import type {
  LanguageId,
  LanguageRunner,
  RunnerContext,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from "./types";

const adapterLoaders: Record<LanguageId, () => Promise<LanguageRunner>> = {
  javascript: async () => (await import("./adapters/jsRunner")).runJavaScript,
  typescript: async () => (await import("./adapters/tsRunner")).runTypeScript,
  python: async () => (await import("./adapters/pythonRunner")).runPython,
  c: async () => (await import("./adapters/cppRunner")).runC,
  cpp: async () => (await import("./adapters/cppRunner")).runCpp,
  lua: async () => (await import("./adapters/luaRunner")).runLua,
  ruby: async () => (await import("./adapters/rubyRunner")).runRuby,
  php: async () => (await import("./adapters/phpRunner")).runPhp,
  sql: async () => (await import("./adapters/sqlRunner")).runSql,
};

function emit(message: WorkerOutboundMessage): void {
  self.postMessage(message);
}

self.addEventListener("message", async (event: MessageEvent<WorkerInboundMessage>) => {
  const payload = event.data;
  if (!payload || payload.type !== "run") return;

  const { runId, language, code, stdin } = payload;
  const loader = adapterLoaders[language];
  if (!loader) {
    emit({
      type: "error",
      runId,
      message: `Unsupported language: ${language}`,
      durationMs: 0,
    });
    return;
  }

  const startedAt = performance.now();
  let executionStartedAt = startedAt;

  const ctx: RunnerContext = {
    onProgress: (stage, percent, loadedBytes, totalBytes) => {
      emit({
        type: "progress",
        runId,
        language,
        stage,
        percent,
        loadedBytes,
        totalBytes,
      });
      if (percent === 100) {
        executionStartedAt = performance.now();
      }
    },
    onStdout: (chunk) => {
      emit({ type: "stdout", runId, chunk });
    },
    onStderr: (chunk) => {
      emit({ type: "stderr", runId, chunk });
    },
    onSqlTables: (tables) => {
      emit({ type: "sqlTables", runId, tables });
    },
  };

  try {
    const runner = await loader();
    executionStartedAt = performance.now();
    const exitCode = await runner(code, stdin, ctx);
    const durationMs = Math.max(0, Math.round(performance.now() - executionStartedAt));
    emit({
      type: "done",
      runId,
      exitCode,
      durationMs,
    });
  } catch (err) {
    const durationMs = Math.max(0, Math.round(performance.now() - executionStartedAt));
    const message =
      err instanceof Error
        ? err.stack || `${err.name}: ${err.message}`
        : String(err);
    emit({
      type: "error",
      runId,
      message,
      durationMs,
    });
  }
});
