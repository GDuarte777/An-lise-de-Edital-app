import type { Session } from "electron";
import type { DescobridorApi } from "./discovery.js";

/**
 * Lista as disputas em que o operador tem proposta cadastrada, usando o endpoint que o
 * DescobridorApi aprendeu ao observar o painel do portal.
 *
 * A resposta do portal não tem formato conhecido de antemão, então em vez de exigir um
 * esquema fixo procuramos, em cada registro, os campos que parecem número do pregão,
 * número do item e situação. O que não for reconhecido vira texto exibido cru, para o
 * operador conseguir identificar a disputa mesmo quando a heurística erra.
 */

export interface Disputa {
  pregaoId: string;
  itemNum: string;
  descricao: string;
  situacao: string;
  /** Se a situação indica que o item aceita lances agora. */
  emFaseDeLances: boolean;
}

const CHAVES = {
  pregao: ["numerocompra", "numeropregao", "idcompra", "numerolicitacao", "pregao", "compra", "licitacao"],
  item: ["numeroitem", "nritem", "iditem", "item", "numero"],
  descricao: ["descricao", "objeto", "descricaoitem", "nome", "titulo"],
  situacao: ["situacao", "status", "fase", "situacaoitem", "statusitem", "etapa"]
};

const EM_LANCES = /lance|disputa|abert|andamento/i;
const ENCERRADO = /encerrad|fechad|finalizad|cancelad|suspens|homologad|adjudicad|desert|fracassad/i;

function normalizar(chave: string): string {
  return chave.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Acha, num registro plano, o primeiro campo cujo nome case com as pistas. */
function pegar(registro: Record<string, unknown>, pistas: string[]): string | undefined {
  const entradas = Object.entries(registro);
  for (const pista of pistas) {
    for (const [chave, valor] of entradas) {
      if (valor === null || valor === undefined || typeof valor === "object") continue;
      if (normalizar(chave).includes(pista)) return String(valor);
    }
  }
  return undefined;
}

/** Extrai a coleção de registros de uma resposta que pode ou não vir embrulhada. */
function extrairRegistros(dados: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(dados)) return dados.filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null);
  if (dados && typeof dados === "object") {
    for (const valor of Object.values(dados as Record<string, unknown>)) {
      if (Array.isArray(valor) && valor.length > 0 && typeof valor[0] === "object") {
        return valor as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

export async function listarDisputas(sessao: Session, descobridor: DescobridorApi): Promise<Disputa[]> {
  const endpoint = descobridor.calibracao.listaDisputas;
  if (!endpoint) {
    throw new Error(
      "O aplicativo ainda não aprendeu onde ficam suas disputas. Abra o painel de disputas do portal " +
        "pelo botão acima — basta navegar por ele uma vez para a calibração acontecer."
    );
  }

  const resp = await sessao.fetch(endpoint.padrao, {
    method: endpoint.metodo,
    headers: { Accept: "application/json" }
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error("A sessão do Compras.gov.br expirou. Entre novamente pelo aplicativo.");
  }
  if (!resp.ok) throw new Error(`O portal respondeu ${resp.status} ao listar suas disputas.`);

  return extrairRegistros(await resp.json())
    .map((registro) => {
      const situacao = pegar(registro, CHAVES.situacao) ?? "";
      return {
        pregaoId: pegar(registro, CHAVES.pregao) ?? "",
        itemNum: pegar(registro, CHAVES.item) ?? "",
        descricao: pegar(registro, CHAVES.descricao) ?? "Item sem descrição",
        situacao,
        emFaseDeLances: EM_LANCES.test(situacao) && !ENCERRADO.test(situacao)
      };
    })
    .filter((d) => d.pregaoId !== "");
}
