import 'dotenv/config';
import mongoose from 'mongoose';
import { findEnvProblems } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Document } from '../src/models/Document.js';
import { RAG } from '../src/config/rag.js';
import { searchChunks } from '../src/services/search.js';
import { generateCitedReply } from '../src/services/gemini.js';

// Checks the real vector search and the real Gemini answer against the demo account's handbook.
// It uses about 3 embedding requests and 2 chat requests.

const NEEDED = ['MONGO_URI', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_EMBED_MODEL'];
const problems = findEnvProblems(process.env).filter((p) => NEEDED.some((name) => p.startsWith(name)));
if (problems.length > 0) {
  console.error('Fix these in .env first:');
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}

const email = process.env.DEMO_EMAIL || 'demo@example.com';
let failed = 0;

function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', '-', name, detail ? `(${detail})` : '');
}

// The same steps the chat route takes for a document question
async function ask(userId, question) {
  const found = await searchChunks(userId, question, RAG.TOP_K);
  const relevant = found.filter((c) => c.score >= RAG.MIN_SCORE);
  const topScore = found[0]?.score ?? 0;
  const reply = relevant.length ? await generateCitedReply([{ role: 'user', content: question }], relevant) : null;
  return { relevant, topScore, reply };
}

const usedText = (r) =>
  r.reply?.used ? r.reply.used.map((n) => r.relevant[n - 1]?.text ?? '').join(' ') : '';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const user = await User.findOne({ email });
  if (!user) throw new Error(`${email} was not found. Run scripts\\seed-demo.js first.`);
  const doc = await Document.findOne({ userId: user._id, status: 'READY' });
  if (!doc) throw new Error('The demo account has no finished document. Run scripts\\seed-demo.js first.');
  console.log(`Account: ${email} | document: ${doc.filename} | ${doc.chunkCount} parts\n`);

  let r = await ask(user._id, 'How many days a week can I work remotely?');
  check('search finds the remote-work passage', r.relevant.some((c) => /three days per week/i.test(c.text)), `top score ${r.topScore.toFixed(3)}`);
  check('answer says three days', Boolean(r.reply) && /three|\b3\b/i.test(r.reply.text), r.reply?.text.slice(0, 70) ?? 'no answer');
  check('the sources it names contain that passage', /three days per week/i.test(usedText(r)),
    r.reply?.used === null ? 'the USED line could not be read' : '');

  r = await ask(user._id, 'What is the home-office stipend?');
  check('search finds the stipend passage', r.relevant.some((c) => /400/.test(c.text)), `top score ${r.topScore.toFixed(3)}`);
  check('answer says 400 dollars', Boolean(r.reply) && /400/.test(r.reply.text), r.reply?.text.slice(0, 70) ?? 'no answer');

  r = await ask(user._id, 'What is the capital of France?');
  const refused =
    r.relevant.length === 0 ||
    /could not find|cannot find|not find/i.test(r.reply?.text ?? '') ||
    r.reply?.used?.length === 0;
  check('an unrelated question is refused', refused, `top score ${r.topScore.toFixed(3)}`);

  console.log(failed === 0 ? '\nAll live checks passed.' : `\n${failed} check(s) failed.`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error('\nLive check failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}