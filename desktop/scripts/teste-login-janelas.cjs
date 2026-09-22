/**
 * Os dois defeitos que faziam o operador logar e o aplicativo dizer "sem sessão".
 *
 * 1. O portal abre uma JANELA NOVA no meio do login (`window.open`). O aplicativo
 *    vigiava só a janela que ele criou — ficava olhando uma página de redirecionamento
 *    enquanto o login acontecia na janela ao lado. Sintoma: a janela nunca fechava e a
 *    interface seguia dizendo "sem sessão".
 *
 * 2. A lista de domínios de cookie não tinha `estaleiro.serpro.gov.br`, que é onde o
 *    Compras.gov.br guarda a sessão. A contagem dava zero e o aplicativo respondia
 *    "ninguém entrou nesta máquina" SEM NEM ABRIR a página.
 */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const path = require("node:path");

app.on("window-all-closed", () => { /* o teste decide quando sair */ });

let falhas = 0;
const ok = (r, c, x) => {
  if (c) console.log(`  ✅ ${r}`);
  else { console.log(`  ❌ ${r}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); falhas++; }
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Página que só redireciona e abre a janela do login — como o SSO faz.
const INTERMEDIARIA = `<!doctype html><meta charset="utf-8"><body>
  <p>Redirecionando para o acesso...</p>
  <script>setTimeout(function(){ window.open("/logado", "_blank"); }, 200);</script>
</body>`;

const LOGADO = `<!doctype html><meta charset="utf-8"><title>Compras.gov.br</title><body>
  <header>GABRIEL DUARTE MOTA SOUZA | 063.976.775-32 | 45.153.397/0001-90 <a href="/logout">Sair</a></header>
  <main><h1>Compras eletrônicas</h1>
  <p>Etapa: Proposta. Acompanhe suas compras, envie propostas e registre lances dentro
     do prazo de cada item desta sessão pública.</p></main>
</body>`;

function servidor() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.url.indexOf("/logado") === 0 ? LOGADO : INTERMEDIARIA);
    });
    s.listen(0, "127.0.0.1", () => r(s));
  });
}

app.whenReady().then(async () => {
  const s = await servidor();
  const base = `http://127.0.0.1:${s.address().port}/`;

  require("tsx/cjs");
  const raiz = path.join(__dirname, "..", "src", "main", "auth");
  const { adotarFilhas, sondar } = require(path.join(raiz, "comprasnet.ts"));
  const { DOMINIOS_COOKIE } = require(path.join(raiz, "endereco.ts"));
  const { autenticadoPor } = require(path.join(raiz, "reconhecimento.ts"));

  try {
    console.log("\n[1] O dominio onde o portal guarda a sessao esta na lista");
    ok("procura cookie em estaleiro.serpro.gov.br",
       DOMINIOS_COOKIE.indexOf("estaleiro.serpro.gov.br") !== -1, DOMINIOS_COOKIE);
    ok("segue procurando nos dominios antigos",
       DOMINIOS_COOKIE.indexOf("comprasnet.gov.br") !== -1 &&
       DOMINIOS_COOKIE.indexOf("compras.gov.br") !== -1, DOMINIOS_COOKIE);
    ok("NAO conta o gov.br generico (cookie de consentimento nao e login)",
       DOMINIOS_COOKIE.indexOf("gov.br") === -1, DOMINIOS_COOKIE);

    console.log("\n[2] O portal abre janela nova: o app tem que adotar");
    const mae = new BrowserWindow({
      show: false, width: 900, height: 700, autoHideMenuBar: true,
      webPreferences: { partition: "persist:teste-login", nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    const adotadas = [];
    adotarFilhas(mae, (f) => adotadas.push(f));
    await mae.loadURL(base);
    await espera(1500);

    ok("a janela nova foi adotada", adotadas.length === 1, adotadas.length);
    const filha = adotadas[0];
    ok("a filha herdou a sessao (mesma partition)",
       filha && filha.webContents.session === mae.webContents.session);
    ok("a filha nao vem com barra de menu solta",
       filha && filha.autoHideMenuBar === true);

    console.log("\n[3] O login esta na FILHA, nao na mae — era isso que passava batido");
    const sMae = await sondar(mae.webContents);
    const sFilha = await sondar(filha.webContents);
    ok("a mae nao mostra login nenhum", autenticadoPor(sMae) === false, sMae);
    ok("a filha tem a identidade do operador", sFilha.temIdentidade === true, sFilha);
    ok("a filha tem opcao de sair", sFilha.temSair === true, sFilha);
    ok("a filha NAO esta no SSO nem com campo de senha",
       sFilha.noSso === false && sFilha.temSenha === false, sFilha);

    // `noPortal` é forçado porque o portal falso roda em 127.0.0.1. Todo o resto da
    // regra real continua valendo.
    ok("com a filha em maos, a regra reconhece o login",
       autenticadoPor({ ...sFilha, noPortal: true }) === true, sFilha);
    ok("olhando so a mae, como antes, NAO reconheceria",
       autenticadoPor({ ...sMae, noPortal: true }) === false, sMae);

    for (const j of [filha, mae]) if (j && !j.isDestroyed()) j.destroy();
  } catch (e) {
    console.log("  ❌ excecao:", e && e.stack); falhas++;
  } finally {
    s.close();
  }

  console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
  app.exit(falhas === 0 ? 0 : 1);
});
