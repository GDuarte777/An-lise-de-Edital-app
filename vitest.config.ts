import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// O app desktop (LanceBot) tem seus próprios testes, mas são scripts que rodam
// direto no node e chamam process.exit() ao final — o vitest os coleta e os
// contabiliza como falha. Por isso a suíte do app web fica restrita a src/;
// o desktop continua sendo verificado pelo workflow build-lancebot.yml.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    // Node por padrão, porque a maior parte da suíte testa utilitário puro e
    // não precisa de DOM. Os testes de componente pedem jsdom no topo do
    // próprio arquivo, com "@vitest-environment jsdom".
    environment: "node",
  },
});
