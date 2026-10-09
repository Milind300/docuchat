import { GoogleGenAI } from '@google/genai';
import { RAG } from '../config/rag.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BATCH_SIZE = 20; // texts sent per request

async function embedBatch(texts, taskType) {
  const res = await ai.models.embedContent({
    model: process.env.GEMINI_EMBED_MODEL,
    contents: texts,
    config: { outputDimensionality: RAG.EMBED_DIMENSIONS, taskType },
  });

  const vectors = (res.embeddings || []).map((e) => e.values);
  // Embedding 2 once returned one vector for three texts, so we always check
  if (vectors.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings but got ${vectors.length}`);
  }
  return vectors;
}

// For document chunks
export async function embedDocuments(texts) {
  const all = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    all.push(...(await embedBatch(batch, 'RETRIEVAL_DOCUMENT')));
  }
  return all;
}

// For a user's question (used in a later step)
export async function embedQuery(text) {
  const [vector] = await embedBatch([text], 'RETRIEVAL_QUERY');
  return vector;
}