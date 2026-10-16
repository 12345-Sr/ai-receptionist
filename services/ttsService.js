/**
 * Text -> 16-bit mono PCM at the call's sample rate.
 *
 * Engines: order TTS_ENGINES env se (default: sarvam,elevenlabs,edge).
 *  - Sarvam Bulbul: Indian Hindi voice, HTTP streaming, ElevenLabs se ~5-10x sasta.
 *  - ElevenLabs Flash: sabse natural, sabse mehenga — premium clients ke liye.
 *  - Azure Neural: official Microsoft (SwaraNeural), sasta, SLA — recommended fallback.
 *  - Microsoft Edge: free, lekin unofficial endpoint (kabhi bhi band ho sakta hai) —
 *    sirf aakhri fallback.
 * Jis engine ki API key nahi, woh apne aap skip.
 *
 * Fixes vs old version:
 *  - ElevenLabs hamesha `pcm_8000` maangta tha, chahe call 16 kHz ho -> awaaz
 *    slow/mota. Ab call ka sample rate.
 *  - Poora audio banne ke baad hi bolna shuru hota tha. Ab ElevenLabs /stream se
 *    pehla chunk ~200-400 ms me caller tak.
 *  - Greeting/fillers har call pe dobara synthesize hote the. Ab cache.
 *  - google-tts-api (unofficial endpoint, axios@0.21 vulnerable) hataya.
 *  - Sarvam WAV header "44 bytes" maan ke kaat-ta tha; ab asli "data" chunk dhoondta hai.
 *  - Devanagari pe `\b` kaam nahi karta tha, isliye saare "breath comma" rules dead the.
 */
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const { MPEGDecoder } = require("mpg123-decoder");

const EDGE_VOICE = process.env.TTS_VOICE || "hi-IN-SwaraNeural";
const EDGE_PROSODY = {
  rate: process.env.TTS_RATE || "+10%",
  pitch: process.env.TTS_PITCH || "+0Hz",
  volume: process.env.TTS_VOLUME || "+5%",
};

const NB = "(?<![\\u0900-\\u097F\\w])"; // Devanagari-aware "word start"
const NA = "(?![\\u0900-\\u097F\\w])"; // Devanagari-aware "word end"

const TIME_WORDS = {
  "1:30": "डेढ़ बजे", "2:30": "ढाई बजे", "5:30": "साढ़े पाँच बजे", "10:00": "दस बजे",
  "2:00": "दो बजे", "12:00": "बारह बजे",
};
const HOURS = ["बारह", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह"];

function sanitizeSpeechText(text) {
  if (!text) return "";
  let s = String(text)
    .replace(/<<[A-Z_]+>>[\s\S]*?(<<END_[A-Z_]+>>|$)/g, " ")
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, " ")
    .replace(/[*_#~`\\|<>\[\]{}()"“”]/g, " ")
    .replace(/^\s*[-•]\s*/gm, "")
    // Dash between words = pause; dash inside numbers (phone) untouched
    .replace(/(\D)\s*[–—-]\s*(\D)/g, "$1, $2");

  // Times: "5:30 PM" / "10:00 बजे" -> spoken Hindi
  s = s.replace(/(\d{1,2}):(\d{2})\s*(?:AM|PM|am|pm)?(\s*बजे)?/g, (m, h, mm) => {
    const key = `${Number(h)}:${mm}`;
    if (TIME_WORDS[key]) return TIME_WORDS[key];
    const hw = HOURS[Number(h) % 12] || h;
    const mi = Number(mm);
    if (mi === 0) return `${hw} बजे`;
    if (mi === 30) return `साढ़े ${hw} बजे`;
    if (mi === 15) return `सवा ${hw} बजे`;
    return `${hw} बजकर ${mi} मिनट`;
  });
  s = s.replace(/बजे\s+बजे/g, "बजे").replace(/₹\s*500|500\s*रुपये|rs\.?\s*500/gi, "पाँच सौ रुपये");

  // Natural micro-pauses after discourse markers
  s = s.replace(new RegExp(`${NB}(नमस्ते|अच्छा|ठीक है|जी हाँ|जी बिल्कुल|धन्यवाद|हम्म)${NA}(?!\\s*[,.?!।])`, "g"), "$1,");

  return s
    .replace(/\s+/g, " ")
    .replace(/\s*([,?!।.])(\s*[,?!।.])+/g, "$1")
    .replace(/\s*([,?!।.])\s*/g, "$1 ")
    .trim();
}

// ---------------------------------------------------------------- resampling
function lowpass(samples, rate, cutoff) {
  const w0 = (2 * Math.PI * cutoff) / rate;
  const cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * 0.7071);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0, b1 = (1 - cos) / a0, b2 = b0, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}

/** Float32 [-1,1] at srcRate -> Int16 PCM Buffer at dstRate */
function floatToPcm(samples, srcRate, dstRate) {
  let src = samples;
  if (srcRate > dstRate) src = lowpass(lowpass(src, srcRate, dstRate * 0.45), srcRate, dstRate * 0.45);
  const ratio = srcRate / dstRate;
  const n = Math.floor(src.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, src.length - 1), f = pos - i0;
    const v = Math.max(-0.97, Math.min(0.97, src[i0] * (1 - f) + src[i1] * f));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return Buffer.from(out.buffer);
}

function int16BufToFloat(buf) {
  const i16 = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  return f;
}

async function mp3ToPcm(mp3, dstRate) {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  try {
    const { channelData, sampleRate } = decoder.decode(new Uint8Array(mp3));
    return floatToPcm(channelData[0], sampleRate, dstRate);
  } finally {
    decoder.free();
  }
}

/** Parse a WAV buffer properly (find fmt + data chunks). */
function wavToPcm(wav, dstRate) {
  if (wav.toString("ascii", 0, 4) !== "RIFF") return wav;
  let off = 12, rate = dstRate, dataStart = -1, dataLen = 0;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "fmt ") rate = wav.readUInt32LE(off + 12);
    if (id === "data") { dataStart = off + 8; dataLen = Math.min(size, wav.length - dataStart); break; }
    off += 8 + size + (size % 2);
  }
  if (dataStart < 0) return Buffer.alloc(0);
  const pcm = wav.subarray(dataStart, dataStart + dataLen);
  return rate === dstRate ? Buffer.from(pcm) : floatToPcm(int16BufToFloat(pcm), rate, dstRate);
}

