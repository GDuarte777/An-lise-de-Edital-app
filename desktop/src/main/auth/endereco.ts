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
  // A base do SPA. É o ÚNICO endereço sem parâmetro que se pode afirmar que existe: o
  // diagnóstico do operador mostrou o próprio SPA respondendo "página não encontrada"
  // sob /comprasnet-web/, o que prova que a aplicação é servida a partir daí.
  //
  // As sementes anteriores (/public/landing, /seguro/fornecedor,
  // /seguro/fornecedor/compras-eletronicas) eram INVENTADAS — deduzi nomes de rota a
  // partir do título "Compras eletrônicas" que aparecia numa captura de tela. Nenhuma
  // existe: no aplicativo do operador as três caíram em "acesso não autorizado" ou
  // "página não encontrada", e foi por isso que ele viu "sem sessão" estando logado.
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/"
];

/**
 * Endpoint que o PRÓPRIO portal usa para saber quem está logado.
 *
 * Observado na coleta do operador: `GET /comprasnet-usuario/v1/usuario` → 200 com
 * sessão, e sem exigir token de captcha. Perguntar isto é infinitamente mais confiável
 * do que abrir uma página e tentar interpretar o HTML — que é onde este projeto errou
 * três vezes seguidas, sempre por causa da URL escolhida.
 */
export const URL_API_USUARIO =
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-usuario/v1/usuario";

export const SEMENTE_SALA =
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa";

/** Sala de uma compra específica, no formato que a coleta mostrou. */
export function urlDaSala(pregaoId: string): string {
  return `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa?compra=${encodeURIComponent(pregaoId)}`;
}

/**
 * Entrada de login, exatamente a que o operador pediu.
 *
 * Sem o `authorization_id` o SSO devolve para a tela "Acesse sua Conta / Selecione o
 * perfil", e o operador tem de clicar antes de chegar ao login de verdade — foi o que a
 * tela dele mostrou. Com ele, a página de CPF e senha abre direto.
 *
 * O identificador é emitido pelo portal e pode vencer. Por isso ele não é só uma
 * constante: toda vez que uma janela do login passa por um endereço do SSO com um
 * `authorization_id` novo, esse valor passa a ser o usado (ver `lembrarAutorizacaoSso`).
 */
/**
 * Identificador da entrada do SSO, APRENDIDO — nunca fixo.
 *
 * Com um `authorization_id` válido, o gov.br abre direto na tela de CPF e senha, que é o
 * que o operador quer. Sem ele, o SSO manda para a escolha de perfil, um clique a mais.
 *
 * O que não dá é embutir um valor: ele é emitido por tentativa de login e vence. Um
 * identificador vencido faz o SSO devolver página VAZIA — tela branca, sem erro. Foi
 * exatamente o que aconteceu com o valor fixo que estava aqui: em toda primeira entrada
 * o operador via branco.
 *
 * Então começa vazio. O primeiro login entra pela via genérica (que sempre responde), e
 * na volta o identificador real é aprendido e guardado: do segundo login em diante, a
 * tela de CPF e senha abre direto.
 */
let autorizacaoSso = "";

export function lembrarAutorizacaoSso(url: string): void {
  const m = /[?&]authorization_id=([\w-]{6,})/i.exec(url);
  if (m && /sso\.acesso\.gov\.br/i.test(url)) autorizacaoSso = m[1];
}

/** Sem identificador: o SSO decide o caminho e emite um novo. Sempre existe. */
export const URL_LOGIN_SEM_AUTORIZACAO = "https://sso.acesso.gov.br/login?client_id=comprasnet.gov.br";

export function urlLoginSso(): string {
  return autorizacaoSso
    ? `https://sso.acesso.gov.br/login?client_id=comprasnet.gov.br&authorization_id=${autorizacaoSso}`
    : URL_LOGIN_SEM_AUTORIZACAO;
}

/**
 * Descarta o identificador quando ele não abre nada.
 *
 * O `authorization_id` é emitido por tentativa de login e vence. Vencido, o SSO devolve
 * uma página VAZIA — tela branca, sem erro, sem nada. Insistir nele deixaria o operador
 * olhando para o branco em todo login; então ele cai fora e a entrada passa a ser a que
 * sempre funciona, que por sua vez emite um identificador novo (aprendido na volta).
 */
