import 'dotenv/config';
import mongoose from 'mongoose';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('Database:', mongoose.connection.name);

  const convos = await Conversation.find();
  console.log('Conversations:', convos.length);
  for (const c of convos) console.log(' -', JSON.stringify(c.title), String(c._id));

  console.log('Messages:', await Message.countDocuments());
} catch (err) {
  console.error('Check failed:', err.message);
} finally {
  await mongoose.disconnect();
}