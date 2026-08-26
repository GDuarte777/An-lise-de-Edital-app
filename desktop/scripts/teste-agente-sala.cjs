/**
 * Testa o agente que opera a sala de disputa, contra uma sala falsa que se comporta
 * como o portal real: tabela de itens, campo com máscara de moeda, modal de confirmação
 * e POST de lance.
 *
 * É o teste que faltava. O robô só dá lance de verdade se este agente achar a linha do
 * item, acertar o valor mesmo com máscara, clicar no botão certo e reconhecer o desfecho
 * — e nada disso dá para verificar lendo o código.
 */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let falhas = 0;
const ok = (rotulo, cond, extra) => {
  if (cond) console.log(`  ✅ ${rotulo}`);
  else {
    console.log(`  ❌ ${rotulo}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`);
    falhas++;
  }
};

/* ------------------------------------------------ agente, transpilado na hora */

function fonteDoAgente() {
  const esbuild = require("esbuild");
  const saida = path.join(os.tmpdir(), "lancebot-sala-script.cjs");
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src", "main", "engine", "sala-script.ts")],
    outfile: saida,
    format: "cjs",
    platform: "node",
    bundle: false
  });
  const mod = require(saida);
  fs.rmSync(saida, { force: true });
  return mod.scriptAgenteSala({});
}

/* ------------------------------------------------------------- sala falsa */

const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Sala de Disputa</title></head>
<body>
  <h1>Pregão 90013/2025 — sessão pública</h1>
  <table>
    <thead>
      <tr><th>Item</th><th>Descrição</th><th>Melhor lance</th><th>Seu lance</th><th>Situação</th><th>Ação</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td><td>Notebook corporativo</td><td>R$ 1.250,50</td><td>R$ 1.300,00</td><td>Em disputa</td>
        <td><input id="lance1" type="text" placeholder="Valor do lance" autocomplete="off">
            <button id="btn1" type="button">Enviar lance</button></td>
      </tr>
      <tr>
        <td>2</td><td>Monitor 24"</td><td>R$ 780,00</td><td>—</td><td>Encerrado</td>
        <td><input id="lance2" type="text" placeholder="Valor do lance" disabled>
            <button id="btn2" type="button" disabled>Enviar lance</button></td>
      </tr>
    </tbody>
  </table>

  <div id="modal" role="dialog" style="display:none">
    <p>Confirma o lance?</p>
    <button id="cancelar" type="button">Cancelar</button>
    <button id="confirmar" type="button">Confirmar</button>
  </div>

<script>
  // Máscara de moeda igual à dos portais: reescreve o campo a cada tecla.
  var campo = document.getElementById("lance1");
  campo.addEventListener("input", function () {
    var dig = campo.value.replace(/\\D/g, "").slice(0, 12);
    campo.value = dig ? (Number(dig) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  });

  var modal = document.getElementById("modal");
  document.getElementById("btn1").addEventListener("click", function () { modal.style.display = "block"; });
  document.getElementById("cancelar").addEventListener("click", function () { modal.style.display = "none"; });
  document.getElementById("confirmar").addEventListener("click", function () {
    modal.style.display = "none";
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/lance");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({ item: 1, valor: campo.value }));
  });
</script>
</body></html>`;

let recebido = null;

function subirServidor() {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/lance") {
        let corpo = "";
        req.on("data", (c) => (corpo += c));
        req.on("end", () => {
          recebido = corpo;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"mensagem":"Lance registrado com sucesso"}');
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGINA);
    });
    servidor.listen(0, "127.0.0.1", () => resolve(servidor));
  });
}

/* ------------------------------------------------------------------ teste */

app.whenReady().then(async () => {
  const servidor = await subirServidor();
  const porta = servidor.address().port;

  const janela = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });

  const rodar = (expr) => janela.webContents.executeJavaScript(expr, true);

  try {
    await janela.loadURL(`http://127.0.0.1:${porta}/`);
    const estado = await rodar(fonteDoAgente());
    ok("agente injetado", estado === "ativo", estado);

    console.log("\n[1] Leitura do item em disputa");
    const l = await rodar('window.__lancebotSala.ler("1")');
    ok("achou o item", l.ok === true, l);
    ok("menor lance = 1250.50", l.menorLance === 1250.5, l.menorLance);
    ok("nosso lance = 1300.00", l.nossoLance === 1300, l.nossoLance);
    ok("item aberto", l.aberto === true, l.aberto);

    console.log("\n[2] Item encerrado e item inexistente");
    const l2 = await rodar('window.__lancebotSala.ler("2")');
    ok("item 2 lido como fechado", l2.aberto === false, l2);
    const l9 = await rodar('window.__lancebotSala.ler("99")');
    ok("item inexistente falha com motivo", l9.ok === false && typeof l9.motivo === "string", l9);

    console.log("\n[3] Diagnóstico: o robô enxerga os controles");
    const d = await rodar('window.__lancebotSala.diagnostico("1")');
    ok("escopo do item encontrado", d.escopoEncontrado === true, d);
    ok("campo de lance localizado", typeof d.campoLance === "string" && d.campoLance.includes("lance1"), d.campoLance);
    ok("botão de envio localizado", typeof d.botaoEnvio === "string" && d.botaoEnvio.includes("btn1"), d.botaoEnvio);

    console.log("\n[4] Ensaio: preenche e confere sem clicar");
    const seco = await rodar('window.__lancebotSala.enviar("1", 1240, { seco: true })');
    ok("ensaio aprovado", seco.ok === true && seco.etapa === "ensaio", seco);
    ok("nenhum POST no ensaio", recebido === null, recebido);
    ok("campo limpo depois do ensaio", (await rodar('document.getElementById("lance1").value')) === "", true);

    console.log("\n[5] Envio real: máscara, modal de confirmação e desfecho");
    const envio = await rodar('window.__lancebotSala.enviar("1", 1240)');
    ok("envio concluído", envio.ok === true && envio.etapa === "enviado", envio);
    ok("portal confirmou", envio.confirmado === true, envio);
    ok("lance aceito", envio.aceito === true, envio.mensagem);
    ok("valor chegou correto ao servidor", recebido === '{"item":1,"valor":"1.240,00"}', recebido);

    console.log("\n[6] Valor que a máscara não aceita não vira clique");
    recebido = null;
    await rodar('document.getElementById("lance1").addEventListener("input", function(){ this.value = "0,00"; })');
    const ruim = await rodar('window.__lancebotSala.enviar("1", 999.99)');
    ok("recusa na etapa de preenchimento", ruim.ok === false && ruim.etapa === "preencher", ruim);
    ok("nenhum lance foi enviado", recebido === null, recebido);

    console.log("\n[7] Listagem das disputas visíveis na tela");
    const lista = await rodar("window.__lancebotSala.listar()");
    ok("achou o pregão", lista.some((i) => i.pregaoId === "90013/2025"), lista.slice(0, 3));
  } catch (e) {
    console.log("  ❌ exceção:", e && e.message);
    falhas++;
  } finally {
    if (!janela.isDestroyed()) janela.destroy();
    servidor.close();
  }

  console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
  app.exit(falhas === 0 ? 0 : 1);
});