export function esquecerAutorizacaoSso(): void {
  autorizacaoSso = "";
}

/** Para a tela de diagnóstico: por onde o login vai entrar agora. */
export function autorizacaoSsoAtual(): string {
  return autorizacaoSso;
}

/** Mantida para quem importa a constante; o valor vivo está em `urlLoginSso()`. */
export const URL_LOGIN_SSO = "https://sso.acesso.gov.br/login?client_id=comprasnet.gov.br";

/**
 * Páginas do aplicativo novo tentadas, EM JANELA OCULTA, só para a sessão se
 * materializar em token. O operador não vê nenhuma delas.
 *
 * São candidatas porque o portal não documenta a rota de entrada e ela já mudou: a que
 * funcionar é aprendida e passa a ser a primeira da próxima vez. Levar a janela VISÍVEL
 * do operador a uma dessas foi erro meu — a que não existe desenha "Página não
 * encontrada" na cara dele.
 */
export const CANDIDATOS_APLICATIVO = [
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/compras",
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor",
  "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/"
];

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
 * Endereço que o aplicativo pode GUARDAR para abrir depois.
 *
 * É mais estreito do que "pertence ao portal" de propósito, e a diferença custou uma
 * sessão inteira do operador: o aplicativo tinha aprendido
 * `comprasnet.gov.br/popup/popup.asp?ambiente=3` — uma página do sistema ANTIGO, que
 * não é onde a disputa acontece — e passou a reabrir essa janela sozinho. O mesmo vale
 * para `intro.htm`.
 *
 * Só o aplicativo novo (o SPA em `/comprasnet-web/`) é endereço para onde voltar.
 */
