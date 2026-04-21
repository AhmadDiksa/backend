import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes.js';
import authRoutes from './authRoutes.js';
import ragRoutes from './ragRoutes.js';
import { requestLogger } from './middleware/logger.js';
import { requireAuth } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

// ── Routes ─────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/rag', ragRoutes);
app.use('/api', routes);

// Protected me endpoint
app.get('/api/auth/me', requireAuth, (req, res) =>
  res.json({ data: req.user })
);

app.get('/health', (_req, res) =>
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    rag_mode: process.env.RAG_MODE || 'tfidf',
  })
);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  AI Chat Backend running on port ${PORT}   ║
  ║  Auth: JWT  |  RAG: TF-IDF  |  DB: JSON  ║
  ╚══════════════════════════════════════════╝
  `);
});
