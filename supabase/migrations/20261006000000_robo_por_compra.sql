-- ═══════════════════════════════════════════════════════════════════════
-- O ROBÔ PASSA A NASCER DA SALA DE DISPUTA
--
-- Antes, disputar exigia cadastrar um robô antes do pregão, amarrado a uma
-- licitação escolhida na plataforma. Era um passo que só podia ser feito com
-- antecedência — e um pregão que aparece de manhã para disputar à tarde não
-- tem essa antecedência. Quem esquecia chegava na sala sem robô.
--
-- Agora a extensão abre a sala, lê o código da compra da própria URL e o
-- backend cria (ou recupera) o robô daquela compra sozinho. O que o operador
-- configura é o piso de margem, item a item, na tabela do painel — e enquanto
-- um item não tiver piso, ele é monitorado mas não recebe lance automático.
-- ═══════════════════════════════════════════════════════════════════════

-- O id deixa de ser digitado por alguém: quem o gera é o banco.
alter table robos_lance alter column id set default gen_random_uuid()::text;

-- Um robô por compra, por conta. É esta restrição que torna a criação
-- automática segura: duas abas da mesma compra, ou duas chamadas simultâneas
-- do mesmo motor, convergem para a mesma linha em vez de criarem robôs
-- paralelos disputando entre si.
--
-- purchase_id nulo não entra na conta (no Postgres, nulos são distintos entre
-- si em índice único), o que preserva os robôs cadastrados à mão.
alter table robos_lance drop constraint if exists robos_lance_user_compra_unico;
alter table robos_lance add constraint robos_lance_user_compra_unico unique (user_id, purchase_id);

-- Perfil padrão da conta.
--
-- É daqui que sai a configuração de um robô recém-criado. Sem isto, cada
-- compra nasceria com os mesmos valores de fábrica e o operador reconfiguraria
-- modo e faixa de redução a cada pregão — justamente o trabalho repetido que a
-- criação automática existe para eliminar.
--
-- O piso NÃO mora aqui, e é deliberado: piso é por item, e um piso global
-- herdado sem querer é a forma mais silenciosa de dar lance abaixo do custo.
create table if not exists perfil_robo_usuario (
  user_id uuid primary key references auth.users(id) on delete cascade,

  mode text not null default 'Manual Assistido',
  dispute_type text not null default 'global',
  item_selection_enabled boolean not null default false,

  min_reduction numeric not null default 1,
  max_reduction numeric not null default 5,
  response_time integer not null default 3,

  fornecedor_cnpj text,
  termos_alerta text[] not null default '{}',

  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table perfil_robo_usuario enable row level security;

drop policy if exists "Usuários acessam apenas seu próprio perfil de robô" on perfil_robo_usuario;
create policy "Usuários acessam apenas seu próprio perfil de robô" on perfil_robo_usuario
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
