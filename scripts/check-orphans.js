import 'dotenv/config';
import mongoose from 'mongoose';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const ids = await Message.distinct('conversationId');
  const alive = new Set((await Conversation.find({ _id: { $in: ids } }).select('_id')).map((c) => String(c._id)));
  const orphanIds = ids.filter((id) => !alive.has(String(id)));

  const stray = await Message.find({ conversationId: { $in: orphanIds } }).select('role content createdAt');
  console.log('Messages without a chat:', stray.length);
  for (const m of stray) console.log(' -', m.role, JSON.stringify(m.content.slice(0, 40)), m.createdAt.toISOString());

  if (process.argv[2] === 'remove' && stray.length > 0) {
    const r = await Message.deleteMany({ conversationId: { $in: orphanIds } });
    console.log('Removed:', r.deletedCount);
  } else if (stray.length > 0) {
    console.log('Run "node scripts\\check-orphans.js remove" to delete them.');
  }
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}