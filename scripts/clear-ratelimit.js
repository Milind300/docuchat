import 'dotenv/config';
import mongoose from 'mongoose';
import { RateLimit } from '../src/models/RateLimit.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const r = await RateLimit.deleteMany({});
  console.log('Cleared rate-limit rows:', r.deletedCount);
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}