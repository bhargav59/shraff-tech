import type { LanguageRunner, RunnerContext } from "../types";
import { fetchBufferWithProgress } from "../utils/fetchProgress";

const PHP_CGI_BASE_URL = "https://cdn.jsdelivr.net/npm/php-cgi-wasm@0.2.0/";
const PHP_CGI_WORKER_MJS_URL = `${PHP_CGI_BASE_URL}PhpCgiWorker.mjs`;
const PHP_84_WASM_URL = `${PHP_CGI_BASE_URL}ac940362a0c6b423813d6981d18b31289fec41c5.wasm`;

interface PhpBinaryHandle {
  inputDataQueue?: string[];
  awaitingInput?: ((value: string | null) => void) | null;
  FS: {
    analyzePath(path: string): { exists: boolean };
    mkdir(path: string): void;
    writeFile(path: string, data: string, opts?: { encoding: "utf8" }): void;
  };
}

interface PhpCgiInstance {
  binary: Promise<PhpBinaryHandle>;
  error: number[];
  request(req: Request): Promise<Response>;
}

let cachedPhp: Promise<PhpCgiInstance> | null = null;

async function getPhpRuntime(
  onProgress: RunnerContext["onProgress"]
): Promise<PhpCgiInstance> {
  if (!cachedPhp) {
    cachedPhp = (async () => {
      onProgress("Loading php-cgi-wasm module...", 5);
      const [{ PhpCgiWorker }, wasmBuffer] = await Promise.all([
        import(/* @vite-ignore */ PHP_CGI_WORKER_MJS_URL) as Promise<{
          PhpCgiWorker: new (args: Record<string, unknown>) => PhpCgiInstance;
        }>,
        fetchBufferWithProgress(
          PHP_84_WASM_URL,
          "Downloading PHP 8.4 Wasm (~13 MB)",
          onProgress
        ),
      ]);

      const wasmBlobUrl = URL.createObjectURL(
        new Blob([wasmBuffer], { type: "application/wasm" })
      );

      onProgress("Initializing PHP 8.4 runtime...", 98);
      let resolvedBinary: PhpBinaryHandle | null = null;

      const php = new PhpCgiWorker({
        version: "8.4",
        docroot: "/docroot",
        prefix: "/php",
        autoTransaction: false,
        persist: [],
        locateFile: (path: string) =>
          path.endsWith(".wasm") ? wasmBlobUrl : `${PHP_CGI_BASE_URL}${path}`,
        // Bridge Emscripten readline() EOF cleanly when Module.inputDataQueue is empty
        triggerStdin: () => {
          if (resolvedBinary?.awaitingInput) {
            resolvedBinary.awaitingInput(null);
          }
        },
      });

      const binary = await php.binary;
      resolvedBinary = binary;

      for (const dir of ["/docroot", "/tmp", "/config"]) {
        if (!binary.FS.analyzePath(dir).exists) {
          binary.FS.mkdir(dir);
        }
      }

      onProgress("PHP 8.4 Wasm ready", 100);
      return php;
    })().catch((err) => {
      cachedPhp = null;
      throw err;
    });
  } else {
    onProgress("PHP 8.4 Wasm cached", 100);
  }

  return cachedPhp;
}

const PHP_ENTRY_WRAPPER = `<?php
if (!defined('STDIN')) {
    define('STDIN', fopen('/tmp/stdin.txt', 'rb'));
}
if (!function_exists('readline')) {
    function readline($prompt = null) {
        if ($prompt !== null) {
            echo $prompt;
        }
        $line = fgets(STDIN);
        return $line === false ? false : rtrim($line, "\\r\\n");
    }
}
require '/docroot/user.php';
`;

export const runPhp: LanguageRunner = async (code, stdin, ctx) => {
  const php = await getPhpRuntime(ctx.onProgress);
  const binary = await php.binary;

  // Populate native readline() queue and /tmp/stdin.txt so both readline() and STDIN work
  binary.inputDataQueue = stdin.length > 0 ? stdin.split(/\r?\n/) : [];
  binary.FS.writeFile("/tmp/stdin.txt", stdin, { encoding: "utf8" });
  binary.FS.writeFile("/docroot/user.php", code, { encoding: "utf8" });
  binary.FS.writeFile("/docroot/index.php", PHP_ENTRY_WRAPPER, { encoding: "utf8" });

  const response = await php.request(
    new Request("https://shraff.local/php/index.php", {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: stdin,
    })
  );

  const stdoutText = await response.text();
  if (stdoutText) {
    ctx.onStdout(stdoutText);
  }

  if (Array.isArray(php.error) && php.error.length > 0) {
    const stderrText = new TextDecoder().decode(new Uint8Array(php.error));
    if (stderrText.trim()) {
      ctx.onStderr(stderrText);
    }
  }

  return response.ok ? 0 : 1;
};
