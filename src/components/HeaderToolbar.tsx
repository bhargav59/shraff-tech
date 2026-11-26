import { useRef, type KeyboardEvent } from "react";
import {
  Code2,
  Download,
  GitFork,
  History,
  Moon,
  Play,
  RotateCcw,
  Share2,
  Square,
  Sun,
} from "lucide-react";
import { LANGUAGE_LIST } from "../runners/templates";
import type { LanguageId } from "../runners/types";
import type { ResolvedTheme, StoredScheme } from "../hooks/useTheme";

interface HeaderToolbarProps {
  language: LanguageId;
  title: string;
  isRunning: boolean;
  isSaving: boolean;
  hasSharedSlug: boolean;
  historyCount: number;
  resolvedTheme: ResolvedTheme;
  storedScheme: StoredScheme;
  onLanguageChange: (language: LanguageId) => void;
  onTitleChange: (title: string) => void;
  onRun: () => void;
  onStop: () => void;
  onResetTemplate: () => void;
  onDownloadCode: () => void;
  onForkSnippet: () => void;
  onOpenHistory: () => void;
  onOpenShare: () => void;
  onToggleTheme: () => void;
}

export function HeaderToolbar({
  language,
  title,
  isRunning,
  isSaving,
  hasSharedSlug,
  historyCount,
  resolvedTheme,
  storedScheme,
  onLanguageChange,
  onTitleChange,
  onRun,
  onStop,
  onResetTemplate,
  onDownloadCode,
  onForkSnippet,
  onOpenHistory,
  onOpenShare,
  onToggleTheme,
}: HeaderToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Roving arrow-key navigation fallback for browsers without native focusgroup
  const handleToolbarKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ("focusGroup" in HTMLElement.prototype) return;
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const container = toolbarRef.current;
    if (!container) return;

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1 || buttons.length === 0) return;

    e.preventDefault();
    let nextIdx = idx;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % buttons.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = buttons.length - 1;
    buttons[nextIdx]?.focus();
  };

  const nextThemeLabel =
    resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <header
      className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <a
          href="/"
          className="flex items-center gap-2 rounded-md text-decoration-none"
          style={{ color: "var(--text-primary)" }}
        >
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--accent)",
            }}
          >
            <Code2 size={18} aria-hidden="true" />
          </span>
          <h1 className="m-0 text-base font-bold tracking-tight">
            shraff<span style={{ color: "var(--accent)" }}>.tech</span>
          </h1>
        </a>

        <div className="flex items-center gap-2">
          <label htmlFor="language-select" className="visually-hidden">
            Programming Language
          </label>
          <select
            id="language-select"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as LanguageId)}
            className="rounded-lg border px-2.5 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            {LANGUAGE_LIST.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.label}
              </option>
            ))}
          </select>

          <label htmlFor="snippet-title-input" className="visually-hidden">
            Snippet Title
          </label>
          <input
            id="snippet-title-input"
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Snippet title..."
            className="hidden w-44 rounded-lg border px-2.5 py-1.5 text-sm sm:block xl:w-60"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      </div>

      {/* Primary IDE Action Toolbar */}
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="IDE execution and sharing actions"
        aria-controls="monaco-editor-region"
        onKeyDown={handleToolbarKeyDown}
        {...({ focusgroup: "toolbar wrap" } as Record<string, string>)}
        className="flex flex-wrap items-center gap-1.5 sm:gap-2"
      >
        <div role="group" aria-label="Execution controls" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (!isRunning) onRun();
            }}
            aria-disabled={isRunning ? "true" : undefined}
            title="Run code (Ctrl/Cmd + Enter)"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-ink)",
            }}
          >
            <Play size={15} aria-hidden="true" />
            <span>{isRunning ? "Running..." : "Run"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (isRunning) onStop();
            }}
            aria-disabled={!isRunning ? "true" : undefined}
            title="Stop execution and terminate Web Worker"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold"
            style={{
              backgroundColor: isRunning ? "var(--danger-bg)" : "var(--bg-elevated)",
              borderColor: isRunning ? "var(--danger)" : "var(--border-subtle)",
              color: isRunning ? "var(--danger)" : "var(--text-muted)",
            }}
          >
            <Square size={14} aria-hidden="true" />
            <span>Kill / Stop</span>
          </button>
        </div>

        <span
          role="separator"
          aria-orientation="vertical"
          className="mx-0.5 h-6 w-px border-r"
          style={{ borderColor: "var(--border-subtle)" }}
        />

        <div role="group" aria-label="File and snippet actions" className="flex items-center gap-1.5">
          {hasSharedSlug && (
            <button
              type="button"
              onClick={onForkSnippet}
              title="Fork snippet into a new local draft"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <GitFork size={14} aria-hidden="true" />
              <span className="hidden md:inline">Fork</span>
            </button>
          )}

          <button
            type="button"
            onClick={onResetTemplate}
            aria-label="Reset to starter template"
            title="Reset to starter template"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span className="hidden lg:inline">Template</span>
          </button>

          <button
            type="button"
            onClick={onDownloadCode}
            aria-label="Download source file"
            title="Download source file"
            className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-2.5 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            <Download size={14} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenHistory}
            aria-label={`Recent history (${historyCount})`}
            title="Recent local snippet history"
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            <History size={14} aria-hidden="true" />
            {historyCount > 0 && (
              <span className="font-mono text-xs">{historyCount}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (!isSaving) onOpenShare();
            }}
            aria-disabled={isSaving ? "true" : undefined}
            title="Share snippet link or send via email (Ctrl/Cmd + S)"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            <Share2 size={14} aria-hidden="true" />
            <span>Share</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={nextThemeLabel}
            aria-pressed={storedScheme !== null ? "true" : "false"}
            title={`${nextThemeLabel} (${storedScheme ? `pinned ${storedScheme}` : "following system"})`}
            className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-2.5 py-1.5"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            <span className="theme-icon-to-light items-center justify-center" aria-hidden="true">
              <Sun size={16} />
            </span>
            <span className="theme-icon-to-dark items-center justify-center" aria-hidden="true">
              <Moon size={16} />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
