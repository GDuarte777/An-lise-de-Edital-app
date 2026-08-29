/**
 * Testa o robô contra uma réplica da tela real do Compras.gov.br — a estrutura veio da
 * coleta feita na sessão do operador, não de suposição: `app-disputa-fornecedor-itens`
 * com cartões `app-card-item`, `app-identificacao-e-fase-item` para a fase, e
 * `app-situacao-conexao-sistema` com o botão "Recarregar página" que o portal mostra
 * quando a conexão cai.
 */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let falhas = 0;
const ok = (r, c, x) => {
  if (c) console.log(`  ✅ ${r}`);
  else { console.log(`  ❌ ${r}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); falhas++; }
};

const RAIZ = path.join(__dirname, "..", "..", "extensao-lancebot");
const ler = (n) => fs.readFileSync(path.join(RAIZ, n), "utf-8");

const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Compras.gov.br</title></head>
<body><app-root><main><div><div>
  <app-cabecalho-disputa-fornecedor><app-cabecalho-compra>
    <div>Enviar lance</div>
    <app-situacao-conexao-sistema><span id="conexao"></span></app-situacao-conexao-sistema>
  </app-cabecalho-compra></app-cabecalho-disputa-fornecedor>

  <app-disputa-fornecedor-itens><div><p-dataview><div>
    <app-card-item>
      <div>
        <app-identificacao-e-fase-item><div><div>1 - Em disputa</div></div></app-identificacao-e-fase-item>
        <div><span>Melhor valor (unitário)</span><span id="melhor">R$ 1.250,50</span></div>
        <div><span>Seu lance</span><span>R$ 1.300,00</span></div>
        <div>
          <input id="lance" type="text" aria-label="Valor do lance" autocomplete="off">
          <button id="enviar" type="button" aria-label="Enviar lance">Enviar lance</button>
          <app-botao-expandir-item><button aria-label="Mostrar detalhes do item">Detalhes</button></app-botao-expandir-item>
        </div>
      </div>
    </app-card-item>

    <app-card-item>
      <div>
        <app-identificacao-e-fase-item><div><div>2 - Encerrado</div></div></app-identificacao-e-fase-item>
        <div><span>Melhor valor (unitário)</span><span>R$ 780,00</span></div>
      </div>
    </app-card-item>

    <app-card-item>
      <div>
        <app-identificacao-e-fase-item><div><div>3 - Em disputa</div></div></app-identificacao-e-fase-item>
        <div><span>Melhor valor (unitário)</span><span>R$ 2.500,7500</span></div>
        <div>
          <input id="lance4" type="text" aria-label="Valor do lance" class="p-inputtext">
          <button id="enviar4" type="button" aria-label="Enviar lance">Enviar lance</button>
        </div>
      </div>
    </app-card-item>
  </div></p-dataview></div></app-disputa-fornecedor-itens>
</div></div></main></app-root>

<div id="modal" role="dialog" style="display:none">
  <p>Confirma o lance?</p><button id="cancelar">Cancelar</button><button id="confirmar">Confirmar</button>
</div>

<script>
  // Máscara de moeda igual à dos portais: reescreve o campo a cada tecla.
  var campo = document.getElementById("lance");
  campo.addEventListener("input", function () {
    var d = campo.value.replace(/\\D/g, "").slice(0, 12);
    campo.value = d ? (Number(d) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  });
  // Mascara de QUATRO casas, como o portal usa em valor unitario.
  var campo4 = document.getElementById("lance4");
  campo4.addEventListener("input", function () {
    var d = campo4.value.replace(/\\D/g, "").slice(0, 12);
    campo4.value = d ? (Number(d) / 10000).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : "";
  });
  document.getElementById("enviar4").addEventListener("click", function () {
    var x = new XMLHttpRequest();
    x.open("POST", "/comprasnet-disputa/v1/compras/900/itens/3/lances");
    x.send(JSON.stringify({ valor: campo4.value }));
  });

  var modal = document.getElementById("modal");
  document.getElementById("enviar").addEventListener("click", function () { modal.style.display = "block"; });
  document.getElementById("confirmar").addEventListener("click", function () {
    modal.style.display = "none";
    var x = new XMLHttpRequest();
    x.open("POST", "/comprasnet-disputa/v1/compras/900/itens/1/lances");
    x.send(JSON.stringify({ valor: campo.value }));
  });
  window.__cairConexao = function () {
    document.getElementById("conexao").innerHTML =
      '<button aria-label="Recarregar página">Recarregar página</button>';
  };
</script>
</body></html>`;

let recebido = null;
function servidor() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      if (req.method === "POST" && /lances/.test(req.url)) {
        let c = ""; req.on("data", (d) => (c += d));
        return req.on("end", () => { recebido = c; res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); });
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(PAGINA);
    });
    s.listen(0, "127.0.0.1", () => r(s));
  });
}

