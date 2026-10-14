-- Permite que cada usuário crie seus próprios tipos de status de disputas
-- (rótulo + cor), usados nos seletores de status e nas colunas do quadro Kanban
-- da Planilha de Disputas. Cada linha pertence a um único usuário.
create table if not exists status_disputas_usuario (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  label text not null,
  color text not null default '#64748b',
  position numeric not null default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table status_disputas_usuario enable row level security;

drop policy if exists "Usuários acessam apenas seus próprios status de disputas" on status_disputas_usuario;
create policy "Usuários acessam apenas seus próprios status de disputas" on status_disputas_usuario
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
