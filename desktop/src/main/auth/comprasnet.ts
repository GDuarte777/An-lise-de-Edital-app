import { BrowserWindow, session, type Session } from "electron";

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
const URL_PORTAL = "https://www.gov.br/compras/pt-br/";
const URL_SALA_DISPUTA = "https://sala-disputa.comprasnet.gov.br/";

/** Domínios cuja presença de cookie de sessão indica login concluído. */
const DOMINIOS_SESSAO = ["comprasnet.gov.br", "compras.gov.br", "gov.br"];

export function sessaoComprasnet(): Session {
  return session.fromPartition(PARTITION);
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
  let total = 0;

  for (const domain of DOMINIOS_SESSAO) {
    const cookies = await ses.cookies.get({ domain });
    total += cookies.length;
  }

  return { autenticado: total > 0, verificadoEm: new Date(), cookiesEncontrados: total };
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

  await janela.loadURL(URL_PORTAL);

  return new Promise<StatusSessao>((resolve) => {
    janela.on("closed", () => {
      void verificarSessao().then(resolve);
    });
  });
}

/** Abre a sala de disputa na mesma sessão — usado junto com o Modo Captura. */
export async function abrirSalaDisputa(): Promise<number> {
  const janela = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "Sala de Disputa — Compras.gov.br",
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  await janela.loadURL(URL_SALA_DISPUTA);
  return janela.id;
}

/** Encerra a sessão local apagando os dados da partition. */
export async function sair(): Promise<void> {
  const ses = sessaoComprasnet();
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
}
