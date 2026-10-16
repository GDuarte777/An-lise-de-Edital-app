import { app, BrowserWindow, dialog, net, session, type Session, type WebContents } from "electron";
import { join } from "node:path";

import {
  CANDIDATOS_APLICATIVO,
  DOMINIOS_COOKIE,
  FONTE_REGEX_HOST,
  RegistroEnderecos,
  lembrarAutorizacaoSso,
  urlLoginSso,
  PRECISA_ENTRAR,
  RETORNO_POS_LOGIN,
  URL_LOGIN_LEGADO,
  URL_API_USUARIO
} from "./endereco.js";
import { autenticadoPor, porQueNao, type Sondagem } from "./reconhecimento.js";
import {
  acharJwtEm,
  ColetorSessaoPortal,
  DiarioDeChamadas,
  ehTokenPlausivel,
  type ChamadaObservada,
  type EstadoSessaoPortal
} from "./token.js";

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
  const anotar = (url: string) => {
    // O identificador do SSO vence; o que passar na janela vale para a próxima vez.
    lembrarAutorizacaoSso(url);
    void registroEnderecos().aprender(url);
  };
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

/**
 * Credencial da sessão do portal, colhida do tráfego do próprio portal.
 *
 * O Compras.gov.br novo não guarda sessão em cookie: a sessão é um token que o SPA manda
 * no `Authorization`. Era por isso que o aplicativo via "1 cookie" e levava 403 com o
 * operador logado. Aqui o token é observado passando — a mesma credencial que a página
 * dele acabou de usar. Valor nenhum sai deste par de módulos.
 */
const coletor = new ColetorSessaoPortal();

/** O que a página do portal chamou. Método e caminho apenas — ver `DiarioDeChamadas`. */
const diario = new DiarioDeChamadas();

export function chamadasDoPortal(): ChamadaObservada[] {
  return diario.tudo;
}

export function coletorSessaoPortal(): ColetorSessaoPortal {
  return coletor;
}

export function estadoSessaoPortal(): EstadoSessaoPortal {
  return coletor.estado();
}

