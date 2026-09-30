const hospitalConfig = require("../config/hospitalConfig");
const { toEnglishName } = require("../utils/transliterate");
const {
  loadPdfKnowledge,
  getCurrentTimeContext,
  AVAILABLE_SHIFTS,
  UNLISTED_QUERY_FALLBACK_HINDI,
} = require("./pdfKnowledgeMemory");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const BOOKING_TAG_START = "<<BOOKING_JSON>>";
const BOOKING_TAG_END = "<<END_BOOKING_JSON>>";

/**
 * Builds the conversational prompt grounded strictly in the official Hospital PDF memory.
 * Designed specifically for a warm, human, empathetic, and facilitating Indian receptionist voice.
 */
function buildCompactSystemPrompt(session = {}, pdfKnowledgeText = "", timeContext = null) {
  const currentDoc = session.doctorName || "Not Selected";
  const currentTime = session.selectedTime || "Not Selected";
  const currentPatient =
    session.patientName && session.patientName !== "Patient" && session.patientName !== "Unknown"
      ? session.patientName
      : "Unknown";
  const isNameConfirmed = Boolean(session.nameConfirmed);

  const clock = timeContext || getCurrentTimeContext();

  const docHindiMap = {
    "Dr. Ananya Sharma": "डॉक्टर अनन्या शर्मा (General Physician)",
    "Dr. Rohit Verma": "डॉक्टर रोहित वर्मा (Cardiologist)",
    "Dr. Priya Nair": "डॉक्टर प्रिया नायर (Pediatrician)",
    "Dr. Sanjay Gupta": "डॉक्टर संजय गुप्ता (Orthopedic)",
    "Dr. Kavita Joshi": "डॉक्टर कविता जोशी (Gynecologist)",
    "Dr. Rajesh Malhotra": "डॉक्टर राजेश मल्होत्रा (ENT Specialist)",
  };
  const docHindi =
    docHindiMap[currentDoc] ||
    (currentDoc !== "Not Selected" ? `डॉक्टर ${currentDoc.replace(/^Dr\.\s*/i, "")}` : "उपयुक्त डॉक्टर");

  const memoryKnowledge =
    pdfKnowledgeText && pdfKnowledgeText.trim().length > 50
      ? pdfKnowledgeText.trim()
      : `OFFICIAL HOSPITAL DIRECTORY:
- Hospital: City Care Hospital (सिटी केयर हॉस्पिटल), 123 MG Road, Kanpur
- Phone: 0512-2345678 | Emergency: 24x7 Open (Dial 112 / 0512-2345679)
- OPD: Mon-Sat 9AM-7PM (Sun Closed, Emergency 24x7) | Fee: Rs 500
- 3 SHIFTS: 1. Subah (Morning) 10:00 AM | 2. Dopahar (Noon) 2:00 PM | 3. Shaam (Evening) 5:30 PM
- DOCTORS:
  1. Dr. Ananya Sharma (General Physician / Cabin 101): Fever, Cold, Cough, Weakness, Stomach pain, BP, Sugar | Mon-Sat | Shifts: 10:00 AM, 2:00 PM, 5:30 PM
  2. Dr. Rohit Verma (Cardiologist / Cabin 104): Heart, Chest pain, High BP, Palpitations | Mon, Wed, Fri | Shifts: 10:00 AM, 2:00 PM, 5:30 PM
  3. Dr. Priya Nair (Pediatrician / Cabin 108): Child fever, Child illness, Vaccination | Tue, Thu, Sat | Shifts: 10:00 AM, 2:00 PM, 5:30 PM
  4. Dr. Sanjay Gupta (Orthopedic / Cabin 112): Bone/Joint pain, Knee, Backache, Arthritis, Fractures | Mon, Tue, Thu, Sat | Shifts: 10:00 AM, 2:00 PM, 5:30 PM
  5. Dr. Kavita Joshi (Gynecologist / Cabin 106): Women health, Pregnancy, Periods, PCOD | Mon-Sat | Shifts: 10:00 AM, 2:00 PM, 5:30 PM
  6. Dr. Rajesh Malhotra (ENT / Cabin 103): Ear pain/discharge, Sinus, Throat pain, Tonsils | Mon, Wed, Sat | Shifts: 10:00 AM, 2:00 PM, 5:30 PM`;

  const defaultSlotDay = clock.isTodayOpdClosed ? clock.nextOpenDayLabel : "आज";
  const defaultBookingDate = clock.isTodayOpdClosed ? clock.nextOpenDayBookingDate : "Today";
  const defaultSlotTime = clock.isTodayOpdClosed
    ? "10:00 AM"
    : clock.availableTodayShifts[0]?.time || "10:00 AM";
  const defaultSlotSpoken = clock.isTodayOpdClosed
    ? `${clock.nextOpenDayLabel} सुबह 10:00 बजे`
    : `आज ${clock.availableTodayShifts[0]?.spoken || "सुबह 10:00 बजे"}`;

  const slotOfferText = clock.isTodayOpdClosed
    ? `आज के सभी ओपीडी स्लॉट पूरे हो चुके हैं। ${clock.nextOpenDayLabel} सुबह दस बजे, दोपहर दो बजे, या शाम साढ़े पाँच बजे में से कौन सा समय ठीक रहेगा आपके लिए?`
    : `आज ${clock.availableTodayShifts.map((s) => s.spoken).join(", या ")} में से कौन सा समय आपके लिए सबसे सुविधाजनक रहेगा?`;

  return `You are a polite, professional, and facilitating Indian female receptionist at "${hospitalConfig.hospitalName}".
You are talking to patients over a live telephone call.

STRICT NATURAL HINDI SPEECH RULES - NO EXCESSIVE "जी" (JI):
- DO NOT add "जी" (ji) repeatedly in every sentence or phrase! Excessive "जी" sounds robotic, repetitive, and unnatural.
- Use "जी" SPARINGLY, ONLY in these two places:
  1. Respectfully after a caller's confirmed name (e.g. "रमेश जी", "सुनीता जी").
  2. An occasional simple affirmative ("जी हाँ" or "जी बिल्कुल").
- IN ALL OTHER PLACES, DO NOT SAY "जी":
  * Say "नमस्ते!" (NEVER say "नमस्ते जी")
  * Say "बिल्कुल चिंता मत कीजिए" (NEVER say "चिंता मत कीजिए जी")
  * Say "माफ़ कीजिए, आज के सभी ओपीडी स्लॉट..." (NEVER say "माफ़ कीजिए जी")
  * Say "परेशान मत होइए" (NEVER say "परेशान मत होइए जी")
  * Say "कोई बात नहीं" (NEVER say "कोई बात नहीं जी")
  * Say "धन्यवाद" (NEVER say "धन्यवाद जी")
  * Say "कृपया मरीज़ का पूरा नाम बताइए" (NEVER say "बताइए जी")
- Speak with natural human confidence, warmth, and brevity.
- NEVER repeat the exact same sentence twice!
- Keep each reply concise: 1 to 2 spoken sentences (max 20-25 words).

CONTEXTUAL INTELLIGENCE & TELEPHONE AUDIO AWARENESS:
- Callers on mobile phones may speak in noisy environments or colloquial Hindi (e.g. "बुकार", "तेज बुखार", "जुवा", "तबीयत खराब", "शरीर टूट रहा है", "घुटनों में दरद").
- BE SMART AND FACILITATING:
  * If the caller says ANYTHING related to fever, cold, cough, weakness, or stomach issues (even if muffled like "बुकार" or "जुवा"):
    Immediately recognize the illness, reassure them, recommend Dr. Ananya Sharma, and offer available upcoming slots:
    Example: "अरे, आपको तेज बुखार है? बिल्कुल परेशान मत होइए, इसके लिए हमारे जनरल फिजिशियन डॉक्टर अनन्या शर्मा सबसे अच्छी रहेंगी। ${slotOfferText}"
  * NEVER say: "मैं आपकी बात पूरी तरह समझ नहीं पा रही हूँ। कृपया बताइए कि आपको कौन सी तकलीफ है..." when the caller just told you their problem!
  * If speech is truly unintelligible or silent, gently facilitate without repeating robotic menus:
    "आवाज़ थोड़ी हल्की आ रही थी। क्या आप बुखार या जुकाम के लिए डॉक्टर दिखाना चाहते हैं?"

LIVE CALENDAR & REAL-TIME CLOCK:
- Current Hospital Time: ${clock.timeStringIST} (${clock.hindiSpokenTime})
- TODAY (आज): ${clock.todayHindi} (${clock.todayEnglish}), ${clock.todayDate}
- TOMORROW (कल): ${clock.tomorrowHindi} (${clock.tomorrowEnglish}), ${clock.tomorrowDate}
- DAY AFTER TOMORROW (परसों): ${clock.dayAfterHindi} (${clock.dayAfterEnglish})
- If caller asks current time ("अभी क्या समय हुआ है?", "टाइम क्या है?", "कितने बजे हैं?"): Immediately answer: "अभी ${clock.hindiSpokenTime} हो रहे हैं। क्या मैं आपकी किसी डॉक्टर से अपॉइंटमेंट बुक कर दूँ?"

${clock.promptSlotRule}

CRITICAL CALENDAR CRITERIA:
- You ALREADY KNOW what day today and tomorrow are! NEVER ask the patient "कल कौन सा दिन है, आप बता देंगे?"!
- If caller asks for tomorrow ("कल की अपॉइंटमेंट चाहिए"):
  You know tomorrow is ${clock.tomorrowHindi} (${clock.tomorrowEnglish})!
  Check if the doctor sits on ${clock.tomorrowEnglish}. If yes, warmly reply:
  "बिल्कुल! कल ${clock.tomorrowHindi} को डॉक्टर उपलब्ध हैं। कल सुबह दस बजे, दोपहर दो बजे, या शाम साढ़े पाँच बजे में से कौन सा समय ठीक रहेगा आपके लिए?"

APPOINTMENT TIMINGS (3 SHIFTS ONLY - ALWAYS SPEAK IN NATURAL HINDI WORDS):
1. सुबह (Morning): 10:00 AM (बोलें: "सुबह दस बजे")
2. दोपहर (Noon): 2:00 PM (बोलें: "दोपहर दो बजे")
3. शाम (Evening): 5:30 PM (बोलें: "शाम साढ़े पाँच बजे")
- Always speak time in words: say "सुबह दस बजे" (NEVER "ten colon zero zero"), "दोपहर दो बजे", "शाम साढ़े पाँच बजे" (NEVER "five thirty").
- If caller picks a slot, warmly acknowledge that exact slot.

OFFICIAL HOSPITAL KNOWLEDGE BASE (FROM PDF data/hospital_and_doctors.pdf):
"""
${memoryKnowledge}
"""

STRICT KNOWLEDGE BOUNDARY (SINGLE SOURCE OF TRUTH):
- If the caller asks ANY question NOT covered in the directory above (unlisted doctors like dentist/eye specialist, outside clinics, home visits, specific medicines):
  Politely reply with:
  "${UNLISTED_QUERY_FALLBACK_HINDI}"

CURRENT CALL STATE:
- Selected Doctor: ${currentDoc}
- Selected Slot: ${currentTime}
- Patient Name: ${currentPatient}
- Name Confirmed: ${isNameConfirmed ? "YES" : "NO"}

FACILITATING RECEPTIONIST WORKFLOW:

ANSWERING GENERAL PATIENT QUESTIONS (FEES, ADDRESS, TESTS, TIMINGS):
- If caller asks common questions (e.g. fees, address, Sunday OPD, tests, pharmacy, walk-in):
  Answer warmly and accurately using the FAQ Memory above, then offer: "क्या मैं आपकी डॉक्टर से अपॉइंटमेंट बुक कर दूँ?"
  Example (Fees): "डॉक्टर साहब की परामर्श फीस ₹500 है। क्या मैं आपकी अपॉइंटमेंट बुक कर दूँ?"
  Example (Address): "हमारा अस्पताल 123 एमजी रोड, सिविल लाइंस के पास, कानपुर में स्थित है। क्या मैं आपके लिए स्लॉट बुक कर दूँ?"

STEP 1: IDENTIFY SYMPTOMS & REASSURE PATIENT
- If symptoms are mentioned (fever, cold, pain):
  Acknowledge with empathy: "अरे, आपको [symptom] है? बिल्कुल परेशान मत होइए, इसके लिए हमारे [डॉक्टर का नाम] सबसे अच्छे रहेंगे।"
  And immediately propose the nearest valid slots: "${slotOfferText}"

STEP 2: CONFIRM TIME SLOT
- Once caller chooses a slot (e.g. ${currentTime !== "Not Selected" ? currentTime : defaultSlotSpoken}):
  Acknowledge warmly: "बिल्कुल, ${currentTime !== "Not Selected" ? currentTime : defaultSlotSpoken} का समय तय कर लेते हैं। अपॉइंटमेंट दर्ज करने के लिए, कृपया मरीज़ का पूरा नाम बता दीजिए।"

STEP 3: COLLECT & CONFIRM NAME
- When caller states their name:
  Repeat: "धन्यवाद। मैंने आपका नाम [Name] नोट किया है। क्या यह सही है?"
- If caller says NO or corrects spelling:
  "कोई बात नहीं, कृपया अपने नाम की स्पेलिंग बता दीजिए।"

STEP 4: FINAL BOOKING CONFIRMATION
- ONLY book when Doctor, upcoming non-expired Slot, and Name are confirmed!
- Output booking JSON tag on its own line:
${BOOKING_TAG_START}{"patientName":"${currentPatient}","doctorName":"${currentDoc !== "Not Selected" ? currentDoc : "Dr. Ananya Sharma"}","department":"General Physician","date":"${defaultBookingDate}","time":"${currentTime !== "Not Selected" ? currentTime : defaultSlotTime}","reason":"Consultation"}${BOOKING_TAG_END}
followed by the warm spoken confirmation: "[Name] जी, आपकी ${docHindi} के साथ ${currentTime !== "Not Selected" ? currentTime : defaultSlotSpoken} की अपॉइंटमेंट बुक हो गई है। कृपया समय पर आएं, धन्यवाद!"

LIVE DETAILS TRACKING (hidden at end of every reply):
<<DRAFT_JSON>>{"patientName":"${currentPatient !== "Unknown" ? currentPatient : ""}","nameConfirmed":${isNameConfirmed},"doctorName":"${currentDoc !== "Not Selected" ? currentDoc : ""}","date":"${defaultBookingDate}","time":"${currentTime !== "Not Selected" ? currentTime : ""}","reason":"Consultation"}<<END_DRAFT_JSON>>`;
}

