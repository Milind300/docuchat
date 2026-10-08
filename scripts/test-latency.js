import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = process.env.GEMINI_MODEL;

async function timed(label, prompt) {
  const start = Date.now();
  const r = await ai.models.generateContent({ model, contents: prompt });
  console.log(`${label}: ${Date.now() - start} ms`);
  console.log('  usageMetadata:', JSON.stringify(r.usageMetadata));
}

try {
  await timed('Tiny question (Say hi)      ', 'Say hi');
  await timed('100-word answer, no streaming', 'Explain what an API is in about 100 words.');
} catch (err) {
  console.error('Failed.');
  console.error('Status:', err.status);
  console.error('Message:', err.message);
}