import { app, BrowserWindow, dialog, session, type Session, type WebContents } from "electron";
import { join } from "node:path";

import { DOMINIOS_COOKIE, FONTE_REGEX_HOST, RegistroEnderecos, URL_LOGIN_SSO } from "./endereco.js";
import { autenticadoPor, porQueNao, type Sondagem } from "./reconhecimento.js";

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
 * O que mudou em relação à versão anterior: a janela deixou de ser "um navegador que o
 * operador fecha na mão". Agora o aplicativo reconhece quando o login terminou de fato
 * — página do portal, sem campo de senha, com identidade e opção de sair na tela — e
 * fecha a janela sozinho, avisando antes e deixando o operador cancelar o fechamento.
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
const URL_LOGIN = URL_LOGIN_SSO;

/**
 * Endereço do portal. NÃO é constante de propósito — ver `endereco.ts`. O valor fixo que
 * ficava aqui apontava para `sala-disputa.comprasnet.gov.br`, um host que não resolve
 * DNS: o login funcionava e todo o resto do aplicativo falava com o vazio.
 */
export function enderecoPortal(): string {
  return registroEnderecos().paraAbrir();
}

export function enderecoSala(): string {
  return registroEnderecos().paraSala();
}

let registro: RegistroEnderecos | null = null;

export function registroEnderecos(): RegistroEnderecos {
  if (!registro) {
    registro = new RegistroEnderecos(join(app.getPath("userData"), "endereco-portal.json"));
    void registro.carregar();
  }
  return registro;
}

/**
 * Liga o aprendizado do endereço numa janela. Toda vez que ela pousa numa página do
 * portal, o endereço é guardado — é assim que o aplicativo acompanha o portal quando ele
 * muda de host, em vez de quebrar como quebrou.
 */
export function aprenderEnderecoDe(janela: BrowserWindow): void {
  const anotar = (url: string) => void registroEnderecos().aprender(url);
  janela.webContents.on("did-navigate", (_e, url) => anotar(url));
  janela.webContents.on("did-navigate-in-page", (_e, url) => anotar(url));
}

/**
 * Domínios onde procuramos sessão. O `gov.br` genérico ficou de fora de propósito:
 * só de visitar o portal já são criados cookies de consentimento e analytics, e contá-los
 * fazia o aplicativo se declarar conectado sem ninguém ter entrado na conta.
 */
const DOMINIOS_SESSAO = DOMINIOS_COOKIE;

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

export function partitionComprasnet(): string {
  return PARTITION;
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

/**
 * Adota as janelas que o próprio portal abre.
 *
 * O fluxo do gov.br abre janela nova no meio do login (`window.open`). O aplicativo
 * vigiava só a janela que ELE criou, então: o operador entrava na janela nova, a antiga
 * ficava parada numa página de redirecionamento, e o robô nunca via login nenhum — a
 * janela ficava aberta para sempre e a interface seguia dizendo "sem sessão".
 *
 * Dava para ver isso na tela: a janela do portal aparecia com barra de menu, e a janela
 * que este arquivo cria tem `autoHideMenuBar`. Era outra janela.
 *
 * As filhas herdam a partition (mesma sessão) e passam a ser vigiadas igual à mãe.
 */
export function adotarFilhas(mae: BrowserWindow, aoAdotar: (filha: BrowserWindow) => void): void {
  mae.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      width: 1100,
      height: 800,
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    }
  }));

  mae.webContents.on("did-create-window", (filha) => {
    aprenderEnderecoDe(filha);
    adotarFilhas(filha, aoAdotar);   // o SSO pode abrir mais de um salto
    aoAdotar(filha);
  });
}

export interface StatusSessao {
  autenticado: boolean;
  verificadoEm: Date;
  /** Quantidade de cookies encontrados — diagnóstico, nunca os valores. */
  cookiesEncontrados: number;
  /** Em que a decisão se apoiou, para a interface poder explicar em vez de só negar. */
  evidencia: string;
}

