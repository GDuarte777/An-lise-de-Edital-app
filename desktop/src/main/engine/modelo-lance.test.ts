import { DescobridorApi } from "./discovery.js";

// A função de modelo é método de instância; o teste só precisa dela, então usa uma
// instância descartável sem sessão real (nada é observado aqui).
const d = new DescobridorApi({} as never, "/tmp/ignorado.json");
const m = (b: string | undefined) => d.montarModeloDeCorpo(b);

let f = 0;
const ok = (l: string, c: boolean, x?: unknown) => {
  if (c) console.log(`  ✅ ${l}`);
  else { console.log(`  ❌ ${l}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); f++; }
};

console.log("\n[1] JSON tipico de lance");
{
  const mod = m('{"numeroItem":"4","valorLance":1250.50,"idCompra":90013}');
  ok("valor virou {valor}", mod === '{"numeroItem":"4","valorLance":{valor},"idCompra":90013}', mod);
  ok("reproduz com novo valor",
     mod!.replace("{valor}", (1200).toFixed(2)) === '{"numeroItem":"4","valorLance":1200.00,"idCompra":90013}');
}

console.log("\n[2] Nao confunde identificador com valor");
ok("preserva item e pregao",
   m('{"item":12,"pregao":90013,"valor":875.00}') === '{"item":12,"pregao":90013,"valor":{valor}}');

console.log("\n[3] Formulario urlencoded");
ok("troca so o valor", m("item=4&valor=1250,50&compra=90013") === "item=4&valor={valor}&compra=90013");

console.log("\n[4] Escolhe o maior decimal quando ha mais de um");
ok("pega o lance, nao o desconto",
   m('{"desconto":1.50,"valorLance":990.25}') === '{"desconto":1.50,"valorLance":{valor}}');

console.log("\n[5] Entradas sem valor decimal nao viram modelo");
ok("corpo vazio", m("") === undefined);
ok("undefined", m(undefined) === undefined);
ok("so inteiros", m('{"item":4,"compra":90013}') === undefined);

console.log(f === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${f} FALHA(S)\n`);
process.exit(f === 0 ? 0 : 1);