export function sessaoComprasnet(): Session {
  const ses = session.fromPartition(PARTITION);
  if (!sessaoPreparada) {
    ses.setUserAgent(USER_AGENT_CHROMIUM);
    // Observa os cabeçalhos que a página do portal manda. É leitura: os cabeçalhos
    // seguem intactos para o portal.
    ses.webRequest.onBeforeSendHeaders((detalhes, callback) => {
      try {
        const cabecalhos = detalhes.requestHeaders ?? {};
        const chave = Object.keys(cabecalhos).find((k) => k.toLowerCase() === "authorization");
        const autorizacao = chave ? String(cabecalhos[chave]) : undefined;
        coletor.observar({ url: detalhes.url, autorizacao });
        diario.registrar(detalhes.url, detalhes.method, Boolean(autorizacao));
      } catch {
        // Observar nunca pode atrapalhar a navegação do operador.
      }
      callback({ requestHeaders: detalhes.requestHeaders });
    });
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
export interface RespostaDoPortal {
  status: number;
  ok: boolean;
  erro?: string;
}

/**
 * Pergunta ao portal quem está logado, usando os cookies da partition.
 *
 * É a resposta do próprio Compras.gov.br, não uma leitura de HTML: `GET
 * /comprasnet-usuario/v1/usuario` devolve 200 com sessão e 401/403 sem ela — observado
 * na coleta feita pelo operador, e sem exigir token de captcha.
 *
 * Isto existe porque as três tentativas anteriores de responder "há sessão?" erraram
 * sempre pelo mesmo motivo: a URL da página que eu escolhia para abrir. Aqui não há
 * página nem rota a adivinhar.
 */
export function perguntarAoPortal(url = URL_API_USUARIO): Promise<RespostaDoPortal> {
  return new Promise((resolve) => {
    let respondido = false;
    const responder = (r: RespostaDoPortal) => { if (!respondido) { respondido = true; resolve(r); } };

    try {
      const req = net.request({ method: "GET", url, session: sessaoComprasnet(), useSessionCookies: true });
      req.setHeader("Accept", "application/json");
      // O cabeçalho que faltava. Sem ele a API responde 403 mesmo com a sessão viva,
      // porque a sessão do portal novo mora no token, não no cookie.
      const token = coletor.tokenAtual();
      if (token) req.setHeader("Authorization", token.startsWith("Bearer") ? token : `Bearer ${token}`);
      req.on("response", (res) => {
        const status = res.statusCode;
        res.on("data", () => { /* o corpo não interessa: nada dele é lido nem guardado */ });
        res.on("end", () => responder({ status, ok: status >= 200 && status < 300 }));
        res.on("error", () => responder({ status, ok: status >= 200 && status < 300 }));
      });
      req.on("error", (e) => responder({ status: 0, ok: false, erro: e.message }));
      req.end();
    } catch (e) {
      responder({ status: 0, ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  });
}

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
  /** Presença e idade da credencial colhida — nunca o valor dela. */
  sessaoPortal: EstadoSessaoPortal;
  /** Rotas tentadas para obter o token e o que o portal respondeu em cada uma. */
  tentativasDeToken: TentativaDeToken[];
  /** O que a página do portal realmente chamou — é o que revela a rota de sessão. */
  chamadasDoPortal: ChamadaObservada[];
  /** A resposta do portal à pergunta "quem está logado?" — a evidência principal. */
  api: RespostaDoPortal;
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

  // O portal novo só revela a sessão quando o SPA dele fala com a API. Se nenhuma
  // requisição passou ainda, abre a base do portal e deixa ele falar — é assim que o
  // token aparece, sem adivinhar rota nem interpretar HTML.
  if (!coletor.tokenAtual()) {
    // Pede o token à API com os cookies do login (caminho do SIGA). Só se não vier é que
    // se abre uma página do portal para ele aparecer.
    if (!(await obterTokenPelaApi())) await aquecerToken(janela, registro);
  }

  // Agora a pergunta direta, já com o cabeçalho de sessão. Se o portal disser que há
  // usuário, acabou.
  const api = await perguntarAoPortal();
  if (api.ok) {
    const status: StatusSessao = {
      autenticado: true,
      verificadoEm: new Date(),
      cookiesEncontrados: cookies,
      evidencia: "O portal confirmou a sessão (respondeu quem está logado)."
    };
    cache = { status, em: Date.now() };
    if (!janela.isDestroyed()) janela.destroy();
    return {
      status,
      api,
      sessaoPortal: coletor.estado(),
      tentativasDeToken: tentativasDeToken(),
      chamadasDoPortal: diario.tudo,
      tentativas: [],
      enderecosAprendidos: registro.aprendidos as Record<string, string | undefined>,
      dominiosDeCookie: DOMINIOS_SESSAO
    };
  }

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
      : api.status === 401 || api.status === 403
        ? coletor.tokenAtual()
          ? "O portal recusou a sessão (HTTP " + api.status + ") mesmo com o token em mãos — " +
            "provavelmente ela expirou. Entre no gov.br outra vez."
          : "O portal ainda não revelou o token desta sessão (HTTP " + api.status + "). " +
            "A sessão do Compras.gov.br novo vive num token, não em cookie: abra uma página " +
            "do portal (o painel de disputas, por exemplo) e tente de novo — o token aparece " +
            "na primeira chamada que a própria página faz."
        : api.status === 0
          ? `Não consegui falar com o portal: ${api.erro ?? "sem resposta"}.`
          : tentativas.length === 0
            ? "Nenhum endereço do portal para verificar."
            : (tentativas[0].motivo ?? "O portal abriu, mas sem sinal de usuário autenticado.")
  };

  cache = { status, em: Date.now() };
  return {
    status,
    api,
    sessaoPortal: coletor.estado(),
    tentativasDeToken: tentativasDeToken(),
    chamadasDoPortal: diario.tudo,
    tentativas,
    enderecosAprendidos: registro.aprendidos as Record<string, string | undefined>,
    dominiosDeCookie: DOMINIOS_SESSAO
  };
}

/**
 * Faz o portal falar, para o token aparecer.
 *
 * Abrir a base do SPA basta: ele mesmo chama a API para saber quem está logado, e é essa
 * chamada que carrega o `Authorization`. Se nada passar em alguns segundos, tenta o
 * armazenamento da página como último recurso.
 */
async function aquecerToken(janela: BrowserWindow, registro: RegistroEnderecos): Promise<void> {
  const url = registro.paraVerificar()[0];
  if (!url || janela.isDestroyed()) return;

  try {
    await janela.loadURL(url);
  } catch {
    // Endereço pode estar fora do ar; o diagnóstico abaixo dirá.
  }

  for (let i = 0; i < 16; i++) {
    if (coletor.tokenAtual()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!janela.isDestroyed()) await colherTokenDaJanela(janela.webContents);
}

export async function verificarSessao(forcar = false): Promise<StatusSessao> {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_CACHE_MS) return cache.status;
  return (await diagnosticarSessao()).status;
}

/* ------------------------------------------------------------------ login */

/*
 * O aviso "Manter aberta" saiu junto com a espera: a janela do login agora fecha
 * assim que a sessão é provada, que é o que o operador pediu — entrar uma vez.
 */

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

  await abrirEntradaDeLogin(janela);

  const abertaEm = Date.now();
  let positivas = 0;
  let fechandoPorNos = false;
  const perfisEscolhidos = new Set<number>();
  let avisoPosto = false;
  let encaminhado = false;
  const entradasClicadas = new Set<number>();

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

        /*
         * Escolha de perfil: o portal desenha "Acesse sua Conta — Fornecedor Brasileiro /
         * Estrangeiro / Governo". É um clique que o aplicativo dá pelo operador, uma vez
         * por janela: a versão anterior deixava essa escolha na mão dele, e era mais um
         * passo entre "entrei" e "o aplicativo reconheceu".
         */
        for (const j of abertas) {
          if (perfisEscolhidos.has(j.id)) continue;
          const sonda = await sondar(j.webContents);
          if (!sonda?.escolhendoPerfil) continue;
          perfisEscolhidos.add(j.id);
          try {
            await j.webContents.executeJavaScript(SCRIPT_ESCOLHER_FORNECEDOR, true);
          } catch {
            // Se não der para clicar, o operador clica; nada se perde.
          }
          return;
        }

        /*
         * Prova de que o login terminou. Três sinais, em ordem de confiança:
         *   1. o token da sessão, confirmado pela API — é o portal novo respondendo;
         *   2. a tela mostrando identificação ou botão de sair — serve ao portal antigo;
         *   3. o SSO ter ficado para trás E existirem cookies de sessão.
         *
         * O terceiro existe porque o token só nasce quando o aplicativo NOVO roda, e
         * depois do login o portal às vezes para numa página antiga. Nesse caso a janela
         * do operador fecha na mesma hora e o token é colhido depois, numa janela
         * OCULTA. Levar a janela DELE a uma rota do aplicativo foi erro meu: quando a
         * rota não existe, ele leva "Página não encontrada" na cara.
         */
        if (!fechandoPorNos && coletor.tokenAtual()) {
          const confirmacao = await perguntarAoPortal();
          if (confirmacao.ok) {
            fechandoPorNos = true;
            for (const j of vivas()) j.close();
            return void concluir();
          }
        }

        let logada: BrowserWindow | null = null;
        let manter = false;
        let saiuDoSso = false;
        for (const j of abertas) {
          const sonda = await sondar(j.webContents);
          if (sonda?.manterAberta) manter = true;
          if (sonda && !sonda.noSso && sonda.noPortal && !sonda.temSenha) saiuDoSso = true;
          if (!logada && autenticadoPor(sonda)) logada = j;
        }

        if (manter) { positivas = 0; return; }

        /*
         * Cookie NÃO é prova suficiente, e tratá-lo como prova custou uma sessão do
         * operador: os cookies aparecem no meio do vaivém do SSO, antes de o portal
         * novo emitir o token. Fechando ali, a janela ia embora antes de a sessão
         * existir de verdade — e o painel seguia dizendo "sem sessão".
         *
         * Então, passado o SSO e sem token ainda, a janela FICA ABERTA, com um aviso
         * dizendo que ela se fecha sozinha. Qualquer página do portal que o operador
         * abrir dali faz o token aparecer, e aí sim ela fecha.
         */
        /*
         * "Acesso não autorizado" do aplicativo novo não é erro: é a porta. A própria
         * tela traz o botão **Efetuar Login**, que leva ao gov.br com um identificador
         * emitido pelo portal novo — a sessão que o robô precisa. Clicar nele é o passo
         * que faltava, e é o que o operador faria com o mouse.
         */
        for (const j of abertas) {
          if (entradasClicadas.has(j.id)) continue;
          const urlJ = j.isDestroyed() ? "" : j.webContents.getURL();
          if (!PRECISA_ENTRAR.test(urlJ)) continue;
          entradasClicadas.add(j.id);
          try {
            const clicou = (await j.webContents.executeJavaScript(SCRIPT_CLICAR_ENTRAR, true)) as boolean;
            if (clicou) return;
          } catch {
            // sem clique, o operador clica; o botão está visível na tela dele
          }
        }

        /*
         * Caiu no sistema antigo depois do login (intro.htm). Aquela sessão não vale
         * para o aplicativo novo — o diário de chamadas do operador provou isso. Então
         * a janela volta para a porta do aplicativo novo, que agora encontra a sessão
         * do gov.br já feita e costuma entrar sozinha.
         */
        if (!coletor.tokenAtual() && !encaminhado) {
          const atual = abertas[0];
          const urlAtual = atual.isDestroyed() ? "" : atual.webContents.getURL();
          if (RETORNO_POS_LOGIN.test(urlAtual)) {
            encaminhado = true;
            const destino = (await linkParaAplicativoNovo(atual)) ?? urlLoginSso();
            try {
              await atual.loadURL(destino);
            } catch {
              // segue o laço; o aviso abaixo explica ao operador
            }
            return;
          }
        }

        if (!logada && saiuDoSso && !avisoPosto) {
          avisoPosto = true;
          for (const j of abertas) {
            try {
              await j.webContents.executeJavaScript(SCRIPT_AVISO_AGUARDANDO, true);
            } catch {
              // aviso é cortesia
            }
          }
        }

        // Duas leituras positivas seguidas, e nunca nos primeiros segundos. É o que
        // separa "logou" de "a SPA piscou uma tela intermediária".
        positivas = logada ? positivas + 1 : 0;
        if (!logada || positivas < 2 || Date.now() - abertaEm < 4000 || fechandoPorNos) return;

        fechandoPorNos = true;
        for (const j of vivas()) j.close();
        // Em segundo plano, e invisível: faz o aplicativo novo rodar uma vez para a
        // sessão virar token. Se falhar, o diagnóstico mostra "token ainda não apareceu"
        // e nada é mentido ao operador.
        void colherTokenEmSegundoPlano();
        await concluir();
      })();
    }, 1200);
  });
}

