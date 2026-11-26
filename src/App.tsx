import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, ShieldCheck, Timer, WrapText } from "lucide-react";
import { ConsolePanel, type ConsoleTab } from "./components/ConsolePanel";
import { HeaderToolbar } from "./components/HeaderToolbar";
import { HistoryDialog } from "./components/HistoryDialog";
import { MonacoEditorPane } from "./components/MonacoEditorPane";
import { ShareDialog } from "./components/ShareDialog";
import { useTheme } from "./hooks/useTheme";
import { LANGUAGES, STARTER_TEMPLATES } from "./runners/templates";
import type { LanguageId, SqlTableResult } from "./runners/types";
import { formatBytes } from "./runners/utils/fetchProgress";
import { SandboxWorkerManager } from "./runners/workerManager";
import { extractSnippetSlugFromPath, fetchSnippet } from "./utils/api";
import {
  addHistoryEntry,
  clearDraft,
  decodeStatelessShareHash,
  loadDraft,
  loadHistory,
  removeHistoryEntry,
  saveDraft,
  type LocalHistoryEntry,
} from "./utils/shareHash";

interface ProgressState {
  active: boolean;
  stage: string;
  percent: number | null;
  loadedBytes?: number;
  totalBytes?: number;
}

const TIMEOUT_OPTIONS = [
  { label: "15s timeout", ms: 15_000 },
  { label: "30s timeout", ms: 30_000 },
  { label: "60s timeout", ms: 60_000 },
  { label: "No timeout", ms: 0 },
] as const;

