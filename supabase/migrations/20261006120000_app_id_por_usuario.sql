-- ═══════════════════════════════════════════════════════════════════════
-- APP ID POR USUÁRIO
--
-- A extensão pede duas credenciais: App ID e Token. O Token já era de cada
-- usuário; o App ID era uma constante no código, igual para todo mundo.
--
-- Isso estava errado por dois motivos. O primeiro é que a constante era o
-- identificador da plataforma de onde a extensão veio — um valor de terceiro,
-- dentro do nosso código. O segundo é que um identificador global não
-- identifica nada: com ele igual para todos, a única coisa que distinguia uma
-- conta da outra era o Token, e o App ID virava enfeite no popup.
--
-- Agora cada conta tem o seu. Ele não é segredo (viaja na URL da chamada, e
-- quem autentica continua sendo o Token), mas é conferido contra o dono do
-- Token: um par trocado não passa. É a diferença entre uma credencial e um
-- campo decorativo.
-- ═══════════════════════════════════════════════════════════════════════

alter table perfil_robo_usuario
  add column if not exists app_id text;

-- 32 hexadecimais, o mesmo formato que o operador já está acostumado a colar.
-- gen_random_uuid() é nativo do Postgres 13+, então isto não depende de
-- nenhuma extensão estar habilitada no projeto.
alter table perfil_robo_usuario
  alter column app_id set default replace(gen_random_uuid()::text, '-', '');

-- Perfis criados antes desta migração não têm App ID; sem o preenchimento,
-- esses usuários ficariam com o campo vazio no popup e sem conseguir conectar.
update perfil_robo_usuario
   set app_id = replace(gen_random_uuid()::text, '-', '')
 where app_id is null;

alter table perfil_robo_usuario
  alter column app_id set not null;

-- Um App ID aponta para no máximo uma conta. Sem isto, uma colisão (por mais
-- improvável que seja) faria a conferência App ID ↔ Token aceitar o par
-- errado — exatamente o que ela existe para impedir.
alter table perfil_robo_usuario drop constraint if exists perfil_robo_usuario_app_id_unico;
alter table perfil_robo_usuario add constraint perfil_robo_usuario_app_id_unico unique (app_id);
