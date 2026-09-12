import { contextBridge, ipcRenderer } from "electron";

/**
 * Ponte entre a interface e o processo principal.
 *
 * Só estes canais são expostos — a interface não alcança Node, filesystem nem a sessão
 * do Compras.gov.br diretamente.
 */

export interface Usuario {
  id: string;
  email: string;
}

export interface StatusSessao {
  autenticado: boolean;
  cookiesEncontrados: number;
  /** Em que a verificação se apoiou — a interface mostra isso em vez de só dizer "não". */
  evidencia: string;
}

export interface EndpointAprendido {
  papel: string;
  padrao: string;
  metodo: string;
  campos: Record<string, string>;
  aprendidoEm: string;
  ocorrencias: number;
}

export interface Calibracao {
  estadoItem?: EndpointAprendido;
  listaDisputas?: EndpointAprendido;
  envioLance?: EndpointAprendido;
  pronto: boolean;
}

export interface Disputa {
  pregaoId: string;
  itemNum: string;
  descricao: string;
  situacao: string;
  emFaseDeLances: boolean;
  origem: "tela" | "api";
}

/** O que o robô enxerga dentro da sala, antes de qualquer lance valer dinheiro. */
export interface ConferenciaSala {
  diagnostico: {
    url: string;
    titulo: string;
    escopoEncontrado: boolean;
    textoEscopo: string;
    campoLance: string | null;
    botaoEnvio: string | null;
    entradasVisiveis: number;
    botoesVisiveis: number;
    valoresNaTela: number[];
  };
  leitura: {
    ok: boolean;
    menorLance: number | null;
    nossoLance: number | null;
    aberto: boolean;
    evidencia: string;
    motivo?: string;
  };
  ensaio: { ok: boolean; etapa: string; mensagem: string } | null;
  seletores: { campo?: string; botao?: string; aprendidoEm?: string };
}

/** O que o guardião de sessão está fazendo — a interface mostra isso ao operador. */
export interface EstadoGuardiao {
  ativo: boolean;
  autenticado: boolean;
  desde: string | null;
  ultimaRenovacaoEm: string | null;
  proximaRenovacaoEm: string | null;
  renovacoes: number;
  falhasSeguidas: number;
  retokensObservados: number;
  motivo: string;
}

/** O que o aplicativo enxergou em cada endereço do portal que tentou. */
export interface TentativaSessao {
  url: string;
  urlFinal: string;
  autenticado: boolean;
  motivo: string | null;
  sondagem: {
    url: string;
    noSso: boolean;
    noPortal: boolean;
    temSenha: boolean;
    temSair: boolean;
    temIdentidade: boolean;
    escolhendoPerfil: boolean;
    tamanho: number;
  } | null;
}

export interface DiagnosticoSessao {
  status: StatusSessao;
  /** Resposta do portal a "quem está logado?" — a evidência principal. */
  api: { status: number; ok: boolean; erro?: string };
  tentativas: TentativaSessao[];
  enderecosAprendidos: Record<string, string | undefined>;
  dominiosDeCookie: string[];
}

export interface ApiLanceBot {
  plataforma: {
    entrar(email: string, senha: string): Promise<Usuario>;
    restaurar(): Promise<Usuario | null>;
    sair(): Promise<void>;
  };
  comprasnet: {
    entrar(): Promise<StatusSessao>;
    status(forcar?: boolean): Promise<StatusSessao>;
    diagnostico(): Promise<DiagnosticoSessao>;
    sair(): Promise<void>;
    abrirSala(pregaoId?: string): Promise<number>;
    abrirPainel(): Promise<number>;
  };
  /**
   * Manutenção da sessão do gov.br. É o que diferencia este aplicativo de uma extensão:
   * a sessão é mantida de pé pelo próprio programa, sem o operador atualizar a página.
   */
  sessao: {
    manterViva(): Promise<EstadoGuardiao>;
    soltar(): Promise<EstadoGuardiao>;
    guardiao(): Promise<EstadoGuardiao>;
    aoMudar(cb: (e: EstadoGuardiao) => void): () => void;
  };
  calibracao: {
    estado(): Promise<Calibracao>;
    esquecer(): Promise<{ ok: boolean }>;
    observadas(): Promise<Array<{ metodo: string; url: string; status: number; em: string }>>;
    aoAtualizar(cb: (e: unknown) => void): () => void;
  };
  disputas: {
    listar(): Promise<Disputa[]>;
  };
  sala: {
    conferir(ref: { pregaoId: string; itemNum: string }, valorEnsaio?: number): Promise<ConferenciaSala>;
  };
  robo: {
    iniciar(cfg: unknown): Promise<{ iniciado: boolean; portal: string; ehSimulacao: boolean }>;
    parar(): Promise<{ parado: boolean }>;
    aoLog(cb: (e: unknown) => void): () => void;
    aoEstado(cb: (e: string) => void): () => void;
  };
}

function assinar<T>(canal: string, cb: (carga: T) => void): () => void {
  const h = (_e: unknown, carga: T) => cb(carga);
  ipcRenderer.on(canal, h as never);
  return () => ipcRenderer.removeListener(canal, h as never);
}

const api: ApiLanceBot = {
  plataforma: {
    entrar: (email, senha) => ipcRenderer.invoke("plataforma:entrar", email, senha),
    restaurar: () => ipcRenderer.invoke("plataforma:restaurar"),
    sair: () => ipcRenderer.invoke("plataforma:sair")
  },
  comprasnet: {
    entrar: () => ipcRenderer.invoke("comprasnet:entrar"),
    status: (forcar) => ipcRenderer.invoke("comprasnet:status", forcar),
    diagnostico: () => ipcRenderer.invoke("comprasnet:diagnostico"),
    sair: () => ipcRenderer.invoke("comprasnet:sair"),
    abrirSala: (pregaoId) => ipcRenderer.invoke("comprasnet:abrirSala", pregaoId),
    abrirPainel: () => ipcRenderer.invoke("comprasnet:abrirPainel")
  },
  sessao: {
    manterViva: () => ipcRenderer.invoke("sessao:manterViva"),
    soltar: () => ipcRenderer.invoke("sessao:soltar"),
    guardiao: () => ipcRenderer.invoke("sessao:guardiao"),
    aoMudar: (cb) => assinar<EstadoGuardiao>("sessao:guardiao", cb)
  },
  calibracao: {
    estado: () => ipcRenderer.invoke("calibracao:estado"),
    esquecer: () => ipcRenderer.invoke("calibracao:esquecer"),
    observadas: () => ipcRenderer.invoke("calibracao:observadas"),
    aoAtualizar: (cb) => assinar("calibracao:atualizada", cb)
  },
  disputas: {
    listar: () => ipcRenderer.invoke("disputas:listar")
  },
  sala: {
    conferir: (ref, valorEnsaio) => ipcRenderer.invoke("sala:conferir", ref, valorEnsaio)
  },
  robo: {
    iniciar: (cfg) => ipcRenderer.invoke("robo:iniciar", cfg),
    parar: () => ipcRenderer.invoke("robo:parar"),
    aoLog: (cb) => assinar("robo:log", cb),
    aoEstado: (cb) => assinar<string>("robo:estado", cb)
  }
};

contextBridge.exposeInMainWorld("lancebot", api);
