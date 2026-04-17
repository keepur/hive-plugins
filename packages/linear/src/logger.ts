/**
 * Minimal stderr logger for MCP plugin packages.
 *
 * MCP servers communicate over stdio — stdout is reserved for the JSON-RPC
 * protocol. All log output must go to stderr.
 */

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export function createLogger(name: string): Logger {
  const emit = (level: string, msg: string, meta?: Record<string, unknown>): void => {
    const payload = meta ? ` ${JSON.stringify(meta)}` : "";
    process.stderr.write(`[${name}] ${level} ${msg}${payload}\n`);
  };
  return {
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
  };
}