/**
 * Abre a entrada do login, e não aceita tela branca como resposta.
 *
 * Primeiro a página de CPF e senha direta (com `authorization_id`), que é o que o
 * operador pediu. Mas esse identificador vence, e vencido o SSO devolve uma página
 * VAZIA — sem erro, sem texto, só branco. Então aqui se confere se veio página de
 * verdade; se não veio, o identificador é descartado e a entrada vira a que sempre
 * funciona. Ela leva à escolha de perfil, que o aplicativo clica sozinho, e nessa volta
 * um identificador NOVO é aprendido para o próximo login.
 */
async function abrirEntradaDeLogin(janela: BrowserWindow): Promise<void> {
  /*
   * Uma porta só: a do próprio portal. Ela redireciona para o gov.br com um
   * `authorization_id` recém-emitido, que é a tela de CPF e senha que o operador quer
   * ver. Montar essa URL à mão com identificador fixo era o que dava página em branco.
   */
  for (const url of [urlLoginSso(), URL_LOGIN_LEGADO]) {
    if (janela.isDestroyed()) return;
    try {
      await janela.loadURL(url);
    } catch {
      continue;
    }
    if (await paginaAbriuDeVerdade(janela)) return;
  }
  if (!janela.isDestroyed()) await janela.loadURL(PAGINA_LOGIN_INDISPONIVEL).catch(() => undefined);
}

