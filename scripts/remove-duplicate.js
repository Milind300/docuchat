import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Document } from '../src/models/Document.js';
import { Chunk } from '../src/models/Chunk.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const user = await User.findOne({ email: 'test@example.com' });
  if (!user) throw new Error('test@example.com not found');

  const copies = await Document.find({ userId: user._id, filename: 'wiki-test.pdf' }).sort({ createdAt: 1 });
  console.log('Copies found:', copies.length);

  for (const extra of copies.slice(1)) {          // keep the oldest, remove the rest
    const c = await Chunk.deleteMany({ documentId: extra._id });
    await Document.deleteOne({ _id: extra._id });
    console.log('Removed copy', String(extra._id), '| chunks deleted:', c.deletedCount);
  }

  console.log('Documents left:', await Document.countDocuments(), '| chunks left:', await Chunk.countDocuments());
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}