const { WebSocketServer } = require("ws");
const hospitalConfig = require("../config/hospitalConfig");
const CallLog = require("../models/CallLog");
const Appointment = require("../models/Appointment");
const { getSession, clearSession } = require("../utils/sessions");
const { getAIReply, extractBooking, extractDraft } = require("./aiService");
const { textToPcm } = require("./ttsService");
const { transcribePcmAudio } = require("./sttService");
const { extractPatientNameFromSpeech, parseSpelledName, extractNameFromAssistantSpeech, toEnglishName } = require("../utils/transliterate");
const { applyCallerTurn, applyAiDraft, finalizeBookingName, isInvalidPatientName } = require("../utils/nameState");
const { calculatePcmRms, analyzeVoiceActivity } = require("../utils/audioDsp");
const { getCurrentTimeContext } = require("./pdfKnowledgeMemory");
const heuristics = { parseSpelledName, extractPatientNameFromSpeech };

/**
 * Attaches the Exotel AgentStream WebSocket server to an existing HTTP server.
 */
function setupExotelWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === "/exotel/media" || pathname === "/media" || pathname === "/stream") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws, req) => {
    console.log(`[exotel-ws] Exotel client connected: ${req.url}`);

    let streamSid = null;
    let callSid = null;
    let session = null;
    let sampleRate = 8000;
    let callStartTime = Date.now();

    let isBotSpeaking = false;
    let botSpeechStartTime = 0;
    let currentPlaybackId = 0;

    // VAD & Speech Buffers
    let audioChunks = [];
    let isSpeaking = false;
    let silenceTimer = null;
    let consecutiveLoudChunksDuringBotSpeech = 0;
    let consecutiveSpeechChunks = 0;

    // Rolling buffer of the last 160ms (8 chunks) of audio to prevent initial syllable clipping
    let preRollRingBuffer = [];
    const PRE_ROLL_LIMIT = 8;

    // Dynamic Adaptive VAD & Noise Floor Tracking:
    // Adapts automatically to caller's background (fan, traffic, TV, ambient room noise)
    let ambientNoiseFloor = 280;
    let botSpeechCooldownUntil = 0;
    const SILENCE_DURATION_MS = 1400; // 1.4s silence pause after caller stops talking ensures full thought is captured

    async function fetchAndSaveExotelCallDetails(targetCallSid) {
      if (!targetCallSid || targetCallSid.startsWith("EXO_") || targetCallSid.startsWith("TEST_")) return;
      const apiKey = process.env.EXOTEL_API_KEY;
      const apiToken = process.env.EXOTEL_API_TOKEN;
      const sid = process.env.EXOTEL_SID;
      if (!apiKey || !apiToken || !sid) return;

      const auth = "Basic " + Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
      try {
        const res = await fetch(`https://api.exotel.com/v1/Accounts/${sid}/Calls/${targetCallSid}.json`, {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.Call) {
            const from = data.Call.From || "Unknown";
            const to = data.Call.To || "Unknown";
            const duration = data.Call.Duration ? parseInt(data.Call.Duration, 10) : 0;
            console.log(`[exotel-ws] 📞 Telephony details for ${targetCallSid}: Caller=${from}, To=${to}, Duration=${duration}s`);

            if (session && from !== "Unknown") {
              session.callerPhone = from;
            }

            await CallLog.updateOne(
              { callSid: targetCallSid },
              {
                $set: {
                  from,
                  to,
                  ...(duration > 0 ? { durationSeconds: duration } : {}),
                },
              }
            );
          }
        }
      } catch (err) {
        console.error("[exotel-ws] Telephony details fetch error:", err.message);
      }
    }

    async function sendMediaChunk(chunk) {
      if (ws.readyState !== ws.OPEN || !streamSid) return;
      const payload = chunk.toString("base64");
      const msg = JSON.stringify({
        event: "media",
        stream_sid: streamSid,
        media: { payload },
      });
      ws.send(msg);
    }

    async function clearExotelBuffer() {
      if (ws.readyState !== ws.OPEN || !streamSid) return;
      ws.send(
        JSON.stringify({
          event: "clear",
          stream_sid: streamSid,
        })
      );
    }

    async function speakText(text) {
      if (!text || ws.readyState !== ws.OPEN) return;
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      isBotSpeaking = true;
      botSpeechStartTime = Date.now();
      consecutiveLoudChunksDuringBotSpeech = 0;
      const playbackId = ++currentPlaybackId;

      console.log(`[exotel-ws] 🤖 Bot speaking: "${text}"`);
      try {
        const pcmBuffer = await textToPcm(text, sampleRate);
        const CHUNK_SIZE = Math.floor(sampleRate * 2 * 0.02); // 20ms chunks (320 bytes @ 8kHz)
        const BURST_COUNT = 6; // Pre-buffer 120ms to prevent telephony carrier jitter & underflow
        const startTime = Date.now();

        for (let i = 0; i < pcmBuffer.length; i += CHUNK_SIZE) {
          if (playbackId !== currentPlaybackId) {
            console.log("[exotel-ws] ⚡ Playback interrupted by caller (barge-in)");
            break;
          }
          const chunk = pcmBuffer.subarray(i, i + CHUNK_SIZE);
          await sendMediaChunk(chunk);

          const chunkIndex = Math.floor(i / CHUNK_SIZE);
          if (chunkIndex >= BURST_COUNT) {
            // Target-time pacing with zero cumulative drift
            const targetTime = startTime + (chunkIndex - BURST_COUNT + 1) * 20;
            const waitMs = targetTime - Date.now();
            if (waitMs > 0) {
              await new Promise((r) => setTimeout(r, waitMs));
            }
          }
        }
      } catch (err) {
        console.error("[exotel-ws] TTS playback error:", err.message);
      } finally {
        if (playbackId === currentPlaybackId) {
          // Acoustic echo decay guard: 450ms cooldown allows phone earpiece/speaker echo and carrier buffer to clear
          botSpeechCooldownUntil = Date.now() + 450;
          preRollRingBuffer = [];
          audioChunks = [];
          isSpeaking = false;
          consecutiveSpeechChunks = 0;
          isBotSpeaking = false;
        }
      }
    }

    async function handleUserSpeechTurn() {
      if (audioChunks.length === 0) return;

      const fullPcm = Buffer.concat(audioChunks);
      audioChunks = [];
      isSpeaking = false;
      consecutiveSpeechChunks = 0;

      // Discard clicks/short line noises under 0.45s
      const minBytes = Math.floor(sampleRate * 2 * 0.45);
      if (fullPcm.length < minBytes) {
        return;
      }

      // Voice Activity & SNR Verification: ensure this is genuine patient speech, not background noise/hum
      const vad = analyzeVoiceActivity(fullPcm, sampleRate);
      if (!vad.isGenuineSpeech) {
        console.log(`[exotel-ws] 🔇 Ignored background noise: voiced=${vad.voicedMs}ms, ratio=${vad.speechRatio}, noiseFloor=${vad.noiseFloor}`);
        return;
      }

      console.log(`[exotel-ws] 🎤 Processing caller speech (${fullPcm.length} bytes, voiced=${vad.voicedMs}ms, ratio=${vad.speechRatio})...`);
      const transcribedText = await transcribePcmAudio(fullPcm, sampleRate);

      if (!transcribedText || transcribedText.length < 2) {
        console.log("[exotel-ws] 🔇 Audio was background noise or unintelligible");
        return;
      }

      console.log(`[exotel-ws] 👤 Caller said: "${transcribedText}"`);

      // Dynamically detect doctor based on symptoms or specific doctor names mentioned by caller
      const lowerSpeech = transcribedText.toLowerCase();
      if (/दिल|सीने|हार्ट|बीपी|घबराहट|रोहित|cardiolog/i.test(lowerSpeech)) {
        session.doctorName = "Dr. Rohit Verma";
      } else if (/हड्डी|हड्डियों|जोड़|जोड़ों|कमर|घुटने|फ्रैक्चर|चोट|मोच|पैर|हाथ|गिरे|गिर\s*गए|संजय|orthoped/i.test(lowerSpeech)) {
        session.doctorName = "Dr. Sanjay Gupta";
      } else if (/बच्चा|बच्चे|शिशु|टीकाकरण|प्रिया|pediatric/i.test(lowerSpeech)) {
        session.doctorName = "Dr. Priya Nair";
      } else if (/बुखार|खांसी|जुकाम|कमजोरी|पेट\s*दर्द|सिर\s*दर्द|उल्टी|अनन्या|general/i.test(lowerSpeech)) {
        session.doctorName = "Dr. Ananya Sharma";
      }

      // Automatically capture chosen appointment time slot in session state
      if (/5:30|साढ़े\s*पा|पाँच\s*तीस|पांच\s*तीस|शाम/i.test(lowerSpeech)) {
        session.selectedTime = "5:30 PM";
      } else if (/2:00|दो\s*बजे|दोपहर/i.test(lowerSpeech)) {
        session.selectedTime = "2:00 PM";
      } else if (/10:00|दस\s*बजे|सुबह/i.test(lowerSpeech)) {
        session.selectedTime = "10:00 AM";
      }

      // Single source of truth for name/confirmation state (see utils/nameState.js).
      // Once session.nameConfirmed is true, this will NOT let it be changed again
      // except by an explicit "no, that's wrong" from the caller.
      const nameCtx = applyCallerTurn(session, transcribedText, heuristics);
      if (session.nameConfirmed && session.patientName && !isInvalidPatientName(session.patientName)) {
        console.log(`[exotel-ws] ✅ Patient name locked: "${session.patientName}"`);
      } else if (session.patientName && !isInvalidPatientName(session.patientName)) {
        console.log(`[exotel-ws] 👤 Patient name pending confirmation: "${session.patientName}"`);
      }

      session.messages.push({ role: "user", content: transcribedText });
      CallLog.updateOne(
        { callSid },
        {
          $push: { transcript: { role: "caller", text: transcribedText, timestamp: new Date() } },
          ...(session.patientName ? { patientName: session.patientName, callerName: session.patientName } : {}),
        }
      ).catch((e) => console.error(e.message));

      try {
        const rawReply = await getAIReply(session.messages, session);
        const { draft } = extractDraft(rawReply);
        const { speech, booking } = extractBooking(rawReply);
        console.log(`[exotel-ws] 🤖 AI reply: "${speech}" ${booking ? "[BOOKING DETECTED]" : ""}`);

        // Update name and confirmation status from AI Brain's draft.
        // applyAiDraft is a no-op once session.nameConfirmed is true, so a later
        // turn can never silently swap in a different name the AI mis-hears or invents.
        if (!session.appointmentBooked) {
          const beforeName = session.patientName;
          applyAiDraft(session, draft, toEnglishName);
          if (session.patientName !== beforeName) {
            console.log(`[exotel-ws] 👤 Patient name updated by AI Brain: "${session.patientName}" (Confirmed: ${session.nameConfirmed})`);
          }

          if (
            !session.patientName ||
            session.patientName === "Patient" ||
            session.patientName === "Unknown"
          ) {
            // Check if assistant greeted caller as "[Name] जी"
            const greetedName = extractNameFromAssistantSpeech(speech);
            if (greetedName) {
              session.patientName = greetedName;
              console.log(`[exotel-ws] 👤 Patient name captured from assistant greeting: "${session.patientName}"`);
            }
          }

          if (draft) {
            if (draft.doctorName && (!session.doctorName || session.doctorName === "Not Selected")) {
              session.doctorName = draft.doctorName;
            }
            if (draft.time && (!session.selectedTime || session.selectedTime === "Not Selected")) {
              session.selectedTime = draft.time;
            }
          }
        }

        session.messages.push({ role: "assistant", content: speech });
        CallLog.updateOne(
          { callSid },
          {
            $push: { transcript: { role: "assistant", text: speech, timestamp: new Date() } },
            ...(session.patientName ? { patientName: session.patientName, callerName: session.patientName } : {}),
          }
        ).catch((e) => console.error(e.message));

        if (booking) {
          // If the AI has confirmed the booking, ensure confirmation flag is set and finalize name
          if (!session.nameConfirmed) {
            session.nameConfirmed = true;
          }
          if (booking.patientName && (!session.patientName || session.patientName === "Unknown" || session.patientName === "Patient")) {
            session.patientName = booking.patientName;
          }

          // The booked appointment ALWAYS uses the confirmed patient name
          finalizeBookingName(session, booking);

          // Validate appointment slot & date: Never book or save an appointment for a past slot today!
          const clock = getCurrentTimeContext();
          const bookingDateStr = String(booking.date || "").toLowerCase();
          if (bookingDateStr.includes("today") || bookingDateStr.includes("आज") || !booking.date) {
            let isPast = clock.isTodayOpdClosed;
            if (!isPast && booking.time) {
              const match = booking.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
              if (match) {
                let h = parseInt(match[1], 10);
                const m = parseInt(match[2], 10);
                const ampm = (match[3] || "").toUpperCase();
                if (ampm === "PM" && h < 12) h += 12;
                if (ampm === "AM" && h === 12) h = 0;
                const slotMins = h * 60 + m;
                if (clock.currentMinutesIST >= slotMins) {
                  isPast = true;
                }
              }
            }
            if (isPast) {
              console.log(
                `[exotel-ws] ⏰ Requested slot time (${booking.time}) for today has already passed. Auto-scheduling for ${clock.nextOpenDayBookingDate}`
              );
              booking.date = clock.nextOpenDayBookingDate;
            } else {
              booking.date = `Today (${clock.todayDate})`;
            }
          }

          // Resolve caller phone number from session or CallLog
          let finalPhone = booking.phone || session.callerPhone;
          if (!finalPhone || finalPhone === "Unknown") {
            try {
              const callDoc = await CallLog.findOne({ callSid }).lean();
              if (callDoc && callDoc.from && callDoc.from !== "Unknown") {
                finalPhone = callDoc.from;
              }
            } catch (err) {
              // fallback
            }
          }
          if (!finalPhone) finalPhone = "Unknown";

          console.log("[exotel-ws] 📅 Saving confirmed appointment to MongoDB:", {
            ...booking,
            phone: finalPhone,
            callSid,
          });

          try {
            const savedAppt = await Appointment.create({
              ...booking,
              phone: finalPhone,
              callSid,
              source: "exotel_voicebot",
            });
            console.log(
              `[exotel-ws] ✅ Appointment confirmed & saved in MongoDB! ID: ${savedAppt._id} | Patient: "${savedAppt.patientName}" | Doctor: "${savedAppt.doctorName}" | Time: "${savedAppt.time}"`
            );
          } catch (e) {
            console.error("[db] Save appointment error:", e.message);
          }

          session.appointmentBooked = true;
          CallLog.updateOne(
            { callSid },
            {
              $set: {
                appointmentBooked: true,
                patientName: booking.patientName || session.patientName,
                callerName: booking.patientName || session.patientName,
              },
            }
          ).catch((e) => console.error(e.message));
        }

        await speakText(speech);
      } catch (err) {
        console.error("[exotel-ws] AI/LLM error:", err.message);
        const fallback = "माफ़ कीजियेगा, क्या आप दोबारा बोल सकते हैं?";
        session.messages.push({ role: "assistant", content: fallback });
        CallLog.updateOne(
          { callSid },
          { $push: { transcript: { role: "assistant", text: fallback, timestamp: new Date() } } }
        ).catch((e) => console.error(e.message));
        await speakText(fallback);
      }
    }

    ws.on("message", async (messageStr) => {
      let data;
      try {
        data = JSON.parse(messageStr);
      } catch {
        return;
      }

      const event = data.event;

      if (event === "connected") {
        console.log("[exotel-ws] Exotel media stream connected");
      } else if (event === "start") {
        streamSid = data.stream_sid || (data.start && data.start.stream_sid);
        callSid = data.call_sid || (data.start && data.start.call_sid) || "EXO_" + Date.now();
        callStartTime = Date.now();

        // Detect sample rate if specified by Exotel
        const detectedRate = parseInt(
          data.start?.media_format?.sample_rate || data.media_format?.sample_rate || 8000,
          10
        );
        if ([8000, 16000, 24000].includes(detectedRate)) {
          sampleRate = detectedRate;
        }

        console.log(
          `[exotel-ws] Call started: callSid=${callSid} | streamSid=${streamSid} | sampleRate=${sampleRate}Hz`
        );

        session = getSession(callSid);
        const incomingFrom =
          data.start?.from ||
          data.start?.caller ||
          data.start?.From ||
          data.start?.Caller ||
          data.from ||
          data.caller ||
          data.start?.custom_parameters?.From ||
          data.start?.custom_parameters?.from;
        if (incomingFrom && incomingFrom !== "Unknown") {
          session.callerPhone = incomingFrom;
        }
        session.messages.push({ role: "assistant", content: hospitalConfig.greeting });

        CallLog.findOneAndUpdate(
          { callSid },
          {
            $setOnInsert: {
              callSid,
              direction: "inbound",
              startedAt: new Date(),
            },
            $push: {
              transcript: {
                role: "assistant",
                text: hospitalConfig.greeting,
                timestamp: new Date(),
              },
            },
          },
          { upsert: true }
        ).catch((e) => console.error(e.message));

        // Fetch real caller phone number from Exotel API and store in session & DB
        fetchAndSaveExotelCallDetails(callSid);
        setTimeout(() => fetchAndSaveExotelCallDetails(callSid), 2500);

        // Speak initial greeting to the caller
        speakText(hospitalConfig.greeting);
      } else if (event === "media") {
        if (!data.media || !data.media.payload) return;
        const chunk = Buffer.from(data.media.payload, "base64");

        // Calculate RMS volume of incoming 16-bit PCM chunk using DSP utility
        const rms = calculatePcmRms(chunk);

        // Maintain a rolling ring buffer of recent chunks (last 160ms)
        preRollRingBuffer.push(chunk);
        if (preRollRingBuffer.length > PRE_ROLL_LIMIT) {
          preRollRingBuffer.shift();
        }

        // Dynamically compute speech thresholds based on ambient background noise floor
        const dynamicSpeechThreshold = Math.max(700, Math.min(2400, Math.round(ambientNoiseFloor * 2.2 + 200)));
        const speechMaintainThreshold = Math.round(dynamicSpeechThreshold * 0.65);
        // 1. Acoustic Echo Guard: While bot is speaking or within the 450ms echo cooldown,
        // ignore all incoming audio to prevent the bot's own voice from cutting off playback
        // or triggering false speech recognition.
        if (isBotSpeaking || Date.now() < botSpeechCooldownUntil) {
          return;
        }

        // 2. Bot is not speaking: Listen to the caller
        if (rms > dynamicSpeechThreshold) {
          consecutiveSpeechChunks++;
          if (!isSpeaking) {
            // Require at least 3 consecutive voiced chunks (~60ms) before activating speech
            // This filters out transient clicks, coughs, mic pops, or short background noises
            if (consecutiveSpeechChunks >= 3) {
              isSpeaking = true;
              // Prepend pre-roll buffer so the onset consonant is never lost!
              audioChunks = [...preRollRingBuffer];
            }
          } else {
            audioChunks.push(chunk);
          }

          if (isSpeaking && silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        } else {
          // Chunk energy is at or below dynamic speech threshold
          consecutiveSpeechChunks = 0;

          if (isSpeaking) {
            audioChunks.push(chunk);

            // If audio drops below maintain threshold, count as silence
            if (rms <= speechMaintainThreshold) {
              if (!silenceTimer) {
                silenceTimer = setTimeout(() => {
                  silenceTimer = null;
                  handleUserSpeechTurn();
                }, SILENCE_DURATION_MS);
              }
            }
          } else {
            // Caller is NOT speaking: smoothly adapt ambient noise floor to room environment
            if (rms > ambientNoiseFloor) {
              ambientNoiseFloor = ambientNoiseFloor * 0.94 + rms * 0.06;
            } else {
              ambientNoiseFloor = ambientNoiseFloor * 0.98 + rms * 0.02;
            }
            if (ambientNoiseFloor < 150) ambientNoiseFloor = 150;
            if (ambientNoiseFloor > 1400) ambientNoiseFloor = 1400;
          }
        }
      } else if (event === "dtmf") {
        console.log(`[exotel-ws] DTMF received: ${data.dtmf?.digit}`);
      } else if (event === "stop") {
        console.log(`[exotel-ws] Stream stopped for call ${callSid}`);
        const callDuration = Math.max(0, Math.round((Date.now() - callStartTime) / 1000));
        CallLog.updateOne(
          { callSid },
          { status: "completed", endedAt: new Date(), durationSeconds: callDuration }
        ).catch((e) => console.error(e.message));
        fetchAndSaveExotelCallDetails(callSid);
        clearSession(callSid);
      }
    });

    ws.on("close", () => {
      console.log(`[exotel-ws] WebSocket closed for call ${callSid}`);
      if (silenceTimer) clearTimeout(silenceTimer);
      if (callSid) clearSession(callSid);
    });

    ws.on("error", (err) => {
      console.error("[exotel-ws] WebSocket error:", err.message);
    });
  });

  return wss;
}

module.exports = { setupExotelWebSocketServer };
