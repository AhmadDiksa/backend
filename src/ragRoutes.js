import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from './middleware/auth.js';
import { createDocument, getDocuments, deleteDocument } from './db.js';
import { ingestDocument, extractText } from './rag-factory.js';

const router = Router();

// Multer: store files in memory (buffer), max 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/plain', 'text/markdown', 'application/pdf', 'application/json', 'text/csv'];
    const allowedExt = /\.(txt|md|pdf|json|csv|js|ts|py)$/i;
    if (allowed.includes(file.mimetype) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Tipe file tidak didukung. Gunakan: txt, md, pdf, json, csv'));
    }
  },
});

// GET /api/rag/documents
router.get('/documents', requireAuth, async (req, res) => {
  try {
    const docs = await getDocuments(req.user.id);
    res.json({ data: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rag/documents  (upload + ingest)
router.post('/documents', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File wajib diupload' });
  }

  try {
    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);

    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'File terlalu pendek atau tidak bisa dibaca' });
    }

    const docId = uuidv4();
    const chunkCount = await ingestDocument(docId, req.user.id, text);
    const doc = await createDocument(docId, req.user.id, req.file.originalname, req.file.originalname, chunkCount);

    res.status(201).json({ data: doc, chunks_created: chunkCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rag/documents/:id
router.delete('/documents/:id', requireAuth, async (req, res) => {
  try {
    await deleteDocument(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

// POST /api/rag/answer — standalone RAG answer (LangChain chain only)
router.post('/answer', requireAuth, async (req, res) => {
  const { question } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question is required' });

  try {
    const { answerWithRag, RAG_MODE } = await import('./rag-factory.js');
    if (RAG_MODE !== 'langchain') {
      return res.status(400).json({ error: 'Endpoint ini hanya tersedia di RAG_MODE=langchain' });
    }
    const answer = await answerWithRag(req.user.id, question.trim());
    if (!answer) return res.status(404).json({ error: 'Tidak ada dokumen relevan ditemukan' });
    res.json({ data: { answer, question } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
