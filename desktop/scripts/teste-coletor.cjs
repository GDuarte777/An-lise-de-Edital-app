/**
 * Testa o coletor contra uma tela falsa que se comporta como o Comprasnet descrito pelo
 * operador: nada de tempo real, e os lances só mudam quando alguém clica em "Atualizar".
 *
 * As duas coisas que precisam ser verdade, ou o coletor não serve para nada:
 *  1. ele descobre QUAL requisição o botão "Atualizar" dispara;
 *  2. nenhum dígito escapa para o arquivo — nada de valor de lance ou CNPJ.
 */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let falhas = 0;
const ok = (rotulo, cond, extra) => {
  if (cond) console.log(`  ✅ ${rotulo}`);
  else { console.log(`  ❌ ${rotulo}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`); falhas++; }
};

const RAIZ = path.join(__dirname, "..", "..", "coletor-comprasnet");
const ler = (n) => fs.readFileSync(path.join(RAIZ, n), "utf-8");

const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Compras.gov.br - Sessao Publica</title></head>
<body>
  <h1>Pregao Eletronico 90013/2025 - UASG 153036</h1>
  <p>CNPJ do fornecedor: 12.345.678/0001-99</p>
  <table>
    <thead><tr><th>Item</th><th>Descricao</th><th>Melhor lance</th><th>Seu lance</th><th>Situacao</th><th>Acao</th></tr></thead>
    <tbody>
      <tr>
        <td>1</td><td>Notebook</td><td id="melhor">R$ 1.250,50</td><td>R$ 1.300,00</td><td>Em disputa</td>
        <td><input id="lance" type="text" placeholder="Valor do lance" maxlength="15">
            <button id="enviar" type="button">Enviar lance</button></td>
      </tr>
    </tbody>
  </table>
  <button id="atualizar" type="button">Atualizar</button>
  <div id="aviso">Sua sessao expira em 5 minutos por inatividade.</div>
<script>
  // A tela NAO se atualiza sozinha: so muda quando o botao e clicado.
  document.getElementById("atualizar").addEventListener("click", function () {
    var x = new XMLHttpRequest();
    x.open("GET", "/comprasnet-web/api/sessao/90013/itens?t=" + Date.now());
    x.onload = function () { document.getElementById("melhor").textContent = "R$ 1.199,90"; };
    x.send();
  });
</script>
</body></html>`;

function subirServidor() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url.indexOf("/comprasnet-web/api/") === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"menorLance":1199.90}');
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGINA);
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

app.whenReady().then(async () => {
  const servidor = await subirServidor();
  const porta = servidor.address().port;
  const janela = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const rodar = (e) => janela.webContents.executeJavaScript(e, true);

  try {
    await janela.loadURL(`http://127.0.0.1:${porta}/`);
    await rodar(ler("gancho-pagina.js"));
    await rodar(ler("coletor.js"));
    ok("coletor carregou", (await rodar("Boolean(window.__horasisColetor)")) === true);

    console.log("\n[1] Descobre a requisicao que o botao Atualizar dispara");
    await rodar('document.getElementById("atualizar").click()');
    await new Promise((r) => setTimeout(r, 900));
    const d = await rodar("window.__horasisColetor.montar()");

    const clique = d.atualizacao.cliquesObservados.find((c) => /Atualizar/i.test(c.texto));
    ok("registrou o clique em Atualizar", Boolean(clique), d.atualizacao.cliquesObservados);
    ok("correlacionou com a requisicao",
       Boolean(clique && clique.requisicoesDepois.some((r) => /comprasnet-web\/api\/sessao/.test(r.url))),
       clique && clique.requisicoesDepois);

    console.log("\n[2] Confirma que a tela nao tem tempo real");
    ok("nenhum WebSocket/SSE", d.temTempoReal === false, d.tempoReal);

    console.log("\n[3] Enxerga campo, botao de lance e botao de atualizar");
    ok("achou o campo de lance",
       d.campos.some((c) => /Valor do lance/i.test(c.atributos.placeholder || "")), d.campos);
    ok("marcou o botao de lance",
       d.botoes.some((b) => b.pareceLance && /Enviar/i.test(b.texto)), d.botoes.map((b) => b.texto));
    ok("marcou o botao de atualizar", d.atualizacao.botoesComCaraDeAtualizar.length === 1,
       d.atualizacao.botoesComCaraDeAtualizar.map((b) => b.texto));

    console.log("\n[4] Le os cabecalhos da tabela");
    ok("cabecalhos capturados",
       d.tabelas.length === 1 && d.tabelas[0].cabecalhos.join("|") === "Item|Descricao|Melhor lance|Seu lance|Situacao|Acao",
       d.tabelas[0] && d.tabelas[0].cabecalhos);

    console.log("\n[5] Acha o aviso de sessao");
    ok("aviso de sessao encontrado",
       d.sessao.avisosEncontrados.some((a) => /expira/i.test(a.texto)), d.sessao.avisosEncontrados);

    console.log("\n[6] NENHUM dado sensivel atravessa");
    const bruto = JSON.stringify(d);
    ok("nao vazou o valor do lance", !bruto.includes("1.250,50") && !bruto.includes("1250"), null);
    ok("nao vazou o CNPJ", !bruto.includes("12.345.678") && !bruto.includes("0001-99"), null);
    ok("nao vazou o numero do pregao", !bruto.includes("90013"), null);
    ok("nao vazou a UASG", !bruto.includes("153036"), null);
    ok("preservou a FORMA do valor", bruto.includes("R$ #.###,##"), null);
    ok("preservou a rota da API",
       bruto.includes("/comprasnet-web/api/sessao/{n}/itens"), null);
  } catch (e) {
    console.log("  ❌ excecao:", e && e.message);
    falhas++;
  } finally {
    if (!janela.isDestroyed()) janela.destroy();
    servidor.close();
  }

  console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
  app.exit(falhas === 0 ? 0 : 1);
});
