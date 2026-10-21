/**
 * A fonte real do painel, vista pela interface.
 *
 * O robô mora no processo principal (é lá que ele alcança a janela da sala); aqui só
 * chega o estado pronto, empurrado a cada leitura. O contrato é o mesmo da
 * demonstração, de propósito: a tela não sabe — nem precisa saber — de onde vem o dado.
 */
import type { ConfigItem, EstadoPainel, FontePainel, LinhaClassificacao } from "../../compartilhado/painel.js";

interface ApiPainel {
  iniciar(pregaoId?: string): Promise<EstadoPainel>;
  acompanhar(idJanela: number): Promise<EstadoPainel>;
  encerrar(): Promise<{ encerrado: boolean }>;
  estado(): Promise<EstadoPainel>;
  configurar(item: string, mudanca: Partial<ConfigItem>): Promise<EstadoPainel>;
  armar(item: string): Promise<EstadoPainel>;
  desarmar(item: string, motivo?: string): Promise<EstadoPainel>;
  classificacao(item: string): Promise<LinhaClassificacao[]>;
  aoEstado(cb: (e: EstadoPainel) => void): () => void;
}

function api(): ApiPainel {
  const janela = window as unknown as { lancebot?: { painel?: ApiPainel } };
  const painel = janela.lancebot?.painel;
  if (!painel) {
    throw new Error("Esta tela precisa do aplicativo instalado — a ponte com o robô não está disponível aqui.");
  }
  return painel;
}

/**
 * Abre a sala, começa o laço de leitura e devolve a fonte já com o primeiro estado em
 * mãos. Se a sala não abrir, o erro sobe: é melhor a tela não abrir do que abrir vazia
 * fingindo que está acompanhando a disputa.
 */
export async function criarFonteIpc(pregaoId?: string): Promise<FontePainel> {
  return montar((ponte) => ponte.iniciar(pregaoId));
}

/**
 * Painel sobre a janela do portal que o operador já abriu — o caminho que não depende
 * de o aplicativo entrar no portal sozinho.
 */
export async function criarFonteDaJanela(idJanela: number): Promise<FontePainel> {
  return montar((ponte) => ponte.acompanhar(idJanela));
}

async function montar(abrir: (ponte: ApiPainel) => Promise<EstadoPainel>): Promise<FontePainel> {
  const ponte = api();
  let atual = await abrir(ponte);
  const ouvintes = new Set<(e: EstadoPainel) => void>();

  const cancelarPush = ponte.aoEstado((estado) => {
    atual = estado;
    for (const ouvinte of ouvintes) ouvinte(estado);
  });

  const guardar = (estado: EstadoPainel): void => {
    atual = estado;
    for (const ouvinte of ouvintes) ouvinte(estado);
  };

  return {
    estadoAtual: () => atual,
    assinar: (ouvinte) => {
      ouvintes.add(ouvinte);
      ouvinte(atual);
      return () => ouvintes.delete(ouvinte);
    },
    comandos: {
      configurar: (item, mudanca) => {
        void ponte.configurar(item, mudanca).then(guardar);
      },
      armar: (item) => {
        void ponte.armar(item).then(guardar);
      },
      desarmar: (item, motivo) => {
        void ponte.desarmar(item, motivo).then(guardar);
      },
      classificacao: (item) => ponte.classificacao(item)
    },
    encerrar: () => {
      cancelarPush();
      ouvintes.clear();
      void ponte.encerrar();
    }
  };
}
