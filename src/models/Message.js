import mongoose from 'mongoose';

// One piece of a document that was used to answer a question
const sourceSchema = new mongoose.Schema(
  {
    documentId: mongoose.Schema.Types.ObjectId,
    filename: String,
    chunkIndex: Number,
    score: Number,
    snippet: String,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    sources: { type: [sourceSchema], default: [] },
  },
  { timestamps: true }
);

// Fast lookup: "all messages of this conversation, oldest first"
messageSchema.index({ conversationId: 1, createdAt: 1 });

export const Message = mongoose.model('Message', messageSchema);