// ═══════════════════════════════════════════════════════════════════════
// ASSISTENTE DE LANCES — o backend do robô
//
// A extensão do navegador opera a sala de disputa, mas não decide nada: ela lê
// o portal, pergunta aqui o que fazer e executa a resposta. Esta separação não
// é organização de código — é a condição para a decisão ser auditável. O que
// roda na máquina do operador pode ser lido e alterado por qualquer um com
// acesso ao navegador; o piso de margem precisa estar fora dali.
//
// A rota mantém o formato de caminho que a extensão já chamava:
//
//   POST /api/apps/<appId>/functions/bidAssistant
//
// Isso é deliberado. Significa que trocar de backend é trocar um host no
// popup, e não reempacotar a extensão instalada em cada máquina — uma troca
// que, no meio de uma temporada de pregões, ninguém consegue coordenar.
//
// Um único endpoint atende sete operações, distinguidas pelas chaves do corpo.
// Também é herança do formato anterior, e também vale a pena manter: o motor
// fala com o backend dezenas de vezes por minuto durante a disputa, e uma
// única rota é uma única superfície para autenticar, limitar e registrar.
// ═══════════════════════════════════════════════════════════════════════
import process from "node:process";
import type { AplicativoExpresso, Requisicao, Resposta } from "./expresso.ts";
import { getUserIdFromJwt } from "./nucleo.ts";
import {
  autorizarLance,
  decidirLance,
  type ConfiguracaoRobo,
  type ItemRobo,
} from "./estrategiaLance.ts";

/** Prefixo dos tokens de extensão. Serve para distingui-los de um JWT. */
const PREFIXO_TOKEN = "hzr_";

/**
 * App ID exigido, quando configurado.
 *
 * Vazio significa "aceita qualquer um": o App ID identifica a instalação da
 * plataforma, não o usuário, e quem autentica é o token. Definir a variável
 * fecha a porta de quem aponta uma extensão de outra instalação para cá.
 */
const APP_ID_ESPERADO = String(process.env.HORASIS_APP_ID || "").trim();

function urlSupabase(): string {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
}

function chaveServico(): string {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
}

// ─── Acesso ao banco ───────────────────────────────────────────────────
//
// As consultas do robô usam a chave de serviço, que ignora RLS. Não é
// preferência: o token da extensão não é um JWT do Supabase, então não há
// sessão para o Postgres aplicar a política em cima.
//
// A contrapartida é que o isolamento entre usuários passa a ser
// responsabilidade deste arquivo. Por isso toda leitura e toda escrita passam
// por `consultar` e `gravar` com `user_id` explícito, e não existe aqui
// nenhuma consulta montada à mão: um filtro esquecido seria um robô lendo a
// configuração de outro cliente.

interface Falha {
  status: number;
  erro: string;
}

function configurado(): Falha | null {
  if (!urlSupabase() || !chaveServico()) {
    return { status: 503, erro: "Banco de dados não configurado neste servidor (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." };
  }
  return null;
}

function cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: chaveServico(),
    Authorization: `Bearer ${chaveServico()}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function consultar(tabela: string, filtros: Record<string, string>, extras = ""): Promise<any[]> {
  const query = Object.entries(filtros)
    .map(([coluna, valor]) => `${encodeURIComponent(coluna)}=${encodeURIComponent(valor)}`)
    .join("&");
  const resp = await fetch(`${urlSupabase()}/rest/v1/${tabela}?${query}${extras}`, { headers: cabecalhos() });
  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => "");
    throw new Error(`Leitura de ${tabela} falhou (HTTP ${resp.status}): ${detalhe.slice(0, 200)}`);
  }
  return await resp.json();
}

async function gravar(tabela: string, linhas: any[], prefer = "return=minimal"): Promise<void> {
  if (!linhas.length) return;
  const resp = await fetch(`${urlSupabase()}/rest/v1/${tabela}`, {
    method: "POST",
    headers: cabecalhos({ Prefer: prefer }),
    body: JSON.stringify(linhas),
  });
  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => "");
    throw new Error(`Gravação em ${tabela} falhou (HTTP ${resp.status}): ${detalhe.slice(0, 200)}`);
  }
}

async function atualizar(tabela: string, filtros: Record<string, string>, valores: any): Promise<void> {
  const query = Object.entries(filtros)
    .map(([coluna, valor]) => `${encodeURIComponent(coluna)}=${encodeURIComponent(valor)}`)
    .join("&");
  const resp = await fetch(`${urlSupabase()}/rest/v1/${tabela}?${query}`, {
    method: "PATCH",
    headers: cabecalhos({ Prefer: "return=minimal" }),
    body: JSON.stringify(valores),
  });
  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => "");
    throw new Error(`Atualização de ${tabela} falhou (HTTP ${resp.status}): ${detalhe.slice(0, 200)}`);
  }
}

// ─── Autenticação ──────────────────────────────────────────────────────

async function sha256Hex(texto: string): Promise<string> {
  const dados = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", dados);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolve o dono da requisição.
 *
 * Dois tipos de credencial chegam aqui. A extensão manda um token próprio, de
 * vida longa, porque a sessão do app expira em uma hora e um pregão passa de
 * três — um token que morre no meio da disputa é um robô que para sozinho
 * justamente quando mais importa. O app manda o JWT da sessão, que já existe.
 */
async function donoDaRequisicao(req: Requisicao): Promise<string | null> {
  const cabecalho = String(req.headers.authorization || "");
  if (!cabecalho.startsWith("Bearer ")) return null;
  const token = cabecalho.slice(7).trim();
  if (!token) return null;

  if (!token.startsWith(PREFIXO_TOKEN)) return getUserIdFromJwt(token);

  const hash = await sha256Hex(token);
  const linhas = await consultar("tokens_robo", {
    select: "id,user_id,expira_em,revogado",
    token_hash: `eq.${hash}`,
    revogado: "is.false",
    limit: "1",
  });
  const registro = linhas[0];
  if (!registro) return null;
  if (registro.expira_em && Date.parse(registro.expira_em) < Date.now()) return null;

  // Carimba o uso sem segurar a resposta: a disputa não espera por telemetria.
  atualizar("tokens_robo", { id: `eq.${registro.id}` }, { ultimo_uso_em: new Date().toISOString() }).catch(() => {});
  return registro.user_id;
}

// ─── Leitura do robô ───────────────────────────────────────────────────

const COLUNAS_ROBO = [
  "id", "title", "mode", "dispute_type", "item_selection_enabled", "status",
  "purchase_id", "uasg", "numero_compra", "numero_interno", "portal_name",
  "orgao", "unidade_compradora", "municipio", "uf", "modalidade", "situacao",
  "data_abertura", "data_encerramento", "link_sistema_origem", "fornecedor_cnpj",
  "initial_value", "minimum_value", "min_reduction", "max_reduction",
  "response_time", "termos_alerta",
].join(",");

const COLUNAS_ITEM = [
  "numero_item", "descricao", "quantidade", "unidade_medida",
  "valor_unitario_estimado", "valor_total", "participar",
  "valor_minimo", "lance_manual", "desconto", "variacao",
].join(",");

async function carregarRobo(userId: string, botId: string): Promise<any | null> {
  const linhas = await consultar("robos_lance", {
    select: COLUNAS_ROBO,
    id: `eq.${botId}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  return linhas[0] || null;
}

async function carregarItens(userId: string, botId: string): Promise<any[]> {
  return await consultar(
    "itens_robo_lance",
    { select: COLUNAS_ITEM, robo_id: `eq.${botId}`, user_id: `eq.${userId}` },
    "&order=numero_item.asc",
  );
}

function acharItem(itens: any[], numeroItem: unknown): ItemRobo | null {
  const numero = Number(numeroItem);
  if (!Number.isFinite(numero)) return null;
  return itens.find((it) => Number(it.numero_item) === numero) || null;
}

// ─── Registro de eventos ───────────────────────────────────────────────

const NIVEIS = new Set(["info", "warn", "error", "success"]);

