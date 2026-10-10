// Settings for document search. Changing the vector size means re-embedding every chunk.
// export const RAG = {
//   EMBED_DIMENSIONS: 768,
//   CHUNK_SIZE: 800,
//   CHUNK_OVERLAP: 100,
//   MAX_CHUNKS_PER_DOCUMENT: 60,
//   MAX_DOCUMENTS_PER_DAY: 3,
// };

// Settings for document search. Changing the vector size means re-embedding every chunk.
export const RAG = {
  EMBED_DIMENSIONS: 768,
  CHUNK_SIZE: 800,
  CHUNK_OVERLAP: 100,
  MAX_CHUNKS_PER_DOCUMENT: 60,
  MAX_DOCUMENTS_PER_DAY: 3,
  TOP_K: 4,          // how many chunks are sent to the AI
  MIN_SCORE: 0.765,  // below this, the question is treated as unrelated to the documents
};