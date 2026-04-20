/**
 * rag-langchain.js
 *
 * LangChain-based RAG implementation.
 * Uses LangChain for:
 *   - Document splitting  (RecursiveCharacterTextSplitter)
 *   - Prompt templating   (ChatPromptTemplate)
 *   - Chain orchestration (LCEL pipe / RunnableSequence)
 *   - LLM calls          (ChatAnthropic)
 *
 * Uses our own TF-IDF for retrieval (no external vector DB needed).
 *
 * Drop-in replacement for rag.js — same exported function signatures.
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatAnthropic } from '@langchain/anthropic';
import { v4 as uuidv4 } from 'uuid';
import { saveChunks, getChunks } from './db.js';
import { logger } from './middleware/logger.js';

// ── LangChain components ───────────────────────────────────────────

const llm = new ChatAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-haiku-4-5-20251001',  // fast model for RAG summary
  maxTokens: 1024,
});

// Text splitter — LangChain's RecursiveCharacterTextSplitter is smarter
// than our manual word-based splitter: it respects paragraph/sentence boundaries
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1500,       // characters (not words)
  chunkOverlap: 200,
  separators: ['\n\n', '\n', '. ', ' ', ''],
});

// RAG prompt template using LangChain's ChatPromptTemplate
const ragPromptTemplate = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are a helpful assistant that answers questions based on provided context.
Use the context below to answer the user's question accurately and concisely.
If the context doesn't contain enough information, say so and answer from general knowledge.

Context:
{context}`,
  ],
  ['human', '{question}'],
]);

// LCEL chain: context + question → formatted prompt → LLM → string
// This is the idiomatic LangChain Expression Language (LCEL) pattern
export const ragChain = RunnableSequence.from([
  {
    context: (input) => input.context,
    question: (input) => input.question,
  },
  ragPromptTemplate,
  llm,
  new StringOutputParser(),
]);

// ── TF-IDF helpers (same as rag.js — retrieval layer) ─────────────
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
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

// ── Public API (same interface as rag.js) ─────────────────────────

/**
 * Ingest a document using LangChain's RecursiveCharacterTextSplitter.
 * Splits into LangChain Document objects, then indexes with TF-IDF.
 */
export async function ingestDocument(documentId, userId, text) {
  // Use LangChain splitter — respects paragraph/sentence boundaries
  const langchainDocs = await splitter.createDocuments(
    [text],
    [{ documentId, userId }]   // metadata attached to each chunk
  );

  // Convert LangChain Documents → our storage format with TF index
  const chunks = langchainDocs.map((doc, idx) => ({
    id: uuidv4(),
    index: idx,
    content: doc.pageContent,
    metadata: doc.metadata,
    tf: buildTF(tokenize(doc.pageContent)),
  }));

  await saveChunks(documentId, userId, chunks);
  logger.success(`Document ${documentId} ingested: ${chunks.length} chunks created.`);
  return chunks.length;
}

/**
 * Retrieve top-K relevant chunks and wrap them as LangChain Documents.
 * Returns context string for injection into prompt.
 */
export async function retrieveContext(userId, query, topK = 4) {
  const chunks = await getChunks(userId);
  if (chunks.length === 0) return null;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  const start = Date.now();

  // Score and retrieve
  const topChunks = chunks
    .map(c => ({ content: c.content, score: cosineSimilarity(queryTokens, c.tf || {}) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(c => c.score > 0.01);

  if (topChunks.length === 0) return null;

  // Wrap as LangChain Document objects (good practice, shows LangChain usage)
  const docs = topChunks.map(c =>
    new Document({ pageContent: c.content, metadata: { score: c.score.toFixed(4) } })
  );

  const duration = Date.now() - start;
  logger.info(`RAG Retrieval: Found ${docs.length} relevant chunks in ${duration}ms`);

  // Format context from LangChain Documents
  return docs.map(d => d.pageContent).join('\n\n---\n\n');
}

/**
 * Standalone RAG answer using full LangChain LCEL chain.
 * Used when you want LangChain to handle the entire RAG answer,
 * not just retrieve context (e.g., for summarization endpoints).
 */
export async function answerWithRag(userId, question) {
  const context = await retrieveContext(userId, question);
  if (!context) return null;

  // Invoke LCEL chain: {context, question} → answer string
  const answer = await ragChain.invoke({ context, question });
  return answer;
}

/**
 * Extract text from file buffer.
 * Same implementation as rag.js.
 */
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
