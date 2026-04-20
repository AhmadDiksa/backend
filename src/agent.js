/**
 * agent.js
 *
 * LangChain Restaurant CS Agent dengan tool calling.
 *
 * Flow:
 *   1. Bangun message history (SystemMessage + HumanMessage + AIMessage)
 *   2. Bind tools ke ChatAnthropic
 *   3. Call model → kalau ada tool_calls → eksekusi tools
 *   4. Loop sampai tidak ada tool_calls lagi
 *   5. Stream final response ke client via SSE
 *
 * Streaming:
 *   - Tool execution dikirim sebagai event "tool_start" dan "tool_result"
 *   - Final text response di-stream chunk by chunk
 */

import { ChatAnthropic as LangChainAnthropic } from '@langchain/anthropic';
import { ChatOpenAI as LangChainOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { restaurantTools } from './restaurant-tools.js';
import { logger } from './middleware/logger.js';

const RESTAURANT_SYSTEM_PROMPT = `Kamu adalah asisten customer service ramah untuk **Restoran Nusantara**, sebuah restoran Indonesia modern di Jakarta.

**Kemampuanmu:**
- Menampilkan menu dan informasi harga
- Mencatat pesanan pelanggan ke sistem
- Membuat dan mengecek reservasi meja
- Update status pesanan
- Membatalkan reservasi

**Panduan:**
- Selalu sapa pelanggan dengan hangat dan gunakan bahasa Indonesia yang sopan
- Sebelum mencatat pesanan, konfirmasi item dan total harga
- Sebelum membuat reservasi, pastikan kamu sudah punya: nama, tanggal, jam, jumlah tamu, dan nomor kontak
- Gunakan tools yang tersedia untuk mengakses data real-time
- Jika ada yang tidak bisa dilakukan, arahkan pelanggan untuk menghubungi staf secara langsung
- Setelah melakukan aksi (catat pesanan/reservasi), berikan konfirmasi yang jelas dengan ID referensi

**Jam Operasional:** Senin–Minggu, 10:00–22:00 WIB
**Telepon:** (021) 555-1234
**Lokasi:** Jl. Sudirman No. 88, Jakarta Pusat`;

// We will instantiate llm inside runAgent dynamically.

/**
 * Convert our DB message format → LangChain message objects
 */
function toLC(messages) {
  return messages.map(m => {
    if (m.role === 'user') return new HumanMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}

/**
 * Execute a single tool call
 */
async function executeTool(toolCall) {
  const tool = restaurantTools.find(t => t.name === toolCall.name);
  if (!tool) {
    return { toolCallId: toolCall.id, output: `Tool "${toolCall.name}" tidak ditemukan.` };
  }
  try {
    const output = await tool.func(toolCall.args);
    return { toolCallId: toolCall.id, name: toolCall.name, output };
  } catch (e) {
    return { toolCallId: toolCall.id, name: toolCall.name, output: `Error: ${e.message}` };
  }
}

/**
 * Run the agent with streaming SSE callbacks.
 *
 * @param {Array}    history    - Message history from DB [{role, content}]
 * @param {Function} onChunk    - Called with each streamed text token
 * @param {Function} onTool     - Called when a tool is invoked { name, args, result }
 * @param {Function} onDone     - Called with final complete text
 */
export async function runAgent(history, onChunk, onTool, onDone, provider = 'anthropic', model) {
  let rawLlm;
  if (provider === 'openrouter') {
    logger.info(`Initializing OpenRouter with model: ${model || 'meta-llama/llama-3.3-70b-instruct'}`);
    rawLlm = new LangChainOpenAI({
      model: model || 'meta-llama/llama-3.3-70b-instruct',
      temperature: 0.1,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      },
    });
  } else if (provider === 'gemini') {
    logger.info(`Initializing Gemini with model: ${model || 'gemini-2.5-flash'}`);
    rawLlm = new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      model: model || 'gemini-2.5-flash',
      temperature: 0.1,
      // includeThoughts is required for reasoning models (2.5+) in newer SDKs
      includeThoughts: true,
    });
  } else {
    logger.info(`Initializing Anthropic with model: ${model || 'claude-3-5-sonnet-20241022'}`);
    rawLlm = new LangChainAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: model || 'claude-3-5-sonnet-20241022',
      maxTokens: 2048,
    });
  }

  const llm = rawLlm.bindTools(restaurantTools);

  // Build message array: system + history
  const messages = [
    new SystemMessage(RESTAURANT_SYSTEM_PROMPT),
    ...toLC(history),
  ];

  let fullResponse = '';
  const MAX_ITERATIONS = 5; // prevent infinite loops

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const iterStart = Date.now();
    // Use invoke instead of stream because LangChain JS currently drops the 
    // Gemini 2.5 thought_signature during stream accumulation.
    const aiMessage = await llm.invoke(messages);

    let streamedText = '';
    const parsedToolCalls = aiMessage.tool_calls || [];
    
    // Extract text block(s) if any, and trigger onChunk
    if (typeof aiMessage.content === 'string') {
      streamedText = aiMessage.content;
      if (streamedText) onChunk(streamedText);
      fullResponse += streamedText;
    } else if (Array.isArray(aiMessage.content)) {
      for (const block of aiMessage.content) {
        if (block.type === 'text') {
          streamedText += block.text;
          if (block.text) onChunk(block.text);
          fullResponse += block.text;
        } else if (block.type === 'thinking' || block.type === 'thought') {
          logger.info(`Model Reasoning: ${block.text.substring(0, 50)}...`);
        }
      }
    }
    
    // For debugging: dump if kwargs signature found
    if (provider === 'gemini' && aiMessage.additional_kwargs?.['__gemini_function_call_thought_signatures__']) {
      logger.info(`FOUND NATIVE SIGNATURE via invoke: ${Object.keys(aiMessage.additional_kwargs['__gemini_function_call_thought_signatures__']).length} sigs`);
    }

    messages.push(aiMessage);

    // No tool calls → we're done
    if (parsedToolCalls.length === 0) {
      const duration = Date.now() - iterStart;
      logger.llm(provider, model, duration);
      break;
    }

    const duration = Date.now() - iterStart;
    logger.llm(provider, model, duration);

    // Execute all tool calls in parallel
    const toolStart = Date.now();
    const toolResults = await Promise.all(parsedToolCalls.map(executeTool));
    const toolDuration = Date.now() - toolStart;

    // Notify SSE about each tool execution
    for (const result of toolResults) {
      logger.tool(result.name, JSON.stringify(parsedToolCalls.find(t => t.id === result.toolCallId)?.args), toolDuration);
      onTool({
        name: result.name,
        args: parsedToolCalls.find(t => t.id === result.toolCallId)?.args,
        result: result.output,
      });
    }

    // Add tool results as ToolMessages
    for (const result of toolResults) {
      messages.push(new ToolMessage({
        content: result.output,
        tool_call_id: result.toolCallId,
      }));
    }

    // Continue loop to get AI response after tool use
  }

  onDone(fullResponse);
  return fullResponse;
}
