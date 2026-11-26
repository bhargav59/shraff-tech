import type { LanguageRunner, RunnerContext } from "../types";
import { fetchBufferWithProgress } from "../utils/fetchProgress";

const WASMOON_ESM_URL = "https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/+esm";
const WASMOON_WASM_URL = "https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/dist/glue.wasm";

interface LuaEngine {
  global: {
    set(name: string, value: unknown): void;
    close(): void;
  };
  doString(script: string): Promise<unknown>;
}

interface LuaFactoryInstance {
  createEngine(): Promise<LuaEngine>;
}

let cachedFactory: Promise<LuaFactoryInstance> | null = null;

async function getLuaFactory(
  onProgress: RunnerContext["onProgress"]
): Promise<LuaFactoryInstance> {
  if (!cachedFactory) {
    cachedFactory = (async () => {
      onProgress("Loading Wasmoon JS...", 10);
      const mod = (await import(/* @vite-ignore */ WASMOON_ESM_URL)) as {
        LuaFactory: new (customWasmUri?: string) => LuaFactoryInstance;
      };
      const wasmBuf = await fetchBufferWithProgress(
        WASMOON_WASM_URL,
        "Downloading Lua 5.4 Wasm",
        onProgress
      );
      const blobUrl = URL.createObjectURL(
        new Blob([wasmBuf], { type: "application/wasm" })
      );
      onProgress("Lua 5.4 Wasm ready", 100);
      return new mod.LuaFactory(blobUrl);
    })().catch((err) => {
      cachedFactory = null;
      throw err;
    });
  } else {
    onProgress("Lua 5.4 Wasm cached", 100);
  }
  return cachedFactory;
}

export const runLua: LanguageRunner = async (code, stdin, ctx) => {
  const factory = await getLuaFactory(ctx.onProgress);
  const lua = await factory.createEngine();

  const lines = stdin.length > 0 ? stdin.split(/\r?\n/) : [];
  let lineIdx = 0;

  try {
    lua.global.set("__shraff_write", (text: string) => {
      ctx.onStdout(String(text));
    });
    lua.global.set("__shraff_read_line", () => {
      if (lineIdx >= lines.length) return null;
      return lines[lineIdx++];
    });
    lua.global.set("__shraff_read_all", () => {
      if (lineIdx >= lines.length) return "";
      const rest = lines.slice(lineIdx).join("\n");
      lineIdx = lines.length;
      return rest;
    });

    await lua.doString(`
      function print(...)
        local n = select("#", ...)
        local parts = {}
        for i = 1, n do
          parts[i] = tostring(select(i, ...))
        end
        __shraff_write(table.concat(parts, "\\t") .. "\\n")
      end

      if io then
        io.write = function(...)
          for i = 1, select("#", ...) do
            __shraff_write(tostring(select(i, ...)))
          end
          return io.stdout
        end
        io.read = function(fmt)
          if fmt == "*a" or fmt == "a" then
            return __shraff_read_all()
          end
          return __shraff_read_line()
        end
      end
    `);

    await lua.doString(code);
    return 0;
  } finally {
    lua.global.close();
  }
};
