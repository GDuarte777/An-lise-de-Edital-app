import { app, BrowserWindow, dialog, session, type Session } from "electron";

/**
 * Login no Compras.gov.br.
 *
 * O aplicativo NÃO pede, não lê e não armazena a senha do gov.br. Ele abre a página
 * oficial de login numa janela Chromium real e sai da frente: o operador autentica
 * direto com o governo, do jeito que a conta dele exigir — senha, 2FA, certificado A1
 * ou token A3.
 *
 * Duas consequências práticas:
 *  - certificado A3 funciona, porque quem faz o handshake TLS é o Chromium e a chave
 *    privada nunca sai do token;
 *  - a sessão resultante fica na partition persistente do app; os cookies são anexados
 *    pelo próprio navegador nas chamadas do robô, sem cópia nem transporte.
 *
 * Se algum dia este arquivo passar a ler campos de formulário, o desenho foi quebrado.
 */

const PARTITION = "persist:comprasnet";

/**
 * Entrada de login do SSO gov.br para o Compras.gov.br.
 *
 * O `authorization_id` que aparece na barra do navegador é emitido por tentativa de
 * login, então fixá-lo aqui daria uma URL vencida. Pedimos o login sem ele e deixamos o
 * SSO emitir o seu; se por qualquer motivo essa página não abrir, caímos na sala de
 * disputa, que redireciona para o mesmo login com os parâmetros corretos.
 */
const URL_LOGIN = "https://sso.acesso.gov.br/login?client_id=comprasnet.gov.br";
const URL_LOGIN_ALTERNATIVA = "https://sala-disputa.comprasnet.gov.br/";

const URL_SALA_DISPUTA = "https://sala-disputa.comprasnet.gov.br/";

/**
 * Domínios onde procuramos sessão. O `gov.br` genérico ficou de fora de propósito:
 * só de visitar o portal já são criados cookies de consentimento e analytics, e contá-los
 * fazia o aplicativo se declarar conectado sem ninguém ter entrado na conta.
 */
const DOMINIOS_SESSAO = ["comprasnet.gov.br", "compras.gov.br"];

/** Nomes que caracterizam um cookie de sessão autenticada, e não de preferência. */
const COOKIE_DE_SESSAO = /sess|token|auth|jwt|jsession|sso|acesso|logged|usuario/i;

/** Cookies conhecidos por existirem sem login — nunca contam como autenticação. */
const COOKIE_IGNORADO = /cookie|consent|lgpd|banner|_ga|_gid|analytics|gtm|utm|theme|idioma|accessib/i;

/**
 * User-Agent do Chromium sem o sufixo "Electron/x.y.z".
 *
 * Isto não é disfarce: o processo É um Chromium, do mesmo motor que o Chrome usa. O
 * sufixo do Electron faz portais de governo tratarem a sessão como cliente
 * desconhecido e recusarem o login. Declarar o motor que de fato renderiza a página é
 * diferente de forjar um navegador a partir de um servidor, que era o que a versão
 * antiga deste projeto fazia.
 */
const USER_AGENT_CHROMIUM =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let sessaoPreparada = false;

export function sessaoComprasnet(): Session {
  const ses = session.fromPartition(PARTITION);
  if (!sessaoPreparada) {
    ses.setUserAgent(USER_AGENT_CHROMIUM);
    sessaoPreparada = true;
  }
  return ses;
}

/**
 * Habilita login por certificado digital A1/A3.
 *
 * Sem tratar este evento o Chromium escolhe sozinho — normalmente o primeiro
 * certificado da lista, ou nenhum — e a autenticação falha em silêncio. Aqui o operador
 * escolhe qual certificado usar, e a chave privada nunca sai do repositório do sistema
 * nem do token físico.
 */
export function habilitarCertificadoDigital(): void {
  app.on("select-client-certificate", (evento, _webContents, _url, lista, callback) => {
    evento.preventDefault();

    if (lista.length === 0) return;
    if (lista.length === 1) return callback(lista[0]);

    const escolha = dialog.showMessageBoxSync({
      type: "question",
      title: "Certificado digital",
      message: "Escolha o certificado para entrar no Compras.gov.br",
      buttons: lista.map((c) => c.subjectName || c.issuerName || "Certificado"),
      cancelId: -1
    });

    if (escolha >= 0 && escolha < lista.length) callback(lista[escolha]);
  });
}

