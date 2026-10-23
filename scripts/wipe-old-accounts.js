import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { Document } from '../src/models/Document.js';
import { Chunk } from '../src/models/Chunk.js';

// Only these two throwaway accounts are ever touched
const OLD_ACCOUNTS = ['test@example.com', 'me@example.com'];
const confirmed = process.argv.includes('--yes');

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('Database:', mongoose.connection.name);
  console.log(confirmed ? 'Mode: DELETE' : 'Mode: dry run (nothing will be deleted)');

  const users = await User.find({ email: { $in: OLD_ACCOUNTS } });
  if (users.length === 0) console.log('None of the old accounts exist. Nothing to do.');

  for (const user of users) {
    const owned = { userId: user._id };
    const counts = {
      conversations: await Conversation.countDocuments(owned),
      messages: await Message.countDocuments(owned),
      documents: await Document.countDocuments(owned),
      chunks: await Chunk.countDocuments(owned),
    };
    console.log('\n' + user.email, JSON.stringify(counts));

    if (confirmed) {
      // The account goes last, so an interrupted run can simply be repeated
      await Chunk.deleteMany(owned);
      await Document.deleteMany(owned);
      await Message.deleteMany(owned);
      await Conversation.deleteMany(owned);
      await User.deleteOne({ _id: user._id });
      console.log('  deleted');
    }
  }

  if (!confirmed && users.length > 0) {
    console.log('\nDry run only. To delete, run: node scripts\\wipe-old-accounts.js --yes');
  }
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}