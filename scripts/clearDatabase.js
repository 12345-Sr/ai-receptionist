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

  const dbName = process.env.MONGODB_DB || "ai_receptionist";
  await mongoose.connect(uri, { dbName });
  console.log(`Connected to MongoDB Atlas (${mongoose.connection.name})`);

  const [delCalls, delAppts, delSlots] = await Promise.all([
    CallLog.deleteMany({}),
    Appointment.deleteMany({}),
    SlotCounter.deleteMany({})
  ]);
  console.log(`Deleted ${delCalls.deletedCount} call logs, ${delAppts.deletedCount} appointments, and ${delSlots.deletedCount} slot counters from ${dbName}.`);

  // Also clear test DB if it had residual calls
  const testDb = mongoose.connection.client.db("test");
  await Promise.all([
    testDb.collection("calllogs").deleteMany({}),
    testDb.collection("appointments").deleteMany({}),
    testDb.collection("slotcounters").deleteMany({})
  ]);
  console.log("Cleared residual test database as well.");

  await mongoose.disconnect();
  console.log("Database cleared successfully!");
  process.exit(0);
}

clearAll().catch((err) => {
  console.error("Error clearing database:", err);
  process.exit(1);
});
