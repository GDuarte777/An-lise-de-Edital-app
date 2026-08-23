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
}

export interface ApiLanceBot {
  plataforma: {
    entrar(email: string, senha: string): Promise<Usuario>;
    restaurar(): Promise<Usuario | null>;
    sair(): Promise<void>;
  };
  comprasnet: {
    entrar(): Promise<StatusSessao>;
    status(): Promise<StatusSessao>;
    sair(): Promise<void>;
    abrirSala(pregaoId?: string): Promise<number>;
    abrirPainel(): Promise<number>;
  };
  calibracao: {
    estado(): Promise<Calibracao>;
    esquecer(): Promise<{ ok: boolean }>;
    aoAtualizar(cb: (e: unknown) => void): () => void;
  };
  disputas: {
    listar(): Promise<Disputa[]>;
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
    status: () => ipcRenderer.invoke("comprasnet:status"),
    sair: () => ipcRenderer.invoke("comprasnet:sair"),
    abrirSala: (pregaoId) => ipcRenderer.invoke("comprasnet:abrirSala", pregaoId),
    abrirPainel: () => ipcRenderer.invoke("comprasnet:abrirPainel")
  },
  calibracao: {
    estado: () => ipcRenderer.invoke("calibracao:estado"),
    esquecer: () => ipcRenderer.invoke("calibracao:esquecer"),
    aoAtualizar: (cb) => assinar("calibracao:atualizada", cb)
  },
  disputas: {
    listar: () => ipcRenderer.invoke("disputas:listar")
  },
  robo: {
    iniciar: (cfg) => ipcRenderer.invoke("robo:iniciar", cfg),
    parar: () => ipcRenderer.invoke("robo:parar"),
    aoLog: (cb) => assinar("robo:log", cb),
    aoEstado: (cb) => assinar<string>("robo:estado", cb)
  }
};

contextBridge.exposeInMainWorld("lancebot", api);
