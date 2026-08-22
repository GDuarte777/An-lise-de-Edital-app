import type { Session } from "electron";
import type {
  EstadoItem,
  PortalAdapter,
  ReferenciaItem,
  ResultadoEnvio
} from "./portal.js";
import { PortalNaoCalibradoError } from "./portal.js";

/**
 * Adapter real do Compras.gov.br.
 *
 * As requisições saem da mesma `Session` do Electron em que o operador fez login na
 * página oficial do gov.br. Consequências disso:
 *
 *  - os cookies de sessão são anexados pelo próprio Chromium, então nada é copiado,
 *    guardado ou transmitido por nós;
 *  - não há User-Agent forjado: o processo é, de fato, um Chromium;
 *  - login com certificado digital A3 funciona, porque a chave privada permanece no
 *    token físico e quem negocia o TLS é o navegador.
 *
 * O QUE FALTA: o bloco MAPEAMENTO abaixo. Os endpoints e os nomes de campo do portal
 * não são públicos e não podem ser adivinhados — precisam ser capturados de um pregão
 * real com o Modo Captura. Enquanto `CALIBRADO` for false, este adapter recusa operar.
 */

// ---------------------------------------------------------------------------
// MAPEAMENTO — preencher com dados capturados, depois virar CALIBRADO para true.
// ---------------------------------------------------------------------------
const CALIBRADO = false;

const MAPEAMENTO = {
  /** Ex.: "https://sala-disputa.comprasnet.gov.br/api/.../{pregaoId}/itens/{itemNum}" */
  urlEstado: "",
  /** Ex.: mesma base + "/lances" */
  urlEnvioLance: "",
  metodoEnvio: "POST" as "POST" | "PUT",
  /** Nome exato do campo do menor lance na resposta. Um único nome, não uma lista de palpites. */
  campoMenorLance: "",
  campoNossoLance: "",
  campoDisputaAberta: "",
  /** Monta o corpo do POST de lance no formato que o portal espera. */
  corpoLance: (_valor: number): unknown => {
    throw new PortalNaoCalibradoError("corpoLance");
  }
};

function exigirCalibracao(operacao: string): void {
  if (!CALIBRADO) throw new PortalNaoCalibradoError(operacao);
}

/** Lê um campo aninhado ("dados.item.valor") sem assumir formato. */
function lerCampo(obj: unknown, caminho: string): unknown {
  return caminho
    .split(".")
    .reduce<unknown>((acc, parte) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[parte] : undefined), obj);
}

function exigirNumero(valor: unknown, campo: string): number {
  const n = typeof valor === "string" ? Number(valor.replace(/\./g, "").replace(",", ".")) : valor;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(
      `Campo "${campo}" veio como ${JSON.stringify(valor)}, que não é um número. ` +
        `O mapeamento em comprasnet.ts está desatualizado — recapture o tráfego.`
    );
  }
  return n;
}

export class ComprasnetAdapter implements PortalAdapter {
  readonly nome = "Compras.gov.br";
  readonly ehSimulacao = false;

  constructor(private readonly sessao: Session) {}

  private montarUrl(template: string, ref: ReferenciaItem): string {
    return template
      .replace("{pregaoId}", encodeURIComponent(ref.pregaoId))
      .replace("{itemNum}", encodeURIComponent(ref.itemNum));
  }

  async lerEstado(ref: ReferenciaItem): Promise<EstadoItem> {
    exigirCalibracao("lerEstado");

    const resp = await this.sessao.fetch(this.montarUrl(MAPEAMENTO.urlEstado, ref), {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Sessão do Compras.gov.br expirou. Faça login novamente no aplicativo.");
    }
    if (!resp.ok) {
      throw new Error(`Portal respondeu ${resp.status} ao ler o item. Nenhum lance será enviado neste ciclo.`);
    }

    const dados: unknown = await resp.json();
    return {
      menorLance: exigirNumero(lerCampo(dados, MAPEAMENTO.campoMenorLance), MAPEAMENTO.campoMenorLance),
      nossoLance: MAPEAMENTO.campoNossoLance
        ? exigirNumero(lerCampo(dados, MAPEAMENTO.campoNossoLance), MAPEAMENTO.campoNossoLance)
        : undefined,
      aberto: Boolean(lerCampo(dados, MAPEAMENTO.campoDisputaAberta)),
      lidoEm: new Date()
    };
  }

  async enviarLance(ref: ReferenciaItem, valor: number): Promise<ResultadoEnvio> {
    exigirCalibracao("enviarLance");

    const resp = await this.sessao.fetch(this.montarUrl(MAPEAMENTO.urlEnvioLance, ref), {
      method: MAPEAMENTO.metodoEnvio,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(MAPEAMENTO.corpoLance(valor))
    });

    const texto = await resp.text();
    return { aceito: resp.ok, mensagem: `HTTP ${resp.status} — ${texto.slice(0, 500)}` };
  }
}
