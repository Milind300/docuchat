import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const texts = [
  'How do I reset my password?',
  'I forgot my login password, how can I change it?',
  'The cat sat on the warm windowsill.',
];

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function test(model) {
  console.log('---', model);
  const start = Date.now();
  try {
    const res = await ai.models.embedContent({ model, contents: texts });
    const vectors = (res.embeddings || []).map((e) => e.values);
    console.log('Time:', Date.now() - start, 'ms');
    console.log('Vectors returned:', vectors.length);
    if (vectors.length === 0) {
      console.log('Unexpected response keys:', Object.keys(res));
      return;
    }
    console.log('Vector length (dimensions):', vectors[0].length);
    if (vectors.length === texts.length) {
      console.log('Similar sentences  :', cosine(vectors[0], vectors[1]).toFixed(3));
      console.log('Unrelated sentences:', cosine(vectors[0], vectors[2]).toFixed(3));
    }
  } catch (err) {
    console.error('Failed.');
    console.error('Status:', err.status);
    console.error('Message:', err.message);
  }
}

await test('gemini-embedding-001');
await test('gemini-embedding-2');