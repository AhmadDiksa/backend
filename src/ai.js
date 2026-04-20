import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './middleware/logger.js';

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openRouterClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const BASE_SYSTEM_PROMPT = `You are a helpful, knowledgeable AI assistant.
Be concise, clear, and friendly. Use markdown formatting when helpful (code blocks, lists, etc.).
If you don't know something, say so honestly.`;

export async function streamChat(messages, ragContext, onChunk, onDone, provider = 'anthropic', model = 'claude-3-5-sonnet-20241022') {
  let systemPrompt = BASE_SYSTEM_PROMPT;

  if (ragContext) {
    systemPrompt += `\n\nBerikut adalah konteks dari dokumen yang telah diupload pengguna.
Gunakan informasi ini untuk menjawab pertanyaan jika relevan:

<context>
${ragContext}
</context>

Jika pertanyaan tidak berkaitan dengan konteks di atas, jawab berdasarkan pengetahuan umum.`;
  }

  let fullText = '';
  const startTime = Date.now();

  try {
    if (provider === 'openrouter') {
      const stream = await openRouterClient.chat.completions.create({
        model: model || 'meta-llama/llama-3.3-70b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content }))
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          fullText += text;
          onChunk(text);
        }
      }
    } else if (provider === 'gemini') {
      const geminiModel = genAI.getGenerativeModel({ 
        model: model || 'gemini-2.5-flash',
        systemInstruction: systemPrompt,
        // Enabling thinking support if the model supports it
        includeThoughts: true
      });
      
      const chat = geminiModel.startChat({
        history: messages.slice(0, -1).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      });

      const lastMessage = messages[messages.length - 1].content;
      const result = await chat.sendMessageStream(lastMessage);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        fullText += text;
        onChunk(text);
      }
    } else {
      // default: anthropic
      const stream = await anthropicClient.messages.stream({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const chunk = event.delta.text;
          fullText += chunk;
          onChunk(chunk);
        }
      }
    }
    const duration = Date.now() - startTime;
    logger.llm(provider, model, duration);
    if (ragContext) logger.info(`RAG Answer generated in ${duration}ms`);
  } catch (error) {
    console.error(`Error streaming with ${provider}:`, error);
    const errorMessage = `\n\n[Error communicating with ${provider} API. Please check your configuration.]`;
    fullText += errorMessage;
    onChunk(errorMessage);
  }

  onDone(fullText);
  return fullText;
}

export async function generateTitle(userMessage, provider = 'anthropic', model) {
  const prompt = `Generate a very short title (max 5 words, no quotes) for a chat that starts with: "${userMessage.slice(0, 200)}"`;
  
  try {
    if (provider === 'openrouter') {
      const response = await openRouterClient.chat.completions.create({
        model: model || 'meta-llama/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 20,
      });
      return response.choices[0]?.message?.content?.trim() || 'New Chat';
    } else if (provider === 'gemini') {
      const geminiModel = genAI.getGenerativeModel({ model: model || 'gemini-2.5-flash' });
      const result = await geminiModel.generateContent(prompt);
      return result.response.text().trim() || 'New Chat';
    } else {
      const response = await anthropicClient.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.content[0]?.text?.trim() || 'New Chat';
    }
  } catch (error) {
    console.error(`Title generation failed with ${provider}:`, error);
    return 'New Chat';
  }
}
