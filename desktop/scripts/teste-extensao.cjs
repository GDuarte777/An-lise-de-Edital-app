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

<app-todos-lances><div><p-table><table>
  <thead><tr><th>Data/hora registro</th><th>Valor do lance (unitário)</th></tr></thead>
  <tbody>
    <tr><td>29/08/2026 15:04:11</td><td>R$ 1.199,9000</td></tr>
    <tr><td>29/08/2026 15:03:02</td><td>R$ 1.250,5000</td></tr>
  </tbody></table></p-table></div></app-todos-lances>

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

/**
 * A tela de disputa REAL, como a coleta do operador mostrou em fase de lances:
 *
 *  - NÃO existe `app-card-item` — os itens são `div` dentro de `p-dataview`;
 *  - o campo de lance é um `input` sem rótulo, sem aria-label e sem formcontrolname,
 *    cujo `id` é o NÚMERO DO ITEM ("2", "3") — e `#2` nem seletor CSS válido é;
 *  - o botão só se identifica pelo `title="Clique aqui ou tecle enter para enviar
 *    seu lance."`;
 *  - o desfecho aparece num toast: "Lance registrado com sucesso.";
 *  - não há modal de confirmação: o POST sai direto do clique.
 */
const TELA_REAL = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Compras.gov.br</title></head><body>
<app-root><main><div><div>
 <app-cabecalho-disputa-fornecedor><app-cabecalho-compra>
   <app-situacao-conexao-sistema><span id="conexao"></span></app-situacao-conexao-sistema>
   <app-tempo-restante><div><label>Tempo restante para envio de lances:</label><span>00:02:41</span></div></app-tempo-restante>
 </app-cabecalho-compra></app-cabecalho-disputa-fornecedor>

 <app-disputa-fornecedor-itens><div><p-dataview><div>
   <div>
     <div><span>Valor do lance (unitário)</span><span>R$ 1.500,0000</span></div>
     <div><span>Seu lance</span><span>R$ 1.700,0000</span></div>
     <div><div><div>
       <input id="2" maxlength="15" class="ng-tns-c1-1 p-component p-inputtext" autocomplete="off">
       <button type="button" title="Clique aqui ou tecle enter para enviar seu lance." class="br-button p-2">Enviar lance</button>
     </div></div></div>
   </div>
   <div>
     <div><span>Valor do lance (unitário)</span><span>R$ 2.000,0000</span></div>
     <div><div><div>
       <input id="3" maxlength="15" class="ng-tns-c1-2 p-component p-inputtext" autocomplete="off">
       <button type="button" title="Clique aqui ou tecle enter para enviar seu lance." class="br-button p-2">Enviar lance</button>
     </div></div></div>
   </div>
 </div></p-dataview></div></app-disputa-fornecedor-itens>
</div></div></main></app-root>

<div id="toast-msgs"></div>

<div id="fim" role="dialog" style="display:none"><app-dialog-confirmacao>
  <span>A sessão pública foi aberta e todos os itens estão encerrados. Aguarde o início da etapa de julgamento de propostas.</span>
  <button type="button">Ok</button>
</app-dialog-confirmacao></div>

