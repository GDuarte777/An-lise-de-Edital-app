import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A Edge Function do Supabase precisa ser autocontida: o Deno só enxerga os
// arquivos publicados junto dela, então `segredos.ts` e `pncpQuery.ts` existem
// em duas cópias. Cópia sem guarda é divergência marcada para acontecer — e a
// divergência silenciosa aqui é grave: `segredos.ts` decide se a chave de API
// de um cliente é decifrada corretamente, e `pncpQuery.ts` decide quais
// licitações aparecem no Radar. Este teste é a guarda.
const raiz = resolve(__dirname, "..");

const copias = [
  ["src/utils/segredos.ts", "supabase/functions/api/segredos.ts"],
  ["src/utils/pncpQuery.ts", "supabase/functions/api/pncpQuery.ts"],
] as const;

describe("cópias compartilhadas com a Edge Function", () => {
  it.each(copias)("%s está idêntico a %s", (origem, copia) => {
    const a = readFileSync(resolve(raiz, origem), "utf-8");
    const b = readFileSync(resolve(raiz, copia), "utf-8");
    expect(b, `Rode: cp ${origem} ${copia}`).toBe(a);
  });
});
