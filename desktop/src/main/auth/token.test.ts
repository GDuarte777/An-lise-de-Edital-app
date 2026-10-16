/**
 * Testes do coletor de sessão. O que importa: reconhecer token de verdade, descartar
 * lixo, tratar captcha velho como inexistente e nunca deixar a credencial escapar no
 * estado que vai para a interface.
 */
import {
  ColetorSessaoPortal,
  ehTokenPlausivel,
  extrairCaptcha,
  VALIDADE_CAPTCHA_MS,
  VALIDADE_TOKEN_MS
} from "./token.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
    falhas++;
  }
}

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibm9tZSI6IkhvcmFzaXMifQ.assinatura-que-nao-importa";
const API = "https://cnetmobile.estaleiro.serpro.gov.br";

console.log("\n[1] O que é token e o que é lixo");
{
  ok("Bearer + JWT", ehTokenPlausivel(`Bearer ${JWT}`));
  ok("JWT nu", ehTokenPlausivel(JWT));
  ok("Basic não é", !ehTokenPlausivel("Basic aG9yYXNpczpzZW5oYQ=="));
  ok('"Bearer undefined" não é', !ehTokenPlausivel("Bearer undefined"));
  ok("vazio não é", !ehTokenPlausivel(""));
  ok("duas partes não é JWT", !ehTokenPlausivel("eyJhbGciOiJIUzI1NiJ9.semterceiraparte"));
}

console.log("\n[2] Captcha na query");
{
  ok("colhe o valor", extrairCaptcha(`${API}/x?captcha=P1_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9`) !== null);
  ok("decodifica", extrairCaptcha(`${API}/x?captcha=abc%2Fdef${"g".repeat(20)}`)?.includes("/") === true);
  ok("sem captcha é null", extrairCaptcha(`${API}/x?compra=1`) === null);
  ok("valor curto é descartado", extrairCaptcha(`${API}/x?captcha=123`) === null);
}

console.log("\n[3] Colheita");
{
  let agora = 1_000_000;
  const c = new ColetorSessaoPortal(() => agora);
  ok("começa sem nada", c.tokenAtual() === null && c.captchaAtual() === null);

  c.observar({ url: `${API}/comprasnet-usuario/v1/usuario`, autorizacao: `Bearer ${JWT}` });
  ok("guardou o token", c.tokenAtual() === `Bearer ${JWT}`);
  ok("aprendeu o host da API", c.hostApi() === "cnetmobile.estaleiro.serpro.gov.br", c.hostApi());

  c.observar({ url: `${API}/comprasnet-disputa/v1/compras/em-disputa?captcha=${"t".repeat(40)}` });
  ok("guardou o captcha", c.captchaAtual() === "t".repeat(40));

  agora += VALIDADE_CAPTCHA_MS + 1;
  ok("captcha velho vale nada", c.captchaAtual() === null);
  ok("token ainda vale", c.tokenAtual() !== null);

  agora += VALIDADE_TOKEN_MS;
  ok("token velho vale nada", c.tokenAtual() === null);
}

console.log("\n[4] Token novo substitui o anterior");
{
  let agora = 2_000_000;
  const c = new ColetorSessaoPortal(() => agora);
  c.observar({ url: `${API}/a`, autorizacao: `Bearer ${JWT}` });
  const novo = JWT.replace("assinatura-que-nao-importa", "outra-assinatura");
  agora += 5_000;
  c.observar({ url: `${API}/comprasnet-usuario/v1/sessao/fornecedor/retoken`, autorizacao: `Bearer ${novo}` });
  ok("fica com o mais recente (o retoken)", c.tokenAtual() === `Bearer ${novo}`);
  ok("idade conta do mais recente", c.estado().idadeTokenS === 0, c.estado());
}

console.log("\n[5] O estado que vai para a interface não carrega credencial");
{
  const c = new ColetorSessaoPortal();
  c.observar({ url: `${API}/x?captcha=${"z".repeat(40)}`, autorizacao: `Bearer ${JWT}` });
  const texto = JSON.stringify(c.estado());
  ok("sem o token", !texto.includes(JWT.slice(0, 20)), texto);
  ok("sem o captcha", !texto.includes("zzzzzzzzzz"), texto);
  ok("mas diz que tem os dois", c.estado().temToken && c.estado().temCaptcha, c.estado());
  ok("e conta o que observou", c.estado().observadas === 1, c.estado());
}

console.log("\n[6] Sair do portal esquece a credencial");
{
  const c = new ColetorSessaoPortal();
  c.observar({ url: `${API}/x`, autorizacao: `Bearer ${JWT}` });
  c.esquecer();
  ok("token sumiu", c.tokenAtual() === null);
  ok("captcha sumiu", c.captchaAtual() === null);
}

console.log("\n[7] Lixo observado não vira sessão");
{
  const c = new ColetorSessaoPortal();
  c.observar({ url: "https://cdn.terceiro.com/script.js", autorizacao: "Basic abc" });
  c.observar({ url: `${API}/x`, autorizacao: "Bearer undefined" });
  ok("nada guardado", c.tokenAtual() === null, c.estado());
  ok("nenhuma observação aproveitada", c.estado().observadas === 0, c.estado());
}

console.log(falhas === 0 ? "\n🎉 coletor de sessão: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
