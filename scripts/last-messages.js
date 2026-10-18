import 'dotenv/config';
import mongoose from 'mongoose';
import { Message } from '../src/models/Message.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const last = await Message.find().sort({ createdAt: -1 }).limit(2);
  for (const m of last.reverse()) {
    console.log(m.role.padEnd(9), '| chars:', String(m.content.length).padStart(4),
      '| tokensIn:', m.tokensIn, '| tokensOut:', m.tokensOut, '|', JSON.stringify(m.content.slice(0, 60)));
  }
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}