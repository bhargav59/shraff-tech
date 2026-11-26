import { useEffect, useRef, type PointerEvent } from "react";
import { Clock, ExternalLink, Trash2, X } from "lucide-react";
import { LANGUAGES } from "../runners/templates";
import type { LocalHistoryEntry } from "../utils/shareHash";

interface HistoryDialogProps {
  open: boolean;
  entries: LocalHistoryEntry[];
  onClose: () => void;
  onSelect: (entry: LocalHistoryEntry) => void;
  onDelete: (id: string) => void;
}

export function HistoryDialog({
  open,
  entries,
  onClose,
  onSelect,
  onDelete,
}: HistoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = () => {
    if (dialogRef.current) dialogRef.current.returnValue = "";
    onClose();
  };

  const isOutsideDialogBox = (e: PointerEvent<HTMLDialogElement>, dialog: HTMLDialogElement) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as Record<string, string>)}
      aria-labelledby="history-dialog-title"
      onClose={handleClose}
      onPointerDown={(e) => {
        if ("closedBy" in HTMLDialogElement.prototype) return;
        const dialog = dialogRef.current;
        if (dialog) pressedOutsideRef.current = isOutsideDialogBox(e, dialog);
      }}
      onPointerUp={(e) => {
        if ("closedBy" in HTMLDialogElement.prototype) return;
        const dialog = dialogRef.current;
        if (dialog && pressedOutsideRef.current && isOutsideDialogBox(e, dialog)) {
          dialog.close();
        }
        pressedOutsideRef.current = false;
      }}
    >
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 id="history-dialog-title" className="m-0 text-lg font-bold">
              Recent Local History
            </h1>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Stored privately in your browser&apos;s localStorage (last 20 runs &amp; shares).
            </p>
          </div>
          <form method="dialog">
            <button
              type="submit"
              value="close"
              aria-label="Close history dialog"
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </form>
        </div>

        {entries.length === 0 ? (
          <div
            className="rounded-xl border p-6 text-center text-sm"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            <Clock size={22} className="mx-auto mb-2 opacity-70" aria-hidden="true" />
            <p className="m-0">No saved runs yet. Execute or share a snippet to save a snapshot here.</p>
          </div>
        ) : (
          <ul className="ide-scroller m-0 max-h-96 list-none space-y-2.5 overflow-y-auto p-0">
            {entries.map((entry) => {
              const langLabel = LANGUAGES[entry.language]?.label ?? entry.language;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold"
                        style={{
                          backgroundColor: "var(--bg-surface)",
                          color: "var(--accent)",
                        }}
                      >
                        {langLabel}
                      </span>
                      <span className="truncate text-sm font-semibold">{entry.title}</span>
                      {entry.slug && (
                        <span
                          className="inline-flex items-center gap-1 font-mono text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <ExternalLink size={11} aria-hidden="true" />
                          /s/{entry.slug}
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-1 mb-0 truncate font-mono text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {entry.code.trim().split("\n")[0]}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(entry);
                        handleClose();
                      }}
                      className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold"
                      style={{
                        backgroundColor: "var(--accent)",
                        color: "var(--accent-ink)",
                      }}
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(entry.id)}
                      aria-label={`Delete ${entry.title}`}
                      title="Delete from history"
                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border"
                      style={{
                        backgroundColor: "var(--bg-surface)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--danger)",
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}