/* -------------------------------------------------------------- sondagem */

/**
 * Pergunta à própria página se ela está no estado de "usuário logado".
 *
 * Cookie não serve para isso: o portal cria cookie httpOnly na primeira visita, e foi
 * exatamente por contar cookies que a versão anterior se declarava conectada sem
 * ninguém ter entrado — e, na versão anterior a essa, fechava a janela no meio do login.
 * A tela renderizada é o sinal honesto: quem está logado tem identidade e opção de sair,
 * e não tem campo de senha.
 */
const SCRIPT_SONDA = `
(() => {
  const txt = ((document.body && document.body.innerText) || "").slice(0, 30000);
  const html = document.documentElement ? document.documentElement.innerHTML.slice(0, 30000) : "";
  const seletorSair = '[href*="logout" i],[href*="sair" i],[aria-label*="sair" i],[title*="sair" i],[data-testid*="logout" i]';
  return {
    url: location.href.slice(0, 300),
    noSso: /sso\\.acesso\\.gov\\.br|acesso\\.gov\\.br\\/(login|autorizar)/i.test(location.href),
    noPortal: new RegExp("${FONTE_REGEX_HOST}", "i").test(location.host),
    temSenha: Boolean(document.querySelector('input[type="password"]')),
    temSair: /\\b(sair|logout|encerrar sess[aã]o|desconectar)\\b/i.test(txt) || Boolean(document.querySelector(seletorSair)),
    temIdentidade: /\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}/.test(txt) || /\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2}/.test(txt) ||
                   /(logado como|usu[aá]rio:|bem[- ]vindo|ol[aá],)/i.test(txt) || /perfil-usuario|nome-usuario/i.test(html),
    escolhendoPerfil: /(escolha|selecione|informe)[^.]{0,30}perfil|meus perfis|selecionar perfil|qual perfil/i.test(txt),
    tamanho: txt.length,
    manterAberta: Boolean(window.__lancebotManter)
  };
})()
`;

export async function sondar(conteudo: WebContents): Promise<Sondagem | null> {
  try {
    return (await conteudo.executeJavaScript(SCRIPT_SONDA, true)) as Sondagem;
  } catch {
    return null;
  }
}

async function contarCookiesDeSessao(): Promise<number> {
  const ses = sessaoComprasnet();
  let total = 0;
  for (const domain of DOMINIOS_SESSAO) {
    const cookies = await ses.cookies.get({ domain });
    for (const c of cookies) {
      if (COOKIE_IGNORADO.test(c.name)) continue;
      if (c.httpOnly || COOKIE_DE_SESSAO.test(c.name)) total++;
    }
  }
  return total;
}

let cache: { status: StatusSessao; em: number } | null = null;
const VALIDADE_CACHE_MS = 15000;

/**
 * Verifica se existe sessão ativa carregando o portal numa janela oculta e olhando o
 * que ele renderiza. É mais caro que contar cookies e é a única forma de a resposta
 * significar alguma coisa.
 *
 * Deliberadamente não inspeciona o conteúdo dos cookies: só conta presença, como
 * diagnóstico.
 */
export interface TentativaSessao {
  url: string;
  urlFinal: string;
  autenticado: boolean;
  motivo: string | null;
  sondagem: Sondagem | null;
}

/** Diagnóstico completo — é o que a interface mostra quando o operador pede. */
export interface DiagnosticoSessao {
  status: StatusSessao;
  tentativas: TentativaSessao[];
  enderecosAprendidos: Record<string, string | undefined>;
  dominiosDeCookie: string[];
}

