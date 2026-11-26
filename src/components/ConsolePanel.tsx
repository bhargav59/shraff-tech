import { useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, Eraser, Terminal, Table2, Keyboard } from "lucide-react";
import type { SqlTableResult } from "../runners/types";

export type ConsoleTab = "output" | "stdin" | "tables";

interface ConsolePanelProps {
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  stdout: string;
  stderr: string;
  stdin: string;
  supportsStdin: boolean;
  sqlTables: SqlTableResult[];
  durationMs: number | null;
  exitCode: number | null;
  runStatus: "idle" | "running" | "done" | "error" | "killed";
  onStdinChange: (value: string) => void;
  onClearOutput: () => void;
}

export function ConsolePanel({
  activeTab,
  onTabChange,
  stdout,
  stderr,
  stdin,
  supportsStdin,
  sqlTables,
  durationMs,
  exitCode,
  runStatus,
  onStdinChange,
  onClearOutput,
}: ConsolePanelProps) {
  const tablistRef = useRef<HTMLDivElement>(null);
  const [copiedMsg, setCopiedMsg] = useState("");

  const hasTables = sqlTables.length > 0;
  const effectiveTab: ConsoleTab =
    activeTab === "tables" && !hasTables ? "output" : activeTab;

  const tabs: Array<{ id: ConsoleTab; label: string; badge?: string }> = [
    { id: "output", label: "Console Output" },
    {
      id: "stdin",
      label: supportsStdin ? "Standard Input (stdin)" : "Standard Input (N/A)",
    },
    ...(hasTables
      ? [{ id: "tables" as const, label: "SQL Tables", badge: String(sqlTables.length) }]
      : []),
  ];

  // Fallback keyboard navigation for browsers without native `focusgroup`
  const handleTablistKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ("focusGroup" in HTMLElement.prototype) return;
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const container = tablistRef.current;
    if (!container) return;

    const tabButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const idx = tabButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1 || tabButtons.length === 0) return;

    e.preventDefault();
    let nextIdx = idx;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabButtons.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabButtons.length) % tabButtons.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabButtons.length - 1;

    const nextTab = tabButtons[nextIdx];
    nextTab?.focus();
    const idAttr = nextTab?.dataset.tabId as ConsoleTab | undefined;
    if (idAttr) onTabChange(idAttr);
  };

  const handleCopyOutput = async () => {
    const combined = [stdout, stderr ? `[stderr]\n${stderr}` : ""]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(combined || "");
      setCopiedMsg("Console output copied");
    } catch {
      setCopiedMsg("Copy failed");
    }
    setTimeout(() => setCopiedMsg(""), 2200);
  };

  return (
    <aside
      aria-label="Execution console and standard input"
      className="flex min-h-0 flex-1 flex-col border-t lg:border-t-0 lg:border-l"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Header bar with accessible tabs & execution telemetry */}
      <div
        className="flex items-center justify-between gap-2 border-b px-3"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Console views"
          onKeyDown={handleTablistKeyDown}
          {...({ focusgroup: "tablist nomemory" } as Record<string, string>)}
          className="flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const selected = effectiveTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                id={`tab-${tab.id}`}
                data-tab-id={tab.id}
                role="tab"
                aria-selected={selected}
                {...(selected ? { focusgroupstart: "" } : {})}
                onClick={() => onTabChange(tab.id)}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap"
                style={{
                  color: selected ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {tab.id === "output" && <Terminal size={13} aria-hidden="true" />}
                {tab.id === "stdin" && <Keyboard size={13} aria-hidden="true" />}
                {tab.id === "tables" && <Table2 size={13} aria-hidden="true" />}
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] leading-none"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2 py-1">
          {durationMs !== null && (
            <span
              className="rounded-md border px-2 py-0.5 font-mono text-xs"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                color:
                  runStatus === "error" || runStatus === "killed"
                    ? "var(--danger)"
                    : "var(--success)",
              }}
            >
              {durationMs} ms
              {exitCode !== null ? ` · exit ${exitCode}` : ""}
            </span>
          )}

          <button
            type="button"
            onClick={handleCopyOutput}
            aria-label="Copy console output"
            title="Copy console output"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            {copiedMsg ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <Copy size={13} aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{copiedMsg ? "Copied" : "Copy"}</span>
          </button>

          <button
            type="button"
            onClick={onClearOutput}
            aria-label="Clear console output"
            title="Clear console output"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            <Eraser size={13} aria-hidden="true" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Live status feedback for copy button */}
      <p role="status" className="visually-hidden">
        {copiedMsg}
      </p>

      {/* Tab Panels */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Output Panel */}
        <div
          role="tabpanel"
          aria-labelledby="tab-output"
          hidden={effectiveTab !== "output"}
          className="h-full"
        >
          <div
            tabIndex={0}
            aria-label="Program stdout and stderr output"
            className="ide-scroller h-full overflow-auto p-3.5 font-mono text-xs leading-6 sm:text-sm"
          >
            {!stdout && !stderr ? (
              <p className="m-0" style={{ color: "var(--text-muted)" }}>
                {runStatus === "running"
                  ? "Running inside isolated Web Worker..."
                  : "Press Run (or Ctrl/Cmd + Enter) to execute locally in WebAssembly."}
              </p>
            ) : (
              <>
                {stdout && (
                  <pre className="m-0 whitespace-pre-wrap break-words">{stdout}</pre>
                )}
                {stderr && (
                  <pre
                    className="mt-2 whitespace-pre-wrap break-words rounded-lg border p-2.5"
                    style={{
                      backgroundColor: "var(--danger-bg)",
                      borderColor: "var(--danger)",
                      color: "var(--danger)",
                    }}
                  >
                    {stderr}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>

        {/* Standard Input Panel */}
        <div
          role="tabpanel"
          aria-labelledby="tab-stdin"
          hidden={effectiveTab !== "stdin"}
          className="h-full"
        >
          <div className="flex h-full flex-col p-3.5">
            <label
              htmlFor="stdin-textarea"
              className="mb-1.5 text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {supportsStdin
                ? "Lines supplied to stdin before execution (e.g., readline(), input(), cin, scanf, STDIN):"
                : "SQLite uses pre-seeded users & orders tables directly; stdin is not used."}
            </label>
            <textarea
              id="stdin-textarea"
              value={stdin}
              onChange={(e) => onStdinChange(e.target.value)}
              disabled={!supportsStdin}
              placeholder="Enter program input lines here..."
              spellCheck={false}
              className="ide-scroller min-h-0 flex-1 resize-none rounded-lg border p-3 font-mono text-sm"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            />
          </div>
        </div>

        {/* Structured SQL Results Panel */}
        {hasTables && (
          <div
            role="tabpanel"
            aria-labelledby="tab-tables"
            hidden={effectiveTab !== "tables"}
            className="h-full"
          >
            <div className="ide-scroller h-full space-y-4 overflow-auto p-3.5">
              {sqlTables.map((table) => (
                <div
                  key={table.statementIndex}
                  className="overflow-x-auto rounded-lg border"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <table className="w-full border-collapse text-left text-xs sm:text-sm">
                    <caption
                      className="border-b px-3 py-2 text-left text-xs font-semibold"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-muted)",
                      }}
                    >
                      Result Set #{table.statementIndex} ({table.values.length} row
                      {table.values.length === 1 ? "" : "s"})
                    </caption>
                    <thead>
                      <tr
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        {table.columns.map((col) => (
                          <th key={col} scope="col" className="px-3 py-2 font-mono font-semibold">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.values.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          style={{
                            borderBottom: "1px solid var(--border-subtle)",
                          }}
                        >
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-3 py-1.5 font-mono">
                              {cell === null || cell === undefined ? (
                                <span style={{ color: "var(--text-muted)" }}>NULL</span>
                              ) : (
                                String(cell)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
