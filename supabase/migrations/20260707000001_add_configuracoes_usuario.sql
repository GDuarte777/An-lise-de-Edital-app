-- Criar tabela de configurações do usuário (chaves de API de IA)
-- Esta tabela armazena as configurações de IA de cada usuário de forma isolada e segura.
create table if not exists configuracoes_usuario (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  active_provider text not null default 'gemini',
  gemini_key text default '',
  gemini_model text default 'gemini-1.5-flash',
  openai_key text default '',
  openai_model text default 'gpt-4o',
  anthropic_key text default '',
  anthropic_model text default 'claude-3-7-sonnet-20250219',
  deepseek_key text default '',
  deepseek_model text default 'deepseek-chat',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar RLS
alter table configuracoes_usuario enable row level security;

-- Remover política existente para evitar erros em re-execuções
drop policy if exists "Usuários acessam apenas suas próprias configurações" on configuracoes_usuario;

-- Política RLS: cada usuário só pode ver/editar suas próprias configurações
create policy "Usuários acessam apenas suas próprias configurações" on configuracoes_usuario
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
