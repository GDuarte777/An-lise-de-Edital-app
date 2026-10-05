import { describe, expect, it } from "vitest";
import {
  arredondarCentavos,
  autorizarLance,
  decidirLance,
  itemAutorizado,
  pisoDoItem,
} from "../supabase/functions/api/estrategiaLance";

// O modelo de lance é a única parte do robô que decide dinheiro sozinha. Cada
// caso aqui é um jeito conhecido de perder: descer abaixo do piso, cobrir o
// próprio lance, aceitar uma configuração pela metade, confiar num número que
// veio do portal como texto.

const robo = {
  mode: "Agressivo",
  dispute_type: "global",
  minimum_value: 1000,
  min_reduction: 1,
  max_reduction: 5,
};

describe("piso de margem", () => {
  it("usa o piso do item quando ele existe", () => {
    expect(pisoDoItem(robo, { valor_minimo: 800 })).toBe(800);
  });

  it("cai para o piso global quando o item não tem piso próprio", () => {
    expect(pisoDoItem(robo, { valor_minimo: null })).toBe(1000);
  });

  it("não aceita zero como piso", () => {
    // Zero é um piso aritmeticamente válido: se passasse, o robô desceria até
    // ele achando que estava obedecendo a configuração.
    expect(pisoDoItem({ minimum_value: 0 }, { valor_minimo: 0 })).toBeNull();
  });

  it("recusa o lance quando não há piso em lugar nenhum", () => {
    const d = decidirLance({ config: { min_reduction: 2 }, item: null, melhorLance: 5000 });
    expect(d.should_bid).toBe(false);
    expect(d.message).toMatch(/valor mínimo/i);
  });
});

describe("decisão de lance", () => {
  it("reduz pelo percentual mínimo configurado no robô", () => {
    const d = decidirLance({ config: robo, item: null, melhorLance: 10000 });
    expect(d.should_bid).toBe(true);
    expect(d.suggested_bid).toBe(9900);
  });

  it("o desconto fixo do item vence a faixa do robô", () => {
    const d = decidirLance({ config: robo, item: { desconto: 250, variacao: 10 }, melhorLance: 10000 });
    expect(d.suggested_bid).toBe(9750);
  });

  it("a variação do item vence a faixa do robô", () => {
    const d = decidirLance({ config: robo, item: { variacao: 3 }, melhorLance: 10000 });
    expect(d.suggested_bid).toBe(9700);
  });

  it("para no piso em vez de atravessá-lo", () => {
    const d = decidirLance({ config: robo, item: { valor_minimo: 9950, variacao: 3 }, melhorLance: 10000 });
    expect(d.should_bid).toBe(false);
    expect(d.suggested_bid).toBeNull();
    // A extensão reconhece este caso pelo texto para avisar na aba Alertas.
    expect(d.message).toMatch(/valor mínimo/i);
  });

  it("aceita um lance que cai exatamente no piso", () => {
    const d = decidirLance({ config: robo, item: { valor_minimo: 9900 }, melhorLance: 10000 });
    expect(d.should_bid).toBe(true);
    expect(d.suggested_bid).toBe(9900);
  });

  it("não cobre o próprio lance quando já lideramos", () => {
    const d = decidirLance({ config: robo, item: null, melhorLance: 9000, meuLance: 9000 });
    expect(d.is_winning).toBe(true);
    expect(d.should_bid).toBe(false);
  });

  it("volta a disputar quando um concorrente baixa o melhor lance", () => {
    const d = decidirLance({ config: robo, item: null, melhorLance: 8900, meuLance: 9000 });
    expect(d.is_winning).toBe(false);
    expect(d.should_bid).toBe(true);
    expect(d.suggested_bid).toBe(8811);
  });

  it("recusa quando o portal ainda não informou o melhor lance", () => {
    for (const valor of [null, undefined, 0, -1, "", "abc", NaN]) {
      const d = decidirLance({ config: robo, item: null, melhorLance: valor });
      expect(d.should_bid, `melhorLance = ${String(valor)}`).toBe(false);
    }
  });

  it("lê número que chegou como texto com vírgula decimal", () => {
    const d = decidirLance({ config: robo, item: { desconto: "150,50" as any }, melhorLance: "10000" as any });
    expect(d.suggested_bid).toBe(9849.5);
  });

  it("recusa quando não há redução configurada em lugar nenhum", () => {
    const d = decidirLance({ config: { minimum_value: 100 }, item: null, melhorLance: 10000 });
    expect(d.should_bid).toBe(false);
    expect(d.message).toMatch(/redução/i);
  });

  it("não devolve centavo quebrado por erro de ponto flutuante", () => {
    const d = decidirLance({ config: { minimum_value: 1, min_reduction: 10 }, item: null, melhorLance: 0.07 });
    expect(d.should_bid).toBe(false); // abaixo do piso, mas sem lixo decimal no texto
    expect(arredondarCentavos(0.07 * 0.9)).toBe(0.06);
  });
});

