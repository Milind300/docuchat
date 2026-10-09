import mongoose from 'mongoose';
import { RAG } from '../config/rag.js';

const chunkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
    },
    index: { type: Number, required: true }, // position inside the document
    text: { type: String, required: true },
    embedding: {
      type: [Number],
      required: true,
      select: false, // 768 numbers per chunk, so only load them when asked
      validate: {
        validator: (v) => v.length === RAG.EMBED_DIMENSIONS,
        message: `Embedding must have exactly ${RAG.EMBED_DIMENSIONS} numbers`,
      },
    },
  },
  { timestamps: true }
);

// "All chunks of this document, in order"
chunkSchema.index({ documentId: 1, index: 1 });
// "All chunks of this user" (also useful for deleting a user's data)
chunkSchema.index({ userId: 1 });

export const Chunk = mongoose.model('Chunk', chunkSchema);