/**
 * Contrato entre o motor de lances e o portal de licitação.
 *
 * A estrutura anterior deste projeto adivinhava a API do Compras.gov.br
 * (`data.menorValor || data.menorLance || data.valorAtual`) e apresentava simulação
 * como se fosse produção. Aqui isso é impossível por construção:
 *
 *  - todo adapter declara `ehSimulacao`, e a interface exibe esse estado;
 *  - o adapter real vive em `comprasnet.ts` e se recusa a operar enquanto o mapeamento
 *    de requisição/resposta não tiver sido preenchido com dados capturados de verdade;
 *  - `RecordingAdapter` existe justamente para produzir esses dados.
 */

export interface EstadoItem {
  /** Menor lance vigente no item, em reais. */
  menorLance: number;
  /** Nosso melhor lance no item, se o portal informar. */
  nossoLance?: number;
  /** Se a disputa aceita lances neste instante. */
  aberto: boolean;
  /** Momento da leitura, para medir defasagem. */
  lidoEm: Date;
}

export interface ReferenciaItem {
  pregaoId: string;
  itemNum: string;
}

export interface ResultadoEnvio {
  aceito: boolean;
  /** Mensagem do portal, repassada crua para o log de auditoria. */
  mensagem: string;
}

export interface PortalAdapter {
  readonly nome: string;
  /** Verdadeiro quando os dados não vêm do portal real. A UI precisa deixar isso evidente. */
  readonly ehSimulacao: boolean;

  lerEstado(ref: ReferenciaItem): Promise<EstadoItem>;
  enviarLance(ref: ReferenciaItem, valor: number): Promise<ResultadoEnvio>;
}

/**
 * Erro usado quando o adapter real ainda não foi calibrado com tráfego capturado.
 * É lançado em vez de retornar dados plausíveis — silêncio aqui viraria lance errado lá.
 */
export class PortalNaoCalibradoError extends Error {
  constructor(operacao: string) {
    super(
      `O adapter do Compras.gov.br ainda não foi calibrado para "${operacao}". ` +
        `Rode o Modo Captura durante um pregão real, exporte o tráfego e preencha ` +
        `src/main/engine/comprasnet.ts antes de operar em produção.`
    );
    this.name = "PortalNaoCalibradoError";
  }
}
