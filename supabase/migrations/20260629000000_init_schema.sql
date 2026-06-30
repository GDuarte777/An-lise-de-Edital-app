-- 1. Criar a tabela de Editais Analisados
create table if not exists editais_analisados (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  date text not null,
  analysis jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Criar a tabela de Documentos Sincronizados
create table if not exists documentos_sincronizados (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text,
  path text,
  timestamp text,
  url text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Criar a tabela de Certidões Fiscais
create table if not exists certidoes_fiscais (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  emission_date text,
  expiration_date text,
  status text not null,
  notes text,
  file_uploaded boolean default false,
  file_name text,
  document_matches_row boolean default false,
  validation_feedback text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Criar a tabela de Histórico de Concorrentes
create table if not exists historico_concorrentes (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  competitor_name text not null,
  focus_items text,
  date text,
  edital_title text,
  analysis jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Criar a tabela de Sessões de Chat
create table if not exists sessoes_chat (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  selected_edital_id text,
  messages jsonb not null,
  created_at text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar RLS (Row Level Security) em todas as tabelas
alter table editais_analisados enable row level security;
alter table documentos_sincronizados enable row level security;
alter table certidoes_fiscais enable row level security;
alter table historico_concorrentes enable row level security;
alter table sessoes_chat enable row level security;

-- Remover políticas existentes para evitar erros em execuções repetidas
drop policy if exists "Usuários podem ver apenas seus próprios editais" on editais_analisados;
drop policy if exists "Usuários podem ver apenas seus próprios documentos" on documentos_sincronizados;
drop policy if exists "Usuários podem ver apenas suas próprias certidões" on certidoes_fiscais;
drop policy if exists "Usuários podem ver apenas seus próprios concorrentes" on historico_concorrentes;
drop policy if exists "Usuários podem ver apenas seus próprios chats" on sessoes_chat;

-- Criar políticas de segurança RLS (Garantindo isolamento total por usuário)
create policy "Usuários podem ver apenas seus próprios editais" on editais_analisados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios documentos" on documentos_sincronizados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas suas próprias certidões" on certidoes_fiscais
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios concorrentes" on historico_concorrentes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios chats" on sessoes_chat
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
