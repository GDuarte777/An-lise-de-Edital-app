/**
 * Relógio e timers injetáveis.
 *
 * Tudo que depende de tempo no robô (pulso do socket, janela final, intervalo entre
 * lances) passa por aqui, para que o teste possa andar com o tempo na mão em vez de
 * dormir de verdade. Em produção é `Date.now` e `setTimeout`, nada mais.
 */
export interface Temporizador {
  agora(): number;
  /** Agenda e devolve o cancelador. */
  agendar(ms: number, acao: () => void): () => void;
}

export const TEMPORIZADOR_REAL: Temporizador = {
  agora: () => Date.now(),
  agendar: (ms, acao) => {
    const t = setTimeout(acao, ms);
    return () => clearTimeout(t);
  }
};
