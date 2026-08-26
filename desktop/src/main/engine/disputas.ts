import type { Session } from "electron";
import type { DescobridorApi } from "./discovery.js";
import type { GerenciadorSalas } from "./sala.js";
import type { ItemVisivel } from "./sala-script.js";

/**
 * Lista as disputas do operador.
 *
 * São dois caminhos, nesta ordem:
 *
 *  1. **A tela do portal.** Uma janela oculta, na sessão já autenticada, abre as páginas
 *     do fornecedor e lê as linhas que o portal desenha. Funciona no minuto seguinte ao
 *     login, sem calibração nenhuma. Este é o caminho normal.
 *  2. **A API aprendida**, quando o DescobridorApi tiver reconhecido o endpoint da lista
 *     enquanto o operador navegava. É mais rápido e mais preciso quando existe — mas
 *     nunca foi pré-requisito, e era exatamente por ser tratado como pré-requisito que
 *     "Suas disputas" ficava permanentemente vazia.
 *
 * Os dois resultados são fundidos por (pregão, item): o que a API souber melhora o que a
 * tela mostrou, e vice-versa.
 */

export interface Disputa {
  pregaoId: string;
  itemNum: string;
  descricao: string;
  situacao: string;
  /** Se a situação indica que o item aceita lances agora. */
  emFaseDeLances: boolean;
  /** De onde veio o registro — a interface mostra isso para o operador saber em que confiar. */
  origem: "tela" | "api";
}

/** Páginas do fornecedor que listam sessões públicas em andamento. */
const PAGINAS_DO_FORNECEDOR = [
  "https://sala-disputa.comprasnet.gov.br/",
  "https://sala-disputa.comprasnet.gov.br/minhas-disputas",
  "https://sala-disputa.comprasnet.gov.br/sessoes"
];

const CHAVES = {
  pregao: ["numerocompra", "numeropregao", "idcompra", "numerolicitacao", "pregao", "compra", "licitacao"],
  item: ["numeroitem", "nritem", "iditem", "item", "numero"],
  descricao: ["descricao", "objeto", "descricaoitem", "nome", "titulo"],
  situacao: ["situacao", "status", "fase", "situacaoitem", "statusitem", "etapa"]
};

const EM_LANCES = /lance|disputa|abert|andamento|recebendo/i;
const ENCERRADO = /encerrad|fechad|finalizad|cancelad|suspens|homologad|adjudicad|desert|fracassad/i;

function normalizar(chave: string): string {
  return chave.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function estaEmFaseDeLances(situacao: string): boolean {
  return EM_LANCES.test(situacao) && !ENCERRADO.test(situacao);
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

async function pelaApi(sessao: Session, descobridor: DescobridorApi): Promise<Disputa[]> {
  const endpoint = descobridor.calibracao.listaDisputas;
  if (!endpoint) return [];

  // `padrao` troca identificadores por marcadores. Sem pregão para substituir, a URL
  // com marcador é inválida — aí vale a URL concreta que foi observada.
  const url = endpoint.padrao.includes("{") ? endpoint.exemploUrl : endpoint.padrao;
  if (!url || url.includes("{")) return [];

  const resp = await sessao.fetch(url, { method: endpoint.metodo, headers: { Accept: "application/json" } });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("A sessão do Compras.gov.br expirou. Entre novamente pelo aplicativo.");
  }
  if (!resp.ok) return [];

  return extrairRegistros(await resp.json())
    .map((registro): Disputa => {
      const situacao = pegar(registro, CHAVES.situacao) ?? "";
      return {
        pregaoId: pegar(registro, CHAVES.pregao) ?? "",
        itemNum: pegar(registro, CHAVES.item) ?? "",
        descricao: pegar(registro, CHAVES.descricao) ?? "Item sem descrição",
        situacao,
        emFaseDeLances: estaEmFaseDeLances(situacao),
        origem: "api"
      };
    })
    .filter((d) => d.pregaoId !== "");
}

function daTela(itens: ItemVisivel[]): Disputa[] {
  return itens
    .filter((i) => i.pregaoId)
    .map((i): Disputa => ({
      pregaoId: i.pregaoId,
      itemNum: i.itemNum,
      descricao: i.descricao || "Item sem descrição",
      situacao: i.situacao,
      emFaseDeLances: estaEmFaseDeLances(i.situacao || i.descricao),
      origem: "tela"
    }));
}

function fundir(...listas: Disputa[][]): Disputa[] {
  const mapa = new Map<string, Disputa>();
  for (const lista of listas) {
    for (const d of lista) {
      const chave = `${d.pregaoId}#${d.itemNum}`;
      const anterior = mapa.get(chave);
      if (!anterior) {
        mapa.set(chave, d);
        continue;
      }
      mapa.set(chave, {
        ...anterior,
        descricao: anterior.descricao.length >= d.descricao.length ? anterior.descricao : d.descricao,
        situacao: anterior.situacao || d.situacao,
        emFaseDeLances: anterior.emFaseDeLances || d.emFaseDeLances
      });
    }
  }
  // Quem está em fase de lances vem primeiro: é o que o operador precisa ver.
  return [...mapa.values()].sort(
    (a, b) =>
      Number(b.emFaseDeLances) - Number(a.emFaseDeLances) ||
      a.pregaoId.localeCompare(b.pregaoId) ||
      Number(a.itemNum || 0) - Number(b.itemNum || 0)
  );
}

export async function listarDisputas(
  sessao: Session,
  descobridor: DescobridorApi,
  salas: GerenciadorSalas
): Promise<Disputa[]> {
  const [tela, api] = await Promise.all([
    salas.coletarDisputas(PAGINAS_DO_FORNECEDOR).then(daTela).catch(() => [] as Disputa[]),
    pelaApi(sessao, descobridor).catch((erro: unknown) => {
      // Sessão expirada é a única falha de API que precisa interromper: sem ela, nem a
      // leitura de tela vale alguma coisa.
      if (erro instanceof Error && /expirou/.test(erro.message)) throw erro;
      return [] as Disputa[];
    })
  ]);

  const disputas = fundir(tela, api);
  if (disputas.length === 0) {
    throw new Error(
      "Não encontrei nenhuma disputa nas páginas do fornecedor. Confirme que a sessão do gov.br " +
        "está ativa e que existe pregão com proposta cadastrada — se houver, abra o portal pelo " +
        "aplicativo e navegue até a lista uma vez, para o app reconhecer o endereço dela."
    );
  }
  return disputas;
}
