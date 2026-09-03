import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AutenticacaoPlataforma, caminhoPadraoSessao } from "./auth/platform.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";
import {
  abrirLogin,
  abrirPainelDisputas,
  diagnosticarSessao,
  enderecoPortal,
  perguntarAoPortal,
  habilitarCertificadoDigital,
  partitionComprasnet,
  sair as sairComprasnet,
  sessaoComprasnet,
  verificarSessao
} from "./auth/comprasnet.js";
import { GuardiaoSessao, type EstadoGuardiao } from "./auth/sessao-viva.js";
import { DescobridorApi, type EstadoCalibracao } from "./engine/discovery.js";
import { listarDisputas } from "./engine/disputas.js";
import { observarSala, extrairValores, type EventoSala } from "./engine/sniffer.js";
import { MotorLances, type ConfiguracaoRobo, type EntradaLog, type EstadoRobo } from "./engine/engine.js";
import { GerenciadorSalas, SalaDisputaAdapter } from "./engine/sala.js";
import { SimulacaoAdapter } from "./engine/simulation.js";
import type { PortalAdapter, ReferenciaItem } from "./engine/portal.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let janelaPrincipal: BrowserWindow | null = null;
let motor: MotorLances | null = null;
let descobridor: DescobridorApi | null = null;
let salas: GerenciadorSalas | null = null;
let guardiao: GuardiaoSessao | null = null;

const auth = new AutenticacaoPlataforma(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  caminhoPadraoSessao(app.getPath("userData"))
);

function emitir(canal: string, carga: unknown): void {
  janelaPrincipal?.webContents.send(canal, carga);
}

function registrar(nivel: EntradaLog["nivel"], msg: string): void {
  emitir("robo:log", { em: new Date().toISOString(), nivel, msg });
}

/**
 * O descobridor observa o tráfego da sessão do portal desde o início, para que a
 * calibração aconteça só de o operador navegar — sem modo de captura para acionar.
 *
 * Desde que o robô passou a operar pela sala de disputa, a calibração deixou de ser
 * pré-requisito para operar: ela virou um atalho de leitura, não a condição de existir.
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

/** Gerenciador das salas de disputa — é por ele que o lance real acontece. */
function obterSalas(): GerenciadorSalas {
  if (!salas) {
    salas = new GerenciadorSalas({
      partition: partitionComprasnet(),
      caminhoSeletores: join(app.getPath("userData"), "seletores-sala.json"),
      aoRegistrar: (nivel, msg) => registrar(nivel, msg)
    });
    void salas.carregarSeletores();
  }
  return salas;
}

/**
 * Espelha, para a interface, o que a sala de disputa recebe em tempo real. É a via de
 * leitura que não depende de conhecer a API do portal: os dados chegam já decodificados,
 * no mesmo instante em que a página os recebe.
 */
function ligarObservador(idJanela: number): void {
  const janela = BrowserWindow.fromId(idJanela);
  if (!janela) return;

  observarSala(janela.webContents, (evento: EventoSala) => {
    emitir("sala:evento", evento);

    const valores = extrairValores(evento.dados);
    if (valores.length > 0) {
      emitir("robo:log", {
        em: evento.em,
        nivel: "concorrente",
        msg: `Sala: ${valores.map((v) => `R$ ${v.toFixed(2)}`).join(" · ")}`
      });
    }
  });
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
  obterSalas();
  // Liga também o observador de DOM nesta janela: o operador costuma continuar
  // navegando pelo portal aqui mesmo depois de logar.
  const status = await abrirLogin(janelaPrincipal?.id, ligarObservador);
  // Entrou: a partir daqui é o aplicativo que segura a sessão de pé.
  if (status.autenticado) void obterGuardiao().iniciar();
  return status;
});
ipcMain.handle("comprasnet:status", async (_e, forcar?: boolean) => verificarSessao(Boolean(forcar)));

// Diagnóstico da sessão: mostra ao operador EXATAMENTE o que o aplicativo enxergou em
// cada endereço tentado. "Sem sessão" sozinho é uma parede — ele vê o próprio nome e
// CNPJ no portal e o programa discorda, sem dizer em quê.
ipcMain.handle("comprasnet:diagnostico", async () => diagnosticarSessao());

/**
 * Guardião de sessão — a razão de o robô ser aplicativo instalado e não extensão.
 *
 * A sessão do gov.br cai em poucos minutos quando ninguém mexe na página. Numa aba do
 * navegador não há o que fazer: a aba vai para segundo plano e a sessão morre. Aqui a
 * janela é do aplicativo, então ele mesmo mantém a sessão viva, sem o operador apertar
 * F5 e sem tocar na janela onde o robô está operando.
 */
