import type { LanguageId } from "../runners/types";

export interface LoadedSnippet {
  slug: string;
  language: LanguageId;
  title: string;
  code: string;
  stdin: string;
  created_at: string;
}

export interface CreateSnippetResponse {
  slug: string;
  url: string;
  language: LanguageId;
  title: string;
  created_at: string;
}

export interface ShareEmailResponse {
  ok: boolean;
  emailId: string;
  slug: string;
  url: string;
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // Ignore non-JSON error body
  }
  return `${fallback} (HTTP ${response.status})`;
}

export async function createSnippet(payload: {
  language: LanguageId;
  title: string;
  code: string;
  stdin: string;
}): Promise<CreateSnippetResponse> {
  const response = await fetch("/api/snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Unable to save snippet"));
  }
  return (await response.json()) as CreateSnippetResponse;
}

export async function fetchSnippet(slug: string): Promise<LoadedSnippet> {
  const response = await fetch(`/api/snippets/${encodeURIComponent(slug)}`);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Snippet could not be loaded"));
  }
  return (await response.json()) as LoadedSnippet;
}

export async function sendSnippetEmail(payload: {
  email: string;
  slug?: string;
  language: LanguageId;
  title: string;
  code: string;
  stdin: string;
  output?: string;
}): Promise<ShareEmailResponse> {
  const response = await fetch("/api/share-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Failed to email snippet"));
  }
  return (await response.json()) as ShareEmailResponse;
}

export function extractSnippetSlugFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/s\/([A-Za-z0-9_-]{7,12})\/?$/);
  return match ? match[1] : null;
}
