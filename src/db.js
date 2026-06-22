// src/db.js — MongoDB ulanish
const mongoose = require("mongoose");
const { MONGO_URI } = require("./config");

async function connectDb() {
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB ulandi:", MONGO_URI.replace(/\/\/.*@/, "//***@"));
    return mongoose;
}

module.exports = { connectDb, mongoose };
