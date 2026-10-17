import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/** Build isolado da pré-visualização do painel — roda em navegador, sem Electron. */
export default defineConfig({
  root: resolve(__dirname, "src/renderer/painel"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist-painel"),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "src/renderer/painel/preview.html") }
  }
});
