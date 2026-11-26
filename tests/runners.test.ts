import { describe, expect, it, vi } from "vitest";
import { executeJavaScriptInSandbox } from "../src/runners/adapters/jsRunner";
import { LANGUAGE_LIST, LANGUAGES, STARTER_TEMPLATES } from "../src/runners/templates";
import type { RunnerContext, WorkerOutboundMessage } from "../src/runners/types";
import { formatBytes } from "../src/runners/utils/fetchProgress";
import { formatAsciiTable, formatObjectTable } from "../src/runners/utils/formatters";
import { SandboxWorkerManager } from "../src/runners/workerManager";
import { extractSnippetSlugFromPath } from "../src/utils/api";
import { decodeStatelessShareHash, encodeStatelessShareHash } from "../src/utils/shareHash";

function createTestRunnerContext(): {
  ctx: RunnerContext;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    ctx: {
      onProgress: () => {},
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
      onSqlTables: () => {},
    },
  };
}

class FakeWorker extends EventTarget {
  public terminated = false;
  public postedMessages: unknown[] = [];

  postMessage(data: unknown): void {
    this.postedMessages.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(payload: WorkerOutboundMessage): void {
    this.dispatchEvent(new MessageEvent("message", { data: payload }));
  }
}

describe("Language metadata & starter templates", () => {
  it("defines complete metadata and non-empty starter templates for all 9 languages", () => {
    expect(LANGUAGE_LIST).toHaveLength(9);
    const ids = LANGUAGE_LIST.map((l) => l.id).sort();
    expect(ids).toEqual([
      "c",
      "cpp",
      "javascript",
      "lua",
      "php",
      "python",
      "ruby",
      "sql",
      "typescript",
    ]);

    for (const lang of LANGUAGE_LIST) {
      const tpl = STARTER_TEMPLATES[lang.id];
      expect(LANGUAGES[lang.id]).toBeDefined();
      expect(tpl).toBeDefined();
      expect(tpl.code.trim().length).toBeGreaterThan(20);
      expect(tpl.title.trim().length).toBeGreaterThan(3);
    }
  });
});

describe("JavaScript sandbox runner", () => {
  it("captures stdout, stderr, console.table, async/await, and stdin readline()", async () => {
    const { ctx, stdout, stderr } = createTestRunnerContext();

    const code = `
      const first = readline();
      const second = readline();
      const missing = readline();
      console.log("hi", first, second, missing);
      console.warn("careful");
      console.table([{ lang: "js", ok: true }]);
      await Promise.resolve();
      console.log("async-ok");
    `;

    const exitCode = await executeJavaScriptInSandbox(code, "Ada\nGrace", ctx);
    expect(exitCode).toBe(0);
    const out = stdout.join("");
    expect(out).toContain("hi Ada Grace null");
    expect(out).toContain("async-ok");
    expect(out).toContain("Ada");
    expect(out).toContain("lang");
    expect(stderr.join("")).toContain("careful");
  });

  it("propagates runtime syntax/reference errors cleanly", async () => {
    const { ctx } = createTestRunnerContext();
    await expect(
      executeJavaScriptInSandbox("throw new Error('boom');", "", ctx)
    ).rejects.toThrow("boom");
  });
});

describe("Formatters, URL slugs & stateless compression", () => {
  it("formats ASCII SQL tables and byte sizes accurately", () => {
    const ascii = formatAsciiTable(["id", "name"], [
      [1, "Ada"],
      [2, null],
    ]);
    expect(ascii).toContain("| id | name |");
    expect(ascii).toContain("| 2  | NULL |");
    expect(ascii).toContain("(2 rows)");

    expect(formatObjectTable([{ a: 1 }])).toContain("(index)");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("extracts valid /s/:slug paths and rejects non-matching paths", () => {
    expect(extractSnippetSlugFromPath("/s/AbCd123")).toBe("AbCd123");
    expect(extractSnippetSlugFromPath("/s/AbCd123/")).toBe("AbCd123");
    expect(extractSnippetSlugFromPath("/")).toBeNull();
    expect(extractSnippetSlugFromPath("/s/bad")).toBeNull();
  });

  it("round-trips stateless compressed share URL hashes cleanly", async () => {
    const hash = await encodeStatelessShareHash({
      language: "rust" as unknown as "python",
      title: "Hash Test",
      code: "print('hello world')\n".repeat(10),
      stdin: "42",
    });
    expect(hash.startsWith("#z=") || hash.startsWith("#j=")).toBe(true);
    const decoded = await decodeStatelessShareHash(hash);
    expect(decoded).not.toBeNull();
    expect(decoded?.title).toBe("Hash Test");
    expect(decoded?.stdin).toBe("42");
    expect(decoded?.code).toContain("print('hello world')");
  });
});

describe("SandboxWorkerManager lifecycle, memory reclamation & timeout guard", () => {
  it("terminates a stuck worker on kill(), respawns cleanly, and reclaims memory on language switch", async () => {
    const workers: FakeWorker[] = [];
    const manager = new SandboxWorkerManager(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });

    const stdoutChunks: string[] = [];
    const runPromise = manager.run("python", "while True: pass", "", {
      onStdout: (c) => stdoutChunks.push(c),
    });

    expect(workers).toHaveLength(1);
    expect(manager.isRunning()).toBe(true);
    const firstWorker = workers[0];
    const sent = firstWorker.postedMessages[0] as { runId: string };

    firstWorker.emitMessage({ type: "stdout", runId: sent.runId, chunk: "looping\n" });
    expect(stdoutChunks).toEqual(["looping\n"]);

    // Kill the infinite loop
    manager.kill();
    const outcome = await runPromise;

    expect(outcome.status).toBe("killed");
    expect(outcome.exitCode).toBe(137);
    expect(firstWorker.terminated).toBe(true);
    expect(manager.isRunning()).toBe(false);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);

    // Same-language run reuses worker[1]
    const secondRun = manager.run("python", "print(2 + 2)", "");
    const secondSent = workers[1].postedMessages[0] as { runId: string };
    workers[1].emitMessage({
      type: "done",
      runId: secondSent.runId,
      exitCode: 0,
      durationMs: 4,
    });
    expect((await secondRun).status).toBe("done");
    expect(workers).toHaveLength(2);

    // Switching language terminates worker[1] to free previous Wasm RAM and spawns worker[2]
    const thirdRun = manager.run("ruby", "puts 1", "");
    expect(workers[1].terminated).toBe(true);
    expect(workers).toHaveLength(3);
    const thirdSent = workers[2].postedMessages[0] as { runId: string };
    workers[2].emitMessage({
      type: "done",
      runId: thirdSent.runId,
      exitCode: 0,
      durationMs: 8,
    });
    expect((await thirdRun).status).toBe("done");
  });

  it("terminates execution automatically when timeoutMs expires after runtime init", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const manager = new SandboxWorkerManager(() => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      });

      const runPromise = manager.run("python", "while True: pass", "", {
        timeoutMs: 5_000,
      });

      const sent = workers[0].postedMessages[0] as { runId: string };
      // Still downloading: timeout must not trigger before percent === 100
      workers[0].emitMessage({
        type: "progress",
        runId: sent.runId,
        language: "python",
        stage: "Downloading",
        percent: 50,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(workers[0].terminated).toBe(false);

      // Runtime ready: timeout arms now
      workers[0].emitMessage({
        type: "progress",
        runId: sent.runId,
        language: "python",
        stage: "Ready",
        percent: 100,
      });
      await vi.advanceTimersByTimeAsync(5_050);

      const result = await runPromise;
      expect(result.status).toBe("timeout");
      expect(result.exitCode).toBe(124);
      expect(workers[0].terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
