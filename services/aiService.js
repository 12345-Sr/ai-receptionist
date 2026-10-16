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

/**
 * COST: system prompt do hisson me hai.
 *  1) STATIC (persona + hospital knowledge + rules + format) — har turn, har call
 *     me byte-for-byte same. Groq (gpt-oss models) aur Gemini (implicit cache)
 *     prompt ke *shuru* ka same hissa cache karte hain => input tokens ~50%+ saste
 *     aur first token tez.
 *  2) DYNAMIC (slots, call state, ghadi) — hamesha AAKHIR me. Pehle ghadi beech me
 *     thi, isliye har minute pura prompt "naya" ho jaata tha aur cache kabhi hit
 *     nahi hota tha.
 */
const STATIC_PROMPT = `Tum "${cfg.hospitalNameEn}" ki receptionist "${cfg.assistantName}" ho, live phone call par. Caller ko lagna chahiye ki woh ek samajhdaar, garam-joshi wali insaan se baat kar raha hai.

## BOLNE KA TAREEKA (sabse zaroori)
- Har jawab 1-2 chhote vaakya, 25 shabdon se kam. Phone par lambi baat bori lagti hai.
- Har vaakya "।" ya "?" se khatam karo (system vaakya-dar-vaakya bolta hai).
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
- Caller se kabhi mat poochho ki aaj/kal kaunsa din hai (neeche ABHI KA SAMAY dekho).

## HOSPITAL KI JAANKARI (sirf isi se jawab do)
${KNOWLEDGE}
Jo is list me nahi (dentist, aankh ke doctor, ghar visit, dawai ka naam): "${cfg.unlistedQueryFallback}"

## BOOKING FLOW
1. Taklif ya doctor samjho -> sahi doctor suggest karo (upar ki list se).
2. Us doctor ke KHAALI SLOTS (neeche) me se sabse nazdeek 2-3 offer karo. Apne se slot mat banao.
3. Slot tay hone par marij ka poora naam poocho. Caller ka phone number mat poocho, woh humare paas hai.
4. Naam aur baaki details EK BAAR padh ke confirm karo, jaise:
   "तो रमेश शर्मा जी, डॉक्टर अनन्या शर्मा, कल सुबह दस बजे, बुक कर दूँ?"
5. Caller "हाँ/कर दो/ठीक है" bole TABHI booking tag do. Tag ke saath bas itna bolo: "ठीक है, बुक कर रही हूँ।"
   (Confirmation ka poora vaakya system khud bolega.)
6. CALL STATE me booked=true ho to dobara booking tag mat dena jab tak caller naya appointment na maange.

## OUTPUT FORMAT (strict)
Pehle sirf bola jaane wala text. Uske BAAD, har jawab ke aakhir me ek line:
${TAGS.draftStart}{"patientName":"<naam Devanagari ya English, na pata ho to khaali>","nameConfirmed":<true sirf jab caller ne naam haan bola>,"doctorName":"<English naam jaise Dr. Rohit Verma, ya khaali>","date":"<YYYY-MM-DD ya khaali>","time":"<10:00 AM | 2:00 PM | 5:30 PM ya khaali>","reason":"<taklif chhote me>"}${TAGS.draftEnd}
Sirf step 5 par, draft ke baad ek aur line:
${TAGS.bookStart}{"patientName":"...","doctorName":"...","date":"YYYY-MM-DD","time":"...","reason":"..."}${TAGS.bookEnd}
Placeholder ya anumaan se value mat bharo; jo pata nahi woh khaali chhodo.`;

function buildDynamicPrompt(session = {}, { availabilityText = "", clock = getClock() } = {}) {
  const name = session.patientName || "";
  const state = {
    patientName: name,
    nameConfirmed: Boolean(session.nameConfirmed && name),
    doctorName: session.doctorName || "",
    date: session.date || "",
    time: session.selectedTime || "",
    booked: Boolean(session.appointmentBooked),
  };
  // Order = sabse kam badalne wala pehle (slots) -> sabse zyada badalne wala aakhir (ghadi)
  return `## KHAALI SLOTS (LIVE DATABASE — sirf yahi offer karo)
${availabilityText || "(availability abhi load nahi hui — pehle doctor/taklif poocho)"}

## CALL STATE (server ka — isse sach maano)
${JSON.stringify(state)}

## ABHI KA SAMAY
- Abhi: ${clock.spokenTime}, आज ${spokenDate(clock.todayIso)} (${clock.todayIso})
- कल = ${spokenDate(clock.tomorrowIso)} (${clock.tomorrowIso}), परसों = ${spokenDate(clock.dayAfterIso)} (${clock.dayAfterIso})`;
}

