/**
 * Prova o ponto central do robô: com o guardião ligado, a sessão do portal NÃO expira.
 *
 * O portal falso aqui imita o comportamento que o operador descreve: a sessão morre
 * sozinha depois de alguns segundos de silêncio, e qualquer carga da página dentro do
 * prazo a renova (é o que o SPA real faz com o `retoken`). Sem guardião, ela morre.
 * Com guardião, ela atravessa várias expirações seguidas.
 *
 * O reconhecedor recebe um seam que força `noPortal`, porque o portal falso roda em
 * 127.0.0.1. TODO o resto da regra real é exercitado: tela de login, campo de senha,
 * presença de "Sair" e da identidade.
 */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const path = require("node:path");

let falhas = 0;
const ok = (r, c, x) => {
  if (c) console.log(`  ✅ ${r}`);
  else { console.log(`  ❌ ${r}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); falhas++; }
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const VIDA_MS = 2500;          // a sessão falsa morre depois disto sem visita

let expiraEm = Date.now() + VIDA_MS;
let sempreMorta = false;
let cargas = 0;
let retokens = 0;

const LOGADO = `<!doctype html><meta charset="utf-8"><body>
  <header>Compras.gov.br — Portal de Compras do Governo Federal</header>
  <nav>FORNECEDOR TESTE LTDA — 12.345.678/0001-90 — 123.456.789-00 <a href="/logout">Sair</a></nav>
  <main>
    <h1>Painel do fornecedor</h1>
    <p>Suas disputas em fase de lances aparecem nesta area. Acompanhe as sessoes
       publicas, envie propostas e registre lances dentro do prazo de cada item.</p>
  </main>
</body>`;

const LOGIN = `<!doctype html><meta charset="utf-8"><body>
  <h1>Entrar</h1>
  <form><input type="text" name="cpf"><input type="password" name="senha"></form>
</body>`;

function servidor() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      if (/retoken/.test(req.url)) {
        retokens++;
        expiraEm = Date.now() + VIDA_MS;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end("{}");
      }
      cargas++;
      const viva = !sempreMorta && Date.now() < expiraEm;
      // Visitar dentro do prazo renova — é o que o SPA real faz sozinho.
      if (viva) expiraEm = Date.now() + VIDA_MS;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(viva ? LOGADO : LOGIN);
    });
    s.listen(0, "127.0.0.1", () => r(s));
  });
}

// Sem isto o Electron encerra o aplicativo quando a ultima janela e destruida — e o
// guardiao trabalha justamente em janelas ocultas que vao e voltam.
app.on("window-all-closed", () => { /* o teste decide quando sair */ });

app.whenReady().then(async () => {
  const s1 = await servidor();
  const s = await servidor();
  const base1 = `http://127.0.0.1:${s1.address().port}/`;
  const base = `http://127.0.0.1:${s.address().port}/`;

  require("tsx/cjs");
  const { GuardiaoSessao } = require(path.join(__dirname, "..", "src", "main", "auth", "sessao-viva.ts"));
  const { autenticadoPor } = require(path.join(__dirname, "..", "src", "main", "auth", "reconhecimento.ts"));

  // Seam: o portal falso roda em 127.0.0.1, então `noPortal` é forçado. TODO o resto da
  // regra real (SSO, campo de senha, "Sair", identidade, tamanho) continua valendo.
  const reconhecer = (x) => autenticadoPor(x ? { ...x, noPortal: true } : x);

  const registros = [];
  const comum = {
    partition: "persist:teste-sessao-viva",
    endereco: () => base,
    intervaloMs: 800,
    reconhecer,
    aoRegistrar: (nivel, msg) => registros.push({ nivel, msg })
  };

  try {
    console.log("\n[1] Sem guardiao, a sessao do portal falso morre sozinha");
    expiraEm = Date.now() + VIDA_MS;
    const solta = new BrowserWindow({ show: false, webPreferences: { partition: "persist:teste-sessao-solta", sandbox: true } });
    await solta.loadURL(base1);
    let temSair = await solta.webContents.executeJavaScript('/Sair/.test(document.body.innerText)', true);
    ok("comeca logado", temSair === true);
    await espera(VIDA_MS + 700);
    await solta.loadURL(base1);
    const temSenha = await solta.webContents.executeJavaScript('Boolean(document.querySelector("input[type=password]"))', true);
    ok("expira sozinha depois do prazo", temSenha === true);
    solta.destroy();

    console.log("\n[2] Com guardiao, a sessao atravessa varias expiracoes");
    expiraEm = Date.now() + VIDA_MS;
    const g = new GuardiaoSessao(comum);
    const inicial = await g.iniciar();
    ok("guardiao iniciou autenticado", inicial.ativo === true && inicial.autenticado === true, inicial);

    // Tres vezes o tempo de vida da sessao: sem guardiao ja teria morrido tres vezes.
    await espera(VIDA_MS * 3);
    const depois = g.atual;
    ok("continua ativo depois de 3x o prazo de expiracao", depois.ativo === true, depois);
    ok("continua autenticado", depois.autenticado === true, depois);
    ok("renovou varias vezes", depois.renovacoes >= 3, depois);
    ok("nenhuma falha acumulada", depois.falhasSeguidas === 0, depois);

    console.log("\n[3] Renovacao e adiada enquanto o robo esta dando lance");
    const antes = g.atual.renovacoes;
    const ocupado = new GuardiaoSessao({ ...comum, podeRenovar: () => false });
    await ocupado.iniciar();
    ok("nao renova enquanto ocupado", ocupado.atual.renovacoes === 0, ocupado.atual);
    ok("registrou o adiamento", registros.some((r) => /adiada/i.test(r.msg)), registros.slice(-3));
    ocupado.parar();
    ok("guardiao principal seguiu renovando", g.atual.renovacoes >= antes, g.atual);

    console.log("\n[4] Sessao perdida de verdade: para e avisa, nao insiste calado");
    sempreMorta = true;
    await espera(VIDA_MS + 1200);
    const morto = g.atual;
    ok("parou o guardiao", morto.ativo === false, morto);
    ok("marcou como nao autenticado", morto.autenticado === false, morto);
    ok("explica que caiu no login", /login|expirou/i.test(morto.motivo), morto);
    ok("avisou o operador para entrar de novo",
       registros.some((r) => r.nivel === "alerta" && /entre de novo/i.test(r.msg)), registros.slice(-3));

    console.log("\n[5] O guardiao trabalhou de verdade");
    ok("carregou a pagina varias vezes", cargas >= 5, { cargas, retokens });
  } catch (e) {
    console.log("  ❌ excecao:", e && e.stack); falhas++;
  } finally {
    s1.close();
    s.close();
  }

  console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
  app.exit(falhas === 0 ? 0 : 1);
});