app.whenReady().then(async () => {
  const s = await servidor();
  const janela = new BrowserWindow({ show: false, width: 1400, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const rodar = (e) => janela.webContents.executeJavaScript(e, true);

  try {
    await janela.loadURL(`http://127.0.0.1:${s.address().port}/`);
    await rodar(ler("pagina.js"));
    await rodar(ler("margem.js"));
    await rodar(ler("conteudo.js"));
    ok("robô carregou", (await rodar("Boolean(window.__lancebot)")) === true);

    console.log("\n[1] Le o cartao do item na estrutura real do portal");
    const i1 = await rodar('(() => { const i = __lancebot.acharItem("1"); return {n:i.numero, m:i.melhorValor, meu:i.meuValor, a:i.aberto}; })()');
    ok("item 1 identificado", i1.n === "1", i1);
    ok("melhor valor = 1250.50", i1.m === 1250.5, i1);
    ok("meu lance = 1300.00", i1.meu === 1300, i1);
    ok("item aberto", i1.a === true, i1);

    const i2 = await rodar('(() => { const c = __lancebot.cartoes()[1]; const i = __lancebot.lerCartao(c); return {n:i.numero, a:i.aberto}; })()');
    ok("item 2 lido como encerrado", i2.a === false, i2);

    console.log("\n[2] Guarda de margem");
    const g = await rodar(`(() => {
      const M = window.__lancebotMargem, agora = Date.now();
      return {
        abaixoDoPiso: M.decidir({piso:1245,decremento:10,tipo:"fixo"}, {melhorValor:1250.5,aberto:true,lidoEm:agora}, agora),
        okAcima:      M.decidir({piso:1000,decremento:10,tipo:"fixo"}, {melhorValor:1250.5,aberto:true,lidoEm:agora}, agora),
        velha:        M.decidir({piso:1000,decremento:10,tipo:"fixo"}, {melhorValor:1250.5,aberto:true,lidoEm:agora-20000}, agora),
        liderando:    M.decidir({piso:1000,decremento:10,tipo:"fixo"}, {melhorValor:1250.5,meuValor:1200,aberto:true,lidoEm:agora}, agora)
      };
    })()`);
    ok("recusa lance abaixo do piso", g.abaixoDoPiso.acao === "parar", g.abaixoDoPiso);
    ok("aceita lance acima do piso", g.okAcima.acao === "enviar" && g.okAcima.valor === 1240.5, g.okAcima);
    ok("RECUSA leitura velha (conexao caida)", g.velha.acao === "parar" && /velha/.test(g.velha.motivo), g.velha);
    ok("aguarda quando ja lidera", g.liderando.acao === "aguardar", g.liderando);

    console.log("\n[3] Envia o lance vencendo a mascara de moeda");
    const env = await rodar('(async () => { const i = __lancebot.acharItem("1"); return await __lancebot.enviarLance(i, 1240.50); })()');
    ok("envio concluido", env.ok === true, env);
    ok("portal confirmou", env.confirmado === true, env);
    ok("lance aceito", env.aceito === true, env.motivo);
    ok("valor exato chegou ao servidor", recebido === '{"valor":"1.240,50"}', recebido);

    console.log("\n[4] Valor que a mascara corrompe NAO vira clique");
    recebido = null;
    await rodar('document.getElementById("lance").addEventListener("input", function(){ this.value = "0,00"; })');
    const ruim = await rodar('(async () => { const i = __lancebot.acharItem("1"); return await __lancebot.enviarLance(i, 999.99); })()');
    ok("recusa antes de clicar", ruim.ok === false && /não aceitou/.test(ruim.motivo), ruim);
    ok("nenhum lance enviado", recebido === null, recebido);

    console.log("\n[5] Quatro casas decimais - o formato real do portal");
    const l3 = await rodar('(() => { const i = __lancebot.acharItem("3"); return {n:i.numero, m:i.melhorValor, a:i.aberto}; })()');
    ok("le 2.500,7500 sem truncar", l3.m === 2500.75, l3);
    recebido = null;
    const env4 = await rodar('(async () => { const i = __lancebot.acharItem("3"); return await __lancebot.enviarLance(i, 2490.5); })()');
    ok("envio com mascara de 4 casas", env4.ok === true && env4.aceito === true, env4);
    ok("valor exato com 4 casas", recebido === '{"valor":"2.490,5000"}', recebido);

    console.log("\n[6] Renovacao de token NAO e tratada como queda");
    await rodar('window.postMessage({__lancebot:true, tipo:"retoken", em:Date.now()}, "*")');
    await new Promise((r) => setTimeout(r, 200));
    ok("registrou renovacao sem parar o robo",
       (await rodar('__lancebot.estado.log.some(l => /renovou o token/.test(l.msg))')) === true);

    console.log("\n[7] Detecta a queda de conexao do portal");
    ok("conexao ok antes", (await rodar("__lancebot.conexaoCaiu()")) === false);
    await rodar("window.__cairConexao()");
    ok("detecta 'Recarregar pagina'", (await rodar("__lancebot.conexaoCaiu()")) === true);
  } catch (e) {
    console.log("  ❌ excecao:", e && e.message); falhas++;
  } finally {
    if (!janela.isDestroyed()) janela.destroy();
    s.close();
  }

  console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
  app.exit(falhas === 0 ? 0 : 1);
});
