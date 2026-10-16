/**
 * Plivo Audio Streaming: fake Plivo client <-> real WebSocket handler.
 * Checks signed stream URL, playAudio/checkpoint/clearAudio protocol, booking,
 * and the /plivo/answer XML.
 */
process.env.END_OF_TURN_MS = "300";
process.env.FILLER_AFTER_MS = "400";
process.env.IDLE_REPROMPT_MS = "60000";
process.env.BARGE_IN_GRACE_MS = "200";
process.env.PLIVO_AUTH_TOKEN = "test-token";
process.env.BASE_URL = "https://bot.example.com";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const { makeModels, pcm } = require("./helpers");
const booking = require("../services/bookingService");
const ai = require("../services/aiService");
const { setupExotelWebSocketServer, PHRASES } = require("../services/exotelWsService");
const { signStream, parseExtraHeaders } = require("../services/telephony");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CALL = "1b2c3d4e-0000-4000-8000-00000000abcd";
const SID = "9f8e7d6c-0000-4000-8000-00000000beef";

function harness({ sttQueue, aiScript, ttsMsPerChar = 12 }) {
  const mm = makeModels();
  Object.defineProperty(booking.models, "SlotCounter", { value: mm.SlotCounter, configurable: true });
  Object.defineProperty(booking.models, "Appointment", { value: mm.Appointment, configurable: true });
  booking.invalidateAvailabilityCache();
  const aiCalls = [];
  const stubAi = {
    parseReply: ai.parseReply,
    async streamAIReply(messages, session, { signal, onSpeech }) {
      const last = messages[messages.length - 1].content;
      aiCalls.push(last);
      const sp = ai.createSpeechStreamer(onSpeech);
      for (const tok of aiScript(last).match(/.{1,4}/gsu)) {
        if (signal?.aborted) throw new Error("aborted");
        sp.push(tok);
        await sleep(10);
      }
      return sp.end();
    },
  };
  const spoken = [];
  const stubTts = {
    async speakToPcm(text, rate, { onChunk, signal }) {
      spoken.push(text);
      const total = Buffer.alloc(Math.round((text.length * ttsMsPerChar * rate * 2) / 1000), 1);
      for (let i = 0; i < total.length && !signal?.aborted; i += 1234) {
        await onChunk(total.subarray(i, i + 1234));
        await sleep(5);
      }
      return total.length;
    },
  };
  const server = http.createServer();
  setupExotelWebSocketServer(server, { stt: async () => sttQueue.shift() || "", ai: stubAi, tts: stubTts, CallLog: mm.CallLog });
  return { server, mm, aiCalls, spoken };
}

