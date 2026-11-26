export type LanguageId =
  | "javascript"
  | "typescript"
  | "python"
  | "c"
  | "cpp"
  | "lua"
  | "ruby"
  | "php"
  | "sql";

export interface LanguageMeta {
  id: LanguageId;
  label: string;
  monacoId: string;
  runtimeLabel: string;
  downloadEstimate: string;
  extension: string;
  supportsStdin: boolean;
}

export interface SqlTableResult {
  statementIndex: number;
  columns: string[];
  values: unknown[][];
}

export type WorkerInboundMessage = {
  type: "run";
  runId: string;
  language: LanguageId;
  code: string;
  stdin: string;
};

export type WorkerOutboundMessage =
  | {
      type: "progress";
      runId: string;
      language: LanguageId;
      stage: string;
      percent: number | null;
      loadedBytes?: number;
      totalBytes?: number;
    }
  | {
      type: "stdout";
      runId: string;
      chunk: string;
    }
  | {
      type: "stderr";
      runId: string;
      chunk: string;
    }
  | {
      type: "sqlTables";
      runId: string;
      tables: SqlTableResult[];
    }
  | {
      type: "done";
      runId: string;
      exitCode: number;
      durationMs: number;
    }
  | {
      type: "error";
      runId: string;
      message: string;
      durationMs: number;
    };

export interface RunnerContext {
  onProgress: (
    stage: string,
    percent: number | null,
    loadedBytes?: number,
    totalBytes?: number
  ) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onSqlTables: (tables: SqlTableResult[]) => void;
}

export type LanguageRunner = (
  code: string,
  stdin: string,
  ctx: RunnerContext
) => Promise<number>;
