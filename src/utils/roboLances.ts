// ═══════════════════════════════════════════════════════════════════════
// ROBÔ DE LANCES — acesso aos dados
//
// Nenhum robô é criado aqui. Ele nasce quando a extensão abre a sala de
// disputa: o backend o cria a partir do código da compra lido do portal. O que
// esta tela faz é o antes e o depois — o perfil padrão que todo robô novo
// herda, e a leitura do que cada disputa produziu.
//
// Robô e itens vão direto ao Postgres pelo cliente do Supabase, sob RLS, como
// o resto do app. Perfil e tokens passam pela Edge Function: o token em claro
// só existe no instante em que é gerado, e quem o gera é o servidor.
// ═══════════════════════════════════════════════════════════════════════
import { apiFetch, readJsonResponseSafe } from "./aiClientHelper";
import { getActiveUser, getSupabaseClient } from "./supabaseClient";

/** Identificador desta instalação da plataforma, colado no popup da extensão. */
export const APP_ID_EXTENSAO = "6a28b2eedb287c0541e5e303";

export type ModoRobo = "Manual Assistido" | "Automático" | "Estratégico";
export type TipoDisputa = "global" | "por_item";

export const MODOS_ROBO: { valor: ModoRobo; rotulo: string; descricao: string }[] = [
  {
    valor: "Manual Assistido",
    rotulo: "Manual assistido",
    descricao: "Calcula e mostra o próximo lance, mas nunca envia sozinho. É você quem clica.",
  },
  {
    valor: "Automático",
    rotulo: "Automático",
    descricao: "Cobre o concorrente sozinho, respeitando o tempo de resposta e o piso de margem.",
  },
  {
    valor: "Estratégico",
    rotulo: "Estratégico",
    descricao:
      "Automático, mas varia o intervalo e a redução dentro da faixa configurada. Uma sequência de lances idênticos é a assinatura mais óbvia de robô.",
  },
];

export interface RoboLance {
  id: string;
  title: string;
  mode: ModoRobo;
  dispute_type: TipoDisputa;
  item_selection_enabled: boolean;
  status: string;
  purchase_id: string | null;
  uasg: string | null;
  numero_compra: string | null;
  numero_interno: string | null;
  portal_name: string | null;
  orgao: string | null;
  unidade_compradora: string | null;
  municipio: string | null;
  uf: string | null;
  modalidade: string | null;
  situacao: string | null;
  data_abertura: string | null;
  data_encerramento: string | null;
  link_sistema_origem: string | null;
  fornecedor_cnpj: string | null;
  initial_value: number | null;
  minimum_value: number | null;
  min_reduction: number | null;
  max_reduction: number | null;
  response_time: number;
  termos_alerta: string[];
  updated_at?: string;
}

export interface ItemRoboLance {
  id?: string;
  robo_id: string;
  numero_item: number;
  descricao: string | null;
  quantidade: number | null;
  unidade_medida: string | null;
  valor_unitario_estimado: number | null;
  valor_total: number | null;
  participar: boolean;
  valor_minimo: number | null;
  lance_manual: number | null;
  desconto: number | null;
  variacao: number | null;
}

export interface TokenRobo {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: string;
  expira_em: string | null;
  ultimo_uso_em: string | null;
  revogado: boolean;
}

/** Configuração que todo robô recém-criado herda. O piso NÃO mora aqui. */
export interface PerfilRobo {
  mode: ModoRobo;
  dispute_type: TipoDisputa;
  item_selection_enabled: boolean;
  min_reduction: number | null;
  max_reduction: number | null;
  response_time: number;
  fornecedor_cnpj: string | null;
  termos_alerta: string[];
}

export const PERFIL_PADRAO: PerfilRobo = {
  mode: "Manual Assistido",
  dispute_type: "global",
  item_selection_enabled: false,
  min_reduction: 1,
  max_reduction: 5,
  response_time: 3,
  fornecedor_cnpj: null,
  termos_alerta: [],
};

/**
 * Converte o que o operador digitou em número, ou em `null`.
 *
 * `null` e zero significam coisas diferentes aqui: um campo de piso vazio
 * significa "não configurado" e bloqueia o lance automático, enquanto zero
 * seria um piso válido até o qual o robô desceria. Por isso campo em branco
 * nunca vira zero.
 */
export function numeroOuNulo(texto: string | number | null | undefined): number | null {
  if (texto === null || texto === undefined) return null;
  const limpo = String(texto).trim().replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

async function usuarioAutenticado(): Promise<string | null> {
  const user = await getActiveUser();
  const id = user?.id;
  // O id de convidado é local e não existe em auth.users: gravar com ele
  // quebraria na chave estrangeira, com um erro que não diz "faça login".
  if (!id || id === "00000000-0000-0000-0000-000000000001") return null;
  return id;
}

export async function listarRobos(): Promise<RoboLance[]> {
  const client = getSupabaseClient();
  const userId = await usuarioAutenticado();
  if (!client || !userId) return [];

  const { data, error } = await client
    .from("robos_lance")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []) as RoboLance[];
}

