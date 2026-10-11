import mongoose from 'mongoose';

// One row per batch of embedding requests, for the whole app
const embeddingLogSchema = new mongoose.Schema({
  count: { type: Number, required: true, min: 1 },
  kind: { type: String, enum: ['document', 'query', 'test'], default: 'document' },
  createdAt: { type: Date, default: Date.now },
});

// Serves "how many in the last minute / today" and deletes rows older than 3 days
embeddingLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

export const EmbeddingLog = mongoose.model('EmbeddingLog', embeddingLogSchema);