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

/**
 * Primeira visita apenas. Depois disso quem manda é o endereço aprendido.
 *
 * Os dois primeiros vieram de uma coleta feita pelo operador DENTRO de uma disputa em
 * fase de lances — não são chute. A sala é
 * `/comprasnet-web/seguro/fornecedor/disputa?compra=<n>`, e depois de encerrada o portal
 * leva para `/acompanhamento-compra?compra=<n>`.
 */
export const SEMENTES_PORTAL = [
  // Área logada do fornecedor: abre para quem tem sessão e não exige parâmetro nenhum.
  // É a melhor página para PERGUNTAR se há sessão.
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/compras-eletronicas",
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor",
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing"
];

/**
 * A sala de disputa exige `?compra=<n>`; sem isso ela não renderiza nada de útil.
 *
 * Por um tempo ela foi a PRIMEIRA semente, e como é dela que saía o endereço de
 * verificação, o aplicativo perguntava "tem sessão?" para uma tela que nunca responde —
 * e concluía "o portal abriu, mas sem sinal de usuário autenticado" com o operador
 * logado. Ela agora vive à parte, e só o `paraSala()` a usa.
 */
export const SEMENTE_SALA =
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa";

/** Sala de uma compra específica, no formato que a coleta mostrou. */
export function urlDaSala(pregaoId: string): string {
  return `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa?compra=${encodeURIComponent(pregaoId)}`;
}

export const URL_LOGIN_SSO = "https://sso.acesso.gov.br/login?client_id=comprasnet.gov.br";

/**
 * Domínios onde procurar cookie de sessão.
 *
 * `estaleiro.serpro.gov.br` estava FALTANDO, e essa ausência sozinha fazia o aplicativo
 * dizer "Nenhum cookie do portal — ninguém entrou nesta máquina ainda" com o operador
 * logado na tela ao lado: é nesse domínio que o Compras.gov.br guarda a sessão de
 * verdade, e a contagem dava zero.
 *
 * O `gov.br` genérico continua de fora de propósito: só de visitar o portal já nascem
 * cookies de consentimento e analytics, e contá-los faria o aplicativo se declarar
 * conectado sem ninguém ter entrado.
 */
export const DOMINIOS_COOKIE = [
  "comprasnet.gov.br",
  "compras.gov.br",
  "estaleiro.serpro.gov.br"
];

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
    // "acompanhamento-compra" é para onde o portal leva DEPOIS de a disputa encerrar:
    // não é sala de lances, e voltar para lá não devolve o robô à disputa.
    if (/acompanhamento/i.test(u.pathname)) return false;
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

  /**
   * Endereços a tentar ao perguntar "existe sessão?", em ordem.
   *
   * Mais de um de propósito: uma única página pode não abrir por motivo que nada tem a
   * ver com sessão (rota mudou, exige parâmetro, portal fora do ar naquele caminho), e
   * concluir "sem sessão" a partir disso é o erro que o operador viu na tela.
   */
  paraVerificar(): string[] {
    const lista = this.dados.portal ? [this.dados.portal, ...SEMENTES_PORTAL] : [...SEMENTES_PORTAL];
    return [...new Set(lista)];
  }

  /** Melhor endereço para reabrir uma sala de disputa. */
  paraSala(): string {
    return this.dados.sala || SEMENTE_SALA;
  }
}
