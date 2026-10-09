import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

try {
  const pager = await ai.models.list();
  let shown = 0;
  for await (const m of pager) {
    const actions = m.supportedActions || [];
    const isEmbedding =
      m.name.toLowerCase().includes('embed') ||
      actions.some((a) => a.toLowerCase().includes('embed'));
    if (!isEmbedding) continue;
    shown++;
    console.log(m.name, '|', m.displayName, '|', actions.join(', '));
  }
  console.log('Embedding models found:', shown);
} catch (err) {
  console.error('Could not list models.');
  console.error('Status:', err.status);
  console.error('Message:', err.message);
}