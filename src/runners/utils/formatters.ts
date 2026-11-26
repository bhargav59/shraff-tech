/**
 * Formats arbitrary JavaScript runtime values cleanly for console output.
 */
export function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "bigint") return `${val}n`;
        if (val instanceof Map) return Object.fromEntries(val.entries());
        if (val instanceof Set) return Array.from(val.values());
        if (val && typeof val === "object") {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      2
    );
  } catch {
    return String(value);
  }
}

export function formatConsoleArgs(args: unknown[]): string {
  return args.map(formatConsoleValue).join(" ") + "\n";
}

/**
 * Formats an array of objects or SQL rows into a readable monospace ASCII table.
 */
export function formatAsciiTable(
  columns: string[],
  rows: unknown[][]
): string {
  if (columns.length === 0) return "(empty result set)\n";

  const stringRows = rows.map((row) =>
    columns.map((_, idx) => {
      const cell = row[idx];
      if (cell === null || cell === undefined) return "NULL";
      return String(cell);
    })
  );

  const widths = columns.map((col, idx) =>
    Math.max(col.length, ...stringRows.map((r) => r[idx].length))
  );

  const border =
    "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const formatLine = (cells: string[]) =>
    "| " + cells.map((c, i) => c.padEnd(widths[i], " ")).join(" | ") + " |";

  const lines = [
    border,
    formatLine(columns),
    border,
    ...stringRows.map(formatLine),
    border,
    `(${rows.length} row${rows.length === 1 ? "" : "s"})`,
  ];

  return lines.join("\n") + "\n";
}

export function formatObjectTable(data: unknown): string {
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
    const colSet = new Set<string>();
    for (const item of data) {
      if (item && typeof item === "object") {
        Object.keys(item as Record<string, unknown>).forEach((k) => colSet.add(k));
      }
    }
    const cols = ["(index)", ...Array.from(colSet)];
    const rows = data.map((item, idx) => [
      idx,
      ...Array.from(colSet).map((col) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>)[col]
          : undefined
      ),
    ]);
    return formatAsciiTable(cols, rows);
  }

  return formatConsoleArgs([data]);
}
