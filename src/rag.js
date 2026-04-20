import { v4 as uuidv4 } from 'uuid';
import { saveChunks, getChunks } from './db.js';

// ── Text Processing ────────────────────────────────────────────────
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function splitIntoChunks(text, chunkSize = 400, overlap = 80) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const slice = words.slice(i, i + chunkSize).join(' ');
    if (slice.trim().length > 50) chunks.push(slice.trim());
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}

function buildTF(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const total = tokens.length || 1;
  for (const k in tf) tf[k] /= total;
  return tf;
}

function cosineSimilarity(queryTokens, chunkTF) {
  const queryTF = buildTF(queryTokens);
  let dot = 0, queryNorm = 0, chunkNorm = 0;
  for (const t in queryTF) {
    queryNorm += queryTF[t] ** 2;
    if (chunkTF[t]) dot += queryTF[t] * chunkTF[t];
  }
  for (const v of Object.values(chunkTF)) chunkNorm += v ** 2;
  const denom = Math.sqrt(queryNorm) * Math.sqrt(chunkNorm);
  return denom === 0 ? 0 : dot / denom;
}

// ── Public API ─────────────────────────────────────────────────────
export async function ingestDocument(documentId, userId, text) {
  const rawChunks = splitIntoChunks(text);
  const chunks = rawChunks.map((content, idx) => ({
    id: uuidv4(),
    index: idx,
    content,
    tf: buildTF(tokenize(content)),
  }));
  await saveChunks(documentId, userId, chunks);
  return chunks.length;
}

export async function retrieveContext(userId, query, topK = 4) {
  const chunks = await getChunks(userId);
  if (chunks.length === 0) return null;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  const top = chunks
    .map(c => ({ content: c.content, score: cosineSimilarity(queryTokens, c.tf || {}) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(c => c.score > 0.01);

  return top.length === 0 ? null : top.map(c => c.content).join('\n\n---\n\n');
}

export async function extractText(buffer, mimetype, originalName) {
  if (mimetype === 'application/pdf' || originalName.endsWith('.pdf')) {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const data = await parser.getText();
      await parser.destroy();
      return data.text;
    } catch (e) {
      throw new Error('Gagal membaca PDF: ' + e.message);
    }
  }
  const textTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];
  if (textTypes.includes(mimetype) || /\.(txt|md|csv|json|js|ts|py)$/.test(originalName)) {
    return buffer.toString('utf-8');
  }
  throw new Error(`Tipe file tidak didukung: ${mimetype || originalName}`);
}
