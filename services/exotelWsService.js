/**
 * Call WebSocket handler — Exotel AgentStream (/exotel/media) aur Plivo Audio
 * Streaming (/plivo/media). Protocol farq services/telephony.js me.
 *
 * Major fixes vs old version:
 *  1. Outbound audio 320-byte (20 ms) chunks me jaata tha. Exotel ka rule:
 *     "Minimum 3.2 KB, maximum 100 KB, multiple of 320" — chhote chunks = toota
 *     /robotic audio. Ab >= 3200-byte frames.
 *  2. Barge-in: bot bolte waqt caller ka SAARA audio ignore hota tha;
 *     `clearExotelBuffer()` kabhi call hi nahi hota tha. Ab caller bole to bot
 *     ruk jaata hai (Exotel "clear" + TTS abort).
 *  3. Overlapping turns: STT+LLM ke 2-3 s me caller "hello?" bole to doosra turn
 *     parallel chal jaata tha -> do jawab, messages ulte, double booking.
 *     Ab turns serialize; naya speech aaye to purana LLM call abort + text merge.
 *  4. Har turn pe regex se doctor/time overwrite ("हाथ" -> ortho, "शाम" -> 5:30)
 *     aur ek baar set hone ke baad caller badal nahi sakta tha. Hataya; LLM draft
 *     + server validation.
 *  5. Booking bina validation seedha DB me. Ab bookingService (doctor day, past
 *     slot, capacity, duplicate) — confirmation SAVED record se bolte hain.
 *  6. Dead air: LLM slow ho to chhota filler ("हम्म, एक सेकंड"); caller chup ho
 *     to reprompt; emergency keywords pe turant deterministic jawab; "इंसान से
 *     बात" pe handoff (stream close -> Exotel flow ka agla applet).
 *  7. Playback end "mark" event se track; end-of-turn 1.4 s -> 0.8 s.
 */
const { WebSocketServer } = require("ws");
const hospitalConfig = require("../config/hospitalConfig");
const { getSession, clearSession } = require("../utils/sessions");
const { extractPatientNameFromSpeech, parseSpelledName, toEnglishName } = require("../utils/transliterate");
const { applyCallerTurn, applyAiDraft, isInvalidPatientName, classifyConfirmation } = require("../utils/nameState");
const { getClock, relativeDayLabel } = require("./hospitalKnowledge");
const { calculatePcmRms, analyzeVoiceActivity } = require("../utils/audioDsp");
const { ADAPTERS, verifyStream } = require("./telephony");

const heuristics = { parseSpelledName, extractPatientNameFromSpeech };

const num = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
const CONF = {
  endOfTurnMs: num(process.env.END_OF_TURN_MS, 800),
  maxUtteranceMs: num(process.env.MAX_UTTERANCE_MS, 15000),
  bargeIn: process.env.BARGE_IN !== "false",
  bargeInMs: num(process.env.BARGE_IN_MS, 300),
  bargeInGraceMs: num(process.env.BARGE_IN_GRACE_MS, 500),
  fillerAfterMs: num(process.env.FILLER_AFTER_MS, 1300),
  idleRepromptMs: num(process.env.IDLE_REPROMPT_MS, 7000),
  maxReprompts: num(process.env.MAX_REPROMPTS, 2),
  echoCooldownMs: num(process.env.ECHO_COOLDOWN_MS, 250),
  handoff: process.env.HUMAN_HANDOFF === "true",
  // Smooth: LLM stream karo aur pehla vaakya aate hi bolo
  streamLlm: process.env.LLM_STREAM !== "false",
  // Cost guard: ek call kitni der max (Exotel per-minute + har turn ka LLM/TTS)
  maxCallSec: num(process.env.MAX_CALL_SECONDS, 420),
};

