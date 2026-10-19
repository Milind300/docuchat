import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../src/models/User.js';
import { RateLimit } from '../src/models/RateLimit.js';
import { hit } from '../src/services/rateLimit.js';

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
let mongod;

try {
  console.log('Starting an in-memory MongoDB. The first run downloads the server, which can take a while...');
  mongod = await MongoMemoryServer.create();
  console.log(`Started after ${secs()}`);

  await mongoose.connect(mongod.getUri('docuchat-test'));
  const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
  console.log('MongoDB version:', info.version);

  // Build the unique indexes first, as the app does when it starts
  await User.init();
  await RateLimit.init();

  // 1. A unique index rejects a duplicate email
  await User.create({ email: 'a@example.com', passwordHash: 'x' });
  try {
    await User.create({ email: 'a@example.com', passwordHash: 'y' });
    console.log('FAIL - a duplicate email was accepted');
  } catch (err) {
    console.log(err.code === 11000 ? 'PASS - duplicate email rejected (code 11000)' : 'FAIL - ' + err.message);
  }

  // 2. Ten simultaneous counter hits give 1 to 10, with no gaps or repeats
  const hits = await Promise.all(Array.from({ length: 10 }, () => hit('try:parallel', 60)));
  const counts = hits.map((h) => h.count).sort((a, b) => a - b).join(',');
  console.log(counts === '1,2,3,4,5,6,7,8,9,10' ? 'PASS - atomic counter' : 'FAIL - counts were ' + counts);

  // 3. The Pacific-time grouping used by the analytics works here too
  const rows = await mongoose.connection.db.collection('users').aggregate([
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Los_Angeles' } } } },
  ]).toArray();
  console.log(rows.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(rows[0]._id)
    ? 'PASS - $dateToString with a time zone'
    : 'FAIL - ' + JSON.stringify(rows));

  console.log(`\nDone after ${secs()}`);
} catch (err) {
  console.error('\nThe experiment failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
  if (mongod) await mongod.stop();
}