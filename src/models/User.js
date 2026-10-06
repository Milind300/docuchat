import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,      // no two users with the same email
      lowercase: true,   // Milind@x.com and milind@x.com are the same
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,     // never returned in queries unless we ask for it
    },
  },
  { timestamps: true }   // adds createdAt and updatedAt automatically
);

export const User = mongoose.model('User', userSchema);