// ---------------------------------------------------------------- engines
const ELEVEN_RATES = [8000, 16000, 22050, 24000];

/** Streams PCM chunks to onChunk as they arrive. Returns total bytes, or 0 on failure. */
async function synthElevenLabsStream(text, rate, { signal, onChunk }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return 0;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
  const reqRate = ELEVEN_RATES.includes(rate) ? rate : 16000;
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream` +
    `?output_format=pcm_${reqRate}&optimize_streaming_latency=${process.env.ELEVENLABS_LATENCY || 3}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
      language_code: "hi",
      voice_settings: {
        stability: Number(process.env.ELEVENLABS_STABILITY || 0.45),
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  if (!res.ok || !res.body) {
    console.warn(`[tts] ElevenLabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return 0;
  }

  let total = 0;
  let carry = Buffer.alloc(0);
  for await (const part of res.body) {
    let buf = Buffer.concat([carry, Buffer.from(part)]);
    const even = buf.length - (buf.length % 2);
    carry = buf.subarray(even);
    buf = buf.subarray(0, even);
    if (!buf.length) continue;
    const out = reqRate === rate ? buf : floatToPcm(int16BufToFloat(buf), reqRate, rate);
    total += out.length;
    await onChunk(out);
    if (signal?.aborted) break;
  }
  return total;
}

/**
 * Sarvam HTTP stream: call ke sample rate (8k/16k) pe seedha linear16 => koi
 * resample/decoding nahi, pehla audio jaldi. Agar stream endpoint fail ho to REST.
 */
const SARVAM_STREAM_RATES = [8000, 16000, 22050, 24000];
async function synthSarvamStream(text, rate, { signal, onChunk }) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return 0;
  const reqRate = SARVAM_STREAM_RATES.includes(rate) ? rate : 16000;
  const body = {
    text,
    language_code: "hi-IN",
    speaker: process.env.SARVAM_SPEAKER || "priya",
    model: process.env.SARVAM_MODEL || "bulbul:v3",
    output_audio_codec: "linear16",
    speech_sample_rate: reqRate,
    pace: Number(process.env.SARVAM_PACE || 1.0),
  };
  if (process.env.SARVAM_TEMPERATURE) body.temperature = Number(process.env.SARVAM_TEMPERATURE);
  const res = await fetch("https://api.sarvam.ai/text-to-speech/stream", {
    method: "POST",
    headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  if (!res.ok || !res.body) {
    console.warn(`[tts] Sarvam stream ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return 0;
  }

  let total = 0;
  let head = Buffer.alloc(0); // WAV header ho to hatana hai
  let headerDone = false;
  let carry = Buffer.alloc(0);
  for await (const part of res.body) {
    let buf = Buffer.from(part);
    if (!headerDone) {
      head = Buffer.concat([head, buf]);
      if (head.length < 12) continue;
      if (head.toString("ascii", 0, 4) === "RIFF") {
        const d = head.indexOf("data");
        if (d < 0 || head.length < d + 8) continue; // header abhi poora nahi aaya
        buf = head.subarray(d + 8);
      } else buf = head;
      headerDone = true;
    }
    buf = carry.length ? Buffer.concat([carry, buf]) : buf;
    const even = buf.length - (buf.length % 2);
    carry = buf.subarray(even);
    buf = buf.subarray(0, even);
    if (!buf.length) continue;
    const out = reqRate === rate ? buf : floatToPcm(int16BufToFloat(buf), reqRate, rate);
    total += out.length;
    await onChunk(out);
    if (signal?.aborted) break;
  }
  return total;
}

/** Sarvam REST (non-stream) fallback — v2 aur v3 dono ke liye */
async function synthSarvam(text, rate, signal) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      target_language_code: "hi-IN",
      speaker: process.env.SARVAM_SPEAKER || "priya",
      model: process.env.SARVAM_MODEL || "bulbul:v3",
      pace: Number(process.env.SARVAM_PACE || 1.0),
      speech_sample_rate: rate,
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    console.warn(`[tts] Sarvam ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return null;
  }
  const data = await res.json();
  const b64 = data.audios?.[0];
  return b64 ? wavToPcm(Buffer.from(b64, "base64"), rate) : null;
}

/**
 * Azure Neural TTS (official, SLA). Wahi hi-IN-SwaraNeural awaaz jo Edge deta hai,
 * lekin paid + reliable. Seedha telephony PCM (raw-8khz/16khz) stream — koi MP3
 * decode/resample nahi. Free tier: 5 lakh characters/month.
 */
const AZURE_FORMATS = { 8000: "raw-8khz-16bit-mono-pcm", 16000: "raw-16khz-16bit-mono-pcm", 24000: "raw-24khz-16bit-mono-pcm" };
const xmlText = (t) => String(t).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

async function synthAzureStream(text, rate, { signal, onChunk }) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || "centralindia";
  if (!key) return 0;
  const reqRate = AZURE_FORMATS[rate] ? rate : 16000;
  const voice = process.env.AZURE_TTS_VOICE || process.env.TTS_VOICE || "hi-IN-SwaraNeural";
  const ssml =
    `<speak version="1.0" xml:lang="hi-IN"><voice name="${xmlText(voice)}">` +
    `<prosody rate="${xmlText(EDGE_PROSODY.rate)}" pitch="${xmlText(EDGE_PROSODY.pitch)}">${xmlText(text)}</prosody></voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": AZURE_FORMATS[reqRate],
      "User-Agent": "ai-receptionist",
    },
    body: ssml,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  if (!res.ok || !res.body) {
    console.warn(`[tts] Azure ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return 0;
  }
  let total = 0;
  let carry = Buffer.alloc(0);
  for await (const part of res.body) {
    let buf = carry.length ? Buffer.concat([carry, Buffer.from(part)]) : Buffer.from(part);
    const even = buf.length - (buf.length % 2);
    carry = buf.subarray(even);
    buf = buf.subarray(0, even);
    if (!buf.length) continue;
    const out = reqRate === rate ? buf : floatToPcm(int16BufToFloat(buf), reqRate, rate);
    total += out.length;
    await onChunk(out);
    if (signal?.aborted) break;
  }
  return total;
}

let edgeInstance = null;
async function edgeClient(fresh = false) {
  if (edgeInstance && !fresh) return edgeInstance;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  edgeInstance = tts;
  return tts;
}

async function synthEdge(text, rate) {
  for (const fresh of [false, true]) {
    try {
      const tts = await edgeClient(fresh);
      const { audioStream } = tts.toStream(text, EDGE_PROSODY);
      const chunks = [];
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("edge timeout")), 8000);
        audioStream.on("data", (c) => chunks.push(c));
        audioStream.once("end", () => { clearTimeout(t); resolve(); });
        audioStream.once("close", () => { clearTimeout(t); resolve(); });
        audioStream.once("error", (e) => { clearTimeout(t); reject(e); });
      });
      audioStream.destroy();
      const mp3 = Buffer.concat(chunks);
      if (mp3.length) return await mp3ToPcm(mp3, rate);
    } catch (err) {
      console.warn(`[tts] Edge ${fresh ? "retry " : ""}failed:`, err.message);
      edgeInstance = null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- public API
/**
 * Cache (COST + speed): greeting/fillers ke alawa har CHHOTA vaakya bhi cache hota
 * hai ("ठीक है।", "जी, बोलिए।", "मरीज़ का नाम बताइए?") — ye calls me baar-baar
 * aate hain. Cache hit = 0 TTS cost, 0 ms latency. LRU, bytes se limited.
 */
const cache = new Map(); // `${rate}|${text}` -> Buffer
let cacheBytes = 0;
const CACHE_MAX_BYTES = Number(process.env.TTS_CACHE_MB || 40) * 1024 * 1024;
const AUTO_CACHE_CHARS = Number(process.env.TTS_AUTO_CACHE_CHARS || 60);
const stats = { hits: 0, misses: 0, chars: 0 };

function cacheGet(key) {
  const buf = cache.get(key);
  if (buf) {
    cache.delete(key); // LRU: recent ko aakhir me
    cache.set(key, buf);
  }
  return buf;
}
function cachePut(key, buf) {
  if (cache.has(key) || buf.length > CACHE_MAX_BYTES / 4) return;
  cache.set(key, buf);
  cacheBytes += buf.length;
  while (cacheBytes > CACHE_MAX_BYTES && cache.size) {
    const [k, v] = cache.entries().next().value;
    cache.delete(k);
    cacheBytes -= v.length;
  }
}

function engineOrder() {
  const want = (process.env.TTS_ENGINES || "sarvam,azure,elevenlabs,edge").split(",").map((x) => x.trim().toLowerCase());
  const has = {
    sarvam: Boolean(process.env.SARVAM_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    azure: Boolean(process.env.AZURE_SPEECH_KEY),
    edge: process.env.TTS_DISABLE_EDGE !== "true",
  };
  return want.filter((e) => has[e]);
}

/**
 * Synthesize and deliver PCM via onChunk (streamed when possible).
 * @returns {Promise<number>} bytes delivered (0 = all engines failed)
 */
async function speakToPcm(text, rate, { signal, onChunk, cacheable = false } = {}) {
  const clean = sanitizeSpeechText(text);
  if (!clean) return 0;
  const key = `${rate}|${clean}`;
  const hit = cacheGet(key);
  if (hit) {
    stats.hits++;
    await onChunk(hit);
    return hit.length;
  }
  stats.misses++;
  const store = cacheable || clean.length <= AUTO_CACHE_CHARS;

  const collected = [];
  let delivered = 0;
  const tap = async (b) => {
    if (store) collected.push(b);
    delivered += b.length;
    await onChunk(b);
  };

  let bytes = 0;
  for (const engine of engineOrder()) {
    if (bytes || signal?.aborted) break;
    // Kisi engine ne aadha audio bhej ke fail kiya => doosre se dobara poora mat bolo
    if (delivered) break;
    try {
      if (engine === "sarvam") {
        bytes = await synthSarvamStream(clean, rate, { signal, onChunk: tap });
        if (!bytes && !delivered && !signal?.aborted) {
          const pcm = await synthSarvam(clean, rate, signal);
          if (pcm?.length) { await tap(pcm); bytes = pcm.length; }
        }
      } else if (engine === "azure") {
        bytes = await synthAzureStream(clean, rate, { signal, onChunk: tap });
      } else if (engine === "elevenlabs") {
        bytes = await synthElevenLabsStream(clean, rate, { signal, onChunk: tap });
      } else if (engine === "edge") {
        const pcm = await synthEdge(clean, rate);
        if (pcm?.length && !signal?.aborted) { await tap(pcm); bytes = pcm.length; }
      }
      if (bytes) stats.chars += clean.length;
    } catch (err) {
      if (signal?.aborted) return delivered;
      console.warn(`[tts] ${engine} error:`, err.message);
    }
  }
  bytes = bytes || delivered;

  if (store && bytes && !signal?.aborted) cachePut(key, Buffer.concat(collected));
  return bytes;
}

function ttsStats() {
  return { ...stats, cacheEntries: cache.size, cacheMB: +(cacheBytes / 1048576).toFixed(1), engines: engineOrder() };
}

/** Non-streaming helper (tests / scripts). */
async function textToPcm(text, rate = 8000) {
  const parts = [];
  await speakToPcm(text, rate, { onChunk: async (b) => parts.push(b) });
  return Buffer.concat(parts);
}

/** Pre-render fixed phrases (greeting, fillers) so they play instantly. */
async function preWarmTTS(phrases = [], rates = [8000]) {
  let ok = 0;
  for (const rate of rates) {
    for (const p of phrases) {
      const n = await speakToPcm(p, rate, { onChunk: async () => {}, cacheable: true }).catch(() => 0);
      if (n) ok++;
    }
  }
  console.log(`[tts] Pre-warmed ${ok}/${phrases.length * rates.length} phrases`);
}

module.exports = { speakToPcm, textToPcm, preWarmTTS, sanitizeSpeechText, wavToPcm, floatToPcm, ttsStats, engineOrder };