const PHRASES = {
  greeting: hospitalConfig.greeting,
  fillers: [],
  reprompts: ["हेलो, क्या आप लाइन पर हैं?", "मुझे आपकी आवाज़ नहीं आ रही, थोड़ा ज़ोर से बोलिए।"],
  goodbye: "लगता है लाइन में दिक्कत है। आप कभी भी दोबारा कॉल कर सकते हैं। धन्यवाद!",
  sorry: "माफ़ कीजिए, आवाज़ थोड़ी कट गई। एक बार फिर से बताएँगे?",
  emergency: hospitalConfig.emergencyReply,
  emergencyFollowUp: "और अगर अभी हालत ठीक है, तो मैं डॉक्टर की अपॉइंटमेंट भी बुक कर सकती हूँ।",
  handoff: hospitalConfig.handoffReply,
  timeLimit: "माफ़ कीजिए, कॉल का समय पूरा हो रहा है। बाकी जानकारी के लिए आप दोबारा कॉल कर सकते हैं। धन्यवाद!",
};

// LLM ne caller ki "haan" ke bina hi "बुक कर रही हूँ" bola => stream me turant mat bolo,
// pehle server booking guard chalne do.
const BOOKING_PHRASE_RE = /बुक\s*कर\s*(?:रही|दी|दिया|दूँगी)|पक्की|कन्फ़र्म|confirm/i;

const EMERGENCY_RE =
  /(?:सीने|छाती)\s*में\s*(?:बहुत\s*)?(?:तेज़?|भयंकर)\s*दर्द|हार्ट\s*अटैक|heart\s*attack|(?:सांस|साँस)\s*(?:नहीं\s*(?:आ|ले)|लेने\s*में\s*(?:बहुत\s*)?(?:दिक्कत|तकलीफ))|बेहोश|unconscious|एक्सीडेंट|accident|दुर्घटना|खून\s*(?:बह|निकल)|लकवा|स्ट्रोक|stroke|ज़हर|जहर\s*खा|दौरा\s*पड़|suicide|आत्महत्या/i;
const HANDOFF_RE =
  /(?:किसी\s*)?(?:इंसान|आदमी|व्यक्ति|रिसेप्शन|रिसेप्शनिस्ट|ऑपरेटर|मैनेजर|staff|human|operator|receptionist|real\s*person)\s*(?:से)?\s*(?:बात|जोड़|connect|transfer)/i;

function defaultDeps() {
  return {
    stt: require("./sttService").transcribePcmAudio,
    ai: require("./aiService"),
    tts: require("./ttsService"),
    booking: require("./bookingService"),
    CallLog: require("../models/CallLog"),
  };
}

function setupExotelWebSocketServer(httpServer, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  httpServer.activeCalls = new Set();

  httpServer.on("upgrade", (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, "http://x");
    } catch {
      return socket.destroy();
    }
    const makeAdapter = ADAPTERS[url.pathname];
    if (!makeAdapter) return socket.destroy();
    // Plivo: answer XML ne har call ke liye signed URL diya hai (?c=<CallUUID>&t=<hmac>)
    if (url.pathname.startsWith("/plivo") && !verifyStream(url.searchParams.get("c"), url.searchParams.get("t"))) {
      console.warn("[ws] rejected unsigned Plivo stream");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, makeAdapter()));
  });

  wss.on("connection", (ws, adapter) => handleCall(ws, deps, httpServer.activeCalls, adapter));
  return wss;
}

