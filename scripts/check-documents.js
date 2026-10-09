import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Document } from '../src/models/Document.js';
import { Chunk } from '../src/models/Chunk.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('Database:', mongoose.connection.name);

  const docs = await Document.find().sort({ createdAt: 1 });
  console.log('Documents:', docs.length);
  for (const d of docs) {
    const owner = await User.findById(d.userId).select('email');
    const stored = await Chunk.countDocuments({ documentId: d._id });
    console.log(
      ' -', d.filename, '|', d.status, '| owner:', owner?.email,
      '| chunkCount:', d.chunkCount, '| chunks stored:', stored,
      d.error ? '| error: ' + d.error : ''
    );
  }
  console.log('Total chunks:', await Chunk.countDocuments());
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}