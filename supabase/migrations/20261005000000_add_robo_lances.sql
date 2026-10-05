-- ═══════════════════════════════════════════════════════════════════════
-- ROBÔ DE LANCES
--
-- Guarda a configuração que a extensão do navegador lê durante a disputa: o
-- robô, os itens, o que foi enviado e o que o portal respondeu.
--
-- A regra que importa está em `itens_robo_lance.valor_minimo`: é o piso de
-- margem por item, e é a única coisa entre o robô e um prejuízo real. Por isso
-- ele nasce NULO em vez de zero — zero seria um piso válido e o robô desceria
-- até lá achando que estava obedecendo. Nulo significa "não configurado", e
-- item sem piso não recebe lance automático.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. O robô: uma configuração de disputa para uma compra.
create table if not exists robos_lance (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,

  -- 'Manual Assistido' só sugere e nunca envia sozinho; 'Estratégico' espalha
  -- o envio no tempo para não assinar um padrão de robô; os demais enviam no
  -- tempo de resposta configurado.
  mode text not null default 'Manual Assistido',

  -- 'global' disputa tudo que o portal mostrar; 'por_item' disputa apenas o
  -- que estiver marcado em itens_robo_lance.
  dispute_type text not null default 'global',
  -- Em 'por_item', exige também que o item tenha piso de margem preenchido.
  item_selection_enabled boolean not null default false,

  status text not null default 'ativo',

  -- Identificação da compra. uasg + numero_compra são conferidos contra o que
  -- o portal informa na aba antes de qualquer lance: é o que impede o robô de
  -- uma licitação de responder por outra quando há duas abas abertas.
  purchase_id text,
  uasg text,
  numero_compra text,
  numero_interno text,
  portal_name text,
  orgao text,
  unidade_compradora text,
  municipio text,
  uf text,
  modalidade text,
  situacao text,
  data_abertura text,
  data_encerramento text,
  link_sistema_origem text,

  fornecedor_cnpj text,

  initial_value numeric,
  -- Piso global, usado só quando o item não tem piso próprio.
  minimum_value numeric,

  -- Faixa de redução por lance, em pontos percentuais.
  min_reduction numeric,
  max_reduction numeric,

  -- Segundos de espera antes de cobrir um lance de concorrente.
  response_time integer not null default 3,

  -- Palavras que disparam alerta quando aparecem no chat do pregoeiro. O CNPJ
  -- e a razão social do fornecedor já são procurados sem precisar estar aqui.
  termos_alerta text[] not null default '{}',

  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Os itens: o que disputar e até onde.
create table if not exists itens_robo_lance (
  id uuid primary key default gen_random_uuid(),
  robo_id text references robos_lance(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,

  numero_item integer not null,
  descricao text,
  quantidade numeric,
  unidade_medida text,
  valor_unitario_estimado numeric,
  valor_total numeric,

  participar boolean not null default false,
  valor_minimo numeric,   -- piso de margem (ver cabeçalho)
  lance_manual numeric,   -- valor exato a enviar, ignorando o cálculo
  desconto numeric,       -- redução fixa em R$ por lance
  variacao numeric,       -- redução percentual por lance

  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

  unique (robo_id, numero_item)
);

-- 3. Os lances efetivamente enviados — o histórico que o operador confere
--    depois para entender por que ganhou ou perdeu um item.
create table if not exists lances_robo (
  id uuid primary key default gen_random_uuid(),
  robo_id text references robos_lance(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  numero_item integer,
  valor numeric not null,
  origem text not null default 'robo',
  portal_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. O diário do motor. Vive junto do robô de propósito: quando um lance não
--    sai, a pergunta é sempre "o que o motor estava vendo naquele segundo", e
--    essa resposta não pode depender de a aba do navegador ainda estar aberta.
create table if not exists logs_robo_lance (
  id uuid primary key default gen_random_uuid(),
  robo_id text references robos_lance(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  nivel text not null default 'info',
  mensagem text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. O chat do pregoeiro, com a marcação de menção ao fornecedor.
create table if not exists mensagens_chat_robo (
  id uuid primary key default gen_random_uuid(),
  robo_id text references robos_lance(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  id_origem text not null,
  quem text,
  mensagem text not null,
  data_hora text,
  mencao boolean not null default false,
  termo_encontrado text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,

  -- O motor reenvia as mensagens que já viu quando a aba é recarregada; sem
  -- esta chave o chat duplicaria a cada F5 no meio da disputa.
  unique (robo_id, id_origem)
);

-- 6. As credenciais da extensão.
--
-- A sessão do navegador do app expira em uma hora e um pregão passa de três,
-- então o token da extensão não pode ser o JWT da sessão: ele morreria no meio
-- da disputa. Aqui fica um token próprio, de vida longa, revogável sozinho e
-- guardado apenas como hash — vazar esta tabela não entrega nenhuma conta.
create table if not exists tokens_robo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  nome text not null default 'Extensão do navegador',
  token_hash text not null unique,
  -- Os primeiros caracteres do token, para o operador reconhecer qual revogar.
  prefixo text not null,
  criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
  expira_em timestamp with time zone,
  ultimo_uso_em timestamp with time zone,
  revogado boolean not null default false
);

create index if not exists idx_robos_lance_user on robos_lance (user_id);
create index if not exists idx_itens_robo_lance_robo on itens_robo_lance (robo_id);
create index if not exists idx_lances_robo_robo on lances_robo (robo_id, created_at desc);
create index if not exists idx_logs_robo_lance_robo on logs_robo_lance (robo_id, created_at desc);
create index if not exists idx_mensagens_chat_robo_robo on mensagens_chat_robo (robo_id, created_at desc);
create index if not exists idx_tokens_robo_user on tokens_robo (user_id);

alter table robos_lance enable row level security;
alter table itens_robo_lance enable row level security;
alter table lances_robo enable row level security;
alter table logs_robo_lance enable row level security;
alter table mensagens_chat_robo enable row level security;
alter table tokens_robo enable row level security;

drop policy if exists "Usuários acessam apenas seus próprios robôs" on robos_lance;
create policy "Usuários acessam apenas seus próprios robôs" on robos_lance
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Usuários acessam apenas os itens dos seus robôs" on itens_robo_lance;
create policy "Usuários acessam apenas os itens dos seus robôs" on itens_robo_lance
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Usuários acessam apenas os lances dos seus robôs" on lances_robo;
create policy "Usuários acessam apenas os lances dos seus robôs" on lances_robo
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Usuários acessam apenas os logs dos seus robôs" on logs_robo_lance;
create policy "Usuários acessam apenas os logs dos seus robôs" on logs_robo_lance
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Usuários acessam apenas o chat dos seus robôs" on mensagens_chat_robo;
create policy "Usuários acessam apenas o chat dos seus robôs" on mensagens_chat_robo
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- O hash do token nunca precisa chegar ao navegador: a tela de Conectar Robô
-- lista nome, prefixo e data, e o valor em claro só existe no instante em que
-- é gerado. A política permite a leitura da linha; a rota é que escolhe as
-- colunas, e nenhuma delas é o hash.
drop policy if exists "Usuários acessam apenas seus próprios tokens" on tokens_robo;
create policy "Usuários acessam apenas seus próprios tokens" on tokens_robo
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
