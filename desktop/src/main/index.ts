import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AutenticacaoPlataforma, caminhoPadraoSessao } from "./auth/platform.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";
import {
  abrirLogin,
  abrirPainelDisputas,
  abrirSalaDisputa,
  sair as sairComprasnet,
  sessaoComprasnet,
  verificarSessao
} from "./auth/comprasnet.js";
import { DescobridorApi, type EstadoCalibracao } from "./engine/discovery.js";
import { listarDisputas } from "./engine/disputas.js";
import { MotorLances, type ConfiguracaoRobo, type EntradaLog, type EstadoRobo } from "./engine/engine.js";
import { ComprasnetAdapter } from "./engine/comprasnet.js";
import { SimulacaoAdapter } from "./engine/simulation.js";
import type { PortalAdapter } from "./engine/portal.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let janelaPrincipal: BrowserWindow | null = null;
let motor: MotorLances | null = null;
let descobridor: DescobridorApi | null = null;

const auth = new AutenticacaoPlataforma(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  caminhoPadraoSessao(app.getPath("userData"))
);

function emitir(canal: string, carga: unknown): void {
  janelaPrincipal?.webContents.send(canal, carga);
}

/**
 * O descobridor observa o tráfego da sessão do portal desde o início, para que a
 * calibração aconteça só de o operador navegar — sem modo de captura para acionar.
 */
function obterDescobridor(): DescobridorApi {
  if (!descobridor) {
    descobridor = new DescobridorApi(
      sessaoComprasnet(),
      join(app.getPath("userData"), "calibracao-portal.json")
    );
    descobridor.observar((estado) => emitir("calibracao:atualizada", estado));
    void descobridor.carregar().then(() => descobridor?.ligar());
  }
  return descobridor;
}

function criarJanela(): void {
  janelaPrincipal = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    title: "HORASIS LanceBot",
    autoHideMenuBar: true,
    backgroundColor: "#0B0D12",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void janelaPrincipal.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void janelaPrincipal.loadFile(join(__dirname, "../renderer/index.html"));
  }

  janelaPrincipal.on("closed", () => {
    janelaPrincipal = null;
  });
}

// --- Plataforma HORASIS -----------------------------------------------------
ipcMain.handle("plataforma:entrar", async (_e, email: string, senha: string) => auth.entrar(email, senha));
ipcMain.handle("plataforma:restaurar", async () => auth.restaurarSessao());
ipcMain.handle("plataforma:sair", async () => auth.sair());

// --- Compras.gov.br ---------------------------------------------------------
ipcMain.handle("comprasnet:entrar", async () => {
  obterDescobridor(); // começa a observar antes de o portal abrir
  return abrirLogin(janelaPrincipal?.id);
});
ipcMain.handle("comprasnet:status", async () => verificarSessao());
ipcMain.handle("comprasnet:sair", async () => sairComprasnet());
ipcMain.handle("comprasnet:abrirSala", async (_e, pregaoId?: string) => {
  obterDescobridor();
  return abrirSalaDisputa(pregaoId);
});
ipcMain.handle("comprasnet:abrirPainel", async () => {
  obterDescobridor();
  return abrirPainelDisputas();
});

// --- Calibração -------------------------------------------------------------
ipcMain.handle("calibracao:estado", async (): Promise<EstadoCalibracao & { pronto: boolean }> => {
  const d = obterDescobridor();
  return { ...d.calibracao, pronto: d.prontoParaProducao };
});
ipcMain.handle("calibracao:esquecer", async () => {
  await obterDescobridor().esquecer();
  return { ok: true };
});

// --- Disputas ---------------------------------------------------------------
ipcMain.handle("disputas:listar", async () => listarDisputas(sessaoComprasnet(), obterDescobridor()));

// --- Robô -------------------------------------------------------------------
ipcMain.handle("robo:iniciar", async (_e, cfg: ConfiguracaoRobo & { modo: "real" | "simulacao" }) => {
  if (motor && motor.estadoAtual === "rodando") {
    throw new Error("Já existe um robô em execução. Pare o atual antes de iniciar outro.");
  }

  let portal: PortalAdapter;

  if (cfg.modo === "real") {
    const status = await verificarSessao();
    if (!status.autenticado) throw new Error("Entre no Compras.gov.br antes de operar em modo produção.");

    const d = obterDescobridor();
    if (!d.prontoParaProducao) {
      throw new Error(
        "O aplicativo ainda não aprendeu como o portal envia lances. Abra a sala de disputa deste item " +
          "e envie um lance manualmente uma vez — a partir daí o robô assume sozinho."
      );
    }
    portal = new ComprasnetAdapter(sessaoComprasnet(), d);
  } else {
    portal = new SimulacaoAdapter(cfg.valorLimiteMinimo * 1.4);
  }

  motor = new MotorLances(
    cfg,
    portal,
    (entrada: EntradaLog) => emitir("robo:log", entrada),
    (estado: EstadoRobo) => emitir("robo:estado", estado)
  );
  motor.iniciar();

  return { iniciado: true, portal: portal.nome, ehSimulacao: portal.ehSimulacao };
});

ipcMain.handle("robo:parar", async () => {
  motor?.parar();
  return { parado: true };
});

app.whenReady().then(() => {
  criarJanela();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  motor?.parar("Aplicativo encerrado.");
  if (process.platform !== "darwin") app.quit();
});
