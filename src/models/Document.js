import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    filename: { type: String, required: true, trim: true, maxlength: 200 },
    mimeType: { type: String, default: 'text/plain' },
    status: {
      type: String,
      enum: ['PROCESSING', 'READY', 'FAILED'],
      default: 'PROCESSING',
    },
    chunkCount: { type: Number, default: 0 },
    charCount: { type: Number, default: 0 },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

// "My documents, newest first" and "how many did I upload today"
documentSchema.index({ userId: 1, createdAt: -1 });

export const Document = mongoose.model('Document', documentSchema);