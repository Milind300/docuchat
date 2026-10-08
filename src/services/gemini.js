import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT =
  'You are DocuChat, a helpful assistant. Answer clearly and concisely. ' +
  'If you are not sure about something, say so instead of guessing.';

// Gemini calls the AI's role "model", not "assistant"
function toContents(history) {
  return history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

/**
 * history: array of { role: 'user' | 'assistant', content: string }
 * returns: { text, tokensIn, tokensOut }   (the whole answer at once)
 */
export async function generateReply(history) {
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: toContents(history),
    config: { systemInstruction: SYSTEM_PROMPT },
  });

  return {
    text: response.text ?? '',
    tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

/**
 * Same question, but the answer arrives in pieces.
 * Yields { type: 'text', text } for each piece,
 * then one final { type: 'done', tokensIn, tokensOut }.
 */
export async function* streamReply(history) {
  const stream = await ai.models.generateContentStream({
    model: process.env.GEMINI_MODEL,
    contents: toContents(history),
    config: { systemInstruction: SYSTEM_PROMPT },
  });

  let tokensIn = 0;
  let tokensOut = 0;

  for await (const chunk of stream) {
    if (chunk.usageMetadata) {
      tokensIn = chunk.usageMetadata.promptTokenCount ?? tokensIn;
      tokensOut = chunk.usageMetadata.candidatesTokenCount ?? tokensOut;
    }
    if (chunk.text) {
      yield { type: 'text', text: chunk.text };
    }
  }

  yield { type: 'done', tokensIn, tokensOut };
}