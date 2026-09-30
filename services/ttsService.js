const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const googleTTS = require("google-tts-api");
const { MPEGDecoder } = require("mpg123-decoder");

let ttsInstance = null;
let isInitializing = null;

// High-fidelity female Indian neural voice with warm, facilitating bedside tone
const DEFAULT_EDGE_VOICE = process.env.TTS_VOICE || "hi-IN-SwaraNeural";
const EDGE_PROSODY = {
  rate: process.env.TTS_RATE || "-5%",
  pitch: process.env.TTS_PITCH || "-2Hz",
  volume: process.env.TTS_VOLUME || "+5%",
};

/**
 * Initializes and warms up Microsoft Edge Neural TTS client.
 * Using 96kbps high-bitrate output for maximum acoustic naturalness.
 */
async function getOrInitEdgeTTS() {
  if (ttsInstance) return ttsInstance;
  if (isInitializing) return isInitializing;

  isInitializing = (async () => {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(DEFAULT_EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      ttsInstance = tts;
      return ttsInstance;
    } finally {
      isInitializing = null;
    }
  })();

  return isInitializing;
}

/**
 * Pre-warms the TTS engine on server start with natural prosody.
 */
async function preWarmTTS() {
  if (process.env.SARVAM_API_KEY) {
    console.log("[ttsService] 🌟 Sarvam AI Female Neural Voice (Speaker: " + (process.env.SARVAM_SPEAKER || "meera") + ") enabled as Primary Engine!");
    return;
  }
  if (process.env.ELEVENLABS_API_KEY) {
    console.log("[ttsService] 🌟 ElevenLabs Multilingual Female Neural Voice enabled as Primary Engine!");
    return;
  }

  try {
    const tts = await getOrInitEdgeTTS();
    const { audioStream } = tts.toStream("नमस्ते जी, सिटी केयर हॉस्पिटल में आपका स्वागत है।", EDGE_PROSODY);
    audioStream.on("data", () => {});
    await new Promise((resolve) => {
      audioStream.once("end", resolve);
      audioStream.once("close", resolve);
      audioStream.once("error", resolve);
    });
    audioStream.destroy();
    console.log(`[ttsService] ✅ Humanized Indian Female Voice (${DEFAULT_EDGE_VOICE}) pre-warmed & ready at 96kbps`);
  } catch (err) {
    console.warn("[ttsService] Pre-warm warning:", err.message);
  }
}

/**
 * Cleans, softens, and formats text for warm, humanized speech:
 * - Injects natural breath commas after conversational markers
 * - Formats time and doctor titles smoothly
 * - Strips all robotic syntax, brackets, and markdown symbols
 */
function sanitizeSpeechText(text) {
  if (!text) return "";
  let clean = text
    // Strip hidden tags and JSON payloads
    .replace(/<<DRAFT_JSON>>[\s\S]*?<<END_DRAFT_JSON>>/gi, "")
    .replace(/<<BOOKING_JSON>>[\s\S]*?<<END_BOOKING_JSON>>/gi, "")
    // Strip markdown formatting symbols that cause robotic reading
    .replace(/[*_#~`\\/<>|]/g, " ")
    .replace(/[\[\]{}()]/g, " ")
    .replace(/["']/g, "")
    // Replace bullet hyphens with commas
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s*[-–—]\s*/g, ", ")
    // Convert digital time strings into natural conversational spoken Hindi words
    // Never let TTS say "ten colon zero zero", "five thirty", or "पाँच अनुपात तीस"
    .replace(/\b5:30\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "साढ़े पाँच बजे")
    .replace(/\b2:30\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "ढाई बजे")
    .replace(/\b1:30\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "डेढ़ बजे")
    .replace(/\b10:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "दस बजे")
    .replace(/\b2:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "दो बजे")
    .replace(/\b1:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "एक बजे")
    .replace(/\b3:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "तीन बजे")
    .replace(/\b4:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "चार बजे")
    .replace(/\b5:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "पाँच बजे")
    .replace(/\b6:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "छह बजे")
    .replace(/\b7:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "सात बजे")
    .replace(/\b8:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "आठ बजे")
    .replace(/\b9:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "नौ बजे")
    .replace(/\b11:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "ग्यारह बजे")
    .replace(/\b12:00\s*(?:AM|PM|am|pm)?\s*(?:बजे)?\b/gi, "बारह बजे")
    // Convert remaining colon times like "6:15" -> "6 बजकर 15 मिनट"
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, min) => {
      const minN = parseInt(min, 10);
      if (minN === 0) return `${h} बजे`;
      if (minN === 30 && h === "5") return "साढ़े पाँच बजे";
      if (minN === 30 && h === "2") return "ढाई बजे";
      if (minN === 30 && h === "1") return "डेढ़ बजे";
      if (minN === 30) return `साढ़े ${h} बजे`;
      return `${h} बजकर ${minN} मिनट`;
    })
    .replace(/\s+बजे\s+बजे/g, " बजे");

  // Add natural conversational breath micro-pauses
  clean = clean
    .replace(/\b(नमस्ते\s*जी)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(जी\s*नमस्ते)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(जी\s*हाँ)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(जी\s*बिल्कुल)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(बिल्कुल\s*चिंता\s*मत\s*कीजिए)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(परेशान\s*मत\s*होइए\s*जी?)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(कोई\s*बात\s*नहीं\s*जी?)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(धन्यवाद)(?![,\.?!।])/gi, "$1,")
    .replace(/\b(कृपया)(?![,\.?!।])/gi, "$1,");

  // Clean duplicate punctuation and spacing
  return clean
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s*([,?!।.])\s*/g, "$1 ")
    .trim();
}

