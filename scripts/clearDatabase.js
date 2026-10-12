require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const CallLog = require("../models/CallLog");
const Appointment = require("../models/Appointment");
const SlotCounter = require("../models/SlotCounter");

async function clearAll() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB Atlas");

  const [delCalls, delAppts, delSlots] = await Promise.all([
    CallLog.deleteMany({}),
    Appointment.deleteMany({}),
    SlotCounter.deleteMany({})
  ]);

  console.log(`Deleted ${delCalls.deletedCount} call logs, ${delAppts.deletedCount} appointments, and ${delSlots.deletedCount} slot counters.`);
  await mongoose.disconnect();
  console.log("Database cleared successfully!");
  process.exit(0);
}

clearAll().catch((err) => {
  console.error("Error clearing database:", err);
  process.exit(1);
});