async function sondarAte(janela: BrowserWindow, url: string): Promise<TentativaSessao> {
  await janela.loadURL(url);

  // O portal é uma SPA: sondar antes de desenhar daria "não logado" por engano.
  let ultima: Sondagem | null = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ultima = await sondar(janela.webContents);
    if (autenticadoPor(ultima)) break;
    if (ultima?.noSso || ultima?.temSenha) break;   // redirecionou para o login: conclusivo
  }

  return {
    url,
    urlFinal: ultima?.url ?? url,
    autenticado: autenticadoPor(ultima),
    motivo: porQueNao(ultima),
    sondagem: ultima
  };
}

/**
 * Verifica se existe sessão ativa abrindo o portal numa janela oculta e olhando o que
 * ele renderiza. Deliberadamente não inspeciona o conteúdo dos cookies.
 *
 * Tenta MAIS DE UM endereço. Uma página só pode falhar por motivo que nada tem a ver com
 * sessão — rota mudou, exige parâmetro, aquele caminho está fora do ar — e concluir "sem
 * sessão" a partir de uma única tentativa foi exatamente o que aconteceu com o operador
 * logado na frente da tela.
 */
export async function diagnosticarSessao(): Promise<DiagnosticoSessao> {
  const cookies = await contarCookiesDeSessao();
  const registro = registroEnderecos();
  await registro.carregar();

  const janela = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      offscreen: false
    }
  });

  const tentativas: TentativaSessao[] = [];
  try {
    for (const url of registro.paraVerificar()) {
      try {
        const t = await sondarAte(janela, url);
        tentativas.push(t);
        if (t.autenticado) break;
      } catch (erro) {
        tentativas.push({
          url,
          urlFinal: url,
          autenticado: false,
          motivo: `Não abriu: ${erro instanceof Error ? erro.message : String(erro)}`,
          sondagem: null
        });
      }
    }
  } finally {
    if (!janela.isDestroyed()) janela.destroy();
  }

  const boa = tentativas.find((t) => t.autenticado);
  const status: StatusSessao = {
    autenticado: Boolean(boa),
    verificadoEm: new Date(),
    cookiesEncontrados: cookies,
    evidencia: boa
      ? `Sessão ativa em ${new URL(boa.urlFinal).host}.`
      : tentativas.length === 0
        ? "Nenhum endereço do portal para verificar."
        : (tentativas[0].motivo ?? "O portal abriu, mas sem sinal de usuário autenticado.")
  };

  cache = { status, em: Date.now() };
  return {
    status,
    tentativas,
    enderecosAprendidos: registro.aprendidos as Record<string, string | undefined>,
    dominiosDeCookie: DOMINIOS_SESSAO
  };
}

export async function verificarSessao(forcar = false): Promise<StatusSessao> {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_CACHE_MS) return cache.status;
  return (await diagnosticarSessao()).status;
}

/* ------------------------------------------------------------------ login */

/**
 * Aviso dentro da própria janela do portal antes de fechá-la. Sem isto, a janela some
 * do nada no meio de um passo que o operador ainda queria ver — e "some do nada" é
 * exatamente o defeito que fez a versão de dois releases atrás ser revertida.
 */
const SCRIPT_AVISO = `
(() => {
  if (window.__lancebotAviso) return;
  window.__lancebotAviso = true;
  const cx = document.createElement("div");
  cx.setAttribute("style", "position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#0B0D12;" +
    "color:#E9EDF5;font:14px/1.4 system-ui,sans-serif;padding:14px 16px;border-radius:10px;" +
    "box-shadow:0 8px 30px rgba(0,0,0,.45);max-width:320px");
  const t = document.createElement("div");
  t.textContent = "Login reconhecido. Fechando esta janela e devolvendo o controle ao LanceBot…";
  const b = document.createElement("button");
  b.textContent = "Manter aberta";
  b.setAttribute("style", "margin-top:10px;background:#1E2635;color:#E9EDF5;border:0;border-radius:6px;" +
    "padding:6px 10px;cursor:pointer;font:13px system-ui,sans-serif");
  b.addEventListener("click", () => { window.__lancebotManter = true; cx.remove(); });
  cx.appendChild(t); cx.appendChild(b);
  document.body.appendChild(cx);
})()
`;

