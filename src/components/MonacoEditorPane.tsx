import { useEffect, useRef, useState } from "react";
import type { ResolvedTheme } from "../hooks/useTheme";

const MONACO_BASE_URL = "https://cdn.jsdelivr.net/npm/monaco-editor@0.58.0/min/vs";

interface MonacoEditorInstance {
  getValue(): string;
  setValue(val: string): void;
  getModel(): unknown;
  updateOptions(options: Record<string, unknown>): void;
  addCommand(keybinding: number, handler: () => void): void;
  onDidChangeModelContent(listener: () => void): { dispose(): void };
  layout(): void;
  dispose(): void;
}

interface MonacoNamespace {
  KeyMod: { CtrlCmd: number };
  KeyCode: { Enter: number; KeyS: number };
  editor: {
    create(
      container: HTMLElement,
      options: Record<string, unknown>
    ): MonacoEditorInstance;
    setTheme(themeName: string): void;
    setModelLanguage(model: unknown, languageId: string): void;
  };
}

declare global {
  interface Window {
    monaco?: MonacoNamespace;
    require?: {
      (deps: string[], onLoad: (monaco: MonacoNamespace) => void, onError?: (err: unknown) => void): void;
      config?: (cfg: Record<string, unknown>) => void;
    };
  }
}

let monacoLoadPromise: Promise<MonacoNamespace> | null = null;

function loadMonacoFromCdn(): Promise<MonacoNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Monaco requires a browser window."));
  }
  if (window.monaco?.editor) {
    return Promise.resolve(window.monaco);
  }
  if (monacoLoadPromise) {
    return monacoLoadPromise;
  }

  monacoLoadPromise = new Promise<MonacoNamespace>((resolve, reject) => {
    const initAmd = () => {
      const amdRequire = window.require;
      if (!amdRequire || typeof amdRequire.config !== "function") {
        reject(new Error("Monaco AMD loader unavailable."));
        return;
      }
      amdRequire.config({ paths: { vs: MONACO_BASE_URL } });
      amdRequire(
        ["vs/editor/editor.main"],
        (monacoMod: MonacoNamespace) => {
          const resolved = window.monaco ?? monacoMod;
          resolve(resolved);
        },
        (err) => reject(err)
      );
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-monaco-loader="true"]'
    );
    if (existingScript) {
      if (window.require?.config) {
        initAmd();
      } else {
        existingScript.addEventListener("load", initAmd, { once: true });
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Failed to load Monaco Editor from CDN.")),
          { once: true }
        );
      }
      return;
    }

    const script = document.createElement("script");
    script.src = `${MONACO_BASE_URL}/loader.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.monacoLoader = "true";
    script.addEventListener("load", initAmd, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load Monaco Editor from CDN.")),
      { once: true }
    );
    document.head.appendChild(script);
  }).catch((err) => {
    monacoLoadPromise = null;
    throw err;
  });

  return monacoLoadPromise;
}

interface MonacoEditorPaneProps {
  value: string;
  language: string;
  theme: ResolvedTheme;
  fontSize: number;
  wordWrap: boolean;
  onChange: (nextValue: string) => void;
  onRunShortcut: () => void;
  onShareShortcut?: () => void;
}

export function MonacoEditorPane({
  value,
  language,
  theme,
  fontSize,
  wordWrap,
  onChange,
  onRunShortcut,
  onShareShortcut,
}: MonacoEditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const suppressChangeRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRunShortcut);
  const onShareRef = useRef(onShareShortcut);

  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");

  onChangeRef.current = onChange;
  onRunRef.current = onRunShortcut;
  onShareRef.current = onShareShortcut;

  useEffect(() => {
    let disposed = false;
    let changeSub: { dispose(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    loadMonacoFromCdn()
      .then((monaco) => {
        if (disposed || !containerRef.current) return;
        monacoRef.current = monaco;

        const instance = monaco.editor.create(containerRef.current, {
          value,
          language,
          theme: theme === "dark" ? "vs-dark" : "vs",
          automaticLayout: false,
          minimap: { enabled: false },
          fontSize,
          lineHeight: Math.round(fontSize * 1.55),
          wordWrap: wordWrap ? "on" : "off",
          fontFamily:
            "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontLigatures: true,
          tabSize: 2,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          padding: { top: 14, bottom: 14 },
          roundedSelection: true,
          cursorBlinking: "smooth",
        });

        editorRef.current = instance;

        instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
          onRunRef.current();
        });
        instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onShareRef.current?.();
        });

        changeSub = instance.onDidChangeModelContent(() => {
          if (suppressChangeRef.current) return;
          onChangeRef.current(instance.getValue());
        });

        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          resizeObserver = new ResizeObserver(() => {
            instance.layout();
          });
          resizeObserver.observe(containerRef.current);
        }

        setStatus("ready");
      })
      .catch(() => {
        if (!disposed) {
          setStatus("fallback");
        }
      });

    return () => {
      disposed = true;
      changeSub?.dispose();
      resizeObserver?.disconnect();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // Initial mount creates Monaco once; subsequent prop updates sync via dedicated effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco) {
      monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.updateOptions({
        fontSize,
        lineHeight: Math.round(fontSize * 1.55),
        wordWrap: wordWrap ? "on" : "off",
      });
    }
  }, [fontSize, wordWrap]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (monaco && editor) {
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, language);
      }
    }
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      suppressChangeRef.current = true;
      editor.setValue(value);
      suppressChangeRef.current = false;
    }
  }, [value]);

  return (
    <div
      id="monaco-editor-region"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ backgroundColor: "var(--bg-surface)" }}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label="Code editor"
        style={{ display: status === "ready" ? "block" : "none" }}
      />

      {status !== "ready" && (
        <div className="flex h-full flex-col">
          <div
            className="flex items-center justify-between border-b px-3 py-1.5 text-xs"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            <span>
              {status === "loading"
                ? "Loading Monaco Editor from jsDelivr CDN (you can already type below)..."
                : "Offline fallback editor active (Monaco CDN unreachable)"}
            </span>
            <span>Ctrl/Cmd + Enter to Run</span>
          </div>
          <label htmlFor="fallback-code-textarea" className="visually-hidden">
            Source code editor
          </label>
          <textarea
            id="fallback-code-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                onRunShortcut();
              } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                onShareShortcut?.();
              }
            }}
            spellCheck={false}
            style={{
              backgroundColor: "var(--bg-surface)",
              color: "var(--text-primary)",
              fontSize: `${fontSize}px`,
              whiteSpace: wordWrap ? "pre-wrap" : "pre",
            }}
            className="ide-scroller min-h-0 flex-1 resize-none border-0 p-4 font-mono leading-6 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
