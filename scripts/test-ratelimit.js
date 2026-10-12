import 'dotenv/config';
import mongoose from 'mongoose';
import { RateLimit } from '../src/models/RateLimit.js';
import { hit } from '../src/services/rateLimit.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await RateLimit.init(); // make sure the unique index exists before we start
  await RateLimit.deleteMany({ bucket: /^test:/ });

  // 1. The same key counts up
  const counts = [];
  for (let i = 0; i < 4; i++) counts.push((await hit('test:login:1.2.3.4', 60)).count);
  console.log('1. Same key, 4 hits:        ', counts.join(', '));

  // 2. A different key starts fresh
  console.log('2. A different key starts at:', (await hit('test:login:5.6.7.8', 60)).count);

  // 3. Ten requests at the same moment must not lose or repeat a count
  const parallel = await Promise.all(Array.from({ length: 10 }, () => hit('test:parallel', 60)));
  console.log('3. Ten at once, counts:     ', parallel.map((r) => r.count).sort((a, b) => a - b).join(', '));

  // 4. A new time window starts again from 1 (dates are 10 days ahead so cleanup is ours)
  const base = Math.ceil((Date.now() + 10 * 24 * 3600 * 1000) / 60000) * 60000;
  const a = await hit('test:window', 60, new Date(base + 10_000));
  const b = await hit('test:window', 60, new Date(base + 50_000));
  const c = await hit('test:window', 60, new Date(base + 65_000));
  console.log('4. Same minute:', a.count, b.count, '| next minute:', c.count);
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  const gone = await RateLimit.deleteMany({ bucket: /^test:/ });
  console.log('Cleaned up test rows:', gone.deletedCount);
  await mongoose.disconnect();
}