// Settings for document search. Changing the vector size means re-embedding every chunk.
export const RAG = {
  EMBED_DIMENSIONS: 768,
  CHUNK_SIZE: 800,
  CHUNK_OVERLAP: 100,
  MAX_CHUNKS_PER_DOCUMENT: 60,
  MAX_DOCUMENTS_PER_DAY: 3,
};