async function connect(server, { token = signStream(CALL), from = "+919999900000" } = {}) {
  await new Promise((r) => server.listen(0, r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/plivo/media?c=${CALL}&t=${token}`);
  const events = [];
  ws.on("message", (m) => {
    const d = JSON.parse(m);
    events.push(d);
    // Plivo plays the queue, then confirms the checkpoint
    if (d.event === "checkpoint") setTimeout(() => ws.send(JSON.stringify({ event: "playedStream", sequenceNumber: 9, streamId: SID, name: d.name })), 50);
    if (d.event === "clearAudio") ws.send(JSON.stringify({ event: "clearedAudio", sequenceNumber: 9, streamId: SID }));
  });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
    ws.on("unexpected-response", (req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  ws.send(JSON.stringify({
    event: "start", sequenceNumber: 1,
    start: { callId: CALL, streamId: SID, accountId: "MA1", tracks: ["inbound"], mediaFormat: { encoding: "audio/x-l16", sampleRate: 8000 } },
    extra_headers: `from=${from};to=+918047289047`,
  }));
  return { ws, events };
}

async function say(ws, speechMs = 600, silenceMs = 500) {
  const send = async (buf) => {
    for (let i = 0; i < buf.length; i += 320) {
      ws.send(JSON.stringify({ event: "media", sequenceNumber: 2, streamId: SID, media: { track: "inbound", timestamp: "0", chunk: 1, payload: buf.subarray(i, i + 320).toString("base64") } }));
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
const checkpoints = (ev) => ev.filter((e) => e.event === "checkpoint").length;

test("plivo: unsigned / wrongly signed stream is rejected", async () => {
  const h = harness({ sttQueue: [], aiScript: () => "x" });
  try {
    await assert.rejects(connect(h.server, { token: "bad" }), /401|Unexpected|socket hang up|ECONNRESET/);
  } finally {
    h.server.close();
  }
});

test("plivo: full booking call with playAudio + checkpoint protocol", async () => {
  const doctor = booking.normalizeDoctor("Dr. H.S. Chawla");
  let d, t;
  const h = harness({
    sttQueue: ["मुझे बुखार है", "रमेश कुमार", "हाँ कर दो"],
    aiScript: (last) => {
      if (/बुखार/.test(last)) return `अरे, बुखार में तकलीफ़ होती है। मरीज़ का नाम बताइए?\n<<DRAFT_JSON>>{"doctorName":"Dr. H.S. Chawla","date":"${d}","time":"${t}"}<<END_DRAFT_JSON>>`;
      if (/रमेश/.test(last)) return `तो रमेश कुमार जी, बुक कर दूँ?\n<<DRAFT_JSON>>{"patientName":"रमेश कुमार","doctorName":"Dr. H.S. Chawla","date":"${d}","time":"${t}"}<<END_DRAFT_JSON>>`;
      return `ठीक है, बुक कर रही हूँ।\n<<BOOKING_JSON>>{"doctorName":"Dr. H.S. Chawla","date":"${d}","time":"${t}","reason":"बुखार"}<<END_BOOKING_JSON>>`;
    },
  });
  const avail = await booking.getAvailability(doctor);
  d = avail[0].date;
  t = avail[0].shifts[0].time;
  const { ws, events } = await connect(h.server);
  try {
    assert.ok(await waitFor(() => h.spoken.includes(PHRASES.greeting)));
    assert.ok(await waitFor(() => checkpoints(events) >= 1, 6000));
    await sleep(300);
    for (const n of [2, 3, 4]) {
      await say(ws);
      assert.ok(await waitFor(() => checkpoints(events) >= n, 9000), `turn ${n}`);
      await sleep(300);
    }
    const plays = events.filter((e) => e.event === "playAudio");
    assert.ok(plays.length > 5);
    for (const p of plays) {
      assert.equal(p.media.contentType, "audio/x-l16");
      assert.equal(p.media.sampleRate, 8000);
      const b = Buffer.from(p.media.payload, "base64").length;
      assert.ok(b % 2 === 0 && b <= 16000, `frame ${b}`);
    }
    assert.ok(events.filter((e) => e.event === "checkpoint").every((e) => e.streamId === SID && e.name));
    assert.ok(!events.some((e) => e.event === "media" || e.event === "mark"), "no Exotel events on a Plivo stream");

    assert.equal(h.mm.Appointment.rows.length, 1);
    assert.equal(h.mm.Appointment.rows[0].phone, "+919999900000", "caller number from extra_headers");
    assert.match(h.spoken[h.spoken.length - 1], /^रमेश जी.*पक्की हो गई/);
    assert.ok(h.mm.CallLog.ops.some(([, , u]) => u?.$set?.provider === "plivo"));
  } finally {
    ws.close();
    h.server.close();
  }
});

test("plivo: barge-in sends clearAudio", async () => {
  const h = harness({ sttQueue: ["रुकिए"], aiScript: () => "जी, बोलिए।", ttsMsPerChar: 60 });
  const { ws, events } = await connect(h.server);
  try {
    assert.ok(await waitFor(() => events.some((e) => e.event === "playAudio")));
    await sleep(400);
    await say(ws, 700, 500);
    assert.ok(await waitFor(() => events.some((e) => e.event === "clearAudio" && e.streamId === SID)));
    assert.ok(await waitFor(() => h.spoken.includes("जी, बोलिए।")));
  } finally {
    ws.close();
    h.server.close();
  }
});

test("plivo: /plivo/answer returns signed bidirectional Stream XML", async () => {
  const CallLog = require("../models/CallLog");
  const orig = CallLog.findOneAndUpdate;
  CallLog.findOneAndUpdate = async () => null; // no DB in tests
  const env = { ...process.env };
  try {
    process.env.HUMAN_HANDOFF = "true";
    process.env.HANDOFF_NUMBER = "+91 74084 12008";
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use("/plivo", require("../routes/plivoRoutes"));
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/plivo/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallUUID: CALL, From: "919999900000", To: "918047289047", Direction: "inbound" }).toString(),
    });
    const xml = await r.text();
    srv.close();
    assert.match(r.headers.get("content-type"), /xml/);
    assert.match(xml, /<Stream bidirectional="true" keepCallAlive="true" contentType="audio\/x-l16;rate=8000"/);
    assert.ok(xml.includes(`wss://bot.example.com/plivo/media?c=${CALL}&amp;t=${signStream(CALL)}`), xml);
    assert.match(xml, /extraHeaders="from=919999900000;to=918047289047"/);
    assert.match(xml, /<Dial callerId="918047289047"><Number>917408412008<\/Number><\/Dial>/);
    assert.equal(require("../utils/sessions").getSession(CALL).callerPhone, "919999900000");
  } finally {
    CallLog.findOneAndUpdate = orig;
    process.env = env;
  }
});

test("plivo: extra_headers parser", () => {
  assert.deepEqual(parseExtraHeaders("from=+9198;to=+9180"), { from: "+9198", to: "+9180" });
  assert.deepEqual(parseExtraHeaders('{"from":"x"}'), { from: "x" });
  assert.deepEqual(parseExtraHeaders(""), {});
});