/**
 * 2nd-order Butterworth low-pass filter at 3500 Hz for 24kHz audio
 * Prevents metallic aliasing folds when downsampling to 8000 Hz.
 */
function applyAntiAliasingFilter(samples, sampleRate = 24000, cutoff = 3500) {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * 0.7071);

  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const b0_norm = b0 / a0;
  const b1_norm = b1 / a0;
  const b2_norm = b2 / a0;
  const a1_norm = a1 / a0;
  const a2_norm = a2 / a0;

  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0_norm * x + b1_norm * x1 + b2_norm * x2 - a1_norm * y1 - a2_norm * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }

  return out;
}

/**
 * Sarvam AI (Indian Voice AI Lab): Widely acclaimed as the #1 most realistic Hindi voice.
 * Features native Indian female voices ("meera", "pavithra") with human breath and natural prosody.
 */
async function synthesizeSarvam(cleanText, targetSampleRate = 8000) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;

  const speaker = process.env.SARVAM_SPEAKER || "meera";
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [cleanText],
      target_language_code: "hi-IN",
      speaker,
      pitch: 0,
      pace: 0.96,
      loudness: 1.2,
      speech_sample_rate: targetSampleRate,
      enable_preprocessing: true,
      model: "bulbul:v1",
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn(`[ttsService] Sarvam TTS error ${res.status}: ${err}`);
    return null;
  }

  const data = await res.json();
  const base64Audio = data.audios?.[0];
  if (!base64Audio) return null;

  const wavBuffer = Buffer.from(base64Audio, "base64");
  // Strip 44-byte WAV header for pure PCM
  return wavBuffer.length > 44 ? wavBuffer.slice(44) : wavBuffer;
}

/**
 * ElevenLabs Multilingual Neural Engine for ultra-human female voice generation.
 */