function handleCall(ws, deps, activeCalls, adapter = ADAPTERS["/exotel/media"]()) {
  const { ai, tts, booking, CallLog } = deps;
  const db = (p) => Promise.resolve(p).catch((e) => console.error("[db]", e.message));

  let callSid = null;
  let session = null;
  let sampleRate = 8000;
  let callStart = Date.now();
  let closed = false;

  // Frame math: ~100 ms, multiple of 320 (Exotel: >= 3200 bytes; Plivo: koi minimum nahi)
  let FRAME_BYTES = 3200;
  let FRAME_MS = 200;
  let LEAD_MS = 400;
  const setRate = (r) => {
    sampleRate = r;
    const bytesPer100ms = Math.round((r * 2 * 0.1) / 320) * 320;
    FRAME_BYTES = Math.max(adapter.minFrameBytes, bytesPer100ms);
    FRAME_MS = (FRAME_BYTES / (r * 2)) * 1000;
    LEAD_MS = Math.max(400, FRAME_MS * 2);
  };
  setRate(8000);

  const log = (...a) => console.log(`[call ${callSid ? callSid.slice(-6) : "------"}]`, ...a);

  // ------------------------------------------------------------ outbound
  const send = (obj) => {
    if (obj && ws.readyState === ws.OPEN && adapter.ready()) ws.send(JSON.stringify(obj));
  };
  const sendMedia = (buf) => send(adapter.media(buf, sampleRate));
  const sendClear = () => send(adapter.clear());
  const sendMark = (name) => send(adapter.mark(name));

  let current = null; // active playback
  let playSeq = 0;
  let cooldownUntil = 0;
  const isBotSpeaking = () => Boolean(current);

  /**
   * Playback = text segments ki queue. Pehla vaakya synthesize hote hi bolna shuru,
   * baaki vaakya peeche-peeche (LLM stream se) aate rehte hain. Ek hi Exotel "mark"
   * aakhir me.
   *   const pb = startPlayback(); pb.push("पहला वाक्य।"); pb.push("दूसरा।"); pb.end();
   */
  function startPlayback({ cacheable = false } = {}) {
    if (closed) {
      const dead = { push() { }, end() { }, done: Promise.resolve(false), finished: true };
      return dead;
    }
    if (current) stopPlayback("replaced");
    clearIdle();
    const id = ++playSeq;
    const p = {
      id,
      ac: new AbortController(),
      pending: Buffer.alloc(0),
      sentMs: 0,
      playEnd: 0, // virtual playhead: Exotel kab tak bajaega (ms epoch)
      ttsDone: false,
      finished: false,
      startedAt: Date.now(),
      queue: [],
      texts: [],
      ended: false,
      working: false,
      onStop: null,
    };
    current = p;
    let resolveDone;
    p.done = new Promise((r) => (resolveDone = r));
    p.finish = (completed) => {
      if (p.finished) return;
      p.finished = true;
      clearInterval(p.timer);
      clearTimeout(p.endTimer);
      if (current === p) {
        current = null;
        cooldownUntil = Date.now() + CONF.echoCooldownMs;
        resetCapture();
        armIdle();
      }
      resolveDone(completed);
    };

    const pump = () => {
      if (p.finished) return;
      const now = Date.now();
      while (p.pending.length >= FRAME_BYTES || (p.ttsDone && p.pending.length > 0)) {
        if (p.playEnd - now > LEAD_MS) break;
        let frame = p.pending.subarray(0, FRAME_BYTES);
        p.pending = p.pending.subarray(frame.length);
        if (frame.length < FRAME_BYTES) frame = Buffer.concat([frame, Buffer.alloc(FRAME_BYTES - frame.length)]);
        sendMedia(frame);
        // Vaakyon ke beech TTS late ho to playhead "abhi" se aage badhta hai (gap ka sahi hisaab)
        p.playEnd = Math.max(p.playEnd, now) + FRAME_MS;
        p.sentMs += FRAME_MS;
      }
      if (p.ttsDone && !p.pending.length && !p.endTimer) {
        if (!p.sentMs) return p.finish(false);
        sendMark(`p${id}`);
        const remaining = Math.max(0, p.playEnd - Date.now());
        p.endTimer = setTimeout(() => p.finish(true), remaining + 200);
      }
    };
    p.timer = setInterval(pump, 20);

    const onChunk = async (b) => {
      if (p.finished) return;
      p.pending = p.pending.length ? Buffer.concat([p.pending, b]) : b;
      pump();
    };

    const work = async () => {
      if (p.working) return;
      p.working = true;
      while (p.queue.length && !p.finished) {
        const text = p.queue.shift();
        p.texts.push(text);
        log(`🤖 "${text}"`);
        try {
          const bytes = await tts.speakToPcm(text, sampleRate, { signal: p.ac.signal, cacheable, onChunk });
          if (!bytes && !p.ac.signal.aborted) console.error("[tts] all engines failed for:", text);
        } catch (err) {
          if (!p.ac.signal.aborted) console.error("[tts] error:", err.message);
        }
      }
      p.working = false;
      if (p.ended && !p.queue.length) {
        p.ttsDone = true;
        pump();
      }
    };

    p.push = (text) => {
      if (p.finished || p.ended || !text) return;
      p.queue.push(text);
      work();
    };
    p.end = () => {
      if (p.ended) return;
      p.ended = true;
      if (!p.working && !p.queue.length) {
        p.ttsDone = true;
        pump();
      }
    };
    return p;
  }

  function play(text, opts = {}) {
    if (!text || closed) return Promise.resolve(false);
    const p = startPlayback(opts);
    p.push(text);
    p.end();
    return p.done;
  }

  function stopPlayback(reason) {
    if (!current) return;
    const p = current;
    log(`⚡ playback stopped (${reason})`);
    p.ac.abort();
    sendClear();
    p.finish(false);
    if (p.onStop) p.onStop(reason);
  }

  // ------------------------------------------------------------ inbound VAD
  let capturing = false;
  let captureChunks = [];
  let captureMs = 0;
  let loudRun = 0;
  let silenceMs = 0;
  let bargeLoudMs = 0;
  let preRoll = [];
  let preRollMs = 0;
  let noiseFloor = 280;

  function resetCapture() {
    capturing = false;
    captureChunks = [];
    captureMs = 0;
    loudRun = 0;
    silenceMs = 0;
    bargeLoudMs = 0;
  }

  function onAudio(chunk) {
    const chunkMs = (chunk.length / (sampleRate * 2)) * 1000;
    if (!chunkMs) return;
    const rms = calculatePcmRms(chunk);

    preRoll.push(chunk);
    preRollMs += chunkMs;
    while (preRollMs > 240 && preRoll.length > 1) preRollMs -= (preRoll.shift().length / (sampleRate * 2)) * 1000;

    const speechThr = Math.max(700, Math.min(2400, noiseFloor * 2.2 + 200));
    const keepThr = speechThr * 0.65;

    // Bot is talking: only a clear, sustained voice counts as barge-in
    if (isBotSpeaking()) {
      if (!CONF.bargeIn || Date.now() - current.startedAt < CONF.bargeInGraceMs) return;
      const bargeThr = Math.max(1500, speechThr * 1.6);
      bargeLoudMs = rms > bargeThr ? bargeLoudMs + chunkMs : Math.max(0, bargeLoudMs - chunkMs);
      if (bargeLoudMs >= CONF.bargeInMs) {
        stopPlayback("barge-in");
        cooldownUntil = 0;
        capturing = true;
        captureChunks = [...preRoll];
        captureMs = preRollMs;
      }
      return;
    }
    if (Date.now() < cooldownUntil) return;

    if (!capturing) {
      if (rms > speechThr) {
        loudRun += chunkMs;
        if (loudRun >= 60) {
          capturing = true;
          clearIdle();
          captureChunks = [...preRoll];
          captureMs = preRollMs;
          silenceMs = 0;
        }
      } else {
        loudRun = 0;
        noiseFloor = rms > noiseFloor ? noiseFloor * 0.94 + rms * 0.06 : noiseFloor * 0.98 + rms * 0.02;
        noiseFloor = Math.min(1400, Math.max(150, noiseFloor));
      }
      return;
    }

    captureChunks.push(chunk);
    captureMs += chunkMs;
    silenceMs = rms <= keepThr ? silenceMs + chunkMs : 0;

    if (silenceMs >= CONF.endOfTurnMs || captureMs >= CONF.maxUtteranceMs) {
      const pcm = Buffer.concat(captureChunks);
      resetCapture();
      onUtterance(pcm);
    }
  }

  // ------------------------------------------------------------ turns
  let sttChain = Promise.resolve();
  let pendingText = "";
  let inflight = null; // { ac, committed }
  let reprompts = 0;
  let emergencyWarned = false;
  let handingOff = false;

  function onUtterance(pcm) {
    if (pcm.length < sampleRate * 2 * 0.3) return;
    const vad = analyzeVoiceActivity(pcm, sampleRate);
    if (!vad.isGenuineSpeech) {
      armIdle();
      return;
    }
    // STT serialized => transcripts stay in spoken order
    sttChain = sttChain
      .then(() => deps.stt(pcm, sampleRate))
      .then((text) => {
        if (!text || text.length < 2) {
          armIdle();
          return;
        }
        log(`👤 "${text}"`);
        reprompts = 0;
        pendingText = pendingText ? `${pendingText} ${text}` : text;
        respond();
      })
      .catch((e) => console.error("[stt]", e.message));
  }

  async function respond() {
    if (closed || handingOff) return;
    // New speech before the previous reply was committed => cancel it, merge text
    if (inflight && !inflight.committed) {
      inflight.ac.abort();
      log("↩️  merged with previous unanswered turn");
    }
    const turn = { ac: new AbortController(), committed: false };
    inflight = turn;
    const userText = pendingText;
    clearIdle();

    // --- deterministic safety paths (no LLM) ---
    if (EMERGENCY_RE.test(userText) && !emergencyWarned) {
      emergencyWarned = true;
      commitUser(turn, userText);
      const line = `${PHRASES.emergency} ${PHRASES.emergencyFollowUp}`;
      commitAssistant(line);
      db(CallLog.updateOne({ callSid }, { $set: { flagged: "emergency" } }));
      await play(line);
      return;
    }
    if (CONF.handoff && HANDOFF_RE.test(userText)) {
      commitUser(turn, userText);
      commitAssistant(PHRASES.handoff);
      await handoff("caller_request");
      return;
    }

    applyCallerTurn(session, userText, heuristics);
    if (CONF.streamLlm && typeof ai.streamAIReply === "function") return respondStreaming(turn, userText);
    return respondBatch(turn, userText);
  }

  /** Purana tareeka: poora LLM jawab aane ke baad bolo (LLM_STREAM=false ya stub AI). */
  async function respondBatch(turn, userText) {

    let fillerPlayback = null;
    const fillerTimer = setTimeout(() => {
      if (!turn.ac.signal.aborted && !isBotSpeaking() && !capturing) {
        fillerPlayback = play(PHRASES.fillers[Math.floor(Math.random() * PHRASES.fillers.length)], { cacheable: true });
      }
    }, CONF.fillerAfterMs);

    let raw;
    try {
      const availabilityText = await booking.getAllAvailabilityText();
      raw = await ai.getAIReply([...session.messages, { role: "user", content: userText }], session, {
        signal: turn.ac.signal,
        availabilityText,
      });
    } catch (err) {
      if (turn.ac.signal.aborted) return clearTimeout(fillerTimer);
      console.error("[ai]", err.message);
      raw = PHRASES.sorry;
    }
    clearTimeout(fillerTimer);
    if (turn.ac.signal.aborted || inflight !== turn || closed) return;

    commitUser(turn, userText);
    const { speech: llmSpeech, draft, booking: bookReq } = ai.parseReply(raw);
    applyDraft(draft);

    let speech = llmSpeech;
    if (bookReq) {
      try {
        speech = await handleBooking(bookReq, llmSpeech, userText);
      } catch (err) {
        console.error("[booking] error:", err.message);
        speech = "माफ़ कीजिए, अभी बुकिंग सेव नहीं हो पाई। थोड़ी देर में दोबारा कॉल कर लीजिए, या मैं रिसेप्शन का नंबर बता दूँ?";
      }
    }
    if (!speech) speech = PHRASES.sorry;

    commitAssistant(speech);
    if (fillerPlayback) await fillerPlayback; // filler ko beech me mat kaato
    if (inflight !== turn || closed) return;
    await play(speech);
  }

  /**
   * Streaming: LLM ka har poora vaakya aate hi TTS queue me. Caller ko pehla shabd
   * ~ (LLM first sentence + TTS first chunk) me sunai deta hai, poore jawab ka intezaar nahi.
   */
  async function respondStreaming(turn, userText) {
    const said = [];
    const held = [];
    const callerSaidYes = classifyConfirmation(userText) === "yes";
    let fillerPlayback = null;
    let gotSpeech = false;
    let pbPromise = null;
    const alive = () => !turn.ac.signal.aborted && inflight === turn && !closed;

    const fillerTimer = setTimeout(() => {
      if (!gotSpeech && alive() && !isBotSpeaking() && !capturing) {
        fillerPlayback = play(PHRASES.fillers[Math.floor(Math.random() * PHRASES.fillers.length)], { cacheable: true });
      }
    }, CONF.fillerAfterMs);

    // Playback lazily: filler chal raha ho to use poora hone do, phir asli jawab
    const getPb = () =>
      pbPromise ||
      (pbPromise = (async () => {
        if (fillerPlayback) await fillerPlayback;
        if (!alive()) return null;
        const pb = startPlayback();
        // Caller beech me bola (barge-in) => LLM stream bhi band, paise bachao
        pb.onStop = () => turn.ac.abort();
        return pb;
      })());
    const speak = (s) => {
      if (!turn.committed) commitUser(turn, userText);
      said.push(s);
      getPb().then((pb) => pb && pb.push(s));
    };

    const onSpeech = (s) => {
      if (!alive()) return;
      gotSpeech = true;
      clearTimeout(fillerTimer);
      if (held.length || (!callerSaidYes && BOOKING_PHRASE_RE.test(s))) held.push(s);
      else speak(s);
    };

    let raw = null;
    try {
      const availabilityText = await booking.getAllAvailabilityText();
      raw = await ai.streamAIReply([...session.messages, { role: "user", content: userText }], session, {
        signal: turn.ac.signal,
        availabilityText,
        onSpeech,
      });
    } catch (err) {
      if (!turn.ac.signal.aborted) console.error("[ai]", err.message);
    }
    clearTimeout(fillerTimer);

    if (!alive()) {
      // Barge-in: jitna bola ja chuka woh history me rahe (LLM ko context mile)
      if (turn.committed && said.length) commitAssistant(said.join(" ") + " …");
      return;
    }
    if (!turn.committed) commitUser(turn, userText);

    const { speech: fullSpeech, draft, booking: bookReq } = ai.parseReply(raw || "");
    applyDraft(draft);

    let tail = [];
    if (bookReq) {
      try {
        tail = [await handleBooking(bookReq, held.join(" ") || fullSpeech, userText)];
      } catch (err) {
        console.error("[booking] error:", err.message);
        tail = ["माफ़ कीजिए, अभी बुकिंग सेव नहीं हो पाई। थोड़ी देर में दोबारा कॉल कर लीजिए, या मैं रिसेप्शन का नंबर बता दूँ?"];
      }
    } else if (held.length) tail = held;
    else if (!said.length) tail = [fullSpeech || PHRASES.sorry];

    if (!alive()) return;
    for (const t of tail.filter(Boolean)) speak(t);
    commitAssistant(said.join(" "));
    const pb = await getPb();
    if (!pb) return;
    pb.end();
    await pb.done;
  }

  function commitUser(turn, text) {
    turn.committed = true;
    pendingText = "";
    session.messages.push({ role: "user", content: text });
    db(CallLog.updateOne({ callSid }, { $push: { transcript: { role: "caller", text, timestamp: new Date() } } }));
  }

  function commitAssistant(text) {
    session.messages.push({ role: "assistant", content: text });
    db(
      CallLog.updateOne(
        { callSid },
        {
          $push: { transcript: { role: "assistant", text, timestamp: new Date() } },
          ...(session.patientName ? { $set: { patientName: session.patientName, callerName: session.patientName } } : {}),
        }
      )
    );
  }

  function applyDraft(draft) {
    if (!draft) return;
    applyAiDraft(session, draft, toEnglishName);
    if (!session.nameConfirmed && /[ऀ-ॿ]/.test(draft.patientName || "") && !isInvalidPatientName(draft.patientName)) {
      session.patientNameSpoken = draft.patientName.trim();
    }
    const doc = booking.normalizeDoctor(draft.doctorName);
    if (doc) session.doctorName = doc.name;
    const shift = booking.normalizeShift(draft.time);
    if (shift) session.selectedTime = shift.time;
    const date = booking.resolveDate(draft.date);
    if (date) session.date = date;
    if (draft.reason) session.reason = String(draft.reason).slice(0, 120);
  }

  async function handleBooking(req, llmSpeech, userText) {
    let name = session.patientName && !isInvalidPatientName(session.patientName) ? session.patientName : null;
    if (!name && req.patientName && !isInvalidPatientName(req.patientName)) name = toEnglishName(req.patientName);
    const request = {
      doctorName: req.doctorName || session.doctorName,
      date: req.date || session.date,
      time: req.time || session.selectedTime,
      reason: req.reason || session.reason,
    };

    // Guard: LLM kabhi-kabhi caller ki "haan" ke bina hi booking tag de deta hai.
    // Caller ne abhi haan nahi bola => khud read-back karke poocho.
    if (classifyConfirmation(userText) !== "yes") {
      const doc = booking.normalizeDoctor(request.doctorName);
      const shift = booking.normalizeShift(request.time);
      const date = booking.resolveDate(request.date);
      if (doc && shift && date && name) {
        const who = (session.patientNameSpoken || name).split(/\s+/)[0];
        log("📅 booking tag without caller 'yes' — asking read-back");
        return `तो ${who} जी, ${doc.hindiName}, ${relativeDayLabel(date, getClock().todayIso)} ${shift.spoken}, बुक कर दूँ?`;
      }
    }

    const result = await booking.validateAndBook({
      request,
      patientName: name,
      phone: session.callerPhone,
      callSid,
    });

    if (!result.ok) {
      log(`📅 booking rejected: ${result.reason}`);
      return result.speech || llmSpeech;
    }
    const appt = result.appointment;
    session.nameConfirmed = true;
    session.patientName = appt.patientName;
    session.appointmentBooked = true;
    session.appointments.push(String(appt._id));
    log(`✅ booked ${appt.patientName} | ${appt.doctorName} | ${appt.date} ${appt.time}${result.duplicate ? " (dup)" : ""}`);
    db(
      CallLog.updateOne(
        { callSid },
        {
          $set: {
            appointmentBooked: true,
            patientName: appt.patientName,
            callerName: appt.patientName,
            doctorName: appt.doctorName,
            appointmentDate: appt.date,
            appointmentTime: appt.time,
          },
        }
      )
    );
    return booking.confirmationSpeech(appt, { spokenName: session.patientNameSpoken });
  }

  async function handoff(reason) {
    handingOff = true;
    log(`☎️  handoff (${reason})`);
    db(CallLog.updateOne({ callSid }, { $set: { handoff: reason } }));
    await play(PHRASES.handoff, { cacheable: true });
    // Stream band => Exotel flow ka AGLA applet chalega (e.g. Connect -> reception)
    setTimeout(() => ws.close(1000, "handoff"), 300);
  }

  /**
   * Call poori tarah kaatna. Exotel: stream band = flow khatam. Plivo: Stream
   * keepCallAlive=true hai (handoff ke liye <Dial> agla element ho sakta hai), isliye
   * sirf WebSocket band karne se call reception pe chali jaati — REST se hangup karo.
   */
  async function hangup(reason) {
    const { PLIVO_AUTH_ID: id, PLIVO_AUTH_TOKEN: tok } = process.env;
    if (adapter.name === "plivo" && id && tok && callSid && !callSid.startsWith("PLV_")) {
      try {
        await fetch(`https://api.plivo.com/v1/Account/${id}/Call/${callSid}/`, {
          method: "DELETE",
          headers: { Authorization: "Basic " + Buffer.from(`${id}:${tok}`).toString("base64") },
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        console.warn("[plivo] hangup failed:", err.message);
      }
    }
    ws.close(1000, reason);
  }

  // ------------------------------------------------------------ idle reprompt
  let idleTimer = null;
  function clearIdle() {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  function armIdle() {
    clearIdle();
    if (closed || handingOff || !adapter.ready()) return;
    idleTimer = setTimeout(async () => {
      if (isBotSpeaking() || capturing || (inflight && !inflight.committed) || pendingText) return armIdle();
      if (reprompts >= CONF.maxReprompts) {
        log("💤 caller silent — ending");
        handingOff = true;
        await play(PHRASES.goodbye, { cacheable: true });
        setTimeout(() => hangup("silence"), 300);
        return;
      }
      const line = PHRASES.reprompts[reprompts++] || PHRASES.reprompts[0];
      session.messages.push({ role: "assistant", content: line });
      play(line, { cacheable: true });
    }, CONF.idleRepromptMs);
  }

  // ------------------------------------------------------------ Exotel events
  async function fetchCallDetails() {
    const { EXOTEL_API_KEY: k, EXOTEL_API_TOKEN: t, EXOTEL_SID: sid } = process.env;
    if (adapter.name !== "exotel" || !k || !t || !sid || !callSid || callSid.startsWith("EXO_")) return;
    try {
      const res = await fetch(`https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}.json`, {
        headers: { Authorization: "Basic " + Buffer.from(`${k}:${t}`).toString("base64") },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const c = (await res.json())?.Call;
      if (!c) return;
      if (c.From && session && !session.callerPhone) session.callerPhone = c.From;
      const duration = parseInt(c.Duration, 10) || 0;
      await db(CallLog.updateOne({ callSid }, { $set: { from: c.From, to: c.To, ...(duration ? { durationSeconds: duration } : {}) } }));
    } catch (err) {
      console.warn("[exotel] call details:", err.message);
    }
  }

  function onStart(ev) {
    callSid = ev.callSid;
    callStart = Date.now();
    if ([8000, 16000, 24000].includes(ev.sampleRate)) setRate(ev.sampleRate);
    activeCalls.add(callSid);

    session = getSession(callSid);
    if (ev.from) session.callerPhone = ev.from;
    // Plivo: number answer webhook se session me pehle hi aa chuka hota hai
    const from = ev.from || session.callerPhone;
    log(`📞 ${adapter.name} start from=${from || "?"} rate=${sampleRate} frame=${FRAME_BYTES}B`);

    if (!session.messages.length || session.messages[session.messages.length - 1].content !== PHRASES.greeting) {
      session.messages.push({ role: "assistant", content: PHRASES.greeting });
    }
    db(
      CallLog.findOneAndUpdate(
        { callSid },
        {
          $setOnInsert: { callSid, direction: session.direction || "inbound", startedAt: new Date(), ...(from ? { from } : {}), ...(ev.to ? { to: ev.to } : {}) },
          $set: { provider: adapter.name },
          $push: { transcript: { role: "assistant", text: PHRASES.greeting, timestamp: new Date() } },
        },
        { upsert: true }
      )
    );
    if (!from) fetchCallDetails();
    play(PHRASES.greeting, { cacheable: true });
    if (CONF.maxCallSec > 0) maxTimer = setTimeout(wrapUpForTime, CONF.maxCallSec * 1000);
  }

  // Cost guard: lambi/atki hui call (bot loop, caller phone rakhna bhool gaya) ko
  // politely band karo. Booking/jawab beech me ho to 20 s tak intezaar.
  let maxTimer = null;
  function wrapUpForTime(waitedMs = 0) {
    if (closed || handingOff) return;
    const busy = isBotSpeaking() || capturing || (inflight && !inflight.committed) || pendingText;
    if (busy && waitedMs < 20000) {
      maxTimer = setTimeout(() => wrapUpForTime(waitedMs + 1000), 1000);
      return;
    }
    log("⏱️  max call duration — wrapping up");
    handingOff = true;
    db(CallLog.updateOne({ callSid }, { $set: { endReason: "max_duration" } }));
    play(PHRASES.timeLimit, { cacheable: true }).then(() => setTimeout(() => hangup("max_duration"), 300));
  }

  function finishCall(reason) {
    if (closed) return;
    closed = true;
    clearIdle();
    clearTimeout(maxTimer);
    if (current) {
      current.ac.abort();
      current.finish(false);
    }
    if (inflight) inflight.ac.abort();
    if (!callSid) return;
    activeCalls.delete(callSid);
    log(`📴 ended (${reason})`);
    db(
      CallLog.updateOne(
        { callSid },
        { $set: { status: "completed", endedAt: new Date(), durationSeconds: Math.round((Date.now() - callStart) / 1000) } }
      )
    );
    fetchCallDetails();
    clearSession(callSid);
  }

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const ev = adapter.parse(data);
    if (!ev) return;
    switch (ev.type) {
      case "start":
        onStart(ev);
        break;
      case "media":
        if (session) onAudio(ev.payload);
        break;
      case "mark":
        if (current && ev.name === `p${current.id}` && current.ttsDone && !current.pending.length) current.finish(true);
        break;
      case "dtmf":
        log(`🔢 DTMF ${ev.digit}`);
        if (ev.digit === "0" && CONF.handoff && !handingOff) {
          stopPlayback("dtmf");
          handoff("dtmf_0");
        }
        break;
      case "stop":
        finishCall(ev.reason);
        break;
    }
  });
  ws.on("close", () => finishCall("ws_close"));
  ws.on("error", (err) => console.error("[ws]", err.message));
}

module.exports = { setupExotelWebSocketServer, PHRASES, CONF };
