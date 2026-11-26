import type { LanguageRunner, RunnerContext } from "../types";

const JSCPP_ESM_URL = "https://cdn.jsdelivr.net/npm/JSCPP@2.0.9/+esm";

interface JsCppModule {
  run(
    code: string,
    input: string,
    config?: {
      stdio?: {
        write?: (text: string) => void;
      };
      unsigned_overflow?: "error" | "warn" | "ignore";
    }
  ): number;
}

let cachedJsCpp: Promise<JsCppModule> | null = null;

async function getJsCpp(onProgress: RunnerContext["onProgress"]): Promise<JsCppModule> {
  if (!cachedJsCpp) {
    cachedJsCpp = (async () => {
      onProgress("Loading JSCPP runtime...", 25);
      const mod = (await import(/* @vite-ignore */ JSCPP_ESM_URL)) as {
        default?: JsCppModule;
      } & JsCppModule;
      const runtime = mod.default ?? mod;
      onProgress("JSCPP ready", 100);
      return runtime;
    })().catch((err) => {
      cachedJsCpp = null;
      throw err;
    });
  } else {
    onProgress("JSCPP cached", 100);
  }
  return cachedJsCpp;
}

/**
 * Shared C / C++ runner adapter backed by JSCPP in the isolated Web Worker.
 * Parameterized by language label to avoid duplicating interpreter setup logic.
 */
export function createCppFamilyRunner(variant: "C" | "C++"): LanguageRunner {
  return async (code, stdin, ctx) => {
    const jscpp = await getJsCpp(ctx.onProgress);
    const exitCode = jscpp.run(code, stdin, {
      stdio: {
        write(chunk: string) {
          ctx.onStdout(chunk);
        },
      },
      unsigned_overflow: "warn",
    });

    if (typeof exitCode === "number" && exitCode !== 0) {
      ctx.onStderr(`\n[${variant}] Process exited with code ${exitCode}\n`);
    }
    return typeof exitCode === "number" ? exitCode : 0;
  };
}

export const runC: LanguageRunner = createCppFamilyRunner("C");
export const runCpp: LanguageRunner = createCppFamilyRunner("C++");
