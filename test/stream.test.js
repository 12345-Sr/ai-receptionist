/**
 * Streaming path (LLM_STREAM=true): sentence-by-sentence speech, barge-in that
 * also cancels the LLM stream, the booking guard, Sarvam stream parsing, TTS cache.
 */
process.env.END_OF_TURN_MS = "300";
process.env.FILLER_AFTER_MS = "400";
process.env.IDLE_REPROMPT_MS = "60000";
process.env.BARGE_IN_GRACE_MS = "200";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const WebSocket = require("ws");
const { makeModels, pcm } = require("./helpers");
const booking = require("../services/bookingService");
const ai = require("../services/aiService");
const { setupExotelWebSocketServer, PHRASES } = require("../services/exotelWsService");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness({ sttQueue, aiScript, ttsMsPerChar = 12, tokenDelay = 15 }) {
  const mm = makeModels();
  Object.defineProperty(booking.models, "SlotCounter", { value: mm.SlotCounter, configurable: true });
  Object.defineProperty(booking.models, "Appointment", { value: mm.Appointment, configurable: true });
  booking.invalidateAvailabilityCache();

  const aiCalls = [];
  const timeline = [];
  const state = { streamAborted: 0, streamFinished: 0 };
  const stubAi = {
    parseReply: ai.parseReply,
    async streamAIReply(messages, session, { signal, onSpeech }) {
      const last = messages[messages.length - 1].content;
      aiCalls.push(last);
      const { reply } = aiScript(last, session, aiCalls.length);
      const sp = ai.createSpeechStreamer((s) => {
        timeline.push(["speech", s, Date.now()]);
        onSpeech(s);
      });
      for (const tok of reply.match(/.{1,4}/gsu)) {
        if (signal?.aborted) {
          state.streamAborted++;
          throw new Error("aborted");
        }
        sp.push(tok);
        await sleep(tokenDelay);
      }
      state.streamFinished++;
      timeline.push(["llm_done", null, Date.now()]);
      return sp.end();
    },
  };
  const spoken = [];
  const stubTts = {
    async speakToPcm(text, rate, { onChunk, signal }) {
      spoken.push(text);
      timeline.push(["tts", text, Date.now()]);
      const total = Buffer.alloc(Math.round((text.length * ttsMsPerChar * rate * 2) / 1000), 1);
      for (let i = 0; i < total.length && !signal?.aborted; i += 1234) {
        await onChunk(total.subarray(i, i + 1234));
        await sleep(5);
      }
      return total.length;
    },
  };
  const stt = async () => sttQueue.shift() || "";
  const server = http.createServer();
  setupExotelWebSocketServer(server, { stt, ai: stubAi, tts: stubTts, CallLog: mm.CallLog });
  return { server, mm, aiCalls, spoken, timeline, state };
}

