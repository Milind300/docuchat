import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT =
  'You are DocuChat, a helpful assistant. Answer clearly and concisely. ' +
  'If you are not sure about something, say so instead of guessing.';

/**
 * history: array of { role: 'user' | 'assistant', content: string }
 * returns: { text, tokensIn, tokensOut }
 */
export async function generateReply(history) {
  // Gemini calls the AI's role "model", not "assistant"
  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents,
    config: { systemInstruction: SYSTEM_PROMPT },
  });

  return {
    text: response.text ?? '',
    tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}