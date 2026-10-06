import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

try {
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: 'Explain what a database index is in two sentences.',
  });
  console.log('Model:', process.env.GEMINI_MODEL);
  console.log('Answer:', response.text);
} catch (err) {
  console.error('Gemini call failed.');
  console.error('Status:', err.status);
  console.error('Message:', err.message);
}