function obterGuardiao(): GuardiaoSessao {
  if (!guardiao) {
    guardiao = new GuardiaoSessao({
      partition: partitionComprasnet(),
      endereco: enderecoPortal,
      // Quem responde se a sessão vale é o portal, não o HTML que ele desenha.
      confirmar: async () => (await perguntarAoPortal()).ok,
      // Nunca rotacionar a sessão no meio de um envio de lance.
      podeRenovar: () => !motor?.ocupado,
      aoMudar: (estado) => emitir("sessao:guardiao", estado),
      aoRegistrar: (nivel, msg) => emitir("robo:log", { em: new Date().toISOString(), nivel, mensagem: msg })
    });
  }
  return guardiao;
}

ipcMain.handle("sessao:manterViva", async (): Promise<EstadoGuardiao> => obterGuardiao().iniciar());
ipcMain.handle("sessao:soltar", async (): Promise<EstadoGuardiao> => obterGuardiao().parar());
ipcMain.handle("sessao:guardiao", async (): Promise<EstadoGuardiao> => obterGuardiao().atual);
ipcMain.handle("comprasnet:sair", async () => {
  obterGuardiao().parar("Você saiu do Compras.gov.br.");
  obterSalas().fechar();
  return sairComprasnet();
});
ipcMain.handle("comprasnet:abrirSala", async (_e, pregaoId?: string) => {
  obterDescobridor();
  const janela = await obterSalas().garantir(pregaoId ?? "");
  ligarObservador(janela.id);
  return janela.id;
});
ipcMain.handle("comprasnet:abrirPainel", async () => {
  obterDescobridor();
  const id = await abrirPainelDisputas();
  ligarObservador(id);
  return id;
});

// --- Calibração -------------------------------------------------------------
ipcMain.handle("calibracao:estado", async (): Promise<EstadoCalibracao & { pronto: boolean }> => {
  const d = obterDescobridor();
  return { ...d.calibracao, pronto: d.prontoParaProducao };
});
ipcMain.handle("calibracao:observadas", async () => obterDescobridor().chamadasObservadas);
ipcMain.handle("calibracao:esquecer", async () => {
  await obterDescobridor().esquecer();
  return { ok: true };
});

// --- Disputas ---------------------------------------------------------------
ipcMain.handle("disputas:listar", async () => listarDisputas(sessaoComprasnet(), obterDescobridor(), obterSalas()));

// --- Sala de disputa --------------------------------------------------------
/**
 * Conferência antes de valer dinheiro: abre a sala do item, mostra o que o robô
 * enxerga e — se um valor for informado — digita esse valor no campo do portal e
 * confere se o campo o aceitou, SEM clicar em enviar.
 */
ipcMain.handle("sala:conferir", async (_e, ref: ReferenciaItem, valorEnsaio?: number) => {
  const s = obterSalas();
  const janela = await s.garantir(ref.pregaoId);
  ligarObservador(janela.id);

  const diagnostico = await s.diagnosticar(ref);
  const leitura = await s.ler(ref);
  const ensaio =
    typeof valorEnsaio === "number" && Number.isFinite(valorEnsaio) && valorEnsaio > 0
      ? await s.enviar(ref, valorEnsaio, true)
      : null;

  return { diagnostico, leitura, ensaio, seletores: s.seletoresAprendidos };
});

// --- Robô -------------------------------------------------------------------
ipcMain.handle("robo:iniciar", async (_e, cfg: ConfiguracaoRobo & { modo: "real" | "simulacao" }) => {
  if (motor && motor.estadoAtual === "rodando") {
    throw new Error("Já existe um robô em execução. Pare o atual antes de iniciar outro.");
  }

  let portal: PortalAdapter;

  if (cfg.modo === "real") {
    const status = await verificarSessao(true);
    if (!status.autenticado) {
      throw new Error(`Entre no Compras.gov.br antes de operar em produção. ${status.evidencia}`);
    }

    const s = obterSalas();
    const janela = await s.garantir(cfg.ref.pregaoId);
    ligarObservador(janela.id);

    // Só entra em disputa se o robô realmente enxergar os controles do item. Descobrir
    // isso no primeiro ciclo, com o pregão correndo, seria tarde demais.
    const diag = await s.diagnosticar(cfg.ref);
    if (!diag.campoLance || !diag.botaoEnvio) {
      throw new Error(
        `Na sala aberta não encontrei ${!diag.campoLance ? "o campo de lance" : "o botão de envio"} ` +
          `do item ${cfg.ref.itemNum}. Abra o item na sala e use "Conferir sala" para ver o que o robô enxerga.`
      );
    }

    portal = new SalaDisputaAdapter(s);
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
  habilitarCertificadoDigital();
  criarJanela();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  motor?.parar("Aplicativo encerrado.");
  if (process.platform !== "darwin") app.quit();
});
