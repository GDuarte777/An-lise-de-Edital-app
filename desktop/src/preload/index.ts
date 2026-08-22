import { contextBridge, ipcRenderer } from "electron";

/**
 * Ponte entre a interface e o processo principal.
 *
 * Só estes canais são expostos — a interface não alcança Node, filesystem nem a sessão
 * do Compras.gov.br diretamente.
 */

export interface ApiLanceBot {
  plataforma: {
    entrar(email: string, senha: string): Promise<{ id: string; email: string }>;
    restaurar(): Promise<{ id: string; email: string } | null>;
    sair(): Promise<void>;
  };
  comprasnet: {
    entrar(): Promise<{ autenticado: boolean; cookiesEncontrados: number }>;
    status(): Promise<{ autenticado: boolean; cookiesEncontrados: number }>;
    sair(): Promise<void>;
    abrirSala(): Promise<number>;
  };
  captura: {
    iniciar(): Promise<{ gravando: boolean }>;
    parar(): Promise<{ gravando: boolean; total: number }>;
    exportar(): Promise<{ exportado: boolean; caminho?: string; chamadas?: number }>;
  };
  robo: {
    iniciar(cfg: unknown): Promise<{ iniciado: boolean; portal: string; ehSimulacao: boolean }>;
    parar(): Promise<{ parado: boolean }>;
    aoLog(cb: (e: unknown) => void): () => void;
    aoEstado(cb: (e: string) => void): () => void;
  };
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
    abrirSala: () => ipcRenderer.invoke("comprasnet:abrirSala")
  },
  captura: {
    iniciar: () => ipcRenderer.invoke("captura:iniciar"),
    parar: () => ipcRenderer.invoke("captura:parar"),
    exportar: () => ipcRenderer.invoke("captura:exportar")
  },
  robo: {
    iniciar: (cfg) => ipcRenderer.invoke("robo:iniciar", cfg),
    parar: () => ipcRenderer.invoke("robo:parar"),
    aoLog: (cb) => {
      const h = (_e: unknown, carga: unknown) => cb(carga);
      ipcRenderer.on("robo:log", h);
      return () => ipcRenderer.removeListener("robo:log", h);
    },
    aoEstado: (cb) => {
      const h = (_e: unknown, carga: string) => cb(carga);
      ipcRenderer.on("robo:estado", h);
      return () => ipcRenderer.removeListener("robo:estado", h);
    }
  }
};

contextBridge.exposeInMainWorld("lancebot", api);
