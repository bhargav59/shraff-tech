import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite configuration for shraff.tech.
 * - Emits ES module Web Workers so lazy CDN imports work inside dedicated workers.
 * - Sets Cross-Origin Isolation headers in dev mode to match production Cloudflare headers.
 * - Proxies /api/* requests to local `wrangler dev` (port 8787) during development.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react";
          }
          if (id.includes("node_modules/lucide-react/")) {
            return "icons";
          }
          return undefined;
        },
      },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
});