/**
 * A página abriu de verdade?
 *
 * Duas lições de uma tela branca que virou 404 na cara do operador:
 *
 *  1. ESPERAR O FIM. A versão anterior olhava a página 3 segundos depois de pedir, e o
 *     SSO às vezes ainda estava redirecionando. Declarar "veio vazia" e navegar para
 *     outro lugar INTERROMPIA uma página que estava chegando.
 *  2. Só julgar quando o carregamento parar. Enquanto `isLoading()` for verdadeiro,
 *     espera-se — até o limite, que é generoso de propósito: o gov.br em hora de pico é
 *     lento, e lentidão não é erro.
 */
async function paginaAbriuDeVerdade(janela: BrowserWindow, limiteMs = 30_000): Promise<boolean> {
  const ate = Date.now() + limiteMs;

  while (Date.now() < ate) {
    if (janela.isDestroyed()) return false;

    if (janela.webContents.isLoading()) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    try {
      const tem = (await janela.webContents.executeJavaScript(
        `(() => {
           const t = ((document.body && document.body.innerText) || "").trim();
           return t.length > 40 ||
                  Boolean(document.querySelector('input[type="password"],form,button,a[href]'));
         })()`,
        true
      )) as boolean;
      if (tem) return true;
    } catch {
      // Navegando no meio da leitura: não é resposta, é "ainda não".
    }

    // Parou de carregar e está vazia. Dá mais um tempo: SPA pinta depois do load.
    await new Promise((r) => setTimeout(r, 700));
    if (janela.isDestroyed()) return false;
    if (!janela.webContents.isLoading()) {
      try {
        const tem = (await janela.webContents.executeJavaScript(
          `(((document.body && document.body.innerText) || "").trim().length > 40)`,
          true
        )) as boolean;
        if (tem) return true;
      } catch {
        // idem
      }
      return false;
    }
  }
  return false;
}