export async function salvarRobo(robo: RoboLance): Promise<{ sucesso: boolean; mensagem: string }> {
  const client = getSupabaseClient();
  const userId = await usuarioAutenticado();
  if (!client) return { sucesso: false, mensagem: "Supabase não configurado." };
  if (!userId) return { sucesso: false, mensagem: "Entre na sua conta para cadastrar um robô." };
  if (!robo.id.trim()) return { sucesso: false, mensagem: "O robô precisa de um ID — é ele que você cola no popup da extensão." };
  if (!robo.title.trim()) return { sucesso: false, mensagem: "Dê um nome ao robô." };

  const { error } = await client
    .from("robos_lance")
    .upsert([{ ...robo, id: robo.id.trim(), user_id: userId, updated_at: new Date().toISOString() }], { onConflict: "id" });

  if (error) return { sucesso: false, mensagem: error.message };
  return { sucesso: true, mensagem: "Robô salvo." };
}

export async function excluirRobo(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  const userId = await usuarioAutenticado();
  if (!client || !userId) return false;
  const { error } = await client.from("robos_lance").delete().eq("id", id).eq("user_id", userId);
  return !error;
}

export async function listarItens(roboId: string): Promise<ItemRoboLance[]> {
  const client = getSupabaseClient();
  const userId = await usuarioAutenticado();
  if (!client || !userId) return [];

  const { data, error } = await client
    .from("itens_robo_lance")
    .select("*")
    .eq("robo_id", roboId)
    .eq("user_id", userId)
    .order("numero_item", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as ItemRoboLance[];
}

export async function salvarItens(roboId: string, itens: ItemRoboLance[]): Promise<{ sucesso: boolean; mensagem: string }> {
  const client = getSupabaseClient();
  const userId = await usuarioAutenticado();
  if (!client) return { sucesso: false, mensagem: "Supabase não configurado." };
  if (!userId) return { sucesso: false, mensagem: "Entre na sua conta para salvar os itens." };
  if (!itens.length) return { sucesso: true, mensagem: "Nada a salvar." };

  const linhas = itens.map((item) => ({
    robo_id: roboId,
    user_id: userId,
    numero_item: item.numero_item,
    descricao: item.descricao,
    quantidade: item.quantidade,
    unidade_medida: item.unidade_medida,
    valor_unitario_estimado: item.valor_unitario_estimado,
    valor_total: item.valor_total,
    participar: item.participar,
    valor_minimo: item.valor_minimo,
    lance_manual: item.lance_manual,
    desconto: item.desconto,
    variacao: item.variacao,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await client
    .from("itens_robo_lance")
    .upsert(linhas, { onConflict: "robo_id,numero_item" });

  if (error) return { sucesso: false, mensagem: error.message };
  return { sucesso: true, mensagem: `${linhas.length} item(ns) salvo(s).` };
}

export async function excluirItem(roboId: string, numeroItem: number): Promise<boolean> {
  const client = getSupabaseClient();
  const userId = await usuarioAutenticado();
  if (!client || !userId) return false;
  const { error } = await client
    .from("itens_robo_lance")
    .delete()
    .eq("robo_id", roboId)
    .eq("numero_item", numeroItem)
    .eq("user_id", userId);
  return !error;
}

export async function lerPerfil(): Promise<PerfilRobo> {
  const resposta = await apiFetch("/api/robos/perfil");
  const dados = await readJsonResponseSafe(resposta);
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível ler o perfil do robô.");
  return { ...PERFIL_PADRAO, ...(dados?.perfil || {}) };
}

export async function salvarPerfil(perfil: PerfilRobo): Promise<PerfilRobo> {
  const resposta = await apiFetch("/api/robos/perfil", { method: "POST", body: perfil as any });
  const dados = await readJsonResponseSafe(resposta);
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível salvar o perfil do robô.");
  return { ...PERFIL_PADRAO, ...(dados?.perfil || {}) };
}

// ─── Tokens da extensão ────────────────────────────────────────────────

export async function listarTokens(): Promise<TokenRobo[]> {
  const resposta = await apiFetch("/api/robos/tokens");
  const dados = await readJsonResponseSafe(resposta);
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível listar os tokens.");
  return dados?.tokens || [];
}

/**
 * Gera um token novo e devolve o valor em claro.
 *
 * Ele só existe nesta resposta: o banco guarda apenas o hash. Quem perder o
 * token gera outro — não há como recuperá-lo, e é essa a intenção.
 */
export async function gerarToken(nome: string, diasValidade?: number): Promise<string> {
  const resposta = await apiFetch("/api/robos/tokens", {
    method: "POST",
    body: { nome, dias_validade: diasValidade },
  });
  const dados = await readJsonResponseSafe(resposta);
  if (!resposta.ok || !dados?.token) throw new Error(dados?.error || "Não foi possível gerar o token.");
  return dados.token as string;
}

export async function revogarToken(id: string): Promise<void> {
  const resposta = await apiFetch("/api/robos/tokens/revogar", { method: "POST", body: { id } });
  const dados = await readJsonResponseSafe(resposta);
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível revogar o token.");
}
