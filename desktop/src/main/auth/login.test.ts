import { autenticadoPor, type Sondagem } from "./reconhecimento.js";

/**
 * A regra que decide fechar a janela de login. Cada caso aqui corresponde a uma tela
 * real do fluxo gov.br → Compras.gov.br, e os dois primeiros negativos são exatamente
 * os defeitos que este projeto já publicou: fechar antes da hora e declarar sessão
 * inexistente.
 */

let f = 0;
const ok = (l: string, c: boolean, x?: unknown) => {
  if (c) console.log(`  ✅ ${l}`);
  else { console.log(`  ❌ ${l}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); f++; }
};

const tela = (p: Partial<Sondagem>): Sondagem => ({
  url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/painel",
  noSso: false,
  noPortal: true,
  temSenha: false,
  temSair: false,
  temIdentidade: false,
  escolhendoPerfil: false,
  tamanho: 5000,
  manterAberta: false,
  ...p
});

console.log("\n[1] Telas em que o login AINDA NAO terminou");
ok("tela de senha do gov.br", !autenticadoPor(tela({ noSso: true, temSenha: true, noPortal: false })));
ok("consentimento do SSO", !autenticadoPor(tela({ noSso: true, noPortal: false, temSair: true })));
ok("escolha de perfil no portal", !autenticadoPor(tela({ escolhendoPerfil: true, temSair: true, temIdentidade: true })));
ok("SPA ainda desenhando", !autenticadoPor(tela({ tamanho: 12, temSair: true })));
ok("site fora do portal", !autenticadoPor(tela({ noPortal: false, temSair: true })));
ok("campo de senha visivel no portal", !autenticadoPor(tela({ temSenha: true, temSair: true })));
ok("sondagem falhou", !autenticadoPor(null));

console.log("\n[2] Portal aberto sem ninguem logado");
ok("pagina publica do portal", !autenticadoPor(tela({})));

console.log("\n[3] Telas em que o login TERMINOU");
ok("tem opcao de sair", autenticadoPor(tela({ temSair: true })));
ok("mostra CNPJ do fornecedor", autenticadoPor(tela({ temIdentidade: true })));
ok("tem os dois sinais", autenticadoPor(tela({ temSair: true, temIdentidade: true })));

console.log("\n[4] Diz POR QUE nao reconheceu — sem isso o operador so ve uma parede");
{
  const { porQueNao } = await import("./reconhecimento.js");
  const base = {
    url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/compras-eletronicas",
    noSso: false, noPortal: true, temSenha: false, temSair: true, temIdentidade: true,
    escolhendoPerfil: false, tamanho: 900, manterAberta: false
  };
  ok("logado nao tem motivo", porQueNao(base) === null, porQueNao(base));
  ok("explica campo de senha", /senha/i.test(porQueNao({ ...base, temSenha: true }) ?? ""));
  ok("explica pagina vazia", /vazia/i.test(porQueNao({ ...base, tamanho: 10 }) ?? ""));
  ok("explica host de fora", /n[aã]o [eé] do portal/i.test(porQueNao({ ...base, noPortal: false }) ?? ""));
  ok("explica falta de identidade",
     /sair|identifica/i.test(porQueNao({ ...base, temSair: false, temIdentidade: false }) ?? ""));

  // Continua barrando, e o diagnóstico mostra o campo ao operador — é assim que se
  // descobre se é ISSO que está barrando, em vez de afrouxar a trava no escuro.
  ok("escolha de perfil barra e explica",
     /perfil/i.test(porQueNao({ ...base, escolhendoPerfil: true }) ?? ""));
}

console.log(f === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${f} FALHA(S)\n`);
process.exit(f === 0 ? 0 : 1);
