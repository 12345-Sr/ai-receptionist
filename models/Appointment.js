const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    patientName: { type: String, required: true },
    phone: { type: String, required: true },
    doctorName: { type: String, required: true },
    department: String,
    date: { type: String, required: true }, // e.g. "2026-09-28" or "next Monday" as spoken
    time: { type: String, required: true }, // e.g. "10:00 AM"
    reason: String,
    status: {
      type: String,
      enum: ["pending_confirmation", "confirmed", "cancelled"],
      default: "confirmed",
    },
    callSid: String,
    source: {
      type: String,
      enum: ["inbound_call", "outbound_call", "exotel_voicebot", "voicebot"],
      default: "inbound_call",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
