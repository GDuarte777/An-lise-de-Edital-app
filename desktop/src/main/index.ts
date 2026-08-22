import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AutenticacaoPlataforma, caminhoPadraoSessao } from "./auth/platform.js";
import { abrirLogin, abrirSalaDisputa, sair as sairComprasnet, sessaoComprasnet, verificarSessao } from "./auth/comprasnet.js";
import { GravadorTrafego } from "./engine/recorder.js";
import { MotorLances, type ConfiguracaoRobo, type EntradaLog, type EstadoRobo } from "./engine/engine.js";
import { ComprasnetAdapter } from "./engine/comprasnet.js";
import { SimulacaoAdapter } from "./engine/simulation.js";
import type { PortalAdapter } from "./engine/portal.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let janelaPrincipal: BrowserWindow | null = null;
let motor: MotorLances | null = null;
let gravador: GravadorTrafego | null = null;

const auth = new AutenticacaoPlataforma(
  process.env.VITE_SUPABASE_URL ?? "",
  process.env.VITE_SUPABASE_ANON_KEY ?? "",
  caminhoPadraoSessao(app.getPath("userData"))
);

function emitir(canal: string, carga: unknown): void {
  janelaPrincipal?.webContents.send(canal, carga);
}

function criarJanela(): void {
  janelaPrincipal = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: "HORASIS LanceBot",
    autoHideMenuBar: true,
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
ipcMain.handle("comprasnet:entrar", async () => abrirLogin(janelaPrincipal?.id));
ipcMain.handle("comprasnet:status", async () => verificarSessao());
ipcMain.handle("comprasnet:sair", async () => sairComprasnet());
ipcMain.handle("comprasnet:abrirSala", async () => abrirSalaDisputa());

// --- Modo Captura -----------------------------------------------------------
ipcMain.handle("captura:iniciar", async () => {
  gravador ??= new GravadorTrafego(sessaoComprasnet());
  gravador.iniciar();
  return { gravando: true };
});

ipcMain.handle("captura:parar", async () => {
  gravador?.parar();
  return { gravando: false, total: gravador?.total ?? 0 };
});

ipcMain.handle("captura:exportar", async () => {
  if (!gravador || gravador.total === 0) {
    throw new Error("Nada capturado ainda. Inicie o Modo Captura e navegue pela sala de disputa.");
  }
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Exportar captura de tráfego",
    defaultPath: `captura-comprasnet-${Date.now()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (canceled || !filePath) return { exportado: false };

  const chamadas = await gravador.exportar(filePath);
  return { exportado: true, caminho: filePath, chamadas };
});

// --- Robô -------------------------------------------------------------------
ipcMain.handle("robo:iniciar", async (_e, cfg: ConfiguracaoRobo & { modo: "real" | "simulacao" }) => {
  if (motor && motor.estadoAtual === "rodando") {
    throw new Error("Já existe um robô em execução. Pare o atual antes de iniciar outro.");
  }

  if (cfg.modo === "real") {
    const status = await verificarSessao();
    if (!status.autenticado) {
      throw new Error("Entre no Compras.gov.br antes de operar em modo real.");
    }
  }

  const portal: PortalAdapter =
    cfg.modo === "real" ? new ComprasnetAdapter(sessaoComprasnet()) : new SimulacaoAdapter(cfg.valorLimiteMinimo * 1.4);

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
