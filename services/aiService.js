/**
 * AI brain: prompt + LLM calls (Groq fast path -> Gemini fallback).
 *
 * Fixes vs old version:
 *  - Booking JSON template me defaults pre-filled the ("Dr. Ananya Sharma",
 *    "General Physician", pehla shift) — LLM unhe copy kar deta tha, cardiology
 *    patient bhi "General Physician" me book hota tha. Ab koi default nahi.
 *  - max_tokens 220: Hindi + DRAFT JSON me truncate hota tha; aadha
 *    "<<DRAFT_JSON>>{..." TTS bol deta tha. Ab 450 tokens + unterminated tags strip.
 *  - Qwen3 jaise reasoning models ka <think>...</think> strip.
 *  - Worst case 3s (Groq) + 3x5s (Gemini) = 18s tak silence. Ab caller ka
 *    AbortSignal + per-provider chhote timeouts.
 *  - Gemini key URL (?key=) me thi -> logs me leak. Ab header me.
 *  - Gemini: first message "model" role / consecutive same roles -> 400. Normalised.
 */
const cfg = require("../config/hospitalConfig");
const { buildKnowledgeText, getClock, spokenDate } = require("./hospitalKnowledge");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TAGS = {
  draftStart: "<<DRAFT_JSON>>",
  draftEnd: "<<END_DRAFT_JSON>>",
  bookStart: "<<BOOKING_JSON>>",
  bookEnd: "<<END_BOOKING_JSON>>",
};

const KNOWLEDGE = buildKnowledgeText();

function buildSystemPrompt(session = {}, { availabilityText = "", clock = getClock() } = {}) {
  const name = session.patientName || "";
  const state = {
    patientName: name,
    nameConfirmed: Boolean(session.nameConfirmed && name),
    doctorName: session.doctorName || "",
    date: session.date || "",
    time: session.selectedTime || "",
    booked: Boolean(session.appointmentBooked),
  };

  return `Tum "${cfg.hospitalNameEn}" ki receptionist "${cfg.assistantName}" ho, live phone call par. Caller ko lagna chahiye ki woh ek samajhdaar, garam-joshi wali insaan se baat kar raha hai.

## BOLNE KA TAREEKA (sabse zaroori)
- Har jawab 1-2 chhote vaakya, 25 shabdon se kam. Phone par lambi baat bori lagti hai.
- Ek baar me SIRF EK sawaal poocho.
- Devanagari me likho. Caller Hinglish bole to aam English shabd (appointment, doctor, slot, fees) chalenge.
- Feminine first person: "कर रही हूँ", "देख लेती हूँ", "बता सकती हूँ".
- Chhote natural acknowledgement badal-badal ke: "अच्छा", "ठीक है", "समझ गई", "जी बिल्कुल", "हम्म, देखती हूँ". Har baar ek jaisa mat bolo; pichhla jawab dohraao mat.
- "जी" kam: sirf naam ke baad ("रमेश जी") ya kabhi-kabhi "जी हाँ".
- Koi list, bullet, markdown, emoji, bracket nahi. Samay shabdon me: "सुबह दस बजे", "शाम साढ़े पाँच बजे". Kabhi "10:00 AM" mat bolo.
- Bimari sun ke pehle ek line me hamdardi: "अरे, बुखार में तो बड़ी तकलीफ़ होती है।" — phir kaam ki baat.
- Awaaz saaf na aaye to seedha poocho: "माफ़ कीजिए, आवाज़ थोड़ी कट गई, एक बार फिर से बताएँगे?"
- Koi pooche "kya aap robot/AI ho?" to sach bolo: "जी, मैं अस्पताल की AI असिस्टेंट हूँ, पर बुकिंग पूरी कर सकती हूँ।"
- Dawai ya diagnosis ki salah KABHI nahi. "यह डॉक्टर ही बता पाएँगे" bolo.

## ABHI KA SAMAY
- Abhi: ${clock.spokenTime}, आज ${spokenDate(clock.todayIso)} (${clock.todayIso})
- कल = ${spokenDate(clock.tomorrowIso)} (${clock.tomorrowIso}), परसों = ${spokenDate(clock.dayAfterIso)} (${clock.dayAfterIso})
- Caller se kabhi mat poochho ki aaj/kal kaunsa din hai.

## HOSPITAL KI JAANKARI (sirf isi se jawab do)
${KNOWLEDGE}
Jo is list me nahi (dentist, aankh ke doctor, ghar visit, dawai ka naam): "${cfg.unlistedQueryFallback}"

## KHAALI SLOTS (LIVE DATABASE — sirf yahi offer karo, apne se mat banao)
${availabilityText || "(availability abhi load nahi hui — pehle doctor/taklif poocho)"}

## BOOKING FLOW
1. Taklif ya doctor samjho -> sahi doctor suggest karo (upar ki list se).
2. Us doctor ke KHAALI SLOTS me se sabse nazdeek 2-3 offer karo.
3. Slot tay hone par marij ka poora naam poocho. Caller ka phone number mat poocho, woh humare paas hai.
4. Naam aur baaki details EK BAAR padh ke confirm karo, jaise:
   "तो रमेश शर्मा जी, डॉक्टर अनन्या शर्मा, कल सुबह दस बजे — बुक कर दूँ?"
5. Caller "हाँ/कर दो/ठीक है" bole TABHI booking tag do. Tag ke saath bas itna bolo: "ठीक है, बुक कर रही हूँ।"
   (Confirmation ka poora vaakya system khud bolega.)

## CALL STATE (server ka — isse sach maano)
${JSON.stringify(state)}
${state.booked ? "Appointment ho chuki hai. Ab dobara booking tag mat dena jab tak caller naya appointment na maange." : ""}

## OUTPUT FORMAT (strict)
Pehle sirf bola jaane wala text. Uske BAAD, har jawab ke aakhir me ek line:
${TAGS.draftStart}{"patientName":"<naam Devanagari ya English, na pata ho to khaali>","nameConfirmed":<true sirf jab caller ne naam haan bola>,"doctorName":"<English naam jaise Dr. Rohit Verma, ya khaali>","date":"<YYYY-MM-DD ya khaali>","time":"<10:00 AM | 2:00 PM | 5:30 PM ya khaali>","reason":"<taklif chhote me>"}${TAGS.draftEnd}
Sirf step 5 par, draft ke baad ek aur line:
${TAGS.bookStart}{"patientName":"...","doctorName":"...","date":"YYYY-MM-DD","time":"...","reason":"..."}${TAGS.bookEnd}
Placeholder ya anumaan se value mat bharo; jo pata nahi woh khaali chhodo.`;
}

