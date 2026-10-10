import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { Document } from '../models/Document.js';
import { RAG } from '../config/rag.js';
import { startOfPacificDay, nextPacificReset } from '../utils/pacificTime.js';
import { extractTextFromFile } from '../services/extract.js';
import { ingestText } from '../services/ingest.js';

const router = Router();

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

// Runs multer and turns its errors into friendly JSON
function receiveFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'That file is too large. The limit is 4 MB.' });
    }
    return res.status(400).json({ message: 'Upload failed. Send one file in the field named "file".' });
  });
}

// POST /api/documents   (multipart form, field name "file")
router.post('/', requireAuth, receiveFile, async (req, res) => {
  const userId = req.user.id;

  if (!req.file) {
    return res.status(400).json({ message: 'No file received.' });
  }

  // 1. Daily upload limit
  const today = await Document.countDocuments({
    userId,
    createdAt: { $gte: startOfPacificDay() },
  });
  if (today >= RAG.MAX_DOCUMENTS_PER_DAY) {
    return res.status(429).json({
      code: 'DOCUMENT_DAILY_LIMIT',
      message: `You can upload ${RAG.MAX_DOCUMENTS_PER_DAY} documents per day. The limit resets at midnight Pacific Time (${nextPacificReset().toUTCString()}).`,
    });
  }

  // 2. Read the text out of the file
  const filename = path.basename(req.file.originalname).slice(0, 200);
  const mimeType = req.file.mimetype;

  let text;
  try {
    ({ text } = await extractTextFromFile({ buffer: req.file.buffer, filename, mimeType }));
  } catch (err) {
    const message = err.message.startsWith('Only')
      ? err.message
      : 'Could not read this file. It may be damaged or password-protected.';
    return res.status(400).json({ message });
  }

  // 3. Split, embed and save
  try {
    const doc = await ingestText({ userId, filename, mimeType, text });
    return res.status(201).json({
      document: { id: doc._id, filename: doc.filename, status: doc.status, chunkCount: doc.chunkCount },
    });
  } catch (err) {
    console.error('Ingest error:', err.status, err.message);

    const ourMessages = ['No readable text', 'This document is too large'];
    if (ourMessages.some((m) => err.message.startsWith(m))) {
      return res.status(422).json({ message: err.message });
    }
    if (err.status === 429) {
      return res.status(429).json({ message: 'The AI is busy right now. Please try again in a minute.' });
    }
    return res.status(500).json({ message: 'Could not process the document right now. Please try again.' });
  }
});

// GET /api/documents  -> my documents, newest first
router.get('/', requireAuth, async (req, res) => {
  const documents = await Document.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .select('filename status chunkCount error createdAt');

  res.json({ documents });
});
export default router;