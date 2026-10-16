/**
 * Telephony adapters: Exotel AgentStream aur Plivo Audio Streaming ka WebSocket
 * protocol alag hai — baaki bot (VAD, LLM, TTS, booking) dono ke liye same.
 *
 * Har adapter:
 *   parse(msg)       -> normalized event: start | media | mark | dtmf | stop | null
 *   media(buf, rate) / clear() / mark(name) -> outbound JSON (ya null)
 *   minFrameBytes    -> outbound frame ka minimum size
 *
 * Plivo:
 *   <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">
 *   in : start{start:{callId,streamId,mediaFormat{encoding,sampleRate}}, extra_headers}
 *        media{media:{payload}} | dtmf{dtmf:{digit}} | playedStream{name} | clearedAudio
 *   out: playAudio{media:{contentType,sampleRate,payload}} | clearAudio{streamId}
 *        | checkpoint{streamId,name}
 *   Plivo "stop" event nahi bhejta — call khatam = WebSocket close.
 */
const crypto = require("crypto");

/** "from=+9198..;to=+9180.." | '{"from":"..."}' -> object */
function parseExtraHeaders(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  const s = String(raw).trim();
  try {
    const j = JSON.parse(s);
    if (j && typeof j === "object") return j;
  } catch {}
  const out = {};
  for (const part of s.split(/[;,]/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function exotelAdapter() {
  let streamSid = null;
  return {
    name: "exotel",
    minFrameBytes: 3200, // Exotel rule: >= 3.2 KB, multiple of 320
    parse(d) {
      switch (d.event) {
        case "start": {
          const st = d.start || {};
          streamSid = d.stream_sid || st.stream_sid;
          return {
            type: "start",
            callSid: st.call_sid || d.call_sid || `EXO_${Date.now()}`,
            from: st.from || st.custom_parameters?.from || d.from,
            to: st.to,
            sampleRate: parseInt(st.media_format?.sample_rate || 8000, 10),
          };
        }
        case "media":
          return d.media?.payload ? { type: "media", payload: Buffer.from(d.media.payload, "base64") } : null;
        case "mark":
          return { type: "mark", name: d.mark?.name };
        case "dtmf":
          return { type: "dtmf", digit: String(d.dtmf?.digit ?? "") };
        case "stop":
          return { type: "stop", reason: d.stop?.reason || "stop" };
        default:
          return null;
      }
    },
    ready: () => Boolean(streamSid),
    media: (buf) => ({ event: "media", stream_sid: streamSid, media: { payload: buf.toString("base64") } }),
    clear: () => ({ event: "clear", stream_sid: streamSid }),
    mark: (name) => ({ event: "mark", stream_sid: streamSid, mark: { name } }),
  };
}

function plivoAdapter() {
  let streamId = null;
  let encoding = "audio/x-l16";
  return {
    name: "plivo",
    // Plivo ka koi minimum nahi; 64 KB/message limit. 100 ms frames = kam messages, smooth.
    minFrameBytes: 0,
    parse(d) {
      switch (d.event) {
        case "start": {
          const st = d.start || {};
          streamId = st.streamId || d.streamId;
          const enc = String(st.mediaFormat?.encoding || "").toLowerCase();
          if (enc && !/l16|linear|pcm/.test(enc)) {
            console.warn(`[plivo] stream encoding "${enc}" — Stream XML me contentType="audio/x-l16;rate=8000" rakho`);
          }
          const xh = parseExtraHeaders(d.extra_headers || st.extra_headers);
          return {
            type: "start",
            callSid: st.callId || d.callId || `PLV_${Date.now()}`,
            from: xh.from || xh.From || xh.X_PH_from,
            to: xh.to || xh.To,
            sampleRate: parseInt(st.mediaFormat?.sampleRate || 8000, 10),
          };
        }
        case "media":
          return d.media?.payload ? { type: "media", payload: Buffer.from(d.media.payload, "base64") } : null;
        case "playedStream":
          return { type: "mark", name: d.name };
        case "dtmf":
          return { type: "dtmf", digit: String(d.dtmf?.digit ?? "") };
        case "clearedAudio":
        default:
          return null;
      }
    },
    ready: () => Boolean(streamId),
    media: (buf, rate) => ({ event: "playAudio", media: { contentType: encoding, sampleRate: rate, payload: buf.toString("base64") } }),
    clear: () => ({ event: "clearAudio", streamId }),
    mark: (name) => ({ event: "checkpoint", streamId, name }),
  };
}

// ---------------------------------------------------------------- Plivo stream auth
// Plivo WebSocket URL public hoti hai. Bina token ke koi bhi connect karke aapke
// LLM/TTS ka bill bana sakta tha. Answer XML har call ke liye signed URL deta hai.
function streamSecret() {
  return process.env.STREAM_SECRET || process.env.PLIVO_AUTH_TOKEN || "";
}
function signStream(callId) {
  return crypto.createHmac("sha256", streamSecret()).update(String(callId)).digest("hex").slice(0, 32);
}
function verifyStream(callId, token) {
  if (!streamSecret()) return process.env.NODE_ENV !== "production"; // dev me khula
  if (!callId || !token) return false;
  const a = Buffer.from(signStream(callId));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ADAPTERS = {
  "/exotel/media": exotelAdapter,
  "/media": exotelAdapter,
  "/stream": exotelAdapter,
  "/plivo/media": plivoAdapter,
};

module.exports = { exotelAdapter, plivoAdapter, parseExtraHeaders, signStream, verifyStream, ADAPTERS };
