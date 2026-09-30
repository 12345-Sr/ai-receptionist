const express = require("express");
const hospitalConfig = require("../config/hospitalConfig");
const CallLog = require("../models/CallLog");
const { getSession } = require("../utils/sessions");
const { getAIReply, extractBooking } = require("../services/aiService");

const router = express.Router();

/**
 * Exotel Dynamic Greeting:
 * Used in Exotel Greeting Applet under "Read text like a robot" -> URL
 * Exotel hits this via HTTP GET, expects Content-Type: text/plain
 */
router.all("/greeting", async (req, res) => {
  const params = { ...req.query, ...req.body };
  const callSid = params.CallSid || params.CallUUID || "EXO_" + Date.now();
  const from = params.From || params.Caller || "Unknown";
  const to = params.To || params.DialWhomNumber || process.env.EXOTEL_PHONE_NUMBER || "Unknown";

  console.log(`[/exotel/greeting] [${req.method}] Inbound Exotel call: ${callSid} (From: ${from} -> To: ${to})`);

  CallLog.findOneAndUpdate(
    { callSid },
    {
      $setOnInsert: {
        callSid,
        from,
        to,
        direction: "inbound",
      },
      $push: { transcript: { role: "assistant", text: hospitalConfig.greeting } },
    },
    { upsert: true }
  ).catch((err) => console.error("[exotel] DB log error:", err.message));

  const session = getSession(callSid);
  session.callerPhone = from;
  session.messages.push({ role: "assistant", content: hospitalConfig.greeting });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(hospitalConfig.greeting);
});

/**
 * Exotel Inbound Passthru Endpoint:
 * Used in Exotel Passthru Applet
 */
router.all(["/inbound", "/passthru"], async (req, res) => {
  const params = { ...req.query, ...req.body };
  const callSid = params.CallSid || params.CallUUID || "EXO_" + Date.now();
  const digits = params.Digits || params.digits;
  const from = params.From || params.Caller || "Unknown";

  console.log(`[/exotel/passthru] [${req.method}] Call: ${callSid} | From: ${from} | Digits: ${digits || "(none)"}`);

  const session = getSession(callSid);
  if (!session.callerPhone) session.callerPhone = from;

  // If caller pressed a key (DTMF) in Exotel Gather applet
  if (digits) {
    session.messages.push({ role: "user", content: `Caller selected option ${digits}` });
    try {
      const rawReply = await getAIReply(session.messages);
      const { speech } = extractBooking(rawReply);
      session.messages.push({ role: "assistant", content: speech });

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(speech);
    } catch (err) {
      console.error("[/exotel/passthru] AI error:", err.message);
    }
  }

  // Default response for Exotel text reader
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(hospitalConfig.greeting);
});

/**
 * Exotel Outbound Trigger:
 * POST /exotel/outbound
 * Body: { "to": "09876543210", "appId": "1347948" }
 */
router.post("/outbound", async (req, res) => {
  const { to, appId } = req.body;
  if (!to) {
    return res.status(400).json({ error: "Missing required 'to' phone number" });
  }

  const exotelSid = process.env.EXOTEL_SID;
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  const callerId = (process.env.EXOTEL_PHONE_NUMBER || "08047289047").replace(/[^0-9]/g, "");

  const flowId = appId || "1347948"; // Exotel App ID configured for Voicebot
  const exomlUrl = `http://my.exotel.com/${exotelSid}/exoml/start_voice/${flowId}`;

  const endpoint = `https://api.exotel.com/v1/Accounts/${exotelSid}/Calls/connect.json`;
  const authHeader = "Basic " + Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

  const formData = new URLSearchParams();
  formData.append("From", to);
  formData.append("To", callerId);
  formData.append("CallerId", callerId);
  formData.append("Url", exomlUrl);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const data = await response.json();
    return res.json({ success: true, exotelResponse: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
