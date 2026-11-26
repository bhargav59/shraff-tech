import type { LanguageId, LanguageMeta } from "./types";

export const LANGUAGES: Record<LanguageId, LanguageMeta> = {
  javascript: {
    id: "javascript",
    label: "JavaScript (ES2024)",
    monacoId: "javascript",
    runtimeLabel: "Native Worker V8/JS",
    downloadEstimate: "0 KB (instant)",
    extension: "js",
    supportsStdin: true,
  },
  typescript: {
    id: "typescript",
    label: "TypeScript",
    monacoId: "typescript",
    runtimeLabel: "esbuild-wasm 0.28",
    downloadEstimate: "~14 MB Wasm",
    extension: "ts",
    supportsStdin: true,
  },
  python: {
    id: "python",
    label: "Python 3",
    monacoId: "python",
    runtimeLabel: "Pyodide 0.29 (CPython 3.13)",
    downloadEstimate: "~18 MB Wasm",
    extension: "py",
    supportsStdin: true,
  },
  c: {
    id: "c",
    label: "C",
    monacoId: "c",
    runtimeLabel: "JSCPP Sandbox VM",
    downloadEstimate: "~600 KB",
    extension: "c",
    supportsStdin: true,
  },
  cpp: {
    id: "cpp",
    label: "C++",
    monacoId: "cpp",
    runtimeLabel: "JSCPP Sandbox VM",
    downloadEstimate: "~600 KB",
    extension: "cpp",
    supportsStdin: true,
  },
  lua: {
    id: "lua",
    label: "Lua 5.4",
    monacoId: "lua",
    runtimeLabel: "Wasmoon Lua 5.4 Wasm",
    downloadEstimate: "~420 KB Wasm",
    extension: "lua",
    supportsStdin: true,
  },
  ruby: {
    id: "ruby",
    label: "Ruby 3.4",
    monacoId: "ruby",
    runtimeLabel: "ruby.wasm (CRuby 3.4 WASI)",
    downloadEstimate: "~30 MB Wasm",
    extension: "rb",
    supportsStdin: true,
  },
  php: {
    id: "php",
    label: "PHP 8.4",
    monacoId: "php",
    runtimeLabel: "php-cgi-wasm (PHP 8.4)",
    downloadEstimate: "~13 MB Wasm",
    extension: "php",
    supportsStdin: true,
  },
  sql: {
    id: "sql",
    label: "SQL (SQLite)",
    monacoId: "sql",
    runtimeLabel: "sql.js (SQLite Wasm)",
    downloadEstimate: "~750 KB Wasm",
    extension: "sql",
    supportsStdin: false,
  },
};

export const LANGUAGE_LIST: LanguageMeta[] = Object.values(LANGUAGES);

export interface LanguageTemplate {
  title: string;
  code: string;
  stdin: string;
}