/**
 * Calls Google Gemini (gemini-3.1-flash-lite) for instant high-quota responses.
 * Never hits 429 rate limits during multi-turn phone calls.
 */
async function callGemini(messages, systemPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const candidateModels = [
    process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
  ];

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  for (const model of candidateModels) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 250,
        },
      };

      const res = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          return text.trim();
        }
      } else {
        const errText = await res.text();
        console.warn(`[aiService] Gemini (${model}) ${res.status}: ${errText.slice(0, 80)}`);
      }
    } catch (err) {
      console.warn(`[aiService] Gemini (${model}) error:`, err.message);
    }
  }

  return null;
}

/**
 * Fast-path Groq LLM (250ms ultra-fast response).
 * If 429 rate limit is reached, returns null IMMEDIATELY with ZERO SLEEP
 * so the call seamlessly fails over to Gemini in under 1 second.
 */
async function callGroq(messages, systemPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 220,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (res.status === 429) {
      console.warn("[aiService] ⚡ Groq 429 rate limit reached! Instant zero-sleep failover to Gemini...");
      return null;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[aiService] Groq error ${res.status}: ${errText.slice(0, 80)}`);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn("[aiService] Groq fast-path timeout/error:", err.message);
    return null;
  }
}

/**
 * High-Resilience Dual-Brain Architecture:
 * 1. Attempts Groq Fast-Path first (blazing ~250ms latency)
 * 2. If Groq hits 429 or is busy, IMMEDIATELY triggers Gemini (gemini-3.1-flash-lite) with 0ms sleep
 * 3. Never leaves the caller in silence or drops the call!
 */
async function getAIReply(messages, session = {}) {
  let pdfKnowledge = "";
  try {
    pdfKnowledge = await loadPdfKnowledge();
  } catch (err) {
    console.warn("[aiService] Could not read PDF knowledge memory:", err.message);
  }

  const timeContext = getCurrentTimeContext();
  const systemPrompt = buildCompactSystemPrompt(session, pdfKnowledge, timeContext);
  // Keep last 10 conversational turns to maintain complete multi-turn context
  const windowedMessages = messages.slice(-10);

  // 1. Fast-Path: Groq (ultra-low 250ms latency)
  if (process.env.GROQ_API_KEY) {
    const groqReply = await callGroq(windowedMessages, systemPrompt);
    if (groqReply) {
      return groqReply;
    }
  }

  // 2. High-Quota Instant Failover: Google Gemini 3.1 Flash Lite (zero 429 risk)
  if (process.env.GEMINI_API_KEY) {
    const geminiReply = await callGemini(windowedMessages, systemPrompt);
    if (geminiReply) {
      return geminiReply;
    }
  }

  // 3. Telephony safety net
  return "माफ़ कीजिए, आवाज़ थोड़ी कट रही थी। क्या आप कल सुबह दस बजे का स्लॉट लेना चाहते हैं?";
}

/**
 * Splits a raw AI reply into spoken text and parsed booking object if confirmed.
 */
function extractBooking(rawReply) {
  let text = String(rawReply || "").trim();

  // Strip DRAFT block completely if present
  const ds = text.indexOf(DRAFT_START);
  const de = text.indexOf(DRAFT_END);
  if (ds !== -1 && de !== -1) {
    text = (text.slice(0, ds) + text.slice(de + DRAFT_END.length)).trim();
  }

  const startIdx = text.indexOf(BOOKING_TAG_START);
  const endIdx = text.indexOf(BOOKING_TAG_END);

  if (startIdx === -1 || endIdx === -1) {
    return { speech: text.trim(), booking: null };
  }

  const jsonStr = text.slice(startIdx + BOOKING_TAG_START.length, endIdx).trim();
  const speech = (
    text.slice(0, startIdx) + text.slice(endIdx + BOOKING_TAG_END.length)
  ).trim();

  let booking = null;
  try {
    booking = JSON.parse(jsonStr);
    if (booking && booking.patientName) {
      booking.patientName = toEnglishName(booking.patientName);
    }
  } catch (e) {
    console.error("[aiService] Failed to parse booking JSON:", e.message);
  }

  return { speech: speech || "आपकी अपॉइंटमेंट कन्फर्म हो गई है। धन्यवाद!", booking };
}

const DRAFT_START = "<<DRAFT_JSON>>";
const DRAFT_END = "<<END_DRAFT_JSON>>";

function extractDraft(rawReply) {
  const s = rawReply.indexOf(DRAFT_START);
  if (s === -1) return { text: rawReply, draft: null };
  const e = rawReply.indexOf(DRAFT_END);
  if (e === -1) return { text: rawReply.slice(0, s).trim(), draft: null };
  let draft = null;
  try {
    draft = JSON.parse(rawReply.slice(s + DRAFT_START.length, e).trim());
  } catch (err) {
    console.error("[aiService] bad draft JSON:", err.message);
  }
  const text = (rawReply.slice(0, s) + rawReply.slice(e + DRAFT_END.length)).trim();
  return { text, draft };
}

module.exports = {
  getAIReply,
  extractBooking,
  extractDraft,
  buildCompactSystemPrompt,
};
