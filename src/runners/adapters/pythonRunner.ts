import type { LanguageRunner } from "../types";

const PYODIDE_BASE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
const PYODIDE_MJS_URL = `${PYODIDE_BASE_URL}pyodide.mjs`;

interface PyodideInstance {
  setStdout(options: { batched: (line: string) => void }): void;
  setStderr(options: { batched: (line: string) => void }): void;
  setStdin(options: { stdin: () => string | null | undefined }): void;
  runPythonAsync(code: string): Promise<unknown>;
}

let cachedPyodide: Promise<PyodideInstance> | null = null;

async function getPyodide(
  onProgress: Parameters<LanguageRunner>[2]["onProgress"]
): Promise<PyodideInstance> {
  if (!cachedPyodide) {
    cachedPyodide = (async () => {
      onProgress("Fetching Pyodide loader...", 5);
      const { loadPyodide } = (await import(/* @vite-ignore */ PYODIDE_MJS_URL)) as {
        loadPyodide: (config: { indexURL: string }) => Promise<PyodideInstance>;
      };

      // Temporarily wrap globalThis.fetch to track Pyodide's .wasm and stdlib download progress
      const originalFetch = globalThis.fetch.bind(globalThis);
      let totalLoaded = 0;
      const estimatedTotal = 18 * 1024 * 1024;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await originalFetch(input, init);
        const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!urlStr.includes("pyodide") || !res.body) {
          return res;
        }

        const reader = res.body.getReader();
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            totalLoaded += value.byteLength;
            const pct = Math.min(95, Math.max(8, Math.round((totalLoaded / estimatedTotal) * 100)));
            onProgress("Downloading CPython Wasm & stdlib", pct, totalLoaded, estimatedTotal);
            controller.enqueue(value);
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return new Response(stream, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      };

      try {
        const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE_URL });
        onProgress("Pyodide ready", 100);
        return pyodide;
      } finally {
        globalThis.fetch = originalFetch;
      }
    })().catch((err) => {
      cachedPyodide = null;
      throw err;
    });
  } else {
    onProgress("Pyodide cached", 100);
  }

  return cachedPyodide;
}

export const runPython: LanguageRunner = async (code, stdin, ctx) => {
  const pyodide = await getPyodide(ctx.onProgress);

  const lines = stdin.length > 0 ? stdin.split(/\r?\n/) : [];
  let lineIdx = 0;

  pyodide.setStdout({
    batched: (text: string) => ctx.onStdout(`${text}\n`),
  });
  pyodide.setStderr({
    batched: (text: string) => ctx.onStderr(`${text}\n`),
  });
  pyodide.setStdin({
    stdin: () => {
      if (lineIdx >= lines.length) return null;
      return `${lines[lineIdx++]}\n`;
    },
  });

  await pyodide.runPythonAsync(code);
  return 0;
};
