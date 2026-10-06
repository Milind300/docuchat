import 'dotenv/config';
import mongoose from 'mongoose';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const convos = await Conversation.find({ title: 'Test chat' });
  const ids = convos.map((c) => c._id);

  const msgs = await Message.deleteMany({ conversationId: { $in: ids } });
  const cons = await Conversation.deleteMany({ _id: { $in: ids } });

  console.log('Deleted messages:', msgs.deletedCount);
  console.log('Deleted conversations:', cons.deletedCount);
} catch (err) {
  console.error('Cleanup failed:', err.message);
} finally {
  await mongoose.disconnect();
}