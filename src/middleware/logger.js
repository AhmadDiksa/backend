/**
 * logger.js
 * Middleware untuk mencatat log request API ke terminal secara lengkap.
 */

export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, url } = req;
  const timestamp = new Date().toISOString();

  // Intercept response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    
    let statusColor = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';
    const gray = '\x1b[90m';
    const white = '\x1b[37m';

    console.log(
      `${gray}[${timestamp}]${reset} ${white}${method}${reset} ${url} - ${statusColor}${status}${reset} ${gray}(${duration}ms)${reset}`
    );
  });

  next();
}

export const logger = {
  info: (msg) => console.log(`\x1b[36mℹ INFO:\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[32m✔ SUCCESS:\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m⚠ WARN:\x1b[0m ${msg}`),
  error: (msg, err) => console.error(`\x1b[31m✖ ERROR:\x1b[0m ${msg}`, err || ''),
  llm: (provider, model, duration) => 
    console.log(`\x1b[35m🤖 LLM:\x1b[0m ${provider} (${model}) ${duration ? `\x1b[90m[${duration}ms]\x1b[0m` : ''}`),
  tool: (name, input, duration) => 
    console.log(`\x1b[34m🛠 TOOL:\x1b[0m ${name} ${duration ? `\x1b[90m[${duration}ms]\x1b[0m` : ''}`),
};