describe("lance manual", () => {
  it("envia exatamente o valor que o operador digitou", () => {
    const d = decidirLance({ config: robo, item: { lance_manual: 9500, valor_minimo: 9000 }, melhorLance: 10000 });
    expect(d.should_bid).toBe(true);
    expect(d.suggested_bid).toBe(9500);
  });

  it("não envia lance manual abaixo do piso", () => {
    // O piso é limite do próprio operador: digitar um valor não o revoga.
    const d = decidirLance({ config: robo, item: { lance_manual: 8000, valor_minimo: 9000 }, melhorLance: 10000 });
    expect(d.should_bid).toBe(false);
    expect(d.message).toMatch(/valor mínimo/i);
  });

  it("não envia lance manual que não cobre o melhor lance", () => {
    const d = decidirLance({ config: robo, item: { lance_manual: 10500, valor_minimo: 9000 }, melhorLance: 10000 });
    expect(d.should_bid).toBe(false);
  });
});

describe("seleção de itens", () => {
  const porItem = { ...robo, dispute_type: "por_item", item_selection_enabled: true };

  it("com seleção ligada, só disputa item marcado e com piso", () => {
    expect(itemAutorizado(porItem, { participar: true, valor_minimo: 500 })).toBe(true);
    expect(itemAutorizado(porItem, { participar: true, valor_minimo: null })).toBe(false);
    expect(itemAutorizado(porItem, { participar: false, valor_minimo: 500 })).toBe(false);
    expect(itemAutorizado(porItem, null)).toBe(false);
  });

  it("com seleção desligada, disputa tudo menos o que foi desmarcado", () => {
    const solto = { ...robo, dispute_type: "por_item", item_selection_enabled: false };
    expect(itemAutorizado(solto, { participar: false })).toBe(false);
    expect(itemAutorizado(solto, null)).toBe(true);
  });

  it("em disputa global, não exige marcação por item", () => {
    expect(itemAutorizado(robo, null)).toBe(true);
  });

  it("recusa a sugestão para item fora da configuração", () => {
    const d = decidirLance({ config: porItem, item: { participar: false }, melhorLance: 10000 });
    expect(d.should_bid).toBe(false);
  });
});

describe("modo Estratégico", () => {
  it("varia a redução dentro da faixa configurada", () => {
    const base = { config: { ...robo, mode: "Estratégico" }, item: null, melhorLance: 10000 };
    const baixo = decidirLance({ ...base, sorteio: 0 });
    const alto = decidirLance({ ...base, sorteio: 1 });
    expect(baixo.suggested_bid).toBe(9900); // 1%
    expect(alto.suggested_bid).toBe(9500); // 5%
  });

  it("nos demais modos a redução é sempre a mínima", () => {
    const a = decidirLance({ config: robo, item: null, melhorLance: 10000, sorteio: 0 });
    const b = decidirLance({ config: robo, item: null, melhorLance: 10000, sorteio: 1 });
    expect(a.suggested_bid).toBe(b.suggested_bid);
  });
});

describe("autorização no instante do envio", () => {
  it("autoriza valor acima do piso", () => {
    expect(autorizarLance(robo, { valor_minimo: 9000 }, 9500).allowed).toBe(true);
  });

  it("barra valor abaixo do piso", () => {
    // O caso real: a configuração mudou no app entre o cálculo e o envio.
    expect(autorizarLance(robo, { valor_minimo: 9000 }, 8999).allowed).toBe(false);
  });

  it("barra item que saiu da configuração", () => {
    const porItem = { ...robo, dispute_type: "por_item", item_selection_enabled: true };
    expect(autorizarLance(porItem, { participar: false, valor_minimo: 100 }, 500).allowed).toBe(false);
  });

  it("barra valor inválido", () => {
    for (const v of [null, undefined, 0, -5, "abc"]) {
      expect(autorizarLance(robo, { valor_minimo: 100 }, v).allowed, String(v)).toBe(false);
    }
  });
});