export function ehEnderecoNavegavel(url: string): boolean {
  if (!ehEnderecoDoPortal(url)) return false;
  try {
    const u = new URL(url);
    if (!/estaleiro\.serpro\.gov\.br$/i.test(u.host)) return false;
    if (!u.pathname.startsWith("/comprasnet-web/")) return false;
    // Páginas do sistema antigo que o portal ainda serve, e que não levam a lugar nenhum.
    if (/popup\.asp|intro\.htm|\.asp$/i.test(u.pathname)) return false;
    return true;
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
  /**
   * Identificador da entrada do SSO. Guardado em disco porque ele vence: se o aplicativo
   * esquecesse a cada reinício, o operador veria a tela branca do identificador morto
   * uma vez por sessão, para sempre. Vazio quer dizer "entra pela via genérica".
   */
  autorizacaoSso?: string;
  /** Última página que parecia uma sala de disputa. */
  sala?: string;
  aprendidoEm?: string;
}

/**
 * Decide o que guardar. Puro de propósito: é a regra que mais vai precisar de teste
 * quando o portal mudar de endereço outra vez.
 */
export function aprenderCom(atual: EnderecosAprendidos, url: string): EnderecosAprendidos {
  if (!ehEnderecoNavegavel(url)) return atual;

  // Páginas de erro e de logout não são endereço para onde voltar. As duas primeiras
  // vieram do diagnóstico do operador: o portal manda para elas quando a rota não existe
  // ou a sessão não vale ali, e guardá-las fazia o aplicativo tentar de novo o endereço
  // que já tinha falhado.
  if (/acesso-nao-autorizado|pagina-nao-encontrada/i.test(url)) return atual;
  if (/\/(logout|sair|erro|error|404)\b/i.test(url)) return atual;

  // `?compra=` sem valor não abre nada — foi exatamente o endereço aprendido que o
  // diagnóstico mostrou, e ele caía em "acesso não autorizado".
  try {
    for (const [, v] of new URL(url).searchParams) if (v === "") return atual;
  } catch {
    return atual;
  }

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
      if (typeof this.dados.autorizacaoSso === "string") {
        if (this.dados.autorizacaoSso) {
          lembrarAutorizacaoSso(
            `https://sso.acesso.gov.br/login?authorization_id=${this.dados.autorizacaoSso}`
          );
        } else {
          esquecerAutorizacaoSso();
        }
      }
    } catch {
      this.dados = {};
    }

    // O que já está no disco também passa pela regra. A máquina do operador tinha
    // `/seguro/fornecedor/compras?compra=` guardado — endereço que só levava a "acesso
    // não autorizado" — e sem esta limpeza a correção do aprendizado não o alcançaria:
    // ele seguiria sendo tentado a cada verificação, para sempre.
    this.dados = {
      ...this.dados,
      portal: this.dados.portal && aprenderCom({}, this.dados.portal).portal ? this.dados.portal : undefined,
      sala: this.dados.sala && aprenderCom({}, this.dados.sala).portal ? this.dados.sala : undefined
    };
  }

  /** Chamado a cada navegação de qualquer janela do portal. Barato e silencioso. */
  async aprender(url: string): Promise<void> {
    const antes = JSON.stringify(this.dados);

    // Identificador do SSO: vem de um host que não é o do portal, então não passa por
    // `aprenderCom` — mas é o que faz o próximo login abrir direto na tela de senha.
    const novaAutorizacao = /sso\.acesso\.gov\.br/i.test(url)
      ? (/[?&]authorization_id=([\w-]{6,})/i.exec(url) ?? [])[1]
      : undefined;
    if (novaAutorizacao) {
      this.dados = { ...this.dados, autorizacaoSso: novaAutorizacao };
      lembrarAutorizacaoSso(url);
    }

    this.dados = aprenderCom(this.dados, url);
    if (JSON.stringify(this.dados) === antes) return;
    try {
      await mkdir(dirname(this.caminho), { recursive: true });
      await writeFile(this.caminho, JSON.stringify(this.dados, null, 2), "utf-8");
    } catch {
      // Não conseguir guardar o endereço não pode derrubar uma disputa em andamento.
    }
  }

  /** O identificador morreu (tela branca): não volta a ser tentado, nem após reiniciar. */
  async esquecerAutorizacao(): Promise<void> {
    esquecerAutorizacaoSso();
    if (this.dados.autorizacaoSso === "") return;
    this.dados = { ...this.dados, autorizacaoSso: "" };
    await this.persistir();
  }

  private async persistir(): Promise<void> {
    try {
      await mkdir(dirname(this.caminho), { recursive: true });
      await writeFile(this.caminho, JSON.stringify(this.dados, null, 2), "utf-8");
    } catch {
      // Não conseguir guardar não pode derrubar uma disputa em andamento.
    }
  }

  get aprendidos(): EnderecosAprendidos {
    return { ...this.dados };
  }

  /** Melhor endereço para abrir o portal agora. */
  /**
   * Endereço para ABRIR numa janela que o operador vê.
   *
   * Sem nada aprendido, vai para a primeira rota candidata do aplicativo e não para a
   * base do SPA: a base responde 404, e 404 na cara de quem acabou de entrar foi
   * exatamente a reclamação. A base continua servindo para sondagem em janela oculta.
   */
  paraAbrir(): string {
    return this.dados.portal && ehEnderecoNavegavel(this.dados.portal)
      ? this.dados.portal
      : CANDIDATOS_APLICATIVO[0];
  }

  /**
   * Endereços a tentar ao perguntar "existe sessão?", em ordem.
   *
   * Mais de um de propósito: uma única página pode não abrir por motivo que nada tem a
   * ver com sessão (rota mudou, exige parâmetro, portal fora do ar naquele caminho), e
   * concluir "sem sessão" a partir disso é o erro que o operador viu na tela.
   */
  paraVerificar(): string[] {
    // Validado na LEITURA, não só na escrita: endereço guardado por uma versão anterior
    // (com regra mais frouxa) não pode continuar sendo aberto depois que a regra apertou.
    const guardado = this.dados.portal && ehEnderecoNavegavel(this.dados.portal) ? [this.dados.portal] : [];
    return [...new Set([...guardado, ...SEMENTES_PORTAL])];
  }

  /** Melhor endereço para reabrir uma sala de disputa. */
  paraSala(): string {
    return this.dados.sala && ehEnderecoNavegavel(this.dados.sala) ? this.dados.sala : SEMENTE_SALA;
  }
}