/**
 * Abre a janela de login oficial e resolve quando a autenticação é reconhecida — ou
 * quando o operador fecha a janela na mão, o que continua valendo.
 *
 * `aoAbrirJanela` é chamado assim que a janela existe, antes de qualquer navegação.
 * É o gancho para ligar o observador em tempo real nesta mesma janela: o operador tende
 * a continuar navegando pelo portal aqui mesmo depois de logar.
 */
export async function abrirLogin(
  paiId?: number,
  aoAbrirJanela?: (idJanela: number) => void
): Promise<StatusSessao> {
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

  aprenderEnderecoDe(janela);
  aoAbrirJanela?.(janela.id);

  // Todas as janelas do fluxo de login, não só esta.
  const janelas: BrowserWindow[] = [janela];

  try {
    await janela.loadURL(URL_LOGIN);
  } catch {
    try {
      await janela.loadURL(enderecoPortal());
    } catch {
      // A própria janela exibe a página de erro de rede; seguimos para o fluxo de espera.
    }
  }

  const abertaEm = Date.now();
  let positivas = 0;
  let fechandoPorNos = false;

  return new Promise<StatusSessao>((resolve) => {
    let resolvido = false;
    const concluir = async () => {
      if (resolvido) return;
      resolvido = true;
      clearInterval(timer);
      resolve(await verificarSessao(true));
    };

    const vivas = () => janelas.filter((j) => !j.isDestroyed());

    // Só encerra quando TODAS as janelas do login sumirem. Fechar a intermediária,
    // como o próprio SSO faz, não pode abortar o fluxo.
    const talvezConcluir = () => { if (vivas().length === 0) void concluir(); };
    janela.on("closed", talvezConcluir);
    adotarFilhas(janela, (filha) => {
      janelas.push(filha);
      aoAbrirJanela?.(filha.id);
      filha.on("closed", talvezConcluir);
    });

    const timer = setInterval(() => {
      void (async () => {
        const abertas = vivas();
        if (abertas.length === 0) return void concluir();

        // Procura o login em QUALQUER janela do fluxo, não só na que abrimos.
        let logada: BrowserWindow | null = null;
        let manter = false;
        for (const j of abertas) {
          const s = await sondar(j.webContents);
          if (s?.manterAberta) manter = true;
          if (!logada && autenticadoPor(s)) logada = j;
        }

        if (manter) { positivas = 0; return; }

        // Duas leituras positivas seguidas, e nunca nos primeiros segundos. É o que
        // separa "logou" de "a SPA piscou uma tela intermediária".
        positivas = logada ? positivas + 1 : 0;
        if (!logada || positivas < 2 || Date.now() - abertaEm < 4000 || fechandoPorNos) return;

        fechandoPorNos = true;
        const alvo = logada;
        try {
          await alvo.webContents.executeJavaScript(SCRIPT_AVISO, true);
        } catch {
          // Aviso é cortesia; a ausência dele não impede o fechamento.
        }
        setTimeout(() => {
          void (async () => {
            const ainda = await sondar(alvo.webContents);
            if (ainda?.manterAberta) {
              fechandoPorNos = false;
              positivas = 0;
              return;
            }
            for (const j of vivas()) j.close();
            await concluir();
          })();
        }, 2200);
      })();
    }, 1200);
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
  aprenderEnderecoDe(janela);
  adotarFilhas(janela, aprenderEnderecoDe);
  return janela.loadURL(url).then(() => janela.id);
}

/** Abre o painel do fornecedor, de onde saem as disputas com proposta cadastrada. */
export function abrirPainelDisputas(): Promise<number> {
  return abrirNoPortal("Minhas disputas — Compras.gov.br", enderecoPortal());
}

/** Encerra a sessão local apagando os dados da partition. */
export async function sair(): Promise<void> {
  const ses = sessaoComprasnet();
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
  cache = null;
}
