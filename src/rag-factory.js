/**
 * rag-factory.js
 *
 * Loads the correct RAG implementation based on RAG_MODE env var:
 *   RAG_MODE=tfidf      → uses rag.js        (default, pure JS, no external deps)
 *   RAG_MODE=langchain  → uses rag-langchain.js (LangChain LCEL + RecursiveTextSplitter)
 *
 * All callers (routes.js, ragRoutes.js, ai.js) import from here.
 * Swap RAG engine = change one env var. Zero code changes.
 */

const mode = (process.env.RAG_MODE || 'tfidf').toLowerCase();

let ragModule;

if (mode === 'langchain') {
  ragModule = await import('./rag-langchain.js');
  console.log('🦜 RAG mode: LangChain (RecursiveCharacterTextSplitter + LCEL chain)');
} else {
  ragModule = await import('./rag.js');
  console.log('📐 RAG mode: TF-IDF (pure JS cosine similarity)');
}

export const { ingestDocument, retrieveContext, extractText, answerWithRag } = ragModule;
export const RAG_MODE = mode;
