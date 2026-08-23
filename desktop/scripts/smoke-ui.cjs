/**
 * Sobe o aplicativo real sob display virtual e verifica se a interface passa da tela
 * "Carregando…". Foi exatamente esse passo que faltou antes de publicar a versão presa.
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");

let janela;
const LIMITE_MS = 25000;

function terminar(codigo, msg) {
  console.log(msg);
  try { janela && !janela.isDestroyed() && janela.destroy(); } catch {}
  app.exit(codigo);
}

app.whenReady().then(async () => {
  janela = new BrowserWindow({
    width: 1240, height: 880, show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "out", "preload", "index.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  janela.webContents.on("console-message", (_e, _lvl, m) => console.log("   [renderer]", m));
  janela.webContents.on("render-process-gone", (_e, d) => terminar(1, `FALHA: renderer morreu (${d.reason})`));

  await janela.loadFile(path.join(__dirname, "..", "out", "renderer", "index.html"));

  const inicio = Date.now();
  const timer = setInterval(async () => {
    let texto = "";
    try {
      texto = await janela.webContents.executeJavaScript("document.body.innerText");
    } catch (e) {
      return terminar(1, "FALHA ao ler o DOM: " + e.message);
    }

    const preso = texto.includes("Carregando");
    const chegouNoLogin = texto.includes("Entrar") && texto.includes("mail");
    const chegouNoCockpit = texto.includes("Compras.gov.br") || texto.includes("Calibra");

    if (chegouNoLogin || chegouNoCockpit) {
      clearInterval(timer);
      return terminar(0, `OK: interface renderizou em ${Date.now() - inicio}ms -> ${chegouNoCockpit ? "cockpit" : "tela de login"}`);
    }

    if (Date.now() - inicio > LIMITE_MS) {
      clearInterval(timer);
      return terminar(1, `FALHA: continua ${preso ? 'na tela "Carregando…"' : "sem conteudo reconhecivel"} apos ${LIMITE_MS}ms.\n--- texto na tela ---\n${texto.slice(0, 300)}`);
    }
  }, 700);
});

app.on("window-all-closed", () => app.quit());