export const STARTER_TEMPLATES: Record<LanguageId, LanguageTemplate> = {
  javascript: {
    title: "ES2024 Async Data Pipeline",
    stdin: "Ada Lovelace\nGrace Hopper\nAlan Turing",
    code: `// JavaScript (ES2024) running inside an isolated Web Worker
const names = [];
let line;
while ((line = readline()) !== null) {
  if (line.trim()) names.push(line.trim());
}

const stats = names.map((name, idx) => ({
  id: idx + 1,
  name,
  initials: name.split(/\\s+/).map((w) => w[0]).join(""),
}));

console.log("Loaded", stats.length, "engineers from stdin:");
console.table(stats);

await new Promise((r) => setTimeout(r, 25));
console.log("Async microtask complete on shraff.tech!");
`,
  },
  typescript: {
    title: "TypeScript Generics + esbuild-wasm",
    stdin: "42",
    code: `// Transpiled in-browser via esbuild-wasm, then executed in a Web Worker
interface BenchmarkResult<T> {
  input: number;
  computed: T;
  tags: readonly string[];
}

function fibonacci(n: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
  }
  return a;
}

const raw = readline()?.trim() || "10";
const n = Math.min(Math.max(Number(raw) || 10, 1), 75);

const summary: BenchmarkResult<number> = {
  input: n,
  computed: fibonacci(n),
  tags: ["wasm", "esbuild", "shraff.tech"],
};

console.log(\`fib(\${summary.input}) = \${summary.computed}\`);
console.log(JSON.stringify(summary, null, 2));
`,
  },
  python: {
    title: "Python 3.13 Statistics via Pyodide",
    stdin: "12 18 25 31 44",
    code: `import sys
import statistics

raw = sys.stdin.read().strip() or "10 20 30 40"
numbers = [float(tok) for tok in raw.split()]

print(f"Python {sys.version.split()[0]} on Pyodide Wasm")
print(f"Count:  {len(numbers)}")
print(f"Sum:    {sum(numbers):.2f}")
print(f"Mean:   {statistics.mean(numbers):.2f}")
print(f"Median: {statistics.median(numbers):.2f}")
`,
  },
  c: {
    title: "C Prime Sieve (In-Browser Sandbox)",
    stdin: "30",
    code: `#include <stdio.h>

int main() {
    int limit = 30;
    if (scanf("%d", &limit) != 1 || limit < 2) {
        limit = 30;
    }
    if (limit > 200) limit = 200;

    printf("Primes up to %d:\\n", limit);
    int count = 0;
    for (int n = 2; n <= limit; n++) {
        int is_prime = 1;
        for (int d = 2; d * d <= n; d++) {
            if (n % d == 0) {
                is_prime = 0;
                break;
            }
        }
        if (is_prime) {
            printf("%d ", n);
            count++;
        }
    }
    printf("\\nTotal: %d primes\\n", count);
    return 0;
}
`,
  },
  cpp: {
    title: "C++ Recursive Factorial & Input",
    stdin: "6",
    code: `#include <iostream>
using namespace std;

long long factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int main() {
    int n = 6;
    cin >> n;
    if (n <= 0) n = 6;
    if (n > 20) n = 20;

    cout << "C++ on shraff.tech" << endl;
    for (int i = 1; i <= n; i++) {
        cout << i << "! = " << factorial(i) << endl;
    }
    return 0;
}
`,
  },
  lua: {
    title: "Lua 5.4 Tables & Metatables",
    stdin: "shraff.tech",
    code: `-- Executed in Wasmoon (Lua 5.4 WebAssembly VM)
local label = io.read("*l") or "shraff.tech"
print("Running " .. _VERSION .. " for " .. label)

local Vector = {}
Vector.__index = Vector

function Vector.new(x, y)
  return setmetatable({ x = x, y = y }, Vector)
end

function Vector:__add(other)
  return Vector.new(self.x + other.x, self.y + other.y)
end

function Vector:__tostring()
  return string.format("Vector(%.1f, %.1f)", self.x, self.y)
end

local a = Vector.new(3, 4)
local b = Vector.new(7, 1.5)
print("a + b =", tostring(a + b))
`,
  },
  ruby: {
    title: "Ruby 3.4 Enumerable Pipeline",
    stdin: "ruby wasm edge cloudflare",
    code: `# Executed in CRuby 3.4 WASI WebAssembly
input = STDIN.read.strip
words = input.empty? ? %w[shraff tech ruby wasm] : input.split

puts "Ruby #{RUBY_VERSION} (#{RUBY_PLATFORM})"
grouped = words.group_by(&:length).sort.to_h
grouped.each do |len, items|
  puts "Length #{len}: #{items.map(&:upcase).join(', ')}"
end
`,
  },
  php: {
    title: "PHP 8.4 Functional Pipeline",
    stdin: "Alice\nBob\nCharlie",
    code: `<?php
// Executed in PHP 8.4 WebAssembly (php-cgi-wasm)
echo "PHP " . PHP_VERSION . " running in Wasm\\n";

$lines = [];
while (($line = readline()) !== false) {
    $trimmed = trim($line);
    if ($trimmed !== '') {
        $lines[] = $trimmed;
    }
}

$items = count($lines) > 0 ? $lines : ['Ada', 'Grace', 'Linus'];
$indexed = array_map(
    fn(string $name, int $i): string => sprintf("[%d] %s", $i + 1, strtoupper($name)),
    $items,
    array_keys($items)
);

echo implode("\\n", $indexed) . "\\n";
`,
  },
  sql: {
    title: "SQLite Orders & Users Analytics",
    stdin: "",
    code: `-- Pre-seeded SQLite Wasm database includes \`users\` and \`orders\` tables.
-- Inspect schema anytime with: SELECT name, sql FROM sqlite_master WHERE type='table';

SELECT
  u.id,
  u.name,
  u.plan,
  COUNT(o.id) AS total_orders,
  ROUND(COALESCE(SUM(o.amount_cents), 0) / 100.0, 2) AS total_spent_usd
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
GROUP BY u.id, u.name, u.plan
ORDER BY total_spent_usd DESC, u.id ASC;
`,
  },
};
