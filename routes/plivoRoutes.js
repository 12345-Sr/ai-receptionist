/**
 * Plivo routes.
 *
 * Plivo console setup:
 *   Voice > Applications > New (XML application)
 *     Answer URL : https://<domain>/plivo/answer   (POST)
 *     Hangup URL : https://<domain>/plivo/hangup   (POST)
 *   Phone Numbers > apna number > Application = upar wali app
 *
 * Flow: call aati hai -> /plivo/answer XML lautata hai -> <Stream bidirectional>
 * se audio wss://<domain>/plivo/media pe aata hai (same bot jo Exotel ke liye hai).
 */
const express = require("express");
const hospitalConfig = require("../config/hospitalConfig");
const CallLog = require("../models/CallLog");
const { getSession } = require("../utils/sessions");
const { requireApiKey } = require("../middleware/auth");
const { signStream } = require("../services/telephony");

const router = express.Router();

const xmlEscape = (s) =>
  String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0];
  return `${proto}://${req.get("host")}`;
}

const sampleRate = () => (Number(process.env.PLIVO_SAMPLE_RATE) === 16000 ? 16000 : 8000);

function handoffNumber() {
  return String(process.env.HANDOFF_NUMBER || hospitalConfig.hospitalPhone || "").replace(/\D/g, "");
}

/** Answer URL: bidirectional stream XML */
router.all("/answer", (req, res) => {
  const p = { ...req.query, ...req.body };
  const callId = p.CallUUID || p.CallUuid;
  const outbound = String(p.Direction || "").toLowerCase() === "outbound";
  // Outbound call me "From" hamara number hai, patient "To" hai
  const patient = outbound ? p.To : p.From;
  const ours = outbound ? p.From : p.To;

  if (callId) {
    const session = getSession(callId);
    if (patient) session.callerPhone = patient;
    session.direction = outbound ? "outbound" : "inbound";
    CallLog.findOneAndUpdate(
      { callSid: callId },
      {
        $setOnInsert: { callSid: callId, direction: session.direction, startedAt: new Date() },
        $set: { provider: "plivo", ...(patient ? { from: patient } : {}), ...(ours ? { to: ours } : {}) },
      },
      { upsert: true }
    ).catch((err) => console.error("[plivo] DB log error:", err.message));
  }

  const wsBase = baseUrl(req).replace(/^http/, "ws");
  const streamUrl = `${wsBase}/plivo/media?c=${encodeURIComponent(callId || "")}&t=${callId ? signStream(callId) : ""}`;
  const rate = sampleRate();
  const extra = [patient && `from=${patient}`, ours && `to=${ours}`].filter(Boolean).join(";");

  // keepCallAlive=true: stream band hone par call agle element pe jaati hai.
  // HUMAN_HANDOFF=true => bot "इंसान से बात" / DTMF 0 pe stream band karta hai -> <Dial> reception.
  const handoff = process.env.HUMAN_HANDOFF === "true" && handoffNumber()
    ? `\n  <Dial callerId="${xmlEscape(ours || "")}"><Number>${xmlEscape(handoffNumber())}</Number></Dial>`
    : "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=${rate}"${
    extra ? ` extraHeaders="${xmlEscape(extra)}"` : ""
  } statusCallbackUrl="${xmlEscape(baseUrl(req) + "/plivo/stream-status")}">${xmlEscape(streamUrl)}</Stream>${handoff}
</Response>`;
  res.type("application/xml").send(xml);
});

/** Hangup URL: asli duration + Plivo ka cost (billing report ke liye) */
router.all("/hangup", (req, res) => {
  const p = { ...req.query, ...req.body };
  const callId = p.CallUUID || p.CallUuid;
  if (callId) {
    const duration = parseInt(p.BillDuration || p.Duration, 10);
    const cost = parseFloat(p.TotalCost);
    CallLog.updateOne(
      { callSid: callId },
      {
        $set: {
          status: "completed",
          endedAt: new Date(),
          ...(Number.isFinite(duration) ? { durationSeconds: duration } : {}),
          ...(p.HangupCause || p.HangupCauseName ? { hangupCause: p.HangupCauseName || p.HangupCause } : {}),
          ...(Number.isFinite(cost) ? { callCost: cost } : {}),
        },
      }
    ).catch((err) => console.error("[plivo] hangup log error:", err.message));
  }
  res.sendStatus(200);
});

router.all("/stream-status", (req, res) => {
  const p = { ...req.query, ...req.body };
  if (p.Event || p.Status) console.log(`[plivo] stream ${p.Event || p.Status} ${p.StatusReason || ""} call=${String(p.CallUUID || "").slice(-6)}`);
  res.sendStatus(200);
});

/**
 * Outbound call (reminder / follow-up). API key zaroori — warna koi bhi aapke
 * Plivo account se calls lagwa ke bill bana sakta hai.
 */
router.post("/outbound", requireApiKey, async (req, res) => {
  const { to } = req.body || {};
  let digits = String(to || "").replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(digits)) digits = `91${digits}`; // Indian 10-digit
  digits = digits.replace(/^\+/, "");
  if (!/^\d{11,13}$/.test(digits)) return res.status(400).json({ error: "Valid 'to' phone number required" });

  const { PLIVO_AUTH_ID: id, PLIVO_AUTH_TOKEN: tok } = process.env;
  const from = String(process.env.PLIVO_PHONE_NUMBER || "").replace(/[^\d]/g, "");
  if (!id || !tok || !from) return res.status(500).json({ error: "PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN / PLIVO_PHONE_NUMBER not configured" });

  try {
    const r = await fetch(`https://api.plivo.com/v1/Account/${id}/Call/`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${id}:${tok}`).toString("base64"), "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: digits,
        answer_url: `${baseUrl(req)}/plivo/answer`,
        answer_method: "POST",
        hangup_url: `${baseUrl(req)}/plivo/hangup`,
        hangup_method: "POST",
        ring_timeout: 30,
        // Voicemail/answering machine pe bot ka paisa mat jalao
        ...(process.env.PLIVO_MACHINE_DETECTION === "true" ? { machine_detection: "hangup" } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    res.status(r.ok ? 200 : 502).json({ success: r.ok, plivoResponse: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
