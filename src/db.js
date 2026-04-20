import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { JSONFilePreset } from 'lowdb/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'chat.json');

const defaultData = {
  users: [],
  conversations: [],
  messages: [],
  documents: [],
  chunks: [],
};

let dbPromise = null;

export async function getDb() {
  if (!dbPromise) {
    mkdirSync(DATA_DIR, { recursive: true });
    dbPromise = JSONFilePreset(DB_PATH, defaultData);
  }
  return dbPromise;
}

function now() { return Math.floor(Date.now() / 1000); }

// ── Users ──────────────────────────────────────────────────────────
export async function createUser(id, username, passwordHash) {
  const db = await getDb();
  const user = { id, username, password_hash: passwordHash, created_at: now() };
  db.data.users.push(user);
  await db.write();
  return { id: user.id, username: user.username, created_at: user.created_at };
}

export async function getUserByUsername(username) {
  const db = await getDb();
  return db.data.users.find(u => u.username === username) || null;
}

export async function getUserById(id) {
  const db = await getDb();
  const u = db.data.users.find(u => u.id === id);
  if (!u) return null;
  return { id: u.id, username: u.username, created_at: u.created_at };
}

// ── Conversations ──────────────────────────────────────────────────
export async function createConversation(id, userId, title = 'New Chat') {
  const db = await getDb();
  const conv = { id, user_id: userId, title, created_at: now(), updated_at: now() };
  db.data.conversations.push(conv);
  await db.write();
  return { ...conv, message_count: 0 };
}

export async function getConversations(userId) {
  const db = await getDb();
  return db.data.conversations
    .filter(c => c.user_id === userId)
    .map(c => ({
      ...c,
      message_count: db.data.messages.filter(m => m.conversation_id === c.id).length,
    }))
    .sort((a, b) => b.updated_at - a.updated_at);
}

export async function getConversation(id, userId) {
  const db = await getDb();
  const conv = db.data.conversations.find(c => c.id === id);
  if (!conv) return null;
  if (userId && conv.user_id !== userId) return null;
  return conv;
}

export async function updateConversationTitle(id, title) {
  const db = await getDb();
  const conv = db.data.conversations.find(c => c.id === id);
  if (conv) { conv.title = title; conv.updated_at = now(); }
  await db.write();
}

export async function deleteConversation(id) {
  const db = await getDb();
  db.data.conversations = db.data.conversations.filter(c => c.id !== id);
  db.data.messages = db.data.messages.filter(m => m.conversation_id !== id);
  await db.write();
}

// ── Messages ───────────────────────────────────────────────────────
export async function addMessage(id, conversationId, role, content) {
  const db = await getDb();
  const msg = { id, conversation_id: conversationId, role, content, created_at: now() };
  db.data.messages.push(msg);
  const conv = db.data.conversations.find(c => c.id === conversationId);
  if (conv) conv.updated_at = now();
  await db.write();
  return msg;
}

export async function getMessages(conversationId) {
  const db = await getDb();
  return db.data.messages
    .filter(m => m.conversation_id === conversationId)
    .sort((a, b) => a.created_at - b.created_at);
}

// ── RAG: Documents ─────────────────────────────────────────────────
export async function createDocument(id, userId, filename, originalName, chunkCount) {
  const db = await getDb();
  const doc = { id, user_id: userId, filename, original_name: originalName, chunk_count: chunkCount, created_at: now() };
  db.data.documents.push(doc);
  await db.write();
  return doc;
}

export async function getDocuments(userId) {
  const db = await getDb();
  return db.data.documents
    .filter(d => d.user_id === userId)
    .sort((a, b) => b.created_at - a.created_at);
}

export async function deleteDocument(id, userId) {
  const db = await getDb();
  db.data.documents = db.data.documents.filter(d => !(d.id === id && d.user_id === userId));
  db.data.chunks = db.data.chunks.filter(c => c.document_id !== id);
  await db.write();
}

// ── RAG: Chunks ────────────────────────────────────────────────────
export async function saveChunks(documentId, userId, chunks) {
  const db = await getDb();
  db.data.chunks = db.data.chunks.filter(c => c.document_id !== documentId);
  for (const chunk of chunks) {
    db.data.chunks.push({ ...chunk, document_id: documentId, user_id: userId });
  }
  await db.write();
}

export async function getChunks(userId) {
  const db = await getDb();
  return db.data.chunks.filter(c => c.user_id === userId);
}
