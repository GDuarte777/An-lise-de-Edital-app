/**
 * "Existe sessão?" passa a ser uma PERGUNTA AO PORTAL, não uma leitura de HTML.
 *
 * Três correções seguidas erraram sempre pelo mesmo motivo: a URL da página que o
 * aplicativo abria para decidir. O diagnóstico na máquina do operador mostrou o desfecho
 * disso — os três endereços que eu usava caíam em "acesso não autorizado" ou "página não
 * encontrada", com ele logado.
 *
 * `GET /comprasnet-usuario/v1/usuario` foi observado na coleta dele: 200 com sessão, sem
 * exigir token de captcha. Não há rota a adivinhar.
 */
const { app } = require("electron");
const http = require("node:http");
const path = require("node:path");

app.on("window-all-closed", () => { /* o teste decide quando sair */ });

let falhas = 0;
const ok = (r, c, x) => {
  if (c) console.log(`  ✅ ${r}`);
  else { console.log(`  ❌ ${r}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); falhas++; }
};

let logado = true;

function servidor() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      if (req.url.indexOf("/comprasnet-usuario/v1/usuario") === 0) {
        if (!logado) { res.writeHead(401); return res.end('{"erro":"nao autenticado"}'); }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"cpf":"06397677532","nome":"FORNECEDOR TESTE"}');
      }
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<body>Página não encontrada</body>");
    });
    s.listen(0, "127.0.0.1", () => r(s));
  });
}

app.whenReady().then(async () => {
  const s = await servidor();
  const base = `http://127.0.0.1:${s.address().port}`;

  require("tsx/cjs");
  const raiz = path.join(__dirname, "..", "src", "main", "auth");
  const { perguntarAoPortal } = require(path.join(raiz, "comprasnet.ts"));
  const { aprenderCom, URL_API_USUARIO, SEMENTES_PORTAL } = require(path.join(raiz, "endereco.ts"));

  try {
    console.log("\n[1] O portal responde, e e a resposta dele que decide");
    logado = true;
    const comSessao = await perguntarAoPortal(`${base}/comprasnet-usuario/v1/usuario`);
    ok("com sessao -> 200", comSessao.ok === true && comSessao.status === 200, comSessao);

    logado = false;
    const semSessao = await perguntarAoPortal(`${base}/comprasnet-usuario/v1/usuario`);
    ok("sem sessao -> 401", semSessao.ok === false && semSessao.status === 401, semSessao);

    const foraDoAr = await perguntarAoPortal("http://127.0.0.1:1/nao-existe");
    ok("portal fora do ar nao vira 'sem sessao' silencioso",
       foraDoAr.ok === false && foraDoAr.status === 0 && Boolean(foraDoAr.erro), foraDoAr);

    console.log("\n[2] O endpoint e o que a coleta do operador mostrou");
    ok("aponta para /comprasnet-usuario/v1/usuario",
       URL_API_USUARIO.endsWith("/comprasnet-usuario/v1/usuario"), URL_API_USUARIO);
    ok("no host onde o portal realmente responde",
       URL_API_USUARIO.indexOf("cnetmobile.estaleiro.serpro.gov.br") !== -1, URL_API_USUARIO);

    console.log("\n[3] As rotas inventadas sairam das sementes");
    const juntas = SEMENTES_PORTAL.join(" ");
    ok("nao ha /public/landing", juntas.indexOf("public/landing") === -1, SEMENTES_PORTAL);
    ok("nao ha /compras-eletronicas", juntas.indexOf("compras-eletronicas") === -1, SEMENTES_PORTAL);
    ok("sobrou a base do SPA", SEMENTES_PORTAL.some((u) => u.endsWith("/comprasnet-web/")), SEMENTES_PORTAL);

    console.log("\n[4] O aplicativo para de aprender endereco que nao serve");
    const h = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web";
    let e = aprenderCom({}, `${h}/acesso-nao-autorizado`);
    ok("nao aprende 'acesso nao autorizado'", e.portal === undefined, e);
    e = aprenderCom({}, `${h}/pagina-nao-encontrada`);
    ok("nao aprende 'pagina nao encontrada'", e.portal === undefined, e);
    // Este era o endereco APRENDIDO na maquina do operador, e ele nao abre nada.
    e = aprenderCom({}, `${h}/seguro/fornecedor/compras?compra=`);
    ok("nao aprende URL com parametro vazio", e.portal === undefined, e);
    e = aprenderCom({}, `${h}/seguro/fornecedor/disputa?compra=90013`);
    ok("mas segue aprendendo endereco bom", e.portal?.includes("compra=90013") === true, e);
  } catch (e) {
    console.log("  ❌ excecao:", e && e.stack); falhas++;
  } finally {
    s.close();
  }

  console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
  app.exit(falhas === 0 ? 0 : 1);
});
