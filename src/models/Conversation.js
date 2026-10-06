import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      default: 'New chat',
      trim: true,
      maxlength: 100,
    },
  },
  { timestamps: true }
);

// Fast lookup: "all conversations of this user, newest first"
conversationSchema.index({ userId: 1, updatedAt: -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);