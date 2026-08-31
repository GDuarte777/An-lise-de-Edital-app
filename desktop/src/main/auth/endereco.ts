import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Onde fica o portal — aprendido, não chutado.
 *
 * Este módulo existe por causa de um defeito que custou caro: o aplicativo inteiro
 * apontava para `sala-disputa.comprasnet.gov.br`, um endereço que **não resolve DNS**.
 * Login funcionava, e logo depois o app perguntava por disputas a um servidor que não
 * existe — daí a impressão de que "o login não dá acesso a nada".
 *
 * A correção não é trocar por outro endereço fixo. O Compras.gov.br já mudou de host
 * mais de uma vez (hoje o sistema de disputa responde em `estaleiro.serpro.gov.br`, que
 * nem parece do Compras), e um endereço fixo é uma bomba-relógio. Então:
 *
 *  - existe uma lista de SEMENTES, usada só na primeira vez;
 *  - toda vez que uma janela do aplicativo pousa numa página do portal, o endereço é
 *    APRENDIDO e guardado;
 *  - a partir daí é o endereço aprendido que manda.
 *
 * Assim, se o portal mudar de host de novo, basta o operador entrar uma vez.
 */

/**
 * Hosts que contam como "o portal".
 *
 * `estaleiro.serpro.gov.br` está aqui porque é onde o sistema de disputa realmente
 * responde — foi o que a coleta na tela real mostrou. A versão anterior testava só
 * `comprasnet|compras.gov.br$`, então não reconhecia o host de verdade e declarava
 * "não logado" mesmo com o operador logado na frente dela.
 */
export const FONTE_REGEX_HOST =
  "(^|\\\\.)((cnetmobile|.*\\\\.)?estaleiro\\\\.serpro\\\\.gov\\\\.br|comprasnet\\\\.gov\\\\.br|compras\\\\.gov\\\\.br)$";

const REGEX_HOST = new RegExp(FONTE_REGEX_HOST.replace(/\\\\/g, "\\"), "i");

/** Primeira visita apenas. Depois disso quem manda é o endereço aprendido. */
export const SEMENTES_PORTAL = [
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing",
  "https://www.gov.br/compras/pt-br/"
];

export const URL_LOGIN_SSO = "https://sso.acesso.gov.br/login?client_id=comprasnet.gov.br";

export function ehHostDoPortal(host: string): boolean {
  return REGEX_HOST.test(String(host || "").toLowerCase());
}

export function ehEnderecoDoPortal(url: string): boolean {
  try {
    return ehHostDoPortal(new URL(url).host);
  } catch {
    return false;
  }
}

/**
 * Uma tela de disputa, e não uma página qualquer do portal.
 *
 * Heurística sobre o caminho, e assumidamente uma heurística: o caminho exato da sala
 * nunca foi observado por este projeto. Ela só decide qual endereço aprendido é o
 * melhor para reabrir a sala — nunca decide lance.
 */
export function ehSalaDeDisputa(url: string): boolean {
  if (!ehEnderecoDoPortal(url)) return false;
  try {
    const u = new URL(url);
    return /disputa|sala|sessao|sessão|lance|prega|pregao/i.test(u.pathname + u.search);
  } catch {
    return false;
  }
}

export interface EnderecosAprendidos {
  /** Última página do portal onde o operador esteve. */
  portal?: string;
  /** Última página que parecia uma sala de disputa. */
  sala?: string;
  aprendidoEm?: string;
}

/**
 * Decide o que guardar. Puro de propósito: é a regra que mais vai precisar de teste
 * quando o portal mudar de endereço outra vez.
 */
export function aprenderCom(atual: EnderecosAprendidos, url: string): EnderecosAprendidos {
  if (!ehEnderecoDoPortal(url)) return atual;

  // Páginas de erro e de logout não são endereço para onde voltar.
  if (/\/(logout|sair|erro|error|404)\b/i.test(url)) return atual;

  const novo: EnderecosAprendidos = { ...atual, portal: url, aprendidoEm: new Date().toISOString() };
  if (ehSalaDeDisputa(url)) novo.sala = url;
  return novo;
}

export class RegistroEnderecos {
  private dados: EnderecosAprendidos = {};
  private carregado = false;

  constructor(private readonly caminho: string) {}

  async carregar(): Promise<void> {
    if (this.carregado) return;
    this.carregado = true;
    try {
      this.dados = JSON.parse(await readFile(this.caminho, "utf-8")) as EnderecosAprendidos;
    } catch {
      this.dados = {};
    }
  }

  /** Chamado a cada navegação de qualquer janela do portal. Barato e silencioso. */
  async aprender(url: string): Promise<void> {
    const antes = JSON.stringify(this.dados);
    this.dados = aprenderCom(this.dados, url);
    if (JSON.stringify(this.dados) === antes) return;
    try {
      await mkdir(dirname(this.caminho), { recursive: true });
      await writeFile(this.caminho, JSON.stringify(this.dados, null, 2), "utf-8");
    } catch {
      // Não conseguir guardar o endereço não pode derrubar uma disputa em andamento.
    }
  }

  get aprendidos(): EnderecosAprendidos {
    return { ...this.dados };
  }

  /** Melhor endereço para abrir o portal agora. */
  paraAbrir(): string {
    return this.dados.portal || SEMENTES_PORTAL[0];
  }

  /** Melhor endereço para reabrir uma sala de disputa. */
  paraSala(): string {
    return this.dados.sala || this.dados.portal || SEMENTES_PORTAL[0];
  }
}
