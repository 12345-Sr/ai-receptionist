const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing in .env");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log("[db] Connected to MongoDB Atlas");
}

module.exports = connectDB;
