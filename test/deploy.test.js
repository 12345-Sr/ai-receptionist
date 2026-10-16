/** Deploy readiness: config validation + Azure TTS fallback. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEnv } = require("../config/validateEnv");

const good = {
  NODE_ENV: "production",
  MONGODB_URI: "mongodb+srv://u:p@x.mongodb.net",
  GROQ_API_KEY: "g",
  DASHBOARD_API_KEY: "a".repeat(64),
  BASE_URL: "https://bot.example.com",
  PLIVO_AUTH_ID: "MA1",
  PLIVO_AUTH_TOKEN: "t",
  SARVAM_API_KEY: "s",
  AZURE_SPEECH_KEY: "z",
};

test("validateEnv: complete production config passes with no warnings", () => {
  const r = validateEnv(good);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("validateEnv: catches the mistakes that break live calls", () => {
  const r = validateEnv({ ...good, MONGODB_URI: "", GROQ_API_KEY: "", DASHBOARD_API_KEY: "change_me", BASE_URL: "http://x", PLIVO_AUTH_TOKEN: "" });
  const all = r.errors.join(" | ");
  for (const k of ["MONGODB_URI", "LLM key", "DASHBOARD_API_KEY", "https://", "PLIVO_AUTH_ID aur PLIVO_AUTH_TOKEN"]) assert.ok(all.includes(k), `missing: ${k}\n${all}`);
  const w = validateEnv({ ...good, SARVAM_API_KEY: "", AZURE_SPEECH_KEY: "" }).warnings.join(" ");
  assert.match(w, /Edge/);
});

test("Azure TTS: telephony PCM stream, SSML escaped, used after Sarvam fails", async () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  const seen = [];
  try {
    Object.assign(process.env, { SARVAM_API_KEY: "s", AZURE_SPEECH_KEY: "z", AZURE_SPEECH_REGION: "centralindia", TTS_DISABLE_EDGE: "true" });
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.TTS_ENGINES;
    const pcm = Buffer.alloc(3201, 3);
    global.fetch = async (url, opts) => {
      seen.push(String(url));
      if (/sarvam/.test(url)) return { ok: false, status: 503, text: async () => "down", json: async () => ({}) };
      assert.equal(String(url), "https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1");
      assert.equal(opts.headers["X-Microsoft-OutputFormat"], "raw-8khz-16bit-mono-pcm");
      assert.match(opts.body, /<voice name="hi-IN-SwaraNeural">/);
      assert.match(opts.body, /डॉक्टर &amp; टीम/);
      return { ok: true, body: (async function* () { yield pcm.subarray(0, 1001); yield pcm.subarray(1001); })() };
    };
    delete require.cache[require.resolve("../services/ttsService")];
    const tts = require("../services/ttsService");
    assert.deepEqual(tts.engineOrder(), ["sarvam", "azure"]);
    const parts = [];
    const n = await tts.speakToPcm("डॉक्टर & टीम आपकी मदद करेगी, कल सुबह दस बजे आ जाइए।", 8000, { onChunk: async (b) => parts.push(b) });
    assert.equal(n, 3200, "odd trailing byte dropped, even-aligned");
    assert.ok(parts.every((b) => b.length % 2 === 0));
    assert.ok(seen.some((u) => /sarvam/.test(u)) && seen.some((u) => /microsoft/.test(u)));
  } finally {
    global.fetch = realFetch;
    process.env = env;
    delete require.cache[require.resolve("../services/ttsService")];
  }
});
