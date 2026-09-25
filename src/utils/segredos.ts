import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
// Buffer é importado explicitamente, e não usado como global.
//
// No Node ele existe sem import e o arquivo funcionava. No Deno — que é onde o
// backend roda — Buffer NÃO é global, e a primeira linha a tocá-lo derrubava a
// função inteira na carga do módulo com "Buffer is not defined". O defeito
// ficou adormecido enquanto AI_KEYS_ENCRYPTION_KEY não estava configurada,
// porque derivarChaveMestra retorna antes de chegar ao Buffer; configurar a
// chave acordou ele e tirou todas as rotas do ar de uma vez.
import { Buffer } from "node:buffer";

// ═══════════════════════════════════════════════════════════════════════
// CHAVES DE IA CRIPTOGRAFADAS EM REPOUSO
//
// A tabela `configuracoes_usuario` guarda gemini_key, openai_key,
// anthropic_key e deepseek_key como texto puro. Quem tiver acesso ao banco
// — o painel do Supabase, um backup, uma service key vazada — lê a chave de
// API de todos os clientes, e cada uma dessas chaves é uma fatura aberta no
// nome de outra pessoa. RLS protege usuário contra usuário; não protege
// ninguém contra quem já está dentro do banco.
//
// Este módulo é SÓ DE SERVIDOR: usa node:crypto e nunca deve ser importado
// pelo código do navegador.
//
// Decisão importante: sem AI_KEYS_ENCRYPTION_KEY configurada, tudo aqui é
// passagem direta e o comportamento fica idêntico ao de hoje. Uma migração de
// segurança que derruba a plataforma de quem não leu o changelog não é uma
// melhoria de segurança — é um incidente. Quem define a variável passa a
// gravar cifrado; quem não define continua exatamente como estava, e o app
// avisa no /api/health que está guardando chave em texto puro.
// ═══════════════════════════════════════════════════════════════════════

const PREFIXO = "enc:v1:";
const ALGORITMO = "aes-256-gcm";

/**
 * Deriva os 32 bytes da chave mestra.
 *
 * Aceita tanto 64 caracteres hexadecimais (chave gerada com `openssl rand -hex 32`)
 * quanto uma frase qualquer — nesse caso o SHA-256 da frase vira a chave. A
 * segunda forma é mais fraca contra força bruta, mas é infinitamente melhor do
 * que o texto puro de hoje, e é a que as pessoas de fato conseguem configurar.
 */
export function derivarChaveMestra(segredo: string | undefined | null): Buffer | null {
  const bruto = String(segredo || "").trim();
  if (!bruto) return null;

  if (/^[0-9a-fA-F]{64}$/.test(bruto)) return Buffer.from(bruto, "hex");
  return createHash("sha256").update(bruto, "utf-8").digest();
}

/** Um valor já cifrado por este módulo. */
export function estaCriptografado(valor: string | undefined | null): boolean {
  return typeof valor === "string" && valor.startsWith(PREFIXO);
}

/**
 * Cifra um segredo. Sem chave mestra, devolve o valor como veio.
 *
 * AES-256-GCM é autenticado: além de esconder, detecta adulteração. Um IV
 * aleatório por gravação impede que duas chaves iguais produzam o mesmo texto
 * cifrado — sem isso dá para descobrir que dois usuários usam a mesma chave
 * sem decifrar nenhuma das duas.
 */
export function criptografarSegredo(valor: string, chaveMestra: Buffer | null): string {
  if (!chaveMestra) return valor;
  if (!valor) return valor;
  if (estaCriptografado(valor)) return valor;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITMO, chaveMestra, iv);
  const cifrado = Buffer.concat([cipher.update(valor, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIXO}${iv.toString("base64")}:${tag.toString("base64")}:${cifrado.toString("base64")}`;
}

/**
 * Decifra um segredo.
 *
 * Valor sem o prefixo é devolvido intacto: são as chaves gravadas antes desta
 * mudança, que precisam continuar funcionando enquanto não forem regravadas.
 *
 * Falha de decifragem devolve string vazia, nunca o texto cifrado. Devolver o
 * cifrado faria a plataforma mandá-lo ao provedor de IA como se fosse a chave,
 * e o usuário veria "chave inválida" em vez de "não consegui ler sua chave".
 */
export function descriptografarSegredo(valor: string, chaveMestra: Buffer | null): string {
  if (!valor || !estaCriptografado(valor)) return valor || "";
  if (!chaveMestra) {
    console.warn("[segredos] Valor cifrado no banco, mas AI_KEYS_ENCRYPTION_KEY não está configurada.");
    return "";
  }

  try {
    const partes = valor.slice(PREFIXO.length).split(":");
    if (partes.length !== 3) return "";

    const [ivB64, tagB64, cifradoB64] = partes;
    const decipher = createDecipheriv(ALGORITMO, chaveMestra, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]).toString("utf-8");
  } catch (err: any) {
    // Chave mestra trocada, ou linha adulterada. Os dois casos são o mesmo
    // para quem chama: esta chave não é utilizável.
    console.warn("[segredos] Não foi possível decifrar um segredo:", err?.message || err);
    return "";
  }
}

/**
 * Versão exibível de uma chave: só os últimos 4 caracteres.
 *
 * A tela de configuração precisa mostrar que existe uma chave salva sem
 * devolvê-la ao navegador. Chave de API é credencial: uma vez gravada, a
 * plataforma não tem motivo para entregá-la de volta a ninguém.
 */
export function mascararSegredo(valor: string | undefined | null): string {
  const bruto = String(valor || "");
  if (!bruto) return "";
  if (bruto.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, bruto.length - 4))}${bruto.slice(-4)}`;
}

/** Comparação em tempo constante, para conferir segredo sem vazar por timing. */
export function segredosIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ""), "utf-8");
  const bufB = Buffer.from(String(b || ""), "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Campos da tabela `configuracoes_usuario` que guardam credencial. */
export const CAMPOS_SECRETOS = ["gemini_key", "openai_key", "anthropic_key", "deepseek_key"] as const;

/** Cifra os campos de credencial de uma linha de configuração. */
export function criptografarConfiguracao<T extends Record<string, any>>(config: T, chaveMestra: Buffer | null): T {
  if (!chaveMestra) return config;
  const saida: Record<string, any> = { ...config };
  for (const campo of CAMPOS_SECRETOS) {
    if (typeof saida[campo] === "string" && saida[campo]) {
      saida[campo] = criptografarSegredo(saida[campo], chaveMestra);
    }
  }
  return saida as T;
}

/** Decifra os campos de credencial de uma linha vinda do banco. */
export function descriptografarConfiguracao<T extends Record<string, any>>(config: T, chaveMestra: Buffer | null): T {
  const saida: Record<string, any> = { ...config };
  for (const campo of CAMPOS_SECRETOS) {
    if (typeof saida[campo] === "string" && saida[campo]) {
      saida[campo] = descriptografarSegredo(saida[campo], chaveMestra);
    }
  }
  return saida as T;
}
