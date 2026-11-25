-- Garante políticas RLS limpas e explícitas para SELECT, INSERT, UPDATE e DELETE
-- na tabela public.editais_analisados, evitando que exclusões sejam bloqueadas
-- silenciosamente pelo PostgREST ou conflitem com políticas legadas.

alter table if exists public.editais_analisados enable row level security;

drop policy if exists "Usuários podem ver apenas seus próprios editais" on public.editais_analisados;
drop policy if exists "Permitir tudo editais_analisados" on public.editais_analisados;
drop policy if exists "Acesso proprio editais_analisados" on public.editais_analisados;
drop policy if exists "Enable read access for all users" on public.editais_analisados;
drop policy if exists "Enable delete for users based on user_id" on public.editais_analisados;
drop policy if exists "editais_analisados_select_own" on public.editais_analisados;
drop policy if exists "editais_analisados_insert_own" on public.editais_analisados;
drop policy if exists "editais_analisados_update_own" on public.editais_analisados;
drop policy if exists "editais_analisados_delete_own" on public.editais_analisados;

-- Política unificada permitindo leitura, inserção, edição e exclusão pelo dono,
-- além de permitir remover registros órfãos legados (user_id nulo ou guest padrão).
create policy "Acesso proprio editais_analisados" on public.editais_analisados
  for all
  to authenticated
  using (
    auth.uid()::text = user_id::text
    or user_id is null
    or user_id::text = '00000000-0000-0000-0000-000000000001'
  )
  with check (
    auth.uid()::text = user_id::text
  );