async function registrarLog(userId: string, botId: string, nivel: string, mensagem: string): Promise<void> {
  const texto = String(mensagem || "").slice(0, 2000);
  if (!texto) return;
  await gravar("logs_robo_lance", [{
    robo_id: botId,
    user_id: userId,
    nivel: NIVEIS.has(nivel) ? nivel : "info",
    mensagem: texto,
  }]);
}

/**
 * Palavras que fazem uma mensagem do chat virar alerta.
 *
 * O CNPJ entra sem e com máscara porque o pregoeiro digita das duas formas, e
 * perder uma menção por causa de um ponto é perder o aviso de que a empresa
 * foi chamada a responder algo — o tipo de coisa que desclassifica.
 */
function termosDeAlerta(robo: any): string[] {
  const termos: string[] = [];
  const cnpj = String(robo.fornecedor_cnpj || "").replace(/\D/g, "");
  if (cnpj.length === 14) {
    termos.push(cnpj);
    termos.push(`${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`);
  }
  for (const termo of robo.termos_alerta || []) {
    const limpo = String(termo || "").trim();
    if (limpo.length >= 3) termos.push(limpo);
  }
  return termos;
}

function procurarMencao(texto: string, termos: string[]): string | null {
  const alvo = texto.toLowerCase();
  // Compara também o texto sem pontuação, para o CNPJ mascarado casar com o
  // termo sem máscara e vice-versa.
  const alvoSemPontuacao = alvo.replace(/[^\w\s]/g, "");
  for (const termo of termos) {
    const t = termo.toLowerCase();
    if (alvo.includes(t) || alvoSemPontuacao.includes(t.replace(/[^\w\s]/g, ""))) return termo;
  }
  return null;
}

// ─── A rota ────────────────────────────────────────────────────────────

