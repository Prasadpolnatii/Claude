import mongoose from "mongoose";
import { config } from "../config.js";

let connected = false;

export async function connectMongo(): Promise<typeof mongoose> {
  if (connected) return mongoose;
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.MONGODB_URI);
  connected = true;
  console.log(`[mongo] connected: ${config.MONGODB_URI.replace(/\/\/[^@]*@/, "//***@")}`);
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
