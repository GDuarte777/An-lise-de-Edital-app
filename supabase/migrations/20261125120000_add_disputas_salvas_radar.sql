-- Armazena as disputas salvas pelo usuário no Radar de Oportunidades
-- para consulta e análise posterior com IA. Cada registro pertence a um único
-- usuário e é deduplicado pelo número de controle oficial do PNCP.
create table if not exists disputas_salvas_radar (
  user_id uuid references auth.users(id) on delete cascade not null,
  numero_controle_pncp text not null,
  dados jsonb not null,
  salvo_em timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, numero_controle_pncp)
);

create index if not exists idx_disputas_salvas_radar_user_salvo_em
  on disputas_salvas_radar (user_id, salvo_em desc);

alter table disputas_salvas_radar enable row level security;

drop policy if exists "Usuários acessam apenas suas disputas salvas no radar" on disputas_salvas_radar;
create policy "Usuários acessam apenas suas disputas salvas no radar" on disputas_salvas_radar
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
