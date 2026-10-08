import { describe, it, expect } from "vitest";
import { getSupabaseFullSchemaSQL } from "./supabaseClient";

// O script é o que o usuário cola no SQL Editor do Supabase. Uma tabela nova
// sem RLS ou sem política vira dado legível por qualquer portador da chave
// publicável — já foi o caso aqui antes das políticas "Acesso proprio".
describe("script de schema — Bloco de Notas", () => {
  const sql = getSupabaseFullSchemaSQL();

  it("cria as duas tabelas", () => {
    expect(sql).toContain("create table if not exists public.pastas_notas");
    expect(sql).toContain("create table if not exists public.notas_bloco");
  });

  it("liga RLS nas duas", () => {
    expect(sql).toContain("alter table public.pastas_notas enable row level security");
    expect(sql).toContain("alter table public.notas_bloco enable row level security");
  });

  it("restringe cada linha ao seu dono — nunca using (true)", () => {
    for (const tabela of ["pastas_notas", "notas_bloco"]) {
      const politica = new RegExp(
        `create policy "Acesso proprio ${tabela}" on public\\.${tabela}\\s+for all using \\(auth\\.uid\\(\\)::text = user_id::text\\)\\s+with check \\(auth\\.uid\\(\\)::text = user_id::text\\)`,
      );
      expect(sql).toMatch(politica);
    }
    // O script cita `using (true)` num comentário, explicando por que NÃO se
    // usa; o que não pode existir é uma política de verdade com ele.
    const politicasPermissivas = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .filter((l) => l.includes("using (true)"));
    expect(politicasPermissivas).toEqual([]);
  });

  it("indexa o que a lista do bloco realmente consulta", () => {
    expect(sql).toContain("notas_bloco_user_atualizada_idx");
    expect(sql).toContain("notas_bloco_pasta_idx");
  });
});
