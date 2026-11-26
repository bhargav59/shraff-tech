import type { LanguageRunner, RunnerContext, SqlTableResult } from "../types";
import { fetchBufferWithProgress } from "../utils/fetchProgress";
import { formatAsciiTable } from "../utils/formatters";

const SQLJS_ESM_URL = "https://cdn.jsdelivr.net/npm/sql.js@1.17.0/+esm";
const SQLJS_WASM_URL =
  "https://cdn.jsdelivr.net/npm/sql.js@1.17.0/dist/sql-wasm-browser.wasm";

interface SqlJsDatabase {
  run(sql: string): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}

interface SqlJsStatic {
  Database: new () => SqlJsDatabase;
}

const SEED_SQL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'team')),
  joined_at TEXT NOT NULL
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid', 'pending', 'refunded')),
  created_at TEXT NOT NULL
);

INSERT INTO users (id, name, email, plan, joined_at) VALUES
  (1, 'Ada Lovelace', 'ada@shraff.tech', 'pro', '2026-01-12'),
  (2, 'Grace Hopper', 'grace@shraff.tech', 'team', '2026-02-04'),
  (3, 'Alan Turing', 'alan@shraff.tech', 'pro', '2026-03-19'),
  (4, 'Margaret Hamilton', 'margaret@shraff.tech', 'team', '2026-04-08'),
  (5, 'Linus Torvalds', 'linus@shraff.tech', 'free', '2026-05-22');

INSERT INTO orders (id, user_id, product, amount_cents, status, created_at) VALUES
  (101, 1, 'Cloud Edge Pack', 4900, 'paid', '2026-06-01'),
  (102, 1, 'Wasm Profiler', 2900, 'paid', '2026-06-14'),
  (103, 2, 'Team Seat Bundle', 14900, 'paid', '2026-07-02'),
  (104, 2, 'Priority Runners', 7900, 'pending', '2026-07-10'),
  (105, 3, 'Cloud Edge Pack', 4900, 'paid', '2026-08-03'),
  (106, 4, 'Team Seat Bundle', 14900, 'paid', '2026-08-19'),
  (107, 4, 'Wasm Profiler', 2900, 'refunded', '2026-09-01'),
  (108, 5, 'Starter Add-on', 1500, 'paid', '2026-09-15');
`;

let cachedSqlJs: Promise<SqlJsStatic> | null = null;

async function getSqlJs(
  onProgress: RunnerContext["onProgress"]
): Promise<SqlJsStatic> {
  if (!cachedSqlJs) {
    cachedSqlJs = (async () => {
      onProgress("Loading sql.js runtime...", 10);
      const [mod, wasmBuffer] = await Promise.all([
        import(/* @vite-ignore */ SQLJS_ESM_URL) as Promise<{
          default: (config: { wasmBinary: Uint8Array }) => Promise<SqlJsStatic>;
        }>,
        fetchBufferWithProgress(
          SQLJS_WASM_URL,
          "Downloading SQLite Wasm",
          onProgress
        ),
      ]);
      onProgress("Initializing SQLite Wasm...", 98);
      const SQL = await mod.default({ wasmBinary: new Uint8Array(wasmBuffer) });
      onProgress("SQLite Wasm ready", 100);
      return SQL;
    })().catch((err) => {
      cachedSqlJs = null;
      throw err;
    });
  } else {
    onProgress("SQLite Wasm cached", 100);
  }
  return cachedSqlJs;
}

export const runSql: LanguageRunner = async (code, _stdin, ctx) => {
  const SQL = await getSqlJs(ctx.onProgress);
  const db = new SQL.Database();

  try {
    db.run(SEED_SQL);
    const results = db.exec(code);

    if (results.length === 0) {
      ctx.onStdout("Query executed successfully (0 result sets returned).\n");
      ctx.onSqlTables([]);
      return 0;
    }

    const structured: SqlTableResult[] = results.map((res, idx) => ({
      statementIndex: idx + 1,
      columns: res.columns,
      values: res.values,
    }));
    ctx.onSqlTables(structured);

    results.forEach((res, idx) => {
      if (results.length > 1) {
        ctx.onStdout(`-- Result Set #${idx + 1} --\n`);
      }
      ctx.onStdout(formatAsciiTable(res.columns, res.values));
    });

    return 0;
  } finally {
    db.close();
  }
};
