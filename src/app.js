import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import chatStreamRoutes from './routes/chatStream.js';
import conversationRoutes from './routes/conversations.js';
import documentRoutes from './routes/documents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Security headers. Our page loads only its own files, so the strict defaults fit.
// 'upgrade-insecure-requests' is switched off so plain http://localhost keeps working.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'upgrade-insecure-requests': null },
    },
  })
);

app.use(express.json({ limit: '100kb' })); // chat messages are capped at 2000 characters anyway

// Express 5 leaves req.body undefined when the request is not JSON. Make it an empty object
// so every route can read from it safely and answer with a normal "required" message.
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/chat/stream', chatStreamRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/documents', documentRoutes);

// Catches any error and returns clean JSON instead of crashing
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body is not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong' });
});

export default app;