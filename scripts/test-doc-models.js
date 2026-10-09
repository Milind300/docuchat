import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Document } from '../src/models/Document.js';
import { Chunk } from '../src/models/Chunk.js';
import { RAG } from '../src/config/rag.js';

let docId = null;

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const user = await User.findOne();
  if (!user) throw new Error('No user found. Register one in the browser first.');

  // 1. Create a document and one chunk with a fake embedding
  const doc = await Document.create({
    userId: user._id,
    filename: 'MODEL-TEST.txt',
    status: 'READY',
    chunkCount: 1,
  });
  docId = doc._id;

  await Chunk.create({
    userId: user._id,
    documentId: doc._id,
    index: 0,
    text: 'This is a test chunk.',
    embedding: Array(RAG.EMBED_DIMENSIONS).fill(0.01),
  });
  console.log('1. Created a document and a chunk');

  // 2. By default the embedding is hidden
  const plain = await Chunk.findOne({ documentId: doc._id });
  console.log('2. Embedding hidden by default:', plain.embedding === undefined);

  // 3. We can ask for it
  const withVec = await Chunk.findOne({ documentId: doc._id }).select('+embedding');
  console.log('3. Embedding length when requested:', withVec.embedding.length);

  // 4. A wrong-sized embedding must be rejected
  try {
    await Chunk.create({
      userId: user._id,
      documentId: doc._id,
      index: 1,
      text: 'bad chunk',
      embedding: [0.1, 0.2, 0.3],
    });
    console.log('4. PROBLEM: a wrong-sized embedding was accepted');
  } catch {
    console.log('4. Wrong-sized embedding rejected: true');
  }
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  // Clean up only the test data
  if (docId) {
    const c = await Chunk.deleteMany({ documentId: docId });
    const d = await Document.deleteMany({ _id: docId });
    console.log('Cleaned up: chunks', c.deletedCount, '| documents', d.deletedCount);
  }
  await mongoose.disconnect();
}