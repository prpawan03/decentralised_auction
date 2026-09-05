import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

/**
 * Tailwind v4 is wired through the Vite plugin, not PostCSS. That is why this
 * package has no postcss.config.js and no tailwind.config.js.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Split the wallet stack out of the entry chunk. Read-only visitors
         * still download it, but it stops one 1.5 MB blob from blocking paint.
         */
        manualChunks(id: string): string | undefined {
          if (id.includes("@rainbow-me") || id.includes("/wagmi/") || id.includes("@wagmi/")) {
            return "wallet";
          }
          if (id.includes("/viem/") || id.includes("/abitype/") || id.includes("/ox/")) {
            return "chain";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
    /* Playwright specs live in e2e/ and are driven by playwright.config.ts. */
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
