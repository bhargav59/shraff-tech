import type { LanguageRunner } from "../types";
import { fetchBufferWithProgress } from "../utils/fetchProgress";
import { executeJavaScriptInSandbox } from "./jsRunner";

const ESBUILD_ESM_URL = "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.28.2/esm/browser.min.js";
const ESBUILD_WASM_URL = "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.28.2/esbuild.wasm";

interface EsbuildModule {
  initialize(options: { wasmModule?: WebAssembly.Module; worker?: boolean }): Promise<void>;
  transform(
    input: string,
    options: { loader: "ts"; target: string }
  ): Promise<{ code: string; warnings: Array<{ text: string }> }>;
}

let cachedEsbuild: Promise<EsbuildModule> | null = null;

async function loadEsbuild(
  onProgress: Parameters<LanguageRunner>[2]["onProgress"]
): Promise<EsbuildModule> {
  if (!cachedEsbuild) {
    cachedEsbuild = (async () => {
      onProgress("Loading esbuild-wasm JS...", 5);
      const esbuild = (await import(/* @vite-ignore */ ESBUILD_ESM_URL)) as EsbuildModule;
      const wasmBuffer = await fetchBufferWithProgress(
        ESBUILD_WASM_URL,
        "Downloading esbuild.wasm",
        onProgress
      );
      onProgress("Compiling esbuild.wasm...", 98);
      const wasmModule = await WebAssembly.compile(wasmBuffer);
      await esbuild.initialize({ wasmModule, worker: false });
      onProgress("esbuild-wasm ready", 100);
      return esbuild;
    })().catch((err) => {
      cachedEsbuild = null;
      throw err;
    });
  } else {
    onProgress("esbuild-wasm cached", 100);
  }
  return cachedEsbuild;
}

export const runTypeScript: LanguageRunner = async (code, stdin, ctx) => {
  const esbuild = await loadEsbuild(ctx.onProgress);
  const result = await esbuild.transform(code, {
    loader: "ts",
    target: "es2024",
  });

  for (const warning of result.warnings) {
    ctx.onStderr(`TS warning: ${warning.text}\n`);
  }

  return executeJavaScriptInSandbox(result.code, stdin, ctx);
};