function buildSystemPrompt(session = {}, opts = {}) {
  return `${STATIC_PROMPT}\n\n${buildDynamicPrompt(session, opts)}`;
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
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    temperature: Number(process.env.LLM_TEMPERATURE || 0.35),
    max_tokens: Number(process.env.LLM_MAX_TOKENS || 600),
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
  if (!models.length) models.push("gemini-3.5-flash-lite");

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
  return FALLBACK_LINE;
}

// ====================================================================
// STREAMING (smoothness): LLM ka pehla vaakya aate hi TTS shuru.
// Pehle poora jawab (+ DRAFT JSON) aane ke baad hi bolna shuru hota tha =>
// har turn pe ~0.5-1.5 s extra chup. Ab caller ko pehla shabd ~LLM first token
// + ek vaakya ke baad sunai deta hai.
// ====================================================================

/** Server-Sent Events -> data payloads */
async function* sseData(res) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) {
        const d = line.slice(5).trim();
        if (d && d !== "[DONE]") yield d;
      }
    }
  }
}

const cleanSpoken = (t) => t.replace(/[*_#`~>|\[\]{}]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Incremental splitter: raw LLM tokens in -> complete spoken sentences out.
 * Tags (<<DRAFT_JSON>>...), code fences, <think> blocks kabhi bahar nahi jaate.
 */
function createSpeechStreamer(onSpeech, { maxChars = 90 } = {}) {
  let raw = "";
  let emitted = 0; // index into visible speech text
  let done = false;

  const visibleSpeech = () => {
    let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const open = t.search(/<think>/i);
    if (open >= 0) t = t.slice(0, open);
    const stop = t.search(/<<|```|\{\s*"/);
    if (stop >= 0) return { text: t.slice(0, stop), final: true };
    // tail jo kisi tag ki shuruaat ho sakti hai ("<", "`", "{") abhi mat bolo
    const m = t.match(/[<`{][^\s]{0,2}$/);
    return { text: m ? t.slice(0, m.index) : t, final: false };
  };

  const emit = (seg) => {
    const c = cleanSpoken(seg);
    if (c && /[ऀ-ॿa-zA-Z0-9]/.test(c)) onSpeech(c);
  };

  function scan(flush) {
    const { text, final } = visibleSpeech();
    const rest = text.slice(emitted);
    // Sentence end: । ? ! (aur "." sirf jab uske baad space ho aur pehle 3+ akshar ka shabd ho —
    // "डॉक्टर एच.एस. चावला" beech me na kate)
    const re = /[।?!]+|(?<=[^\s.]{3})\.(?=\s)/g;
    let last = 0;
    let m;
    while ((m = re.exec(rest))) {
      const end = m.index + m[0].length;
      emit(rest.slice(last, end));
      last = end;
    }
    let pending = rest.slice(last);
    // Bahut lamba vaakya bina viram => comma pe tod do (pehla audio jaldi)
    if (pending.length > maxChars) {
      const c = pending.lastIndexOf(",", maxChars);
      if (c > 20) {
        emit(pending.slice(0, c + 1));
        last += c + 1;
        pending = rest.slice(last);
      }
    }
    emitted += last;
    if (final || flush) {
      emit(pending);
      emitted += pending.length;
      done = true;
    }
  }

  return {
    push(delta) {
      raw += delta;
      if (!done) scan(false);
    },
    end() {
      if (!done) scan(true);
      return raw;
    },
    get raw() {
      return raw;
    },
  };
}

function streamTimeouts(signal, firstTokenMs, totalMs) {
  const ac = new AbortController();
  const first = setTimeout(() => ac.abort(new Error("first-token timeout")), firstTokenMs);
  const total = setTimeout(() => ac.abort(new Error("total timeout")), totalMs);
  return {
    signal: anySignal([signal, ac.signal]),
    gotToken: () => clearTimeout(first),
    clear: () => (clearTimeout(first), clearTimeout(total)),
  };
}

/** @returns {Promise<boolean>} true agar kuch bhi text aaya */
async function streamGroq(messages, systemPrompt, signal, onDelta) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return false;
  const body = {
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    temperature: Number(process.env.LLM_TEMPERATURE || 0.35),
    max_tokens: Number(process.env.LLM_MAX_TOKENS || 600),
    stream: true,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };
  if (process.env.GROQ_REASONING_EFFORT) body.reasoning_effort = process.env.GROQ_REASONING_EFFORT;
  if (process.env.GROQ_REASONING_FORMAT) body.reasoning_format = process.env.GROQ_REASONING_FORMAT;

  const t = streamTimeouts(signal, Number(process.env.GROQ_TIMEOUT_MS || 2500), 10000);
  let got = false;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    if (!res.ok || !res.body) {
      console.warn(`[ai] Groq stream ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
      return false;
    }
    for await (const d of sseData(res)) {
      let j;
      try {
        j = JSON.parse(d);
      } catch {
        continue;
      }
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) {
        got = true;
        t.gotToken();
        onDelta(delta);
      }
      const u = j.usage || j.x_groq?.usage;
      if (u && process.env.LOG_LLM_USAGE === "true") {
        const cached = u.prompt_tokens_details?.cached_tokens || 0;
        console.log(`[ai] groq tokens in=${u.prompt_tokens} (cached ${cached}) out=${u.completion_tokens}`);
      }
    }
    return got;
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("[ai] Groq stream error:", err.message);
    return got;
  } finally {
    t.clear();
  }
}

async function streamGemini(messages, systemPrompt, signal, onDelta) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return false;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const generationConfig = {
    temperature: Number(process.env.LLM_TEMPERATURE || 0.35),
    maxOutputTokens: Number(process.env.LLM_MAX_TOKENS || 600) + 100,
  };
  if (process.env.GEMINI_THINKING_LEVEL) generationConfig.thinkingConfig = { thinkingLevel: process.env.GEMINI_THINKING_LEVEL };

  const t = streamTimeouts(signal, Number(process.env.GEMINI_TIMEOUT_MS || 4000), 12000);
  let got = false;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig }),
      signal: t.signal,
    });
    if (!res.ok || !res.body) {
      console.warn(`[ai] Gemini stream (${model}) ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
      return false;
    }
    for await (const d of sseData(res)) {
      let j;
      try {
        j = JSON.parse(d);
      } catch {
        continue;
      }
      const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
      if (text) {
        got = true;
        t.gotToken();
        onDelta(text);
      }
    }
    return got;
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn(`[ai] Gemini stream (${model}) error:`, err.message);
    return got;
  } finally {
    t.clear();
  }
}

const FALLBACK_LINE = "माफ़ कीजिए, लाइन पर थोड़ी दिक्कत आ गई। क्या आप एक बार फिर से बताएँगे?";

/**
 * Streaming reply. `onSpeech(sentence)` har poore vaakya pe turant call hota hai.
 * @returns raw LLM text (tags ke saath) — parseReply() se draft/booking nikalo.
 */
async function streamAIReply(messages, session = {}, opts = {}) {
  const systemPrompt = buildSystemPrompt(session, opts);
  const windowed = normalizeMessages(messages.slice(-16));
  const order = (process.env.LLM_PRIMARY || "groq") === "gemini" ? [streamGemini, streamGroq] : [streamGroq, streamGemini];
  const onSpeech = opts.onSpeech || (() => {});

  for (const fn of order) {
    const sp = createSpeechStreamer(onSpeech);
    const got = await fn(windowed, systemPrompt, opts.signal, (d) => sp.push(d));
    if (got) return sp.end(); // beech me toota ho to bhi jitna aaya woh use karo
  }
  onSpeech(FALLBACK_LINE);
  return FALLBACK_LINE;
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

module.exports = {
  getAIReply,
  streamAIReply,
  createSpeechStreamer,
  parseReply,
  buildSystemPrompt,
  STATIC_PROMPT,
  normalizeMessages,
  TAGS,
};