async function synthesizeElevenLabs(cleanText, targetSampleRate = 8000) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const voiceId = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // Default Sarah (Warm, works on free & paid tier)
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_8000`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.85,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(6000),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.warn(`[ttsService] ElevenLabs TTS error ${res.status}: ${err}`);
    return null;
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Microsoft Edge Neural TTS with 96kbps and studio anti-aliasing filter (Free, built-in).
 */
async function synthesizeEdgeNeural(cleanText, targetSampleRate = 8000) {
  try {
    const tts = await getOrInitEdgeTTS();
    const { audioStream } = tts.toStream(cleanText, EDGE_PROSODY);

    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on("data", (c) => chunks.push(c));
      audioStream.once("end", resolve);
      audioStream.once("close", resolve);
      audioStream.once("error", reject);
    });
    audioStream.destroy();

    const mp3Buffer = Buffer.concat(chunks);
    return decodeAndResampleMp3(mp3Buffer, targetSampleRate);
  } catch (edgeErr) {
    console.warn("[ttsService] Edge Neural error, reconnecting:", edgeErr.message);
    ttsInstance = null;

    // Retry with fresh instance
    try {
      const freshTTS = new MsEdgeTTS();
      await freshTTS.setMetadata(DEFAULT_EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      ttsInstance = freshTTS;
      const { audioStream } = freshTTS.toStream(cleanText, EDGE_PROSODY);
      const chunks = [];
      await new Promise((resolve, reject) => {
        audioStream.on("data", (c) => chunks.push(c));
        audioStream.on("end", resolve);
        audioStream.on("error", reject);
      });
      const mp3Buffer = Buffer.concat(chunks);
      return decodeAndResampleMp3(mp3Buffer, targetSampleRate);
    } catch (retryErr) {
      console.warn("[ttsService] Fresh Edge Neural retry failed, falling back to Google TTS:", retryErr.message);
    }

    // Fallback: Google TTS
    try {
      const base64Audio = await googleTTS.getAudioBase64(cleanText.slice(0, 199), {
        lang: "hi",
        slow: false,
        host: "https://translate.google.com",
        timeout: 5000,
      });
      const mp3Buffer = Buffer.from(base64Audio, "base64");
      return decodeAndResampleMp3(mp3Buffer, targetSampleRate);
    } catch (gErr) {
      console.error("[ttsService] All TTS engines failed:", gErr.message);
      throw gErr;
    }
  }
}

/**
 * Master Text-to-PCM Audio Router:
 * 1. Sarvam AI (Meera / Pavithra) if SARVAM_API_KEY is configured
 * 2. ElevenLabs (Multilingual Female) if ELEVENLABS_API_KEY is configured
 * 3. Microsoft Edge Neural (hi-IN-SwaraNeural) 96kbps with anti-aliasing (Default, Free)
 */
async function textToPcm(text, targetSampleRate = 8000) {
  if (!text || !text.trim()) return Buffer.alloc(0);

  const cleanText = sanitizeSpeechText(text);
  if (!cleanText) return Buffer.alloc(0);

  // 1. Check Sarvam AI (Best Indian Voice)
  if (process.env.SARVAM_API_KEY) {
    try {
      const pcm = await synthesizeSarvam(cleanText, targetSampleRate);
      if (pcm && pcm.length > 0) return pcm;
    } catch (err) {
      console.warn("[ttsService] Sarvam TTS failed, falling back to Edge Neural:", err.message);
    }
  }

  // 2. Check ElevenLabs
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const pcm = await synthesizeElevenLabs(cleanText, targetSampleRate);
      if (pcm && pcm.length > 0) return pcm;
    } catch (err) {
      console.warn("[ttsService] ElevenLabs TTS failed, falling back to Edge Neural:", err.message);
    }
  }

  // 3. Default: High-fidelity Edge Neural
  return await synthesizeEdgeNeural(cleanText, targetSampleRate);
}

/**
 * Decodes 24kHz MP3, applies 3500Hz anti-aliasing filter, and resamples to 8000Hz PCM.
 * Eliminates harsh robotic high-frequency aliasing for silky, natural female voice.
 */
async function decodeAndResampleMp3(mp3Buffer, targetSampleRate = 8000) {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const { channelData, sampleRate: sourceRate } = decoder.decode(new Uint8Array(mp3Buffer));

  let sourceSamples = channelData[0];

  // Apply anti-aliasing filter at 3500 Hz to prevent metallic telephony distortion
  if (sourceRate > targetSampleRate) {
    sourceSamples = applyAntiAliasingFilter(sourceSamples, sourceRate, 3500);
  }

  const ratio = sourceRate / targetSampleRate;
  const targetLength = Math.floor(sourceSamples.length / ratio);
  const pcm16 = new Int16Array(targetLength);

  // High-quality band-limited linear interpolation with warm soft-limiter
  for (let i = 0; i < targetLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, sourceSamples.length - 1);
    const frac = srcPos - idx0;

    // Linear interpolation
    const rawVal = sourceSamples[idx0] * (1 - frac) + sourceSamples[idx1] * frac;

    // Gentle soft-knee saturation prevents harsh clipping
    const clamped = Math.max(-0.95, Math.min(0.95, rawVal));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  decoder.free();
  return Buffer.from(pcm16.buffer);
}

module.exports = { textToPcm, preWarmTTS, sanitizeSpeechText };
