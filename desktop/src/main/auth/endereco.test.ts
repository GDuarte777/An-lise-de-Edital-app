import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aprenderCom, ehEnderecoDoPortal, ehHostDoPortal, ehSalaDeDisputa,
  RegistroEnderecos, SEMENTES_PORTAL
} from "./endereco.js";

let falhas = 0;
const ok = (r: string, c: boolean, x?: unknown) => {
  if (c) console.log(`  ✅ ${r}`);
  else { console.log(`  ❌ ${r}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); falhas++; }
};

console.log("\n[endereço do portal]");

// O host onde o sistema de disputa REALMENTE responde. A versão anterior não o
// reconhecia, e por isso declarava "não logado" com o operador logado na frente dela.
ok("reconhece cnetmobile.estaleiro.serpro.gov.br", ehHostDoPortal("cnetmobile.estaleiro.serpro.gov.br"));
ok("reconhece www.comprasnet.gov.br", ehHostDoPortal("www.comprasnet.gov.br"));
ok("reconhece compras.gov.br", ehHostDoPortal("compras.gov.br"));
ok("NAO reconhece sso.acesso.gov.br como portal", !ehHostDoPortal("sso.acesso.gov.br"));
ok("NAO reconhece host de terceiro", !ehHostDoPortal("comprasnet.gov.br.golpe.com"));

ok("le host da URL", ehEnderecoDoPortal("https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/x"));
ok("URL invalida nao vira portal", !ehEnderecoDoPortal("nao-e-url"));

ok("caminho de disputa vira sala",
   ehSalaDeDisputa("https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/disputa/900"));
ok("landing nao e sala",
   !ehSalaDeDisputa("https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing"));

// Endereços reais, tirados da coleta feita em disputa ao vivo.
ok("a sala real e reconhecida",
   ehSalaDeDisputa("https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa?compra=90013"));
ok("acompanhamento pos-disputa NAO e sala",
   !ehSalaDeDisputa("https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra?compra=90013"));

console.log("\n[aprendizado]");
let e = aprenderCom({}, "https://sso.acesso.gov.br/login");
ok("nao aprende endereco do SSO", e.portal === undefined, e);

e = aprenderCom(e, "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/painel");
ok("aprende pagina do portal", e.portal?.endsWith("/painel") === true, e);
ok("painel nao e sala", e.sala === undefined, e);

e = aprenderCom(e, "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/disputa?compra=90013");
ok("aprende a sala", e.sala?.includes("disputa") === true, e);

const antes = e.sala;
e = aprenderCom(e, "https://cnetmobile.estaleiro.serpro.gov.br/logout");
ok("logout nao apaga a sala aprendida", e.sala === antes, e);
ok("logout nao vira o endereco do portal", !e.portal?.includes("logout"), e);

console.log("\n[persistencia]");
const dir = await mkdtemp(join(tmpdir(), "lancebot-"));
const caminho = join(dir, "sub", "endereco.json");
const reg = new RegistroEnderecos(caminho);
await reg.carregar();
ok("sem nada aprendido, cai na semente", reg.paraAbrir() === SEMENTES_PORTAL[0]);

await reg.aprender("https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/disputa/900");
ok("passa a usar o aprendido", reg.paraAbrir().includes("/disputa/900"), reg.aprendidos);
ok("sala aprendida", reg.paraSala().includes("/disputa/900"), reg.aprendidos);

const outro = new RegistroEnderecos(caminho);
await outro.carregar();
ok("sobrevive ao reinicio do aplicativo", outro.paraSala().includes("/disputa/900"), outro.aprendidos);
assert.ok(JSON.parse(await readFile(caminho, "utf-8")).portal);

console.log(falhas === 0 ? "\n🎉 endereço: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
