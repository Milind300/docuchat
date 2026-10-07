import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { checkLimits } from '../src/services/usage.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const users = await User.find();
  for (const u of users) {
    const result = await checkLimits(u._id);
    console.log(u.email, '->', JSON.stringify(result));
  }
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}