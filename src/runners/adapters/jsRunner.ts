import type { LanguageRunner, RunnerContext } from "../types";
import { formatConsoleArgs, formatObjectTable } from "../utils/formatters";

const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

/**
 * Executes ES2024 JavaScript inside the sandboxed Web Worker with captured
 * console output, console.table formatting, timers, and stdin readline().
 */
export async function executeJavaScriptInSandbox(
  jsCode: string,
  stdin: string,
  ctx: RunnerContext
): Promise<number> {
  const lines = stdin.length > 0 ? stdin.split(/\r?\n/) : [];
  let cursor = 0;

  const timers = new Map<string, number>();

  const sandboxConsole = {
    log: (...args: unknown[]) => ctx.onStdout(formatConsoleArgs(args)),
    info: (...args: unknown[]) => ctx.onStdout(formatConsoleArgs(args)),
    debug: (...args: unknown[]) => ctx.onStdout(formatConsoleArgs(args)),
    warn: (...args: unknown[]) => ctx.onStderr(formatConsoleArgs(args)),
    error: (...args: unknown[]) => ctx.onStderr(formatConsoleArgs(args)),
    table: (data: unknown) => ctx.onStdout(formatObjectTable(data)),
    time: (label = "default") => {
      timers.set(label, performance.now());
    },
    timeEnd: (label = "default") => {
      const started = timers.get(label);
      if (started !== undefined) {
        timers.delete(label);
        ctx.onStdout(`${label}: ${(performance.now() - started).toFixed(2)}ms\n`);
      }
    },
    clear: () => {},
  };

  const readline = (): string | null => {
    if (cursor >= lines.length) return null;
    return lines[cursor++];
  };

  const prompt = (message?: string): string | null => {
    if (message) ctx.onStdout(String(message));
    return readline();
  };

  const fn = new AsyncFunction("console", "readline", "prompt", jsCode);
  await fn(sandboxConsole, readline, prompt);
  return 0;
}

export const runJavaScript: LanguageRunner = async (code, stdin, ctx) => {
  ctx.onProgress("Ready (Native ES2024)", 100);
  return executeJavaScriptInSandbox(code, stdin, ctx);
};
