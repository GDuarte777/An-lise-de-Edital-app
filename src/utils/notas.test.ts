import { describe, it, expect } from "vitest";
import { Nota, PastaNotas } from "../types";
import {
  FILTRO_TODAS,
  SEM_PASTA,
  normalizar,
  validarPasta,
  criarPasta,
  ordenarPastas,
  desvincularNotasDaPasta,
  reconciliarPastas,
  criarNota,
  aplicarEdicaoNota,
  tituloVisivel,
  previaNota,
  estatisticasTexto,
  ordenarNotas,
  filtrarNotas,
  contarPorPasta,
  notaParaMarkdown,
  nomeArquivoDaNota,
  quandoAtualizada,
  LIMITE_CARACTERES_NOTA,
} from "./notas";

const AGORA = new Date(2026, 9, 8, 14, 30);

function nota(parcial: Partial<Nota> = {}): Nota {
  return {
    id: "n1",
    pastaId: SEM_PASTA,
    titulo: "Checklist do PE 45",
    conteudo: "Levar certidão do FGTS\nConferir o anexo II",
    fixada: false,
    criadaEm: AGORA.toISOString(),
    atualizadaEm: AGORA.toISOString(),
    ...parcial,
  };
}

function pasta(parcial: Partial<PastaNotas> = {}): PastaNotas {
  return { id: "p1", nome: "Licitações 2026", cor: "#6366f1", posicao: 0, ...parcial };
}

describe("normalizar", () => {
  it("ignora acento e caixa, para a busca achar o que o usuário digitou rápido", () => {
    expect(normalizar("Habilitação")).toBe("habilitacao");
    expect(normalizar("  PREÇO Mínimo ")).toBe("preco minimo");
  });

  it("não quebra com valor ausente", () => {
    expect(normalizar(undefined as unknown as string)).toBe("");
  });
});

describe("validarPasta", () => {
  it("exige nome", () => {
    const r = validarPasta("   ");
    expect(r.ok).toBe(false);
    expect(r.erros.nome).toMatch(/nome/i);
  });

  it("recusa nome repetido — duas pastas iguais tornam a coluna inútil", () => {
    const r = validarPasta("licitacoes 2026", [pasta()]);
    expect(r.ok).toBe(false);
    expect(r.erros.nome).toMatch(/já existe/i);
  });

  it("renomear a própria pasta não colide com ela mesma", () => {
    expect(validarPasta("Licitações 2026", [pasta()], "p1").ok).toBe(true);
  });

  it("devolve o nome já limpo", () => {
    expect(validarPasta("  Recursos  ").nome).toBe("Recursos");
  });
});

describe("criarPasta", () => {
  it("entra no fim da lista", () => {
    const nova = criarPasta({ id: "p3", nome: "Recursos" }, [pasta(), pasta({ id: "p2", posicao: 4 })]);
    expect(nova.posicao).toBe(5);
  });

  it("tem cor mesmo sem escolha", () => {
    expect(criarPasta({ id: "p1", nome: "X" }).cor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ordena por posição e desempata pelo nome", () => {
    const ordenadas = ordenarPastas([
      pasta({ id: "b", nome: "Zebra", posicao: 1 }),
      pasta({ id: "c", nome: "Alfa", posicao: 1 }),
      pasta({ id: "a", nome: "Meio", posicao: 0 }),
    ]);
    expect(ordenadas.map((p) => p.id)).toEqual(["a", "c", "b"]);
  });
});

describe("apagar pasta", () => {
  it("devolve as notas para a raiz em vez de apagar o texto do usuário", () => {
    const notas = [nota({ id: "a", pastaId: "p1" }), nota({ id: "b", pastaId: "p2" })];
    const depois = desvincularNotasDaPasta(notas, "p1");

    expect(depois).toHaveLength(2);
    expect(depois[0].pastaId).toBe(SEM_PASTA);
    expect(depois[0].conteudo).toBe(notas[0].conteudo);
    expect(depois[1].pastaId).toBe("p2");
  });

  it("nota apontando para pasta inexistente cai na raiz, não fica invisível", () => {
    // Acontece quando a pasta é apagada em outro dispositivo: sem isso a nota
    // não apareceria em nenhum filtro.
    const depois = reconciliarPastas([nota({ pastaId: "fantasma" })], [pasta()]);
    expect(depois[0].pastaId).toBe(SEM_PASTA);
  });

  it("mantém a nota quando a pasta existe", () => {
    expect(reconciliarPastas([nota({ pastaId: "p1" })], [pasta()])[0].pastaId).toBe("p1");
  });
});

describe("criarNota", () => {
  it("nasce vazia, na pasta aberta, com as duas datas marcadas", () => {
    const n = criarNota({ id: "x", pastaId: "p1" }, AGORA);
    expect(n.titulo).toBe("");
    expect(n.conteudo).toBe("");
    expect(n.fixada).toBe(false);
    expect(n.pastaId).toBe("p1");
    expect(n.criadaEm).toBe(AGORA.toISOString());
    expect(n.atualizadaEm).toBe(AGORA.toISOString());
  });

  it("criar com o filtro 'todas' aberto guarda na raiz, não numa pasta chamada 'todas'", () => {
    expect(criarNota({ id: "x", pastaId: FILTRO_TODAS }, AGORA).pastaId).toBe(SEM_PASTA);
  });
});

describe("aplicarEdicaoNota", () => {
  it("troca só o campo enviado e atualiza a hora", () => {
    const depois = aplicarEdicaoNota(nota(), { conteudo: "novo texto" }, new Date(2026, 9, 9, 10, 0));

    expect(depois.conteudo).toBe("novo texto");
    expect(depois.titulo).toBe("Checklist do PE 45");
    expect(depois.criadaEm).toBe(AGORA.toISOString());
    expect(Date.parse(depois.atualizadaEm)).toBeGreaterThan(Date.parse(AGORA.toISOString()));
  });

  it("aceita esvaziar um campo", () => {
    expect(aplicarEdicaoNota(nota(), { titulo: "" }, AGORA).titulo).toBe("");
  });

  it("corta conteúdo acima do limite da coluna", () => {
    const enorme = "a".repeat(LIMITE_CARACTERES_NOTA + 500);
    expect(aplicarEdicaoNota(nota(), { conteudo: enorme }, AGORA).conteudo.length).toBe(
      LIMITE_CARACTERES_NOTA,
    );
  });
});

describe("tituloVisivel", () => {
  it("usa o título quando existe", () => {
    expect(tituloVisivel(nota())).toBe("Checklist do PE 45");
  });

  it("sem título, usa a primeira linha que o usuário escreveu", () => {
    // Texto dele, não resumo gerado.
    expect(tituloVisivel(nota({ titulo: "", conteudo: "Ligar para o pregoeiro\noutra linha" }))).toBe(
      "Ligar para o pregoeiro",
    );
  });

  it("pula linhas em branco e marcação de markdown", () => {
    expect(tituloVisivel(nota({ titulo: "", conteudo: "\n\n## Pontos de atenção\ntexto" }))).toBe(
      "Pontos de atenção",
    );
  });

  it("corta primeira linha muito longa", () => {
    const t = tituloVisivel(nota({ titulo: "", conteudo: "x".repeat(200) }));
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith("…")).toBe(true);
  });

  it("nota totalmente vazia não vira cartão em branco", () => {
    expect(tituloVisivel(nota({ titulo: "", conteudo: "" }))).toBe("Nota sem título");
    expect(tituloVisivel(nota({ titulo: "   ", conteudo: "  \n " }))).toBe("Nota sem título");
  });
});

describe("previaNota", () => {
  it("mostra o corpo quando o título é próprio", () => {
    expect(previaNota(nota())).toContain("Levar certidão do FGTS");
  });

  it("não repete a linha que já virou título", () => {
    const p = previaNota(nota({ titulo: "", conteudo: "Primeira\nSegunda" }));
    expect(p).toBe("Segunda");
  });

  it("fica vazia quando não há mais nada a mostrar", () => {
    expect(previaNota(nota({ titulo: "", conteudo: "Só uma linha" }))).toBe("");
    expect(previaNota(nota({ titulo: "T", conteudo: "" }))).toBe("");
  });

  it("corta no limite pedido", () => {
    const p = previaNota(nota({ titulo: "T", conteudo: "y".repeat(300) }), 40);
    expect(p.length).toBeLessThanOrEqual(40);
  });
});

describe("estatisticasTexto", () => {
  it("conta palavras, caracteres e linhas", () => {
    const e = estatisticasTexto("uma duas tres\nquatro");
    expect(e.palavras).toBe(4);
    expect(e.linhas).toBe(2);
    expect(e.caracteres).toBe("uma duas tres\nquatro".length);
  });

  it("texto vazio não conta uma palavra fantasma", () => {
    expect(estatisticasTexto("").palavras).toBe(0);
    expect(estatisticasTexto("   \n  ").palavras).toBe(0);
  });
});

describe("ordenarNotas", () => {
  it("fixadas primeiro, depois a editada mais recentemente", () => {
    const antiga = nota({ id: "antiga", atualizadaEm: new Date(2026, 0, 1).toISOString() });
    const recente = nota({ id: "recente", atualizadaEm: new Date(2026, 9, 7).toISOString() });
    const presa = nota({ id: "presa", fixada: true, atualizadaEm: new Date(2020, 0, 1).toISOString() });

    expect(ordenarNotas([antiga, recente, presa]).map((n) => n.id)).toEqual([
      "presa",
      "recente",
      "antiga",
    ]);
  });

  it("empate de horário cai no título, para a ordem não dançar entre renderizações", () => {
    const mesmo = new Date(2026, 5, 5).toISOString();
    const ids = ordenarNotas([
      nota({ id: "b", titulo: "Zebra", atualizadaEm: mesmo }),
      nota({ id: "a", titulo: "Alfa", atualizadaEm: mesmo }),
    ]).map((n) => n.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("não altera o array recebido", () => {
    const lista = [nota({ id: "a" }), nota({ id: "b", fixada: true })];
    ordenarNotas(lista);
    expect(lista.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("filtrarNotas", () => {
  const notas = [
    nota({ id: "raiz", pastaId: SEM_PASTA, titulo: "Solta" }),
    nota({ id: "dentro", pastaId: "p1", titulo: "Habilitação do CREF" }),
    nota({ id: "outra", pastaId: "p2", titulo: "Recurso", conteudo: "prazo de 3 dias úteis" }),
  ];

  it("sem filtro, devolve tudo", () => {
    expect(filtrarNotas(notas)).toHaveLength(3);
    expect(filtrarNotas(notas, { pastaId: FILTRO_TODAS })).toHaveLength(3);
  });

  it("recorta por pasta", () => {
    expect(filtrarNotas(notas, { pastaId: "p1" }).map((n) => n.id)).toEqual(["dentro"]);
  });

  it("'sem pasta' traz só as da raiz", () => {
    expect(filtrarNotas(notas, { pastaId: SEM_PASTA }).map((n) => n.id)).toEqual(["raiz"]);
  });

  it("busca sem acento acha o título com acento", () => {
    expect(filtrarNotas(notas, { busca: "habilitacao" }).map((n) => n.id)).toEqual(["dentro"]);
  });

  it("busca também no conteúdo, não só no título", () => {
    expect(filtrarNotas(notas, { busca: "3 dias" }).map((n) => n.id)).toEqual(["outra"]);
  });

  it("pasta e busca valem juntas", () => {
    expect(filtrarNotas(notas, { pastaId: "p1", busca: "recurso" })).toHaveLength(0);
  });

  it("devolve já ordenado", () => {
    const presa = nota({ id: "presa", fixada: true, atualizadaEm: new Date(2020, 0, 1).toISOString() });
    expect(filtrarNotas([...notas, presa])[0].id).toBe("presa");
  });
});

describe("contarPorPasta", () => {
  it("conta cada pasta, o total e a raiz", () => {
    const c = contarPorPasta([
      nota({ id: "a", pastaId: "p1" }),
      nota({ id: "b", pastaId: "p1" }),
      nota({ id: "c", pastaId: SEM_PASTA }),
    ]);
    expect(c["p1"]).toBe(2);
    expect(c[SEM_PASTA]).toBe(1);
    expect(c[FILTRO_TODAS]).toBe(3);
  });

  it("lista vazia zera sem quebrar", () => {
    const c = contarPorPasta([]);
    expect(c[FILTRO_TODAS]).toBe(0);
    expect(c[SEM_PASTA]).toBe(0);
  });
});

describe("exportar", () => {
  it("monta markdown com título, pasta e corpo", () => {
    const md = notaParaMarkdown(nota(), pasta());
    expect(md).toContain("# Checklist do PE 45");
    expect(md).toContain("Licitações 2026");
    expect(md).toContain("Levar certidão do FGTS");
  });

  it("omite a linha da pasta quando a nota está na raiz", () => {
    expect(notaParaMarkdown(nota(), null)).not.toContain("Pasta:");
  });

  it("nome de arquivo sai do título, sem acento nem caractere problemático", () => {
    expect(nomeArquivoDaNota(nota({ titulo: "Habilitação / CREF 20" }))).toBe("habilitacao-cref-20.md");
  });

  it("nota sem título ainda gera nome utilizável", () => {
    expect(nomeArquivoDaNota(nota({ titulo: "", conteudo: "" }))).toBe("nota-sem-titulo.md");
  });
});

describe("quandoAtualizada", () => {
  it("usa referência curta, que é o que cabe no cartão", () => {
    expect(quandoAtualizada(new Date(2026, 9, 8, 14, 29, 50).toISOString(), AGORA)).toBe("agora");
    expect(quandoAtualizada(new Date(2026, 9, 8, 14, 0).toISOString(), AGORA)).toBe("há 30 min");
    expect(quandoAtualizada(new Date(2026, 9, 8, 10, 30).toISOString(), AGORA)).toBe("há 4 h");
    expect(quandoAtualizada(new Date(2026, 9, 7, 9, 0).toISOString(), AGORA)).toBe("ontem");
    expect(quandoAtualizada(new Date(2026, 9, 5, 9, 0).toISOString(), AGORA)).toBe("há 3 dias");
  });

  it("acima de uma semana mostra a data", () => {
    expect(quandoAtualizada(new Date(2026, 8, 1, 9, 0).toISOString(), AGORA)).toMatch(/01/);
  });

  it("data inválida não imprime 'Invalid Date'", () => {
    expect(quandoAtualizada("", AGORA)).toBe("");
    expect(quandoAtualizada("não é data", AGORA)).toBe("");
  });
});
