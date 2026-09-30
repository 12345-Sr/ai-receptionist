const express = require("express");
const CallLog = require("../models/CallLog");
const Appointment = require("../models/Appointment");

const router = express.Router();

router.get("/calls", async (req, res) => {
  const calls = await CallLog.find().sort({ createdAt: -1 }).limit(50);
  res.json(calls);
});

router.get("/appointments", async (req, res) => {
  const appts = await Appointment.find().sort({ createdAt: -1 }).limit(50);
  res.json(appts);
});

module.exports = router;