export interface StatusSessao {
  autenticado: boolean;
  verificadoEm: Date;
  /** Quantidade de cookies encontrados — diagnóstico, nunca os valores. */
  cookiesEncontrados: number;
}

/**
 * Verifica se existe sessão ativa. Deliberadamente não inspeciona o conteúdo dos
 * cookies: só conta presença, para não manipular material de credencial.
 */
export async function verificarSessao(): Promise<StatusSessao> {
  const ses = sessaoComprasnet();
  let sessao = 0;

  for (const domain of DOMINIOS_SESSAO) {
    const cookies = await ses.cookies.get({ domain });
    for (const c of cookies) {
      if (COOKIE_IGNORADO.test(c.name)) continue;
      // Cookie de sessão é httpOnly na prática, ou tem nome que o identifica como tal.
      if (c.httpOnly || COOKIE_DE_SESSAO.test(c.name)) sessao++;
    }
  }

  // Um único cookie httpOnly não distingue visitante de usuário logado: o portal cria
  // sessão anônima na primeira visita. Exigir vários reduz o falso positivo, mas nem
  // isso é prova — por isso a interface fala em "sessão detectada", e não em "conectado".
  return { autenticado: sessao >= 3, verificadoEm: new Date(), cookiesEncontrados: sessao };
}

/**
 * Abre a janela de login oficial e resolve quando o operador fecha a janela.
 * O retorno diz apenas se, ao final, existe sessão — não o que foi digitado.
 */
export async function abrirLogin(paiId?: number): Promise<StatusSessao> {
  const pai = typeof paiId === "number" ? BrowserWindow.fromId(paiId) : null;

  const janela = new BrowserWindow({
    width: 1100,
    height: 800,
    parent: pai ?? undefined,
    modal: false,
    title: "Entrar no Compras.gov.br",
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      // Sem preload e sem integração com Node: esta janela hospeda um site de terceiros
      // e não deve alcançar nada do aplicativo.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Uma falha de carregamento não pode deixar a janela em branco e sem explicação:
  // tentamos a alternativa e, se nem ela abrir, a janela mostra o erro do Chromium.
  try {
    await janela.loadURL(URL_LOGIN);
  } catch {
    try {
      await janela.loadURL(URL_LOGIN_ALTERNATIVA);
    } catch {
      // A própria janela exibe a página de erro de rede; seguimos para o fluxo de espera.
    }
  }

  // A janela NÃO se fecha sozinha, de propósito.
  //
  // Uma versão anterior fechava a janela ao detectar navegação dentro de compras.gov.br
  // com "sessão presente". Só que o portal cria cookie httpOnly antes de qualquer login:
  // ao escolher o perfil de fornecedor, a regra disparava e matava a janela no meio do
  // fluxo — o operador nunca chegava à tela de senha. Quem decide quando o login
  // terminou é o operador, fechando a janela.

  return new Promise<StatusSessao>((resolve) => {
    janela.on("closed", () => {
      void verificarSessao().then(resolve);
    });
  });
}

function abrirNoPortal(titulo: string, url: string): Promise<number> {
  const janela = new BrowserWindow({
    width: 1280,
    height: 900,
    title: titulo,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  return janela.loadURL(url).then(() => janela.id);
}

/**
 * Abre a sala de disputa na mesma sessão. Navegar por ela é o que alimenta a
 * calibração automática: o descobridor observa as chamadas que a própria página faz.
 */
export function abrirSalaDisputa(pregaoId?: string): Promise<number> {
  const url = pregaoId ? `${URL_SALA_DISPUTA}?compra=${encodeURIComponent(pregaoId)}` : URL_SALA_DISPUTA;
  return abrirNoPortal("Sala de Disputa — Compras.gov.br", url);
}

/** Abre o painel do fornecedor, de onde saem as disputas com proposta cadastrada. */
export function abrirPainelDisputas(): Promise<number> {
  return abrirNoPortal("Minhas disputas — Compras.gov.br", URL_SALA_DISPUTA);
}

/** Encerra a sessão local apagando os dados da partition. */
export async function sair(): Promise<void> {
  const ses = sessaoComprasnet();
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
}
