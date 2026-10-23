import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { findEnvProblems } from '../src/config/env.js';
import { readCredentials } from '../src/utils/credentials.js';
import { User } from '../src/models/User.js';
import { Document } from '../src/models/Document.js';

// A fictional handbook, written for demonstrations
const FILENAME = 'northwind-handbook.txt';
const HANDBOOK = `Northwind Studio Team Handbook

Welcome. Northwind Studio is a fictional design company, and this handbook is sample text written for demonstrations. It describes how the team works.

1. Working hours and remote work. The standard working week is Monday to Friday. After the three-month probation period, team members may work remotely up to three days per week. The remaining two days are office days, which are Tuesday and Thursday. Core hours are 10:00 to 15:00 in the team member's local time zone, and everyone must be reachable on chat during core hours.

2. Home-office stipend. Every team member receives a one-time home-office stipend of 400 dollars to buy a desk, a chair or a monitor. Receipts must be uploaded to the finance portal within 30 days of purchase. In addition, the company pays 30 dollars per month toward home internet costs. Items bought with the stipend remain the property of the team member.

3. Equipment. The company provides a laptop and a headset on the first day. A lost or damaged laptop must be reported to the IT desk within 24 hours. Laptops must have full-disk encryption turned on, and company data may only be accessed through the company VPN.

4. Leave. Team members receive 25 days of paid leave per year, plus public holidays. Leave requests of more than five days in a row need approval from the team lead at least four weeks in advance. Unused leave can be carried over for up to five days into the next year.

5. Sick days. If you are unwell, tell your team lead by 9:30 on the first morning of absence, using the team chat or a phone call. A medical certificate is required after three consecutive sick days. Sick days do not reduce paid leave, and there is no fixed limit on sick days.

6. Learning budget. Each team member has a learning budget of 1,200 dollars per year for courses, books and conferences. Requests are approved by the team lead. Conference travel is booked through the finance portal and must be approved before booking.

7. Expenses. Client lunches up to 40 dollars per person are reimbursed with a receipt. Taxi rides are reimbursed only when public transport is unavailable, for example after 22:00. Expense claims must be submitted by the fifth day of the following month.
`;

// This script needs only the database address and the embedding settings
// (it does not use JWT_SECRET, so a weak secret does not block it)
const NEEDED = ['MONGO_URI', 'GEMINI_API_KEY', 'GEMINI_EMBED_MODEL'];
const problems = findEnvProblems(process.env).filter((p) => NEEDED.some((name) => p.startsWith(name)));
if (problems.length > 0) {
  console.error('Fix these in .env first:');
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}

const email = process.env.DEMO_EMAIL || 'demo@example.com';
const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error('Set a password for the demo account in this terminal first (it is never written to a file):');
  console.error("  $env:DEMO_PASSWORD = 'choose-something-here'");
  process.exit(1);
}
const creds = readCredentials({ email, password });
if (creds.error || creds.password.length < 8) {
  console.error('Invalid demo credentials:', creds.error || 'the password needs at least 8 characters');
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('Database:', mongoose.connection.name);

  // 1. The account
  let user = await User.findOne({ email: creds.email });
  if (user) {
    console.log('Account', creds.email, 'already exists. Its password was not changed.');
  } else {
    const passwordHash = await bcrypt.hash(creds.password, 12);
    user = await User.create({ email: creds.email, passwordHash });
    console.log('Created account', creds.email);
  }

  // 2. The sample document (uses a few embedding requests)
  const existing = await Document.findOne({ userId: user._id, filename: FILENAME, status: 'READY' });
  if (existing) {
    console.log('Sample document already there:', existing.chunkCount, 'parts');
  } else {
    // Loaded only now, after the settings checks above
    const { ingestText } = await import('../src/services/ingest.js');
    const doc = await ingestText({ userId: user._id, filename: FILENAME, mimeType: 'text/plain', text: HANDBOOK });
    console.log('Added sample document:', doc.filename, '-', doc.chunkCount, 'parts,', doc.status);
  }

  console.log('\nDone. Log in with', creds.email, 'and the password you set.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}