async function connect(server) {
  await new Promise((r) => server.listen(0, r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/exotel/media`);
  const events = [];
  ws.on("message", (m) => {
    const d = JSON.parse(m);
    events.push({ ...d, at: Date.now() });
    if (d.event === "mark") ws.send(JSON.stringify({ event: "mark", stream_sid: "S1", mark: d.mark }));
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ event: "connected" }));
  ws.send(JSON.stringify({
    event: "start", stream_sid: "S1",
    start: { stream_sid: "S1", call_sid: "CALLS", from: "+919999900000", media_format: { encoding: "raw", sample_rate: "8000" } },
  }));
  return { ws, events };
}

async function say(ws, speechMs = 600, silenceMs = 500) {
  const send = async (buf) => {
    for (let i = 0; i < buf.length; i += 320) {
      ws.send(JSON.stringify({ event: "media", stream_sid: "S1", media: { payload: buf.subarray(i, i + 320).toString("base64") } }));
      await sleep(20);
    }
  };
  await send(pcm(speechMs, { amp: 9000 }));
  await send(pcm(silenceMs));
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
}

const marks = (events) => events.filter((e) => e.event === "mark").length;

test("streaming: first sentence is spoken before the LLM finishes; booking still validated", async () => {
  const doctor = booking.normalizeDoctor("Dr. H.S. Chawla");
  let d, t;
  const h = harness({
    sttQueue: ["मुझे बुखार है", "रमेश कुमार", "हाँ कर दो"],
    tokenDelay: 25,
    aiScript: (last) => {
      if (/बुखार/.test(last)) return { reply: `अरे, बुखार में तो तकलीफ़ होती है। डॉक्टर एच.एस. चावला ठीक रहेंगे। मरीज़ का नाम बताइए?\n<<DRAFT_JSON>>{"doctorName":"Dr. H.S. Chawla","date":"${d}","time":"${t}","reason":"बुखार"}<<END_DRAFT_JSON>>` };
      if (/रमेश/.test(last)) return { reply: `तो रमेश कुमार जी, डॉक्टर एच.एस. चावला, बुक कर दूँ?\n<<DRAFT_JSON>>{"patientName":"रमेश कुमार","doctorName":"Dr. H.S. Chawla","date":"${d}","time":"${t}"}<<END_DRAFT_JSON>>` };
      return { reply: `ठीक है, बुक कर रही हूँ।\n<<DRAFT_JSON>>{}<<END_DRAFT_JSON>>\n<<BOOKING_JSON>>{"doctorName":"Dr. H.S. Chawla","date":"${d}","time":"${t}","reason":"बुखार"}<<END_BOOKING_JSON>>` };
    },
  });
  const avail = await booking.getAvailability(doctor);
  d = avail[0].date;
  t = avail[0].shifts[0].time;
  const { ws, events } = await connect(h.server);
  try {
    assert.ok(await waitFor(() => marks(events) >= 1, 6000));
    await sleep(300);

    for (const n of [2, 3, 4]) {
      await say(ws);
      assert.ok(await waitFor(() => marks(events) >= n, 9000), `turn ${n} finished`);
      await sleep(300);
    }

    // Turn 2: TTS of sentence 1 started BEFORE the LLM stream ended
    const firstTts = h.timeline.find((e) => e[0] === "tts" && e[1].startsWith("अरे"));
    const llmDone = h.timeline.find((e) => e[0] === "llm_done");
    assert.ok(firstTts && llmDone && firstTts[2] < llmDone[2], "speech started while LLM was still streaming");
    // Abbreviation not split, tags never spoken
    assert.ok(h.spoken.includes("डॉक्टर एच.एस. चावला ठीक रहेंगे।"));
    assert.ok(h.spoken.every((s) => !/<<|DRAFT|\{/.test(s)), `tag leaked: ${h.spoken}`);

    // Framing rule still holds with multi-sentence playback
    const frames = events.filter((e) => e.event === "media").map((e) => Buffer.from(e.media.payload, "base64").length);
    assert.ok(frames.every((b) => b >= 3200 && b % 320 === 0));
    // One mark per bot turn (not per sentence)
    assert.equal(marks(events), 4);

    assert.equal(h.mm.Appointment.rows.length, 1);
    assert.equal(h.mm.Appointment.rows[0].patientName, "Ramesh Kumar");
    assert.ok(h.spoken.includes("ठीक है, बुक कर रही हूँ।"), "caller said yes => ack spoken early");
    assert.match(h.spoken[h.spoken.length - 1], /^रमेश जी.*पक्की हो गई/);
  } finally {
    ws.close();
    h.server.close();
  }
});

test("streaming: barge-in stops audio AND cancels the LLM stream (no wasted tokens)", async () => {
  const long = "जी, हमारे यहाँ सोमवार से शनिवार ओपीडी चलती है। सुबह दस बजे से शाम सात बजे तक डॉक्टर बैठते हैं। रविवार को सिर्फ़ इमरजेंसी खुली रहती है। और कुछ जानना है?";
  const h = harness({
    sttQueue: ["ओपीडी कब खुलती है", "बस बस ठीक है"],
    tokenDelay: 60,
    ttsMsPerChar: 40,
    aiScript: (last) => ({ reply: /ओपीडी/.test(last) ? long : "जी, बोलिए।" }),
  });
  const { ws, events } = await connect(h.server);
  try {
    assert.ok(await waitFor(() => marks(events) >= 1, 6000));
    await sleep(300);
    await say(ws);
    assert.ok(await waitFor(() => h.spoken.some((s) => s.startsWith("जी, हमारे"))), "first sentence spoken");
    await sleep(400);
    await say(ws, 700, 500); // caller talks over the bot
    assert.ok(await waitFor(() => events.some((e) => e.event === "clear")), "clear sent");
    assert.ok(await waitFor(() => h.state.streamAborted >= 1), "LLM stream aborted");
    assert.ok(await waitFor(() => h.spoken.includes("जी, बोलिए।")), "answered the interruption");
    assert.ok(!h.spoken.includes("और कुछ जानना है?"), "rest of the old answer was not spoken");
  } finally {
    ws.close();
    h.server.close();
  }
});

test("streaming: 'बुक कर रही हूँ' is held when caller did not say yes; server reads back", async () => {
  const doctor = booking.normalizeDoctor("Dr. H.S. Chawla");
  let d, t;
  const h = harness({
    sttQueue: ["मेरा नाम सुनीता वर्मा है"],
    aiScript: () => ({ reply: `ठीक है, बुक कर रही हूँ।\n<<DRAFT_JSON>>{"patientName":"सुनीता वर्मा"}<<END_DRAFT_JSON>>\n<<BOOKING_JSON>>{"doctorName":"Dr. H.S. Chawla","date":"${d}","time":"${t}"}<<END_BOOKING_JSON>>` }),
  });
  const avail = await booking.getAvailability(doctor);
  d = avail[0].date;
  t = avail[0].shifts[0].time;
  const { ws, events } = await connect(h.server);
  try {
    assert.ok(await waitFor(() => marks(events) >= 1, 6000));
    await sleep(300);
    await say(ws);
    assert.ok(await waitFor(() => h.spoken.some((s) => /^तो सुनीता जी, .* बुक कर दूँ\?$/.test(s))), `spoken: ${h.spoken}`);
    assert.ok(!h.spoken.includes("ठीक है, बुक कर रही हूँ।"));
    assert.equal(h.mm.Appointment.rows.length, 0);
  } finally {
    ws.close();
    h.server.close();
  }
});

test("speech streamer: think blocks, split tags, long sentences", () => {
  const out = [];
  const sp = ai.createSpeechStreamer((s) => out.push(s));
  const raw = "<think>सोच रहा हूँ</think>जी बिल्कुल। डॉक्टर एच.एस. चावला सोमवार, मंगलवार, बुधवार, गुरुवार, शुक्रवार और शनिवार को सुबह दस बजे से बैठते हैं, आप किसी भी दिन आ सकते हैं? <";
  for (const ch of [...raw]) sp.push(ch);
  sp.push("<DRAFT_JSON>>{}<<END_DRAFT_JSON>>");
  sp.end();
  assert.equal(out[0], "जी बिल्कुल।");
  assert.ok(out.length >= 3, "long sentence split at a comma");
  assert.ok(out.every((s) => !/[<{]|सोच/.test(s)), JSON.stringify(out));
  assert.ok(out.join(" ").endsWith("सकते हैं?"));
});

test("TTS: Sarvam stream (WAV header stripped), engine order, LRU cache hit", async () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  let calls = 0;
  try {
    process.env.SARVAM_API_KEY = "x";
    delete process.env.ELEVENLABS_API_KEY;
    process.env.TTS_DISABLE_EDGE = "true";
    const pcmBody = Buffer.alloc(1600, 7);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.write("WAVE", 8); header.write("fmt ", 12); header.write("data", 36);
    header.writeUInt32LE(0xffffffff, 40);
    global.fetch = async (url, opts) => {
      calls++;
      assert.match(String(url), /text-to-speech\/stream/);
      const body = JSON.parse(opts.body);
      assert.equal(body.output_audio_codec, "linear16");
      assert.equal(body.speech_sample_rate, 8000);
      const parts = [header.subarray(0, 20), Buffer.concat([header.subarray(20), pcmBody.subarray(0, 801)]), pcmBody.subarray(801)];
      return { ok: true, body: (async function* () { for (const p of parts) yield p; })() };
    };
    delete require.cache[require.resolve("../services/ttsService")];
    const tts = require("../services/ttsService");
    assert.deepEqual(tts.engineOrder(), ["sarvam"]);
    const got = [];
    const n = await tts.speakToPcm("ठीक है।", 8000, { onChunk: async (b) => got.push(b) });
    assert.equal(n, 1600);
    assert.ok(Buffer.concat(got).equals(pcmBody), "header removed, odd split re-aligned");
    const again = await tts.speakToPcm("ठीक है।", 8000, { onChunk: async () => {} });
    assert.equal(again, 1600);
    assert.equal(calls, 1, "short phrase served from cache");
    assert.equal(tts.ttsStats().hits, 1);
  } finally {
    global.fetch = realFetch;
    process.env = env;
    delete require.cache[require.resolve("../services/ttsService")];
  }
});

test("prompt: static part first and identical across turns (prefix-cache friendly)", () => {
  const a = ai.buildSystemPrompt({ patientName: "A" }, { availabilityText: "x" });
  const b = ai.buildSystemPrompt({ patientName: "B", appointmentBooked: true }, { availabilityText: "y" });
  assert.ok(a.startsWith(ai.STATIC_PROMPT) && b.startsWith(ai.STATIC_PROMPT));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(ai.STATIC_PROMPT), "no dates in the cached prefix");
});

test("streamAIReply: parses Groq SSE; falls back to Gemini SSE when Groq fails", async () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  const sse = (objs) => (async function* () {
    const text = objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n";
    const b = Buffer.from(text);
    for (let i = 0; i < b.length; i += 17) yield b.subarray(i, i + 17); // split mid-UTF8 on purpose
  })();
  try {
    process.env.GROQ_API_KEY = "g";
    process.env.GEMINI_API_KEY = "m";
    delete process.env.LLM_PRIMARY;
    let groqOk = true;
    const hits = [];
    global.fetch = async (url, opts) => {
      hits.push(String(url));
      if (/groq/.test(url)) {
        assert.equal(JSON.parse(opts.body).stream, true);
        if (!groqOk) return { ok: false, status: 503, text: async () => "busy" };
        return { ok: true, body: sse([{ choices: [{ delta: { content: "जी, बताइए। " } }] }, { choices: [{ delta: { content: "क्या तकलीफ़ है?\n<<DRAFT_JSON>>{}<<END_DRAFT_JSON>>" } }] }]) };
      }
      assert.match(String(url), /streamGenerateContent\?alt=sse/);
      return { ok: true, body: sse([{ candidates: [{ content: { parts: [{ text: "जी, मैं सुन रही हूँ।" }] } }] }]) };
    };
    const said = [];
    const raw = await ai.streamAIReply([{ role: "user", content: "हेलो" }], {}, { onSpeech: (s) => said.push(s) });
    assert.deepEqual(said, ["जी, बताइए।", "क्या तकलीफ़ है?"]);
    assert.match(raw, /<<DRAFT_JSON>>/);

    groqOk = false;
    said.length = 0;
    await ai.streamAIReply([{ role: "user", content: "हेलो" }], {}, { onSpeech: (s) => said.push(s) });
    assert.deepEqual(said, ["जी, मैं सुन रही हूँ।"]);
    assert.ok(hits.some((u) => /gemini|generativelanguage/.test(u)));
  } finally {
    global.fetch = realFetch;
    process.env = env;
  }
});
