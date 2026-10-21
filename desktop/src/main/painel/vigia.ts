/**
 * Vigia das janelas do portal.
 *
 * Depois de muitas tentativas de fazer o aplicativo entrar no Compras.gov.br sozinho, a
 * conclusão honesta é que o acesso ao sistema novo depende de passos que só existem na
 * máquina e na conta do operador. Então inverte-se o encargo: ele navega como já faz
 * todo dia, e o robô ACOMPANHA a janela aberta.
 *
 * Este módulo olha, de tempos em tempos, as janelas do portal que estão abertas no
 * aplicativo. Quando uma delas é uma sala de disputa — quem diz isso é o agente dentro
 * da página, que enxerga os cartões dos itens —, avisa quem estiver ouvindo. Nenhuma
 * navegação é forçada, nenhum clique é dado: só leitura.
 */
import { BrowserWindow } from "electron";

export interface DisputaNaTela {
  idJanela: number;
  /** Número da compra, quando a página informa. */
  compra: string;
  titulo: string;
  itens: number;
  /** Quantos itens estão em fase de lances agora. */
  abertos: number;
}

export interface OpcoesVigia {
  /** Partição da sessão do portal: só janelas dela interessam. */
  partition: string;
  /** Injeta o agente de leitura na janela. */
  preparar: (janela: BrowserWindow) => Promise<void>;
  aoDetectar: (disputa: DisputaNaTela) => void;
  intervaloMs?: number;
}

const SCRIPT_RECONHECER = `
(() => {
  const b = window.__lancebot;
  if (!b) return null;
  try {
    const d = b.identificarDisputa();
    const cartoes = b.cartoes ? b.cartoes() : [];
    const itens = cartoes.map(b.lerCartao).filter(Boolean);
    return {
      compra: String((d && d.compra) || ""),
      titulo: String((d && d.titulo) || ""),
      naSala: Boolean(d && d.naSalaDeDisputa) || itens.length > 0,
      itens: itens.length,
      abertos: itens.filter((i) => i && i.aberto).length
    };
  } catch (e) {
    return null;
  }
})()`;

export class VigiaDeDisputas {
  private relogio: NodeJS.Timeout | null = null;
  private readonly preparadas = new Set<number>();
  private readonly avisadas = new Set<string>();

  constructor(private readonly opcoes: OpcoesVigia) {}

  iniciar(): void {
    if (this.relogio) return;
    const intervalo = Math.max(1_000, this.opcoes.intervaloMs ?? 2_000);
    this.relogio = setInterval(() => void this.olhar(), intervalo);
  }

  parar(): void {
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
  }

  /** Esquece o que já foi avisado — usado quando o painel fecha. */
  reiniciarAvisos(): void {
    this.avisadas.clear();
  }

  private async olhar(): Promise<void> {
    for (const janela of BrowserWindow.getAllWindows()) {
      if (janela.isDestroyed()) continue;
      const conteudo = janela.webContents;
      // Só janelas que estão no portal. O endereço basta: a janela principal do
      // aplicativo e qualquer outra coisa ficam de fora.
      if (!/serpro\.gov\.br|comprasnet\.gov\.br|compras\.gov\.br/i.test(conteudo.getURL())) continue;

      if (!this.preparadas.has(janela.id)) {
        this.preparadas.add(janela.id);
        janela.on("closed", () => this.preparadas.delete(janela.id));
        try {
          await this.opcoes.preparar(janela);
        } catch {
          // Página em transição; a próxima volta tenta de novo.
        }
      }

      type LeituraDaTela = { compra: string; titulo: string; naSala: boolean; itens: number; abertos: number };
      let leitura: LeituraDaTela | null = null;
      try {
        leitura = (await conteudo.executeJavaScript(SCRIPT_RECONHECER, true)) as LeituraDaTela | null;
      } catch {
        continue; // navegando
      }
      if (!leitura?.naSala || leitura.itens === 0) continue;

      // Avisa uma vez por sala, para o painel não reabrir a cada volta do laço.
      const chave = `${janela.id}:${leitura.compra}`;
      if (this.avisadas.has(chave)) continue;
      this.avisadas.add(chave);

      this.opcoes.aoDetectar({
        idJanela: janela.id,
        compra: leitura.compra,
        titulo: leitura.titulo,
        itens: leitura.itens,
        abertos: leitura.abertos
      });
    }
  }
}
