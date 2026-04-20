import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from './middleware/auth.js';
import {
  createConversation, getConversations, getConversation,
  deleteConversation, addMessage, getMessages, updateConversationTitle,
} from './db.js';
import { streamChat, generateTitle } from './ai.js';
import { retrieveContext } from './rag-factory.js';

const router = Router();
router.use(requireAuth);

// Detect mode
const AGENT_MODE = process.env.AGENT_MODE || 'off';
const isRestaurantAgent = AGENT_MODE === 'restaurant';

// Lazy-load agent to avoid import errors when Google Sheets creds are missing
let runAgent = null;
async function getAgent() {
  if (!runAgent) {
    const mod = await import('./agent.js');
    runAgent = mod.runAgent;
  }
  return runAgent;
}

// GET /api/conversations
router.get('/conversations', async (req, res) => {
  try {
    res.json({ data: await getConversations(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations
router.post('/conversations', async (req, res) => {
  try {
    res.status(201).json({ data: await createConversation(uuidv4(), req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/conversations/:id
router.delete('/conversations/:id', async (req, res) => {
  try {
    const conv = await getConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    await deleteConversation(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:id/messages
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const conv = await getConversation(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ data: await getMessages(req.params.id), conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:id/messages — SSE streaming
router.post('/conversations/:id/messages', async (req, res) => {
  const { content, provider, model } = req.body;
  const conversationId = req.params.id;

  if (!content?.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  let conv = await getConversation(conversationId, req.user.id);
  if (!conv) conv = await createConversation(conversationId, req.user.id);

  const userMsg = await addMessage(uuidv4(), conversationId, 'user', content.trim());
  const history = await getMessages(conversationId);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  sendEvent('user_message', userMsg);

  try {
    // ── Restaurant Agent Mode ────────────────────────────────────
    if (isRestaurantAgent) {
      const agent = await getAgent();

      await agent(
        history,
        (chunk) => sendEvent('chunk', { text: chunk }),
        (tool) => sendEvent('tool_call', {
          name: tool.name,
          args: tool.args,
          result: tool.result,
        }),
        async (fullText) => {
          const assistantMsg = await addMessage(uuidv4(), conversationId, 'assistant', fullText);
          if (history.length === 1 && conv.title === 'New Chat') {
            const title = await generateTitle(content, provider, model);
            await updateConversationTitle(conversationId, title);
            sendEvent('title_update', { title });
          }
          sendEvent('done', { message: assistantMsg });
          res.end();
        },
        provider,
        model
      );

      // ── Normal Chat Mode (with optional RAG) ────────────────────
    } else {
      const ragContext = await retrieveContext(req.user.id, content.trim());
      if (ragContext) sendEvent('rag_used', { chunks: ragContext.split('---').length });

      await streamChat(
        history,
        ragContext,
        (chunk) => sendEvent('chunk', { text: chunk }),
        async (fullText) => {
          const assistantMsg = await addMessage(uuidv4(), conversationId, 'assistant', fullText);
          if (history.length === 1 && conv.title === 'New Chat') {
            const title = await generateTitle(content, provider, model);
            await updateConversationTitle(conversationId, title);
            sendEvent('title_update', { title });
          }
          sendEvent('done', { message: assistantMsg });
          res.end();
        },
        provider,
        model
      );
    }
  } catch (err) {
    console.error('Error:', err);
    sendEvent('error', { error: err.message || 'Service error' });
    res.end();
  }
});

// GET /api/mode — info current mode
router.get('/mode', (_req, res) => {
  res.json({
    agent_mode: AGENT_MODE,
    rag_mode: process.env.RAG_MODE || 'tfidf',
    is_restaurant_agent: isRestaurantAgent,
  });
});

export default router;
