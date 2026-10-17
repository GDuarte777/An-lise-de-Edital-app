import { app, BrowserWindow, dialog, net, session, type Session, type WebContents } from "electron";
import { join } from "node:path";

import {
  CANDIDATOS_APLICATIVO,
  DOMINIOS_COOKIE,
  FONTE_REGEX_HOST,
  RegistroEnderecos,
  lembrarAutorizacaoSso,
  PRECISA_ENTRAR,
  URL_ENTRADA_LOGIN,
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
/** Em que ponto do acesso o aplicativo está — a tela mostra isto enquanto espera. */
export type EtapaLogin = "abrindo" | "login" | "concluindo";

/**
 * Login: abre a página do gov.br, espera o operador entrar, fecha.
 *
 * Esta função já teve escolha de perfil clicada sozinha, navegação para o aplicativo
 * novo, janela oculta que aparecia e sumia. Cada acréscimo resolvia um sintoma e criava
 * outro — o último foi a janela piscando entre a tela de erro e o carregamento, porque o
 * laço mandava mostrar e esconder a cada ciclo.
 *
 * Então o fluxo saiu. O que sobrou é o que o operador pediu: uma janela, a página de
 * login, e o fechamento assim que ele entra. O que o robô precisa (a sessão do portal
 * novo) é buscado DEPOIS, em janela oculta — se não vier, o aplicativo diz isso, mas
 * nada mais pisca na frente de ninguém.
 */
export async function abrirLogin(
  paiId?: number,
  aoAbrirJanela?: (idJanela: number) => void,
  aoProgresso?: (etapa: EtapaLogin) => void
): Promise<StatusSessao> {
  const pai = typeof paiId === "number" ? BrowserWindow.fromId(paiId) : null;

  const janela = new BrowserWindow({
    width: 1100,
    height: 800,
    parent: pai ?? undefined,
    modal: false,
    title: "Entrar no gov.br",
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
  aoProgresso?.("login");

  // Entrada única: a porta do portal, que redireciona ao gov.br com um identificador
  // recém-emitido. É o passo 1 do caminho que o próprio operador mapeou.
  try {
    await janela.loadURL(URL_LOGIN_LEGADO);
  } catch {
    // A janela mostra o erro de rede do Chromium; o laço abaixo segue esperando.
  }

  const abertaEm = Date.now();
  const janelas: BrowserWindow[] = [janela];

  return new Promise<StatusSessao>((resolve) => {
    let resolvido = false;
    let fechando = false;

    const concluir = async () => {
      if (resolvido) return;
      resolvido = true;
      clearInterval(timer);
      aoProgresso?.("concluindo");
      // A sessão do portal novo (a que o robô usa) é buscada agora, sem janela visível.
      await colherTokenEmSegundoPlano().catch(() => false);
      resolve(await verificarSessao(true));
    };

    const vivas = () => janelas.filter((j) => !j.isDestroyed());
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
        if (fechando || Date.now() - abertaEm < 2500) return;

        /*
         * Entrou? Duas evidências bastam, e nenhuma depende de adivinhar tela:
         *  - a página saiu do gov.br e voltou para um host do portal; ou
         *  - a tela mostra identificação (CPF/CNPJ) ou botão de sair.
         * Qualquer uma delas fecha a janela na hora, que é o que foi pedido.
         */
        let entrou = false;
        for (const j of abertas) {
          const sonda = await sondar(j.webContents);
          if (!sonda) continue;
          if (autenticadoPor(sonda)) entrou = true;
          if (!sonda.noSso && sonda.noPortal && !sonda.temSenha && !sonda.escolhendoPerfil) entrou = true;
        }
        if (!entrou) return;

        fechando = true;
        for (const j of vivas()) j.close();
        await concluir();
      })();
    }, 800);
  });
}

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
  // Primeiro o caminho direto: pedir à API. Só se ele falhar é que se abre uma janela.
  if (await obterTokenPelaApi()) return true;

  /*
   * Plano B, invisível: a porta do aplicativo novo.
   *
   * Sem sessão, essa rota desenha "Acesso não autorizado" com o botão Efetuar Login.
   * Com a sessão do gov.br já feita (o operador acabou de entrar), clicar nele costuma
   * ser um vaivém silencioso que termina com a sessão do portal novo criada — e é dela
   * que o token nasce.
   *
   * Isto acontece numa janela OCULTA de propósito: se o portal mostrar erro, tela de
   * perfil ou qualquer outra coisa, ninguém vê. Foi tentar fazer o mesmo na janela do
   * operador que produziu a tela piscando.
   */
  const janela = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true }
  });

  const esperarToken = async (voltas: number): Promise<boolean> => {
    for (let i = 0; i < voltas; i++) {
      if (coletor.tokenAtual()) return true;
      if (janela.isDestroyed()) return false;
      await new Promise((r) => setTimeout(r, 400));
    }
    return coletor.tokenAtual() !== null;
  };

  try {
    for (const url of [URL_ENTRADA_LOGIN, ...CANDIDATOS_APLICATIVO]) {
      if (janela.isDestroyed()) return false;
      try {
        await janela.loadURL(url);
      } catch {
        continue;
      }
      if (await esperarToken(10)) return true;

      // Porta fechada: clica em "Efetuar Login" e deixa o vaivém do gov.br acontecer.
      if (PRECISA_ENTRAR.test(janela.webContents.getURL())) {
        try {
          const clicou = (await janela.webContents.executeJavaScript(SCRIPT_CLICAR_ENTRAR, true)) as boolean;
          if (clicou && (await esperarToken(40))) return true;
        } catch {
          // Sem clique: tenta a próxima rota.
        }
      }

      if (!janela.isDestroyed() && (await colherTokenDaJanela(janela.webContents))) return true;
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