/** Merge consecutive same-role turns; Gemini needs the first turn to be "user". */
function normalizeMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!m || !m.content) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += " " + m.content;
    else out.push({ role, content: String(m.content) });
  }
  if (out.length && out[0].role === "assistant") out.unshift({ role: "user", content: "(call connected)" });
  return out;
}

function anySignal(signals) {
  const valid = signals.filter(Boolean);
  if (AbortSignal.any) return AbortSignal.any(valid);
  const ac = new AbortController();
  for (const s of valid) {
    if (s.aborted) ac.abort(s.reason);
    else s.addEventListener("abort", () => ac.abort(s.reason), { once: true });
  }
  return ac.signal;
}

async function callGroq(messages, systemPrompt, signal) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const body = {
    model: process.env.GROQ_MODEL || "qwen/qwen3-32b",
    temperature: Number(process.env.LLM_TEMPERATURE || 0.35),
    max_tokens: 450,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };
  // Qwen3/reasoning models: set GROQ_REASONING_EFFORT=none (agar model support kare)
  if (process.env.GROQ_REASONING_EFFORT) body.reasoning_effort = process.env.GROQ_REASONING_EFFORT;
  if (process.env.GROQ_REASONING_FORMAT) body.reasoning_format = process.env.GROQ_REASONING_FORMAT;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: anySignal([signal, AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 2500))]),
    });
    if (!res.ok) {
      console.warn(`[ai] Groq ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("[ai] Groq error:", err.message);
    return null;
  }
}

async function callGemini(messages, systemPrompt, signal) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const models = [...new Set([process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL].filter(Boolean))];
  if (!models.length) models.push("gemini-2.5-flash-lite");

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const generationConfig = { temperature: Number(process.env.LLM_TEMPERATURE || 0.35), maxOutputTokens: 500 };
  if (process.env.GEMINI_THINKING_LEVEL) generationConfig.thinkingConfig = { thinkingLevel: process.env.GEMINI_THINKING_LEVEL };

  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig }),
        signal: anySignal([signal, AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 4000))]),
      });
      if (!res.ok) {
        console.warn(`[ai] Gemini (${model}) ${res.status}: ${(await res.text()).slice(0, 160)}`);
        continue;
      }
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join("")
        .trim();
      if (text) return text;
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn(`[ai] Gemini (${model}) error:`, err.message);
    }
  }
  return null;
}

/**
 * @param {Array} messages  [{role, content}]
 * @param {object} session
 * @param {{signal?: AbortSignal, availabilityText?: string}} opts
 * @returns raw LLM text (or a safe fallback line)
 */
async function getAIReply(messages, session = {}, opts = {}) {
  const systemPrompt = buildSystemPrompt(session, opts);
  const windowed = normalizeMessages(messages.slice(-16));
  const order = (process.env.LLM_PRIMARY || "groq") === "gemini" ? [callGemini, callGroq] : [callGroq, callGemini];

  for (const fn of order) {
    const reply = await fn(windowed, systemPrompt, opts.signal);
    if (reply) return reply;
  }
  return "माफ़ कीजिए, लाइन पर थोड़ी दिक्कत आ गई। क्या आप एक बार फिर से बताएँगे?";
}

function safeJson(str) {
  try {
    const m = String(str).match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Split raw LLM output into { speech, draft, booking }.
 * Robust to: <think> blocks, missing END tags (truncation), code fences, stray JSON.
 */
function parseReply(raw) {
  let text = String(raw || "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "");

  const grab = (start, end) => {
    const s = text.indexOf(start);
    if (s === -1) return null;
    const e = text.indexOf(end, s);
    return safeJson(text.slice(s + start.length, e === -1 ? undefined : e));
  };
  const draft = grab(TAGS.draftStart, TAGS.draftEnd);
  const booking = grab(TAGS.bookStart, TAGS.bookEnd);

  // Speech = everything before the first tag/JSON-ish marker
  let speech = text.split(/<<|```|\{\s*"/)[0];
  speech = speech
    .replace(/[*_#`~>|\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { speech, draft, booking };
}

module.exports = { getAIReply, parseReply, buildSystemPrompt, normalizeMessages, TAGS };
