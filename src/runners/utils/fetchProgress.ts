const WASM_CACHE_NAME = "shraff-wasm-cache-v1";

/**
 * Downloads a binary asset (e.g., .wasm) via ReadableStream while reporting
 * incremental byte progress back to the main thread. Uses browser CacheStorage
 * when available so subsequent runs and language switches incur zero network transfer.
 */
export async function fetchBufferWithProgress(
  url: string,
  stage: string,
  onProgress: (
    stage: string,
    percent: number | null,
    loadedBytes?: number,
    totalBytes?: number
  ) => void
): Promise<ArrayBuffer> {
  onProgress(stage, 0, 0, undefined);

  let cache: Cache | null = null;
  if (typeof caches !== "undefined") {
    try {
      cache = await caches.open(WASM_CACHE_NAME);
      const cachedResponse = await cache.match(url);
      if (cachedResponse && cachedResponse.ok) {
        const cachedBuffer = await cachedResponse.arrayBuffer();
        onProgress(
          `${stage} (cached)`,
          100,
          cachedBuffer.byteLength,
          cachedBuffer.byteLength
        );
        return cachedBuffer;
      }
    } catch {
      cache = null;
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch runtime asset (${response.status}): ${url}`);
  }

  const contentLengthHeader = response.headers.get("Content-Length");
  const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (!response.body) {
    const buf = await response.arrayBuffer();
    if (cache) {
      cache
        .put(
          url,
          new Response(buf, {
            headers: { "Content-Type": "application/wasm" },
          })
        )
        .catch(() => undefined);
    }
    onProgress(stage, 100, buf.byteLength, buf.byteLength);
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      const percent =
        totalBytes > 0
          ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100))
          : null;
      onProgress(stage, percent, loadedBytes, totalBytes || undefined);
    }
  }

  const combined = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (cache) {
    cache
      .put(
        url,
        new Response(combined.buffer.slice(0), {
          headers: { "Content-Type": "application/wasm" },
        })
      )
      .catch(() => undefined);
  }

  onProgress(stage, 100, loadedBytes, totalBytes || loadedBytes);
  return combined.buffer;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
