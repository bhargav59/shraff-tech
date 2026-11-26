import type {
  LanguageId,
  SqlTableResult,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from "./types";

export interface RunCallbacks {
  onProgress?: (info: {
    language: LanguageId;
    stage: string;
    percent: number | null;
    loadedBytes?: number;
    totalBytes?: number;
  }) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onSqlTables?: (tables: SqlTableResult[]) => void;
  timeoutMs?: number;
}

export interface RunOutcome {
  status: "done" | "error" | "killed" | "timeout";
  exitCode: number;
  durationMs: number;
  errorMessage?: string;
}

export type WorkerFactory = () => Worker;

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL("./sandbox.worker.ts", import.meta.url), {
    type: "module",
    name: "shraff-wasm-sandbox",
  });

/**
 * Manages the dedicated browser Web Worker lifecycle for all 9 languages.
 * - Reuses the warm worker when running the same language repeatedly.
 * - Terminates and replaces the worker when switching languages so heavy Wasm
 *   linear memories (Pyodide, CRuby, PHP) never accumulate into tab OOM.
 * - Supports instant infinite-loop kill (`terminate()` + fresh worker respawn)
 *   and an optional post-initialization execution timeout guard.
 */
export class SandboxWorkerManager {
  private worker: Worker | null = null;
  private workerLanguage: LanguageId | null = null;
  private activeRunId: string | null = null;
  private settleActive: ((outcome: RunOutcome) => void) | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private runStartedAt = 0;
  private readonly createWorker: WorkerFactory;

  constructor(createWorker: WorkerFactory = defaultWorkerFactory) {
    this.createWorker = createWorker;
  }

  private ensureWorkerForLanguage(language: LanguageId): Worker {
    if (this.worker && this.workerLanguage !== null && this.workerLanguage !== language) {
      // Reclaim previous Wasm VM memory cleanly when switching runtimes
      this.worker.terminate();
      this.worker = null;
      this.workerLanguage = null;
    }
    if (!this.worker) {
      this.worker = this.createWorker();
      this.workerLanguage = language;
    }
    return this.worker;
  }

  public isRunning(): boolean {
    return this.activeRunId !== null;
  }

  private clearTimeoutGuard(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * Executes code inside the isolated Web Worker.
   */
  public run(
    language: LanguageId,
    code: string,
    stdin: string,
    callbacks: RunCallbacks = {}
  ): Promise<RunOutcome> {
    if (this.activeRunId) {
      this.kill();
    }

    const worker = this.ensureWorkerForLanguage(language);
    const runId = crypto.randomUUID();
    this.activeRunId = runId;
    this.runStartedAt = performance.now();

    const timeoutMs = callbacks.timeoutMs ?? 0;

    return new Promise<RunOutcome>((resolve) => {
      const cleanup = () => {
        this.clearTimeoutGuard();
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleWorkerError);
        if (this.activeRunId === runId) {
          this.activeRunId = null;
          this.settleActive = null;
        }
      };

      const startTimeoutGuard = () => {
        if (timeoutMs <= 0 || this.timeoutTimer !== null || this.activeRunId !== runId) {
          return;
        }
        this.timeoutTimer = setTimeout(() => {
          if (this.activeRunId !== runId) return;
          const durationMs = Math.max(0, Math.round(performance.now() - this.runStartedAt));
          cleanup();
          this.worker?.terminate();
          this.worker = null;
          this.workerLanguage = null;
          resolve({
            status: "timeout",
            exitCode: 124,
            durationMs,
            errorMessage: `Execution timed out after ${(timeoutMs / 1000).toFixed(0)}s (Worker terminated).`,
          });
        }, timeoutMs);
      };

      this.settleActive = (outcome: RunOutcome) => {
        cleanup();
        resolve(outcome);
      };

      const handleMessage = (event: MessageEvent<WorkerOutboundMessage>) => {
        const msg = event.data;
        if (!msg || msg.runId !== runId) return;

        switch (msg.type) {
          case "progress":
            callbacks.onProgress?.({
              language: msg.language,
              stage: msg.stage,
              percent: msg.percent,
              loadedBytes: msg.loadedBytes,
              totalBytes: msg.totalBytes,
            });
            // Start execution timeout only after Wasm download/init completes
            if (msg.percent === 100) {
              this.runStartedAt = performance.now();
              startTimeoutGuard();
            }
            break;
          case "stdout":
            callbacks.onStdout?.(msg.chunk);
            break;
          case "stderr":
            callbacks.onStderr?.(msg.chunk);
            break;
          case "sqlTables":
            callbacks.onSqlTables?.(msg.tables);
            break;
          case "done":
            cleanup();
            resolve({
              status: "done",
              exitCode: msg.exitCode,
              durationMs: msg.durationMs,
            });
            break;
          case "error":
            cleanup();
            resolve({
              status: "error",
              exitCode: 1,
              durationMs: msg.durationMs,
              errorMessage: msg.message,
            });
            break;
        }
      };

      const handleWorkerError = (err: ErrorEvent) => {
        const durationMs = Math.max(0, Math.round(performance.now() - this.runStartedAt));
        cleanup();
        this.worker?.terminate();
        this.worker = null;
        this.workerLanguage = null;
        resolve({
          status: "error",
          exitCode: 1,
          durationMs,
          errorMessage: err.message || "Web Worker crashed unexpectedly.",
        });
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleWorkerError);

      // For JS or pre-warmed workers that might emit 100% right away, arm fallback timer too
      if (language === "javascript") {
        startTimeoutGuard();
      }

      const message: WorkerInboundMessage = {
        type: "run",
        runId,
        language,
        code,
        stdin,
      };
      worker.postMessage(message);
    });
  }

  /**
   * Immediately terminates the running Web Worker (stopping infinite loops)
   * and spawns a clean replacement worker right away so the next run is ready.
   */
  public kill(): void {
    const durationMs = this.runStartedAt
      ? Math.max(0, Math.round(performance.now() - this.runStartedAt))
      : 0;
    const prevLang = this.workerLanguage;

    this.clearTimeoutGuard();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerLanguage = null;
    }

    const settle = this.settleActive;
    this.activeRunId = null;
    this.settleActive = null;

    if (prevLang) {
      this.ensureWorkerForLanguage(prevLang);
    }

    settle?.({
      status: "killed",
      exitCode: 137,
      durationMs,
      errorMessage: "Execution terminated by user (Worker killed & respawned).",
    });
  }

  public dispose(): void {
    this.clearTimeoutGuard();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerLanguage = null;
    }
    this.activeRunId = null;
    this.settleActive = null;
  }
}
