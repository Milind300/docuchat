import mongoose from 'mongoose';

// One row per (key, time window). Rows delete themselves after the window ends.
const rateLimitSchema = new mongoose.Schema({
  bucket: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});

rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = mongoose.model('RateLimit', rateLimitSchema);