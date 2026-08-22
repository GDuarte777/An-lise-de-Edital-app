import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      lib: { entry: "src/main/index.ts", formats: ["es"], fileName: () => "index.js" },
      rollupOptions: { external: ["electron"] }
    }
  },
  preload: {
    build: {
      lib: { entry: "src/preload/index.ts", formats: ["cjs"], fileName: () => "index.cjs" },
      rollupOptions: { external: ["electron"] }
    }
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    build: { rollupOptions: { input: "src/renderer/index.html" } }
  }
});