export function App() {
  const { storedScheme, resolvedTheme, toggleTheme } = useTheme();
  const workerManagerRef = useRef<SandboxWorkerManager | null>(null);
  if (!workerManagerRef.current) {
    workerManagerRef.current = new SandboxWorkerManager();
  }

  const initialDraft = loadDraft("javascript");
  const [language, setLanguage] = useState<LanguageId>("javascript");
  const [title, setTitle] = useState<string>(
    initialDraft?.title || STARTER_TEMPLATES.javascript.title
  );
  const [code, setCode] = useState<string>(
    initialDraft?.code ?? STARTER_TEMPLATES.javascript.code
  );
  const [stdin, setStdin] = useState<string>(
    initialDraft?.stdin ?? STARTER_TEMPLATES.javascript.stdin
  );

  const [fontSize, setFontSize] = useState<number>(14);
  const [wordWrap, setWordWrap] = useState<boolean>(false);
  const [timeoutMs, setTimeoutMs] = useState<number>(30_000);

  const [activeTab, setActiveTab] = useState<ConsoleTab>("output");
  const [stdout, setStdout] = useState<string>("");
  const [stderr, setStderr] = useState<string>("");
  const [sqlTables, setSqlTables] = useState<SqlTableResult[]>([]);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [runStatus, setRunStatus] = useState<
    "idle" | "running" | "done" | "error" | "killed" | "timeout"
  >("idle");
  const [progress, setProgress] = useState<ProgressState>({
    active: false,
    stage: "",
    percent: null,
  });

  const [currentSlug, setCurrentSlug] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? extractSnippetSlugFromPath(window.location.pathname)
      : null
  );
  const [loadingSlug, setLoadingSlug] = useState<boolean>(currentSlug !== null);
  const [slugBanner, setSlugBanner] = useState<string>("");
  const [shareOpen, setShareOpen] = useState<boolean>(false);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [historyEntries, setHistoryEntries] = useState<LocalHistoryEntry[]>(() =>
    loadHistory()
  );
  const [announcement, setAnnouncement] = useState<string>("");

  // Load shared snippet from /s/:slug OR stateless compressed #z=/#j= hash
  useEffect(() => {
    const slug = extractSnippetSlugFromPath(window.location.pathname);
    if (slug) {
      let cancelled = false;
      setLoadingSlug(true);
      fetchSnippet(slug)
        .then((snippet) => {
          if (cancelled) return;
          setLanguage(snippet.language);
          setTitle(snippet.title);
          setCode(snippet.code);
          setStdin(snippet.stdin);
          setCurrentSlug(snippet.slug);
          setSlugBanner(`Loaded shared snippet /s/${snippet.slug}`);
          document.title = `${snippet.title} | shraff.tech`;
        })
        .catch((err) => {
          if (cancelled) return;
          setSlugBanner(
            err instanceof Error ? err.message : "Could not load shared snippet."
          );
        })
        .finally(() => {
          if (!cancelled) setLoadingSlug(false);
        });

      return () => {
        cancelled = true;
      };
    }

    setLoadingSlug(false);
    const hash = window.location.hash;
    if (hash.startsWith("#z=") || hash.startsWith("#j=")) {
      decodeStatelessShareHash(hash).then((decoded) => {
        if (!decoded || !(decoded.language in LANGUAGES)) return;
        setLanguage(decoded.language);
        setTitle(decoded.title || LANGUAGES[decoded.language].label);
        setCode(decoded.code);
        setStdin(decoded.stdin || "");
        setSlugBanner("Loaded zero-server compressed snippet");
        document.title = `${decoded.title || "Shared Snippet"} | shraff.tech`;
      });
    }
  }, []);

  // Debounced auto-save draft to localStorage when editing standalone drafts
  useEffect(() => {
    if (currentSlug) return;
    const timer = setTimeout(() => {
      saveDraft(language, { title, code, stdin });
    }, 350);
    return () => clearTimeout(timer);
  }, [language, title, code, stdin, currentSlug]);

  useEffect(() => {
    return () => {
      workerManagerRef.current?.dispose();
    };
  }, []);

  const handleLanguageChange = useCallback((nextLang: LanguageId) => {
    if (workerManagerRef.current?.isRunning()) {
      workerManagerRef.current.kill();
    }
    const saved = loadDraft(nextLang);
    const tpl = STARTER_TEMPLATES[nextLang];
    setLanguage(nextLang);
    setTitle(saved?.title || tpl.title);
    setCode(saved?.code ?? tpl.code);
    setStdin(saved?.stdin ?? tpl.stdin);
    setStdout("");
    setStderr("");
    setSqlTables([]);
    setDurationMs(null);
    setExitCode(null);
    setRunStatus("idle");
    setCurrentSlug(null);
    setSlugBanner("");
    if (window.location.pathname !== "/" || window.location.hash) {
      window.history.replaceState(null, "", "/");
    }
    document.title = `${LANGUAGES[nextLang].label} | shraff.tech`;
  }, []);

  const handleResetTemplate = useCallback(() => {
    clearDraft(language);
    const tpl = STARTER_TEMPLATES[language];
    setTitle(tpl.title);
    setCode(tpl.code);
    setStdin(tpl.stdin);
    setCurrentSlug(null);
    setSlugBanner("");
    if (window.location.pathname !== "/" || window.location.hash) {
      window.history.replaceState(null, "", "/");
    }
    setAnnouncement(`Reset ${LANGUAGES[language].label} starter template.`);
  }, [language]);

  const handleDownloadCode = useCallback(() => {
    const ext = LANGUAGES[language].extension;
    const safeName =
      title
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-|-$/g, "") || "snippet";
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setAnnouncement(`Downloaded ${safeName}.${ext}.`);
  }, [code, language, title]);

  const handleForkSnippet = useCallback(() => {
    setCurrentSlug(null);
    setTitle((prev) => (prev.endsWith("(Fork)") ? prev : `${prev} (Fork)`));
    setSlugBanner("Forked into editable local draft");
    window.history.replaceState(null, "", "/");
    setAnnouncement("Forked snippet into a new local draft.");
  }, []);

  const handleRun = useCallback(async () => {
    const manager = workerManagerRef.current;
    if (!manager) return;

    setStdout("");
    setStderr("");
    setSqlTables([]);
    setDurationMs(null);
    setExitCode(null);
    setRunStatus("running");
    setActiveTab("output");
    setProgress({
      active: true,
      stage: `Preparing ${LANGUAGES[language].runtimeLabel}...`,
      percent: null,
    });

    setHistoryEntries(
      addHistoryEntry({
        language,
        title,
        code,
        stdin,
        slug: currentSlug ?? undefined,
      })
    );

    const outcome = await manager.run(language, code, stdin, {
      timeoutMs,
      onProgress: (info) => {
        const complete = info.percent === 100;
        setProgress({
          active: !complete,
          stage: info.stage,
          percent: info.percent,
          loadedBytes: info.loadedBytes,
          totalBytes: info.totalBytes,
        });
        if (complete) {
          setAnnouncement(`${LANGUAGES[language].runtimeLabel} ready.`);
        }
      },
      onStdout: (chunk) => {
        setStdout((prev) => prev + chunk);
      },
      onStderr: (chunk) => {
        setStderr((prev) => prev + chunk);
      },
      onSqlTables: (tables) => {
        setSqlTables(tables);
      },
    });

    setProgress({ active: false, stage: "", percent: null });
    setDurationMs(outcome.durationMs);
    setExitCode(outcome.exitCode);
    setRunStatus(outcome.status);

    if (outcome.errorMessage) {
      setStderr((prev) => (prev ? `${prev}\n${outcome.errorMessage}` : outcome.errorMessage!));
    }

    setAnnouncement(
      outcome.status === "done"
        ? `Execution completed in ${outcome.durationMs} milliseconds.`
        : `Execution ${outcome.status} after ${outcome.durationMs} milliseconds.`
    );
  }, [code, currentSlug, language, stdin, timeoutMs, title]);

  const handleStop = useCallback(() => {
    workerManagerRef.current?.kill();
    setProgress({ active: false, stage: "", percent: null });
    setRunStatus("killed");
    setAnnouncement("Execution stopped and Web Worker respawned.");
  }, []);

  const langMeta = LANGUAGES[language];
  const consoleDisplayStatus = runStatus === "timeout" ? "error" : runStatus;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a href="#main-ide" className="skip-link visually-hidden">
        Skip to IDE workspace
      </a>

      <HeaderToolbar
        language={language}
        title={title}
        isRunning={runStatus === "running"}
        isSaving={loadingSlug}
        hasSharedSlug={currentSlug !== null}
        historyCount={historyEntries.length}
        resolvedTheme={resolvedTheme}
        storedScheme={storedScheme}
        onLanguageChange={handleLanguageChange}
        onTitleChange={setTitle}
        onRun={handleRun}
        onStop={handleStop}
        onResetTemplate={handleResetTemplate}
        onDownloadCode={handleDownloadCode}
        onForkSnippet={handleForkSnippet}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenShare={() => setShareOpen(true)}
        onToggleTheme={toggleTheme}
      />

      {/* Runtime Metadata + Editor Quality-of-Life Controls + Wasm Download Progress Bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5 text-xs"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Cpu size={13} aria-hidden="true" style={{ color: "var(--accent)" }} />
            <span>{langMeta.runtimeLabel}</span>
            <span className="hidden md:inline">({langMeta.downloadEstimate})</span>
          </span>

          <span className="hidden items-center gap-1 sm:inline-flex">
            <ShieldCheck size={13} aria-hidden="true" style={{ color: "var(--success)" }} />
            <span>100% Client-Side Wasm Worker</span>
          </span>

          {language === "sql" && (
            <button
              type="button"
              onClick={() =>
                setCode(
                  "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name;\n\n" +
                    code
                )
              }
              className="cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                color: "var(--accent)",
              }}
            >
              Tables: users, orders (+inspect schema)
            </button>
          )}

          {slugBanner && (
            <span
              className="rounded-md px-2 py-0.5 font-medium"
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--accent)",
              }}
            >
              {slugBanner}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {progress.active && (
            <div className="flex min-w-48 items-center gap-2 sm:max-w-xs">
              <label htmlFor="wasm-download-progress" className="shrink-0 text-[11px] font-medium">
                {progress.stage}
                {progress.loadedBytes !== undefined
                  ? ` (${formatBytes(progress.loadedBytes)}${
                      progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""
                    })`
                  : ""}
              </label>
              <progress
                id="wasm-download-progress"
                className="wasm-progress"
                max={100}
                {...(progress.percent !== null ? { value: progress.percent } : {})}
              />
            </div>
          )}

          {/* Timeout selector & Editor preferences */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="timeout-select" className="visually-hidden">
              Execution timeout
            </label>
            <span className="inline-flex items-center gap-1">
              <Timer size={12} aria-hidden="true" />
              <select
                id="timeout-select"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
                className="rounded border px-1.5 py-0.5 text-[11px]"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              >
                {TIMEOUT_OPTIONS.map((opt) => (
                  <option key={opt.ms} value={opt.ms}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </span>

            <button
              type="button"
              onClick={() => setWordWrap((w) => !w)}
              aria-pressed={wordWrap ? "true" : "false"}
              title="Toggle word wrap"
              className="inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: wordWrap ? "var(--accent)" : "var(--border-subtle)",
                color: wordWrap ? "var(--accent)" : "var(--text-primary)",
              }}
            >
              <WrapText size={12} aria-hidden="true" />
              <span className="hidden sm:inline">Wrap</span>
            </button>

            <div className="hidden items-center gap-0.5 sm:flex" role="group" aria-label="Editor font size">
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.max(12, s - 1))}
                aria-label="Decrease editor font size"
                className="cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[11px]"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.min(20, s + 1))}
                aria-label="Increase editor font size"
                className="cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[11px]"
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              >
                A+
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split-Pane Workspace */}
      <main
        id="main-ide"
        tabIndex={-1}
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(260px,1.25fr)_minmax(200px,1fr)] lg:grid-cols-[1.25fr_1fr] lg:grid-rows-1"
      >
        <MonacoEditorPane
          value={code}
          language={langMeta.monacoId}
          theme={resolvedTheme}
          fontSize={fontSize}
          wordWrap={wordWrap}
          onChange={setCode}
          onRunShortcut={handleRun}
          onShareShortcut={() => setShareOpen(true)}
        />

        <ConsolePanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          stdout={stdout}
          stderr={stderr}
          stdin={stdin}
          supportsStdin={langMeta.supportsStdin}
          sqlTables={sqlTables}
          durationMs={durationMs}
          exitCode={exitCode}
          runStatus={consoleDisplayStatus}
          onStdinChange={setStdin}
          onClearOutput={() => {
            setStdout("");
            setStderr("");
            setSqlTables([]);
            setDurationMs(null);
            setExitCode(null);
            setRunStatus("idle");
          }}
        />
      </main>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        language={language}
        title={title}
        code={code}
        stdin={stdin}
        output={stdout || stderr}
        currentSlug={currentSlug}
        onSlugCreated={(newSlug) => {
          setCurrentSlug(newSlug);
          setSlugBanner(`Saved /s/${newSlug}`);
          setHistoryEntries(
            addHistoryEntry({ language, title, code, stdin, slug: newSlug })
          );
          window.history.replaceState(null, "", `/s/${newSlug}`);
        }}
      />

      <HistoryDialog
        open={historyOpen}
        entries={historyEntries}
        onClose={() => setHistoryOpen(false)}
        onSelect={(entry) => {
          setLanguage(entry.language);
          setTitle(entry.title);
          setCode(entry.code);
          setStdin(entry.stdin);
          setCurrentSlug(entry.slug ?? null);
          setSlugBanner(entry.slug ? `Loaded /s/${entry.slug}` : "Loaded local snapshot");
          setStdout("");
          setStderr("");
          setSqlTables([]);
        }}
        onDelete={(id) => setHistoryEntries(removeHistoryEntry(id))}
      />

      <div role="status" aria-live="polite" className="visually-hidden">
        {announcement}
      </div>
    </div>
  );
}

export default App;