export function registrarRotasRoboLances(app: AplicativoExpresso): void {
  app.post("/api/apps/:appId/functions/bidAssistant", async (req, res): Promise<any> => {
    try {
      const indisponivel = configurado();
      if (indisponivel) return res.status(indisponivel.status).json({ error: indisponivel.erro });

      if (APP_ID_ESPERADO && req.params.appId !== APP_ID_ESPERADO) {
        return res.status(404).json({ error: "App ID desconhecido." });
      }

      const userId = await donoDaRequisicao(req);
      if (!userId) {
        return res.status(401).json({
          error: "Token inválido ou expirado — gere um novo na página Conectar Robô e cole no popup da extensão.",
        });
      }

      const corpo = req.body || {};
      const botId = String(corpo.bot_id || "").trim();
      if (!botId) return res.status(400).json({ error: "bot_id é obrigatório." });

      const robo = await carregarRobo(userId, botId);
      if (!robo) {
        // 404 e não 403: dizer "existe, mas não é seu" já conta algo sobre a
        // conta alheia a quem tentou um ID qualquer.
        return res.status(404).json({ error: "Robô não encontrado nesta conta — confira o ID do robô na página Conectar Robô." });
      }

      const config: ConfiguracaoRobo = robo;

      // ── 1. Autorização de um valor já escolhido, no instante do envio ──
      if (corpo.authorize_item_bid === true) {
        const itens = await carregarItens(userId, botId);
        const veredito = autorizarLance(config, acharItem(itens, corpo.item_id), corpo.bid_value);
        if (!veredito.allowed) {
          await registrarLog(userId, botId, "warn", `Lance bloqueado no item ${corpo.item_id}: ${veredito.message}`);
        }
        return res.json({ allowed: veredito.allowed, message: veredito.message });
      }

      // ── 2. Configuração completa do robô ──
      if (corpo.fetch_details === true) {
        const itens = await carregarItens(userId, botId);
        return res.json({
          bot_config: robo,
          items: itens,
          // A identificação da licitação sai do próprio robô: é o que o
          // operador conferiu ao cadastrá-lo. A importação automática dos
          // itens do edital ainda não existe aqui — por isso `items` vem
          // vazio e o motor bloqueia o lance automático, em vez de disputar
          // um item que ninguém configurou.
          licitation_details: {
            organ: robo.orgao,
            unidade_compradora: robo.unidade_compradora,
            municipio: robo.municipio,
            uf: robo.uf,
            modalidade: robo.modalidade,
            situacao: robo.situacao,
            numero_interno: robo.numero_interno,
            data_abertura: robo.data_abertura,
            data_encerramento: robo.data_encerramento,
            total_value: robo.initial_value,
            items: [],
          },
        });
      }

      // ── 3. Edição da configuração de um item, feita na tabela do painel ──
      if (corpo.item_update && typeof corpo.item_update === "object") {
        const numeroItem = Number(corpo.item_id);
        if (!Number.isFinite(numeroItem)) return res.status(400).json({ error: "item_id inválido." });

        // Lista fechada: um campo inesperado no corpo não vira coluna gravada.
        const permitidos = ["participar", "valor_minimo", "lance_manual", "desconto", "variacao"];
        const valores: Record<string, any> = { updated_at: new Date().toISOString() };
        for (const campo of permitidos) {
          if (corpo.item_update[campo] !== undefined) valores[campo] = corpo.item_update[campo];
        }
        if (Object.keys(valores).length === 1) {
          return res.status(400).json({ error: "Nenhum campo editável no item_update." });
        }

        await gravar(
          "itens_robo_lance",
          [{ robo_id: botId, user_id: userId, numero_item: numeroItem, ...valores }],
          "resolution=merge-duplicates,return=minimal",
        );
        return res.json({ ok: true });
      }

      // ── 4. Linha de log vinda do motor ──
      if (corpo.log_message && typeof corpo.log_message === "object") {
        await registrarLog(userId, botId, corpo.log_message.level, corpo.log_message.message);
        return res.json({ ok: true });
      }

      // ── 5. Mensagens do chat do pregoeiro ──
      if (Array.isArray(corpo.chat_messages)) {
        const termos = termosDeAlerta(robo);
        const mentions: any[] = [];
        const linhas = corpo.chat_messages
          .filter((m: any) => m && typeof m === "object" && m.mensagem)
          .slice(0, 200)
          .map((m: any) => {
            const mensagem = String(m.mensagem).slice(0, 4000);
            const termo = procurarMencao(mensagem, termos);
            if (termo) mentions.push({ mensagem, termo_encontrado: termo, quem: m.quem, data_hora: m.data_hora });
            return {
              robo_id: botId,
              user_id: userId,
              id_origem: String(m.id || "").slice(0, 120) || `s${Date.now()}${mentions.length}`,
              quem: String(m.quem || "").slice(0, 200),
              mensagem,
              data_hora: String(m.data_hora || "").slice(0, 60),
              mencao: Boolean(termo),
              termo_encontrado: termo,
            };
          });

        // `merge-duplicates` sobre (robo_id, id_origem): o motor reenvia o que
        // já viu quando a aba é recarregada, e sem isso o chat duplicaria a
        // cada F5 no meio da disputa.
        await gravar("mensagens_chat_robo", linhas, "resolution=merge-duplicates,return=minimal");
        return res.json({ ok: true, mentions });
      }

      // ── 6. Ciclo de vida e confirmação de lance enviado ──
      if (corpo.action) {
        const acao = String(corpo.action);
        if (acao === "start" || acao === "pause") {
          await atualizar("robos_lance", { id: `eq.${botId}`, user_id: `eq.${userId}` }, {
            status: acao === "start" ? "em_disputa" : "pausado",
            updated_at: new Date().toISOString(),
          });
          await registrarLog(userId, botId, "info", acao === "start" ? "Motor iniciado pelo operador." : "Motor pausado.");
          return res.json({ ok: true, status: acao === "start" ? "em_disputa" : "pausado" });
        }

        if (acao === "bid_sent") {
          const valor = Number(corpo.current_lowest_bid);
          if (Number.isFinite(valor) && valor > 0) {
            const numeroItem = Number(corpo.item_id);
            await gravar("lances_robo", [{
              robo_id: botId,
              user_id: userId,
              numero_item: Number.isFinite(numeroItem) ? numeroItem : null,
              valor,
              origem: "robo",
              portal_url: String(corpo.portal_url || "").slice(0, 500),
            }]);
          }
          return res.json({ ok: true });
        }

        return res.status(400).json({ error: `Ação desconhecida: ${acao}` });
      }

      // ── 7. A pergunta central: qual é o próximo lance? ──
      const itens = await carregarItens(userId, botId);
      const item = acharItem(itens, corpo.item_id);
      const decisao = decidirLance({
        config,
        item,
        melhorLance: corpo.current_lowest_bid,
        meuLance: corpo.meu_lance,
      });

      return res.json(decisao);
    } catch (erro: any) {
      console.error("[bidAssistant] Falha:", erro?.message || erro);
      return res.status(500).json({ error: `Erro no assistente de lances: ${erro?.message || "desconhecido"}` });
    }
  });

  registrarRotasTokens(app);
}

