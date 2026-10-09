import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Document } from '../src/models/Document.js';
import { Chunk } from '../src/models/Chunk.js';
import { ingestText } from '../src/services/ingest.js';

const SAMPLE = `Acme Remote Work Policy

1. Eligibility. Employees who have completed three months of service may work remotely up to three days per week. Managers approve the schedule at the start of each quarter, and the schedule can be changed with two weeks of notice. Employees in customer-facing roles must be on site at least four days per week.

2. Equipment. The company provides a laptop, a monitor and a headset to every remote employee. Employees may expense up to 300 dollars per year for a desk or chair. Equipment remains company property and must be returned within ten days after employment ends.

3. Working hours. Core hours are 10:00 to 16:00 in the employee's local time zone. During core hours employees must be reachable on chat and respond within 30 minutes. Outside core hours employees may arrange their time freely as long as the agreed weekly hours are met.

4. Security. Company data may only be accessed over the company VPN. Public Wi-Fi without the VPN is not allowed. Laptops must use full-disk encryption, and lost devices must be reported to the IT desk within one hour.

5. Expenses. Internet costs are reimbursed up to 40 dollars per month with a valid receipt. Travel to the office for regular work days is not reimbursed. Travel for team events is booked through the finance portal and approved by the manager in advance.

6. Leave and sick days. Employees receive 24 paid leave days per year and 10 paid sick days. Sick days must be reported to the manager by 10:00 on the day of absence. A medical certificate is required for absences longer than three days.`;

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const user = (await User.findOne({ email: 'me@example.com' })) || (await User.findOne());
  if (!user) throw new Error('No user found. Register one in the browser first.');

  const already = await Document.findOne({ userId: user._id, filename: 'SAMPLE-TEST.txt' });
  if (already) {
    console.log('SAMPLE-TEST.txt already exists for', user.email, '- not creating a second copy.');
  } else {
    console.log('Ingesting sample text for', user.email, '...');
    const start = Date.now();
    const doc = await ingestText({
      userId: user._id,
      filename: 'SAMPLE-TEST.txt',
      mimeType: 'text/plain',
      text: SAMPLE,
    });
    console.log('Done in', Date.now() - start, 'ms | status:', doc.status, '| chunks:', doc.chunkCount);
  }

  const doc = await Document.findOne({ userId: user._id, filename: 'SAMPLE-TEST.txt' });
  const chunks = await Chunk.find({ documentId: doc._id }).sort({ index: 1 }).select('+embedding');
  for (const c of chunks) {
    console.log(`#${c.index}`, String(c.text.length).padStart(3), 'chars | vector:', c.embedding.length, '|', JSON.stringify(c.text.slice(0, 50)));
  }
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  await mongoose.disconnect();
}