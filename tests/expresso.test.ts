import { describe, expect, it } from "vitest";
import { criarAplicativo, type Requisicao } from "../supabase/functions/api/expresso.ts";

// A camada de compatibilidade com o Express é nova e TODA requisição da
// plataforma passa por ela. Um defeito aqui não aparece como um erro numa tela:
// aparece como "a IA parou de funcionar" em todas elas ao mesmo tempo. Por isso
// as garantias que as rotas assumem estão fixadas em teste.

function requisicao(parcial: Partial<Requisicao> = {}): Requisicao {
  return {
    method: "GET",
    path: "/api/health",
    originalUrl: "/api/health",
    headers: {},
    query: {},
    body: {},
    socket: { remoteAddress: "" },
    ip: "",
    ...parcial,
  };
}

describe("roteamento", () => {
  it("entrega a requisição à rota de mesmo método e caminho", async () => {
    const app = criarAplicativo();
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

    const saida = await app.despachar(requisicao());

    expect(saida.status).toBe(200);
    expect(JSON.parse(String(saida.corpo))).toEqual({ status: "ok" });
  });

  it("não entrega a requisição a uma rota de outro método", async () => {
    const app = criarAplicativo();
    app.post("/api/chat", (_req, res) => res.json({ nunca: true }));

    const saida = await app.despachar(requisicao({ path: "/api/chat" }));

    expect(saida.status).toBe(404);
  });

  it("devolve 404 em JSON para rota desconhecida", async () => {
    const app = criarAplicativo();

    const saida = await app.despachar(requisicao({ path: "/api/inexistente", originalUrl: "/api/inexistente" }));

    expect(saida.status).toBe(404);
    expect(JSON.parse(String(saida.corpo)).error).toContain("/api/inexistente");
  });

  it("aplica use(prefixo) a todos os caminhos sob o prefixo", async () => {
    const app = criarAplicativo();
    const vistos: string[] = [];
    app.use("/api", (req, _res, next) => {
      vistos.push(req.path);
      next();
    });
    app.get("/api/pncp/arquivos", (_req, res) => res.json({ ok: true }));

    await app.despachar(requisicao({ path: "/api/pncp/arquivos" }));

    expect(vistos).toEqual(["/api/pncp/arquivos"]);
  });
});

describe("resposta", () => {
  it("encadeia status() com json()", async () => {
    const app = criarAplicativo();
    app.get("/api/health", (_req, res) => res.status(429).json({ error: "cota" }));

    const saida = await app.despachar(requisicao());

    expect(saida.status).toBe(429);
    expect(saida.cabecalhos["Content-Type"]).toBe("application/json");
  });

  it("preserva cabeçalhos definidos antes do corpo", async () => {
    const app = criarAplicativo();
    app.get("/api/health", (_req, res) => {
      res.setHeader("Content-Disposition", 'attachment; filename="edital.pdf"');
      res.setHeader("Content-Type", "application/pdf");
      return res.send(new Uint8Array([1, 2, 3]));
    });

    const saida = await app.despachar(requisicao());

    expect(saida.cabecalhos["Content-Disposition"]).toContain("edital.pdf");
    expect(saida.cabecalhos["Content-Type"]).toBe("application/pdf");
    expect(saida.corpo).toBeInstanceOf(Uint8Array);
  });

  it("ignora uma segunda escrita, como o Express faria", async () => {
    const app = criarAplicativo();
    app.get("/api/health", (_req, res) => {
      res.json({ primeiro: true });
      res.status(500).json({ segundo: true });
    });

    const saida = await app.despachar(requisicao());

    expect(saida.status).toBe(200);
    expect(JSON.parse(String(saida.corpo))).toEqual({ primeiro: true });
  });
});

describe("erros", () => {
  it("encaminha exceção de handler assíncrono ao tratador de erro", async () => {
    const app = criarAplicativo();
    app.post("/api/chat", async () => {
      throw new Error("provedor fora do ar");
    });
    app.use((erro: any, _req: any, res: any, _next: any) =>
      res.status(500).json({ error: erro.message })
    );

    const saida = await app.despachar(requisicao({ method: "POST", path: "/api/chat" }));

    expect(saida.status).toBe(500);
    expect(JSON.parse(String(saida.corpo))).toEqual({ error: "provedor fora do ar" });
  });

  it("encaminha next(erro) ao tratador de erro, pulando as rotas seguintes", async () => {
    const app = criarAplicativo();
    let rotaRodou = false;
    app.use("/api", (_req, _res, next) => next(new Error("cota estourada")));
    app.get("/api/health", (_req, res) => {
      rotaRodou = true;
      return res.json({ status: "ok" });
    });
    app.use((erro: any, _req: any, res: any, _next: any) => res.status(429).json({ error: erro.message }));

    const saida = await app.despachar(requisicao());

    expect(rotaRodou).toBe(false);
    expect(saida.status).toBe(429);
  });

  it("um handler que termina sem responder vira erro visível, não uma requisição pendurada", async () => {
    const app = criarAplicativo();
    app.get("/api/health", () => {
      /* esqueceu de responder */
    });

    await expect(app.despachar(requisicao())).rejects.toThrow(/terminou sem responder/);
  });

  it("não roda tratador de erro quando não há erro", async () => {
    const app = criarAplicativo();
    let tratadorRodou = false;
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
    app.use((_erro: any, _req: any, _res: any, _next: any) => {
      tratadorRodou = true;
    });

    await app.despachar(requisicao());

    expect(tratadorRodou).toBe(false);
  });
});