// ─── Tokens da extensão ────────────────────────────────────────────────
//
// Autenticadas pelo JWT da sessão do app: é a página Conectar Robô que as usa.
// Um token de extensão não pode gerar outro token — se um vazasse, a conta
// ainda seria revogável de um lugar só.

async function usuarioDaSessao(req: Requisicao, res: Resposta): Promise<string | null> {
  const cabecalho = String(req.headers.authorization || "");
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  const userId = token && !token.startsWith(PREFIXO_TOKEN) ? getUserIdFromJwt(token) : null;
  if (!userId) {
    res.status(401).json({ error: "Faça login para gerenciar os tokens do robô." });
    return null;
  }
  return userId;
}

function registrarRotasTokens(app: AplicativoExpresso): void {
  app.get("/api/robos/tokens", async (req, res): Promise<any> => {
    const indisponivel = configurado();
    if (indisponivel) return res.status(indisponivel.status).json({ error: indisponivel.erro });
    const userId = await usuarioDaSessao(req, res);
    if (!userId) return;

    try {
      // O hash fica de fora da projeção: ele nunca precisa sair do banco.
      const linhas = await consultar(
        "tokens_robo",
        { select: "id,nome,prefixo,criado_em,expira_em,ultimo_uso_em,revogado", user_id: `eq.${userId}` },
        "&order=criado_em.desc",
      );
      return res.json({ tokens: linhas });
    } catch (erro: any) {
      console.error("[tokens-robo] Falha ao listar:", erro?.message || erro);
      return res.status(500).json({ error: "Não foi possível listar os tokens." });
    }
  });

  app.post("/api/robos/tokens", async (req, res): Promise<any> => {
    const indisponivel = configurado();
    if (indisponivel) return res.status(indisponivel.status).json({ error: indisponivel.erro });
    const userId = await usuarioDaSessao(req, res);
    if (!userId) return;

    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const segredo = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const token = PREFIXO_TOKEN + segredo;

      const dias = Number(req.body?.dias_validade);
      const expiraEm = Number.isFinite(dias) && dias > 0
        ? new Date(Date.now() + dias * 86_400_000).toISOString()
        : null;

      await gravar("tokens_robo", [{
        user_id: userId,
        nome: String(req.body?.nome || "Extensão do navegador").slice(0, 120),
        token_hash: await sha256Hex(token),
        prefixo: token.slice(0, 12),
        expira_em: expiraEm,
      }]);

      // O valor em claro existe só nesta resposta: o banco guarda o hash, e
      // quem perder o token gera outro em vez de recuperar este.
      return res.json({ token, prefixo: token.slice(0, 12), expira_em: expiraEm });
    } catch (erro: any) {
      console.error("[tokens-robo] Falha ao gerar:", erro?.message || erro);
      return res.status(500).json({ error: "Não foi possível gerar o token." });
    }
  });

  app.post("/api/robos/tokens/revogar", async (req, res): Promise<any> => {
    const indisponivel = configurado();
    if (indisponivel) return res.status(indisponivel.status).json({ error: indisponivel.erro });
    const userId = await usuarioDaSessao(req, res);
    if (!userId) return;

    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Informe o id do token a revogar." });

    try {
      await atualizar("tokens_robo", { id: `eq.${id}`, user_id: `eq.${userId}` }, { revogado: true });
      return res.json({ ok: true });
    } catch (erro: any) {
      console.error("[tokens-robo] Falha ao revogar:", erro?.message || erro);
      return res.status(500).json({ error: "Não foi possível revogar o token." });
    }
  });
}