const PAGINA_LOGIN_INDISPONIVEL =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><meta charset="utf-8">
<style>
 body{margin:0;display:grid;place-items:center;height:100vh;background:#0b0d12;color:#e8ebf2;
      font:400 15px/1.6 "Segoe UI",system-ui,sans-serif;text-align:center}
 div{max-width:460px;padding:32px}
 h1{font-size:18px;margin:0 0 12px}
 p{color:#8f97ab;margin:0}
</style>
<div>
  <h1>A página de login do gov.br não abriu</h1>
  <p>O serviço de acesso do governo não respondeu agora. Feche esta janela e tente entrar
     de novo em alguns instantes.</p>
</div>`);

/**
 * Clica em "Efetuar Login" na tela do aplicativo novo.
 *
 * Procura pelo texto, nunca por seletor fixo — o portal remarca essas telas com
 * frequência. Só clica em algo visível e com rótulo curto, para não acertar um texto
 * de ajuda que por acaso contenha a palavra.
 */
const SCRIPT_CLICAR_ENTRAR = `
(() => {
  const candidatos = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"]'));
  const alvo = candidatos.find((el) => {
    const t = ((el.innerText || el.textContent || el.value || "") + "").trim();
    if (!t || t.length > 40) return false;
    if (!/(efetuar|fazer)?\\s*login|^entrar$|acessar/i.test(t)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!alvo) return false;
  alvo.click();
  return true;
})()`;

/**
 * Procura, na página em que o operador está, o link para o aplicativo novo.
 *
 * É a diferença entre seguir o portal e adivinhar o portal: o menu do sistema antigo
 * aponta para a área nova, e esse endereço é verdadeiro por construção.
 */
async function linkParaAplicativoNovo(janela: BrowserWindow): Promise<string | null> {
  try {
    const achado = (await janela.webContents.executeJavaScript(
      `(() => {
         const links = Array.from(document.querySelectorAll("a[href]"));
         const bom = links.find((a) => /estaleiro\\.serpro\\.gov\\.br\\/comprasnet-web/i.test(a.href));
         return bom ? bom.href : null;
       })()`,
      true
    )) as string | null;
    return typeof achado === "string" && achado ? achado : null;
  } catch {
    return null;
  }
}

/**
 * Aviso dentro da janela do portal, enquanto o aplicativo espera a sessão aparecer.
 *
 * Sem ele o operador olha para uma janela que não fecha e conclui que travou — foi
 * exatamente o que aconteceu. Com ele, a janela diz o que está esperando.
 */
const SCRIPT_AVISO_AGUARDANDO = `
(() => {
  if (window.__lancebotAviso) return true;
  window.__lancebotAviso = true;
  const cx = document.createElement("div");
  cx.setAttribute("style",
    "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;" +
    "background:#0B0D12;color:#E8EBF2;border:1px solid #FF5A00;border-radius:12px;" +
    "padding:14px 16px;font:400 13px/1.5 Segoe UI,system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.45)");
  cx.innerHTML =
    "<b style='display:block;margin-bottom:6px'>HORASIS LanceBot</b>" +
    "Login reconhecido. Abra <b>suas disputas</b> aqui no portal uma vez — esta janela " +
    "fecha sozinha assim que o aplicativo pegar a sessão.";
  document.body.appendChild(cx);
  return true;
})()`;

/**
 * Clica em "Fornecedor Brasileiro" na tela de escolha de perfil.
 *
 * Procura pelo texto, não por seletor fixo: a tela do portal muda de marcação com
 * frequência, e um seletor inventado clicaria no lugar errado — ou em nada.
 */
const SCRIPT_ESCOLHER_FORNECEDOR = `
(() => {
  const alvos = Array.from(document.querySelectorAll('a,button,[role="button"],li,div'));
  const querido = alvos.find((el) => {
    const t = (el.innerText || el.textContent || "").trim();
    if (!t || t.length > 60) return false;
    if (!/fornecedor/i.test(t)) return false;
    if (/estrangeir/i.test(t)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!querido) return false;
  querido.click();
  return true;
})()`;

/**
 * Pede o token à API do portal, com os cookies do login — é o caminho do SIGA.
 *
 * Por que isto existe: o token da sessão é emitido pelo serviço de usuário do portal, e
 * quem normalmente o pede é o JavaScript da página. Eu vinha tentando fazer uma PÁGINA
 * rodar para que ela pedisse por nós — e gastei três versões adivinhando qual página.
 * Pedir direto ao serviço elimina a adivinhação: a rota de sessão é irmã da de renovação
 * (`/sessao/fornecedor/retoken`), que foi confirmada na análise.
 *
 * Nada é forjado: quem autentica a chamada são os cookies que o gov.br acabou de dar ao
 * operador, nesta máquina. O token volta e fica em memória, nunca em disco nem em log.
 */
/*
 * Candidatas à rota que EMITE o token.
 *
 * O diagnóstico do operador matou as quatro primeiras deduções — `/sessao/...` responde
 * 404 — e mostrou algo valioso: `/comprasnet-usuario/v1/usuario` responde 403, ou seja,
 * o serviço existe e só falta a credencial. A emissão está em outro caminho deste mesmo
 * serviço, e as candidatas abaixo cobrem os nomes usuais. Cada uma custa uma requisição
 * em janela oculta, e o status de TODAS aparece no diagnóstico: se nenhuma servir, o
 * `chamadasDoPortal` (o que a página de verdade chamou) entrega a resposta.
 */
const ROTAS_DE_TOKEN: Array<{ caminho: string; metodos: Array<"POST" | "GET"> }> = [
  { caminho: "/comprasnet-usuario/v1/sessao/fornecedor/retoken", metodos: ["POST"] },
  { caminho: "/comprasnet-usuario/v1/token", metodos: ["POST", "GET"] },
  { caminho: "/comprasnet-usuario/v1/login", metodos: ["POST", "GET"] },
  { caminho: "/comprasnet-usuario/v1/autenticacao", metodos: ["POST", "GET"] },
  { caminho: "/comprasnet-usuario/v1/oauth/token", metodos: ["POST"] },
  { caminho: "/comprasnet-seguranca/v1/token", metodos: ["POST", "GET"] },
  { caminho: "/comprasnet-usuario/v1/usuario", metodos: ["GET"] }
];

/**
 * O que foi tentado na última busca de token, e o que o portal respondeu.
 *
 * Existe para a próxima rodada de suporte não ser adivinhação: com o status de cada
 * rota em mãos, a rota certa aparece sem mais um ciclo de instalar-e-testar. Só rota,
 * método e status — nada de corpo, nada de credencial.
 */
export interface TentativaDeToken {
  rota: string;
  metodo: string;
  status: number;
}

let trilhaDeToken: TentativaDeToken[] = [];

export function tentativasDeToken(): TentativaDeToken[] {
  return [...trilhaDeToken];
}

export async function obterTokenPelaApi(): Promise<boolean> {
  if (coletor.tokenAtual()) return true;
  trilhaDeToken = [];

  const base = "https://cnetmobile.estaleiro.serpro.gov.br";
  for (const rota of ROTAS_DE_TOKEN) {
    for (const metodo of rota.metodos) {
      const url = `${base}${rota.caminho}`;
      const resposta = await pedirAoPortal(url, metodo);
      trilhaDeToken.push({ rota: rota.caminho, metodo, status: resposta?.status ?? 0 });
      if (!resposta) continue;

      // O token pode vir no cabeçalho (é como o portal devolve na renovação) ou no corpo.
      const doCabecalho = resposta.autorizacao;
      if (doCabecalho && ehTokenPlausivel(doCabecalho)) {
        coletor.observar({ url, autorizacao: doCabecalho });
        return true;
      }
      try {
        const achado = acharJwtEm(JSON.parse(resposta.corpo));
        if (achado) {
          coletor.observar({ url, autorizacao: `Bearer ${achado}` });
          return true;
        }
      } catch {
        // resposta não era JSON; tenta a próxima rota
      }
    }
  }
  return false;
}

interface RespostaCrua {
  status: number;
  corpo: string;
  autorizacao?: string;
}

function pedirAoPortal(url: string, metodo: "GET" | "POST"): Promise<RespostaCrua | null> {
  return new Promise((resolve) => {
    let respondido = false;
    const responder = (r: RespostaCrua | null) => { if (!respondido) { respondido = true; resolve(r); } };
    const desistir = setTimeout(() => responder(null), 12_000);

    try {
      const req = net.request({ method: metodo, url, session: sessaoComprasnet(), useSessionCookies: true });
      req.setHeader("Accept", "application/json");
      if (metodo === "POST") req.setHeader("Content-Type", "application/json");
      req.on("response", (res) => {
        const partes: Buffer[] = [];
        const cabecalho = res.headers["authorization"] ?? res.headers["Authorization"];
        res.on("data", (c: Buffer) => {
          // Teto de 1 MB: resposta gigante aqui é sinal de que não é o que se procura.
          if (partes.reduce((n, p) => n + p.length, 0) < 1_000_000) partes.push(c);
        });
        res.on("end", () => {
          clearTimeout(desistir);
          responder({
            status: res.statusCode,
            corpo: Buffer.concat(partes).toString("utf-8"),
            autorizacao: Array.isArray(cabecalho) ? cabecalho[0] : cabecalho
          });
        });
        res.on("error", () => { clearTimeout(desistir); responder(null); });
      });
      req.on("error", () => { clearTimeout(desistir); responder(null); });
      req.end();
    } catch {
      clearTimeout(desistir);
      responder(null);
    }
  });
}

/**
 * Faz a sessão virar token sem o operador ver nada.
 *
 * O portal não publica a rota de entrada do aplicativo, e ela já mudou de lugar. Então
 * aqui se tenta uma lista curta, em janela oculta, e a que funcionar é aprendida — na
 * próxima vez ela é a primeira. Página inexistente desenha 404 nesta janela invisível,
 * e ninguém vê.
 */
export async function colherTokenEmSegundoPlano(): Promise<boolean> {
  if (coletor.tokenAtual()) return true;
  // Primeiro o caminho direto: pedir à API. Só se ele falhar é que se roda uma página.
  if (await obterTokenPelaApi()) return true;

  const registro = registroEnderecos();
  await registro.carregar();
  const candidatos = [...new Set([registro.paraAbrir(), ...CANDIDATOS_APLICATIVO])];

  const janela = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true }
  });

  try {
    for (const url of candidatos) {
      if (janela.isDestroyed()) return false;
      try {
        await janela.loadURL(url);
      } catch {
        continue;
      }
      for (let i = 0; i < 16; i++) {
        if (coletor.tokenAtual()) {
          await registro.aprender(url);
          return true;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!janela.isDestroyed() && (await colherTokenDaJanela(janela.webContents))) {
        await registro.aprender(url);
        return true;
      }
    }
    return false;
  } finally {
    if (!janela.isDestroyed()) janela.destroy();
  }
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
  // `enderecoPortal()` já descarta endereço do sistema antigo (ver `ehEnderecoNavegavel`),
  // então esta janela abre no aplicativo novo — nunca mais no popup.asp.
  return abrirNoPortal("Minhas disputas — Compras.gov.br", enderecoPortal());
}

/** Encerra a sessão local apagando os dados da partition. */
export async function sair(): Promise<void> {
  const ses = sessaoComprasnet();
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
  // Credencial de sessão encerrada não fica em memória.
  coletor.esquecer();
  cache = null;
}

/**
 * Última tentativa de achar o token quando nenhuma requisição do portal passou ainda:
 * o SPA guarda a sessão no armazenamento da própria página.
 *
 * [inferido] A chave varia entre versões do portal, então nada de nome fixo: varre as
 * chaves e aproveita só o que tem cara de JWT. Devolve se achou — nunca o valor.
 */
export async function colherTokenDaJanela(conteudo: WebContents): Promise<boolean> {
  try {
    const achado = (await conteudo.executeJavaScript(SCRIPT_TOKEN_DO_ARMAZENAMENTO, true)) as string | null;
    if (typeof achado === "string" && ehTokenPlausivel(achado)) {
      coletor.observar({ url: conteudo.getURL(), autorizacao: achado });
      return true;
    }
  } catch {
    // Página sem acesso ao armazenamento: segue sem token, e o 403 dirá isso.
  }
  return false;
}

const SCRIPT_TOKEN_DO_ARMAZENAMENTO = `
(() => {
  const ehJwt = (v) => typeof v === "string" && /^(Bearer\s+)?eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v.trim());
  const cofres = [];
  try { cofres.push(window.sessionStorage); } catch (e) { /* bloqueado */ }
  try { cofres.push(window.localStorage); } catch (e) { /* bloqueado */ }

  for (const cofre of cofres) {
    if (!cofre) continue;
    for (let i = 0; i < cofre.length; i++) {
      const chave = cofre.key(i);
      if (!chave) continue;
      const cru = cofre.getItem(chave);
      if (!cru) continue;
      if (ehJwt(cru)) return cru.trim();
      // Valor pode ser um JSON com o token dentro.
      if (cru.length < 20000 && (cru[0] === "{" || cru[0] === "[")) {
        try {
          const pilha = [JSON.parse(cru)];
          while (pilha.length) {
            const no = pilha.pop();
            if (ehJwt(no)) return String(no).trim();
            if (no && typeof no === "object") {
              for (const k of Object.keys(no)) pilha.push(no[k]);
            }
          }
        } catch (e) { /* não era JSON */ }
      }
    }
  }
  return null;
})()`;
