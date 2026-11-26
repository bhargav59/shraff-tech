import type { LanguageRunner, RunnerContext } from "../types";
import { fetchBufferWithProgress } from "../utils/fetchProgress";

const RUBY_WASM_ESM_URL = "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.10.1/+esm";
const WASI_SHIM_ESM_URL =
  "https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.4.2/+esm";
const RUBY_STDLIB_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.10.1/dist/ruby+stdlib.wasm";

interface RubyRuntimeBundle {
  RubyVM: {
    instantiateModule(options: {
      module: WebAssembly.Module;
      wasip1: unknown;
      addToImports?: (imports: WebAssembly.Imports) => void;
      setMemory?: (memory: WebAssembly.Memory) => void;
    }): Promise<{
      vm: {
        eval(code: string): unknown;
      };
    }>;
  };
  consolePrinter: (handlers: {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  }) => {
    addToImports(imports: WebAssembly.Imports): void;
    setMemory(memory: WebAssembly.Memory): void;
  };
  WASI: new (
    args: string[],
    env: string[],
    fds: unknown[],
    options?: { debug?: boolean }
  ) => unknown;
  File: new (data: Uint8Array) => unknown;
  OpenFile: new (file: unknown) => unknown;
  PreopenDirectory: new (name: string, contents: Map<string, unknown>) => unknown;
  module: WebAssembly.Module;
}

let cachedRubyBundle: Promise<RubyRuntimeBundle> | null = null;

async function getRubyBundle(
  onProgress: RunnerContext["onProgress"]
): Promise<RubyRuntimeBundle> {
  if (!cachedRubyBundle) {
    cachedRubyBundle = (async () => {
      onProgress("Loading ruby.wasm runtime...", 4);
      const [rubyMod, wasiMod, wasmBuffer] = await Promise.all([
        import(/* @vite-ignore */ RUBY_WASM_ESM_URL) as Promise<{
          RubyVM: RubyRuntimeBundle["RubyVM"];
          consolePrinter: RubyRuntimeBundle["consolePrinter"];
        }>,
        import(/* @vite-ignore */ WASI_SHIM_ESM_URL) as Promise<{
          WASI: RubyRuntimeBundle["WASI"];
          File: RubyRuntimeBundle["File"];
          OpenFile: RubyRuntimeBundle["OpenFile"];
          PreopenDirectory: RubyRuntimeBundle["PreopenDirectory"];
        }>,
        fetchBufferWithProgress(
          RUBY_STDLIB_WASM_URL,
          "Downloading CRuby 3.4 Wasm (~30 MB)",
          onProgress
        ),
      ]);

      onProgress("Compiling CRuby 3.4 Wasm...", 98);
      const module = await WebAssembly.compile(wasmBuffer);
      onProgress("CRuby 3.4 ready", 100);

      return {
        RubyVM: rubyMod.RubyVM,
        consolePrinter: rubyMod.consolePrinter,
        WASI: wasiMod.WASI,
        File: wasiMod.File,
        OpenFile: wasiMod.OpenFile,
        PreopenDirectory: wasiMod.PreopenDirectory,
        module,
      };
    })().catch((err) => {
      cachedRubyBundle = null;
      throw err;
    });
  } else {
    onProgress("CRuby 3.4 cached", 100);
  }
  return cachedRubyBundle;
}

export const runRuby: LanguageRunner = async (code, stdin, ctx) => {
  const bundle = await getRubyBundle(ctx.onProgress);
  const stdinBytes = new TextEncoder().encode(stdin);

  const fds = [
    new bundle.OpenFile(new bundle.File(stdinBytes)),
    new bundle.OpenFile(new bundle.File(new Uint8Array(0))),
    new bundle.OpenFile(new bundle.File(new Uint8Array(0))),
    new bundle.PreopenDirectory("/", new Map()),
  ];

  const wasi = new bundle.WASI([], [], fds, { debug: false });
  const printer = bundle.consolePrinter({
    stdout: (chunk: string) => ctx.onStdout(chunk),
    stderr: (chunk: string) => ctx.onStderr(chunk),
  });

  const { vm } = await bundle.RubyVM.instantiateModule({
    module: bundle.module,
    wasip1: wasi,
    addToImports: (imports) => printer.addToImports(imports),
    setMemory: (memory) => printer.setMemory(memory),
  });

  vm.eval(code);
  return 0;
};
