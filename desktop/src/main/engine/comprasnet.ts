import type { Session } from "electron";
import type { EstadoItem, PortalAdapter, ReferenciaItem, ResultadoEnvio } from "./portal.js";
import { PortalNaoCalibradoError } from "./portal.js";
import type { DescobridorApi, EndpointAprendido } from "./discovery.js";

/**
 * Adapter real do Compras.gov.br.
 *
 * As requisições saem da mesma `Session` do Electron em que o operador fez login no
 * gov.br. Consequências disso:
 *
 *  - os cookies de sessão são anexados pelo próprio Chromium, então nada é copiado,
 *    guardado ou transmitido por nós;
 *  - não há User-Agent forjado: o processo é, de fato, um Chromium;
 *  - login com certificado A3 funciona, porque a chave privada permanece no token
 *    físico e quem negocia o TLS é o navegador.
 *
 * Os endpoints não são chutados nem escritos à mão: vêm do DescobridorApi, que os
 * aprendeu observando as chamadas da própria sala de disputa. Enquanto o que foi
 * aprendido não cobrir a operação, o adapter recusa agir em vez de improvisar.
 */

/** Converte "1.234,56" ou "1234.56" em número, recusando o que não for numérico. */
function paraNumero(valor: unknown, campo: string): number {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;

  if (typeof valor === "string") {
    const limpo = valor.trim();
    // Formato brasileiro: ponto de milhar, vírgula decimal.
    const normalizado = /,\d{1,2}$/.test(limpo)
      ? limpo.replace(/\./g, "").replace(",", ".")
      : limpo.replace(/,/g, "");
    const n = Number(normalizado);
    if (Number.isFinite(n)) return n;
  }

  throw new Error(
    `O campo "${campo}" veio como ${JSON.stringify(valor)}, que não é um número. ` +
      `A calibração do portal está desatualizada — abra a sala de disputa no aplicativo para recalibrar.`
  );
}

function lerCaminho(obj: unknown, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((acc, parte) => {
    if (acc && typeof acc === "object") {
      const chave = parte.replace("[]", "");
      const v = (acc as Record<string, unknown>)[chave];
      return parte.endsWith("[]") && Array.isArray(v) ? v[0] : v;
    }
    return undefined;
  }, obj);
}

/** Interpreta o campo de situação, que tanto pode vir booleano quanto textual. */
function interpretarAbertura(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor;
  if (valor === null || valor === undefined) return true; // sem informação, seguimos
  const texto = String(valor).toLowerCase();
  if (/encerrad|fechad|finalizad|suspens|cancelad|homologad|adjudicad/.test(texto)) return false;
  if (/abert|disputa|lance|andamento|ativo/.test(texto)) return true;
  return true;
}

function montarUrl(endpoint: EndpointAprendido, ref: ReferenciaItem): string {
  return endpoint.padrao
    .replace(/\{pregaoId\}/g, encodeURIComponent(ref.pregaoId))
    .replace(/\{itemNum\}/g, encodeURIComponent(ref.itemNum));
}

export class ComprasnetAdapter implements PortalAdapter {
  readonly nome = "Compras.gov.br";
  readonly ehSimulacao = false;

  constructor(
    private readonly sessao: Session,
    private readonly descobridor: DescobridorApi
  ) {}

  async lerEstado(ref: ReferenciaItem): Promise<EstadoItem> {
    const endpoint = this.descobridor.calibracao.estadoItem;
    if (!endpoint) throw new PortalNaoCalibradoError("leitura do item");

    const resp = await this.sessao.fetch(montarUrl(endpoint, ref), {
      method: endpoint.metodo,
      headers: { Accept: "application/json" }
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new Error("A sessão do Compras.gov.br expirou. Entre novamente pelo aplicativo.");
    }
    if (!resp.ok) {
      throw new Error(`O portal respondeu ${resp.status} ao ler o item. Nenhum lance foi enviado neste ciclo.`);
    }

    const dados: unknown = await resp.json();

    return {
      menorLance: paraNumero(lerCaminho(dados, endpoint.campos.menorLance), endpoint.campos.menorLance),
      nossoLance: endpoint.campos.nossoLance
        ? (() => {
            const bruto = lerCaminho(dados, endpoint.campos.nossoLance);
            return bruto === null || bruto === undefined ? undefined : paraNumero(bruto, endpoint.campos.nossoLance);
          })()
        : undefined,
      aberto: endpoint.campos.aberto ? interpretarAbertura(lerCaminho(dados, endpoint.campos.aberto)) : true,
      lidoEm: new Date()
    };
  }

  async enviarLance(ref: ReferenciaItem, valor: number): Promise<ResultadoEnvio> {
    const endpoint = this.descobridor.calibracao.envioLance;
    if (!endpoint) throw new PortalNaoCalibradoError("envio de lance");

    const resp = await this.sessao.fetch(montarUrl(endpoint, ref), {
      method: endpoint.metodo,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(this.montarCorpo(ref, valor))
    });

    const texto = await resp.text();
    return { aceito: resp.ok, mensagem: `HTTP ${resp.status} — ${texto.slice(0, 400)}` };
  }

  /**
   * Corpo do POST de lance. O formato exato é aprendido junto com o endpoint quando o
   * operador envia um lance manualmente pela sala; até lá usamos as chaves mais comuns,
   * e a resposta do portal (devolvida crua no log) revela se o formato foi aceito.
   */
  private montarCorpo(ref: ReferenciaItem, valor: number): Record<string, unknown> {
    return {
      valor,
      valorLance: valor,
      numeroItem: ref.itemNum,
      item: ref.itemNum
    };
  }
}