<script>
  // Mascara de QUATRO casas, como o portal usa em valor unitario.
  ["2","3"].forEach(function (id) {
    var c = document.getElementById(id);
    c.addEventListener("input", function () {
      var d = c.value.replace(/\\D/g, "").slice(0, 12);
      c.value = d ? (Number(d) / 10000).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : "";
    });
    c.nextElementSibling.addEventListener("click", function () {
      var x = new XMLHttpRequest();
      x.open("POST", "/comprasnet-disputa/v1/compras/900/itens/" + id + "/lances");
      x.onload = function () {
        document.getElementById("toast-msgs").innerHTML =
          '<p-toastitem><div><div>Lance registrado com sucesso.</div></div></p-toastitem>';
      };
      x.send(JSON.stringify({ item: id, valor: c.value }));
    });
  });
  window.__abrirFimDeSessao = function () { document.getElementById("fim").style.display = "block"; };
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
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.url === "/real" ? TELA_REAL : PAGINA);
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

    console.log("\n[5] Historico de lances - componente app-todos-lances");
    ok("le o melhor lance do historico",
       (await rodar("__lancebot.melhorDoHistorico()")) === 1199.9,
       await rodar("__lancebot.melhorDoHistorico()"));

    console.log("\n[6] Quatro casas decimais - o formato real do portal");
    const l3 = await rodar('(() => { const i = __lancebot.acharItem("3"); return {n:i.numero, m:i.melhorValor, a:i.aberto}; })()');
    ok("le 2.500,7500 sem truncar", l3.m === 2500.75, l3);
    recebido = null;
    const env4 = await rodar('(async () => { const i = __lancebot.acharItem("3"); return await __lancebot.enviarLance(i, 2490.5); })()');
    ok("envio com mascara de 4 casas", env4.ok === true && env4.aceito === true, env4);
    ok("valor exato com 4 casas", recebido === '{"valor":"2.490,5000"}', recebido);

    console.log("\n[7] Renovacao de token NAO e tratada como queda");
    await rodar('window.postMessage({__lancebot:true, tipo:"retoken", em:Date.now()}, "*")');
    await new Promise((r) => setTimeout(r, 200));
    ok("registrou renovacao sem parar o robo",
       (await rodar('__lancebot.estado.log.some(l => /renovou o token/.test(l.msg))')) === true);

    console.log("\n[8] Detecta a queda de conexao do portal");
    ok("conexao ok antes", (await rodar("__lancebot.conexaoCaiu()")) === false);
    await rodar("window.__cairConexao()");
    ok("detecta 'Recarregar pagina'", (await rodar("__lancebot.conexaoCaiu()")) === true);

    console.log("\n[9] Painel do operador");
    await rodar(ler("painel.js"));
    ok("painel montou", (await rodar("Boolean(window.__lancebotPainel)")) === true);
    ok("painel vive em shadow DOM (nao vaza para a pagina)",
       (await rodar('document.querySelector("#piso") === null && Boolean(document.getElementById("horasis-lancebot-painel"))')) === true);
    ok("painel NAO e confundido com o campo de lance do item",
       (await rodar('(() => { const c = __lancebot.cartoes()[0]; const r = __lancebot.controles(c, null); return r.campo && r.campo.id; })()')) === "lance");

    const moeda = await rodar(`(() => { const L = __lancebotPainel.lerMoeda; return {
      br: L("1.250,50"), simples: L("1250,50"), ponto: L("1250.50"),
      milhar: L("1.250"), comRs: L("R$ 1.250,50"), lixo: L("abc"), vazio: L("")
    }; })()`);
    ok("le 1.250,50", moeda.br === 1250.5, moeda);
    ok("le 1250,50", moeda.simples === 1250.5, moeda);
    ok("le 1250.50", moeda.ponto === 1250.5, moeda);
    ok("le 1.250 como mil duzentos e cinquenta", moeda.milhar === 1250, moeda);
    ok("ignora o R$", moeda.comRs === 1250.5, moeda);
    ok("recusa texto invalido", moeda.lixo === null && moeda.vazio === null, moeda);

    const val = await rodar(`(() => { const V = __lancebotPainel.validar; return {
      semItem:   V({item:"",  piso:"100", decremento:"1",  tipo:"fixo"}),
      pisoRuim:  V({item:"1", piso:"abc", decremento:"1",  tipo:"fixo"}),
      decZero:   V({item:"1", piso:"100", decremento:"0",  tipo:"fixo"}),
      pctCheio:  V({item:"1", piso:"100", decremento:"100",tipo:"percentual"}),
      bom:       V({item:"1", piso:"1.200,00", decremento:"0,50", tipo:"fixo"})
    }; })()`);
    ok("recusa sem item", val.semItem.ok === false, val.semItem);
    ok("recusa piso invalido", val.pisoRuim.ok === false, val.pisoRuim);
    ok("recusa decremento zero", val.decZero.ok === false, val.decZero);
    ok("recusa percentual de 100%", val.pctCheio.ok === false, val.pctCheio);
    ok("aceita config valida", val.bom.ok === true && val.bom.cfg.piso === 1200 && val.bom.cfg.decremento === 0.5, val.bom);

    ok("lista os itens da tela no seletor",
       (await rodar('Array.from(__lancebotPainel.raiz.getElementById("item").options).map(o => o.value).join(",")')) === "1,2,3");

    const entregue = await rodar(`(async () => {
      const P = __lancebotPainel, r = P.raiz, original = __lancebot.ligar;
      let recebido = null;
      __lancebot.ligar = (item, cfg) => { recebido = { item, cfg }; };
      r.getElementById("item").value = "1";
      r.getElementById("piso").value = "1.200,00";
      r.getElementById("decremento").value = "0,50";
      r.getElementById("tipo").value = "fixo";
      r.getElementById("acao").click();
      __lancebot.ligar = original;
      return { recebido, erro: r.getElementById("erro").textContent };
    })()`);
    ok("Ligar entrega item e config ao robo",
       entregue.recebido && entregue.recebido.item === "1" &&
       entregue.recebido.cfg.piso === 1200 && entregue.recebido.cfg.decremento === 0.5, entregue);

    const recusa = await rodar(`(() => {
      const r = __lancebotPainel.raiz, original = __lancebot.ligar;
      let chamou = false;
      __lancebot.ligar = () => { chamou = true; };
      r.getElementById("piso").value = "";
      r.getElementById("acao").click();
      __lancebot.ligar = original;
      r.getElementById("piso").value = "1.200,00";
      return { chamou, erro: r.getElementById("erro").textContent };
    })()`);
    ok("piso vazio NAO liga o robo", recusa.chamou === false && /Piso/.test(recusa.erro), recusa);

    const parada = await rodar(`(() => {
      const r = __lancebotPainel.raiz;
      __lancebot.estado.ligado = true;
      __lancebotPainel.pintar();
      const rotulo = r.getElementById("acao").textContent;
      r.getElementById("acao").click();
      return { rotulo, ligado: __lancebot.estado.ligado };
    })()`);
    ok("botao vira 'Parar robo' com o robo ligado", /Parar/.test(parada.rotulo), parada);
    ok("Parar desliga o robo", parada.ligado === false, parada);

    const prev = await rodar(`(() => {
      const r = __lancebotPainel.raiz;
      r.getElementById("item").value = "1";
      r.getElementById("piso").value = "1.000,00";
      r.getElementById("decremento").value = "0,50";
      __lancebotPainel.pintar();
      return { previsto: r.getElementById("ePrevisto").textContent,
               melhor: r.getElementById("eMelhor").textContent };
    })()`);
    ok("mostra o melhor lance do item", prev.melhor === "R$ 1.250,50", prev);
    ok("mostra o proximo lance previsto", prev.previsto === "R$ 1.250,00", prev);

    const trava = await rodar(`(() => {
      const r = __lancebotPainel.raiz;
      r.getElementById("piso").value = "1.251,00";   // piso acima do proximo lance
      __lancebotPainel.pintar();
      return { previsto: r.getElementById("ePrevisto").textContent,
               erro: r.getElementById("erro").textContent };
    })()`);
    ok("piso alto some com a previsao e explica o motivo",
       trava.previsto === "\u2014" && /[Mm]argem/.test(trava.erro), trava);

    console.log("\n[10] A TELA REAL da disputa (coleta em fase de lances)");
    await janela.loadURL(`http://127.0.0.1:${s.address().port}/real`);
    await rodar(ler("pagina.js"));
    await rodar(ler("margem.js"));
    await rodar(ler("conteudo.js"));

    // Sem app-card-item na tela: o robô tinha que enxergar os itens assim mesmo.
    ok("nao existe app-card-item nesta tela",
       (await rodar('document.querySelectorAll("app-card-item").length')) === 0);
    ok("mesmo assim achou os 2 itens", (await rodar("__lancebot.cartoes().length")) === 2);

    const r2 = await rodar('(() => { const i = __lancebot.acharItem("2"); return {n:i.numero, m:i.melhorValor, meu:i.meuValor, a:i.aberto}; })()');
    ok("item 2 identificado pelo id do campo", r2.n === "2", r2);
    ok("le 1.500,0000 sem truncar", r2.m === 1500, r2);
    ok("le o proprio lance (1.700,0000)", r2.meu === 1700, r2);
    ok("item aberto", r2.a === true, r2);

    ok("acha o campo pelo id numerico",
       (await rodar('(() => { const i = __lancebot.acharItem("2"); return __lancebot.controles(i.cartao, null).campo.id; })()')) === "2");
    ok("acha o botao pelo title",
       (await rodar('(() => { const i = __lancebot.acharItem("2"); return __lancebot.controles(i.cartao, null).botao.getAttribute("title"); })()'))
         .indexOf("enviar seu lance") !== -1);

    // O escopo do item nao pode vazar para o vizinho.
    ok("o item 3 usa o campo 3, nao o 2",
       (await rodar('(() => { const i = __lancebot.acharItem("3"); return __lancebot.controles(i.cartao, null).campo.id; })()')) === "3");

    console.log("\n[11] Envio real: valor certo, item certo, confirmacao certa");
    recebido = null;
    const envReal = await rodar('(async () => { const i = __lancebot.acharItem("2"); return await __lancebot.enviarLance(i, 1490.5); })()');
    ok("envio confirmado", envReal.ok === true && envReal.confirmado === true, envReal);
    ok("lance aceito", envReal.aceito === true, envReal.motivo);
    ok("chegou no item 2, com 4 casas", recebido === '{"item":"2","valor":"1.490,5000"}', recebido);

    recebido = null;
    const env3 = await rodar('(async () => { const i = __lancebot.acharItem("3"); return await __lancebot.enviarLance(i, 1980.25); })()');
    ok("lance do item 3 vai para o item 3", recebido === '{"item":"3","valor":"1.980,2500"}', recebido);
    ok("item 3 aceito", env3.aceito === true, env3.motivo);

    console.log("\n[12] O aviso de fim de sessao NAO e clicado como se fosse lance");
    await rodar("window.__abrirFimDeSessao()");
    ok("modal de fim de sessao esta na tela",
       (await rodar('document.getElementById("fim").style.display')) === "block");
    ok("o robo NAO trata o 'Ok' dele como confirmacao de lance",
       (await rodar("__lancebot.botaoConfirmacao() === null")) === true);

  } catch (e) {
    console.log("  ❌ excecao:", e && e.message); falhas++;
  } finally {
    if (!janela.isDestroyed()) janela.destroy();
    s.close();
  }

  console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
  app.exit(falhas === 0 ? 0 : 1);
});
