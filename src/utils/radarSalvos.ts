import {
  fetchDisputasSalvasRadarFromSupabase,
  saveDisputaSalvaRadarToSupabase,
  deleteDisputaSalvaRadarFromSupabase,
} from "./supabaseClient";

export interface DisputaSalvaRadar {
  id: string;
  numeroControlePNCP: string;
  numero: string;
  tituloPncp: string;
  orgao: string;
  cnpjOrgao?: string;
  uf: string;
  municipio: string;
  unidade: string;
  uasg?: string;
  objeto: string;
  dataPublicacao: string;
  dataAtualizacao: string;
  dataAbertura: string;
  valorEstimadoRaw: number;
  valorEstimado: string;
  valorHomologadoRaw?: number;
  valorHomologado?: string;
  orcamentoSigiloso?: boolean;
  precoCarregando?: boolean;
  modalidade: string;
  modalidadeId?: string | number;
  situacao: string;
  fonteId?: string;
  fonteNome?: string;
  linkPNCP?: string;
  salvoEm: string;
}

const STORAGE_KEY = "aip_radar_disputas_salvas";
const PENDENTES_KEY = "aip_radar_salvos_pendentes";
const REMOVIDOS_KEY = "aip_radar_salvos_removidos";

export function chaveDisputaSalva(item: { numeroControlePNCP?: string; id?: string }): string {
  return String(item.numeroControlePNCP || item.id || "").trim();
}

function lerSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function gravarSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // ignore storage errors
  }
}

export function lerDisputasSalvasLocal(): DisputaSalvaRadar[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const vistas = new Set<string>();
    const limpas: DisputaSalvaRadar[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const chave = chaveDisputaSalva(item);
      if (!chave || vistas.has(chave)) continue;
      vistas.add(chave);
      limpas.push({
        ...item,
        precoCarregando: false,
        salvoEm: typeof item.salvoEm === "string" && item.salvoEm ? item.salvoEm : new Date().toISOString(),
      });
    }
    return limpas;
  } catch {
    return [];
  }
}

export function gravarDisputasSalvasLocal(lista: DisputaSalvaRadar[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch {
    // ignore quota errors
  }
}

export function alternarDisputaSalva(
  listaAtual: DisputaSalvaRadar[],
  item: Omit<DisputaSalvaRadar, "salvoEm">
): {
  lista: DisputaSalvaRadar[];
  salvo: boolean;
  chave: string;
  itemSalvo?: DisputaSalvaRadar;
} {
  const chave = chaveDisputaSalva(item);
  if (!chave) return { lista: listaAtual, salvo: false, chave: "" };

  const jaSalvo = listaAtual.some((s) => chaveDisputaSalva(s) === chave);
  const pendentes = lerSet(PENDENTES_KEY);
  const removidos = lerSet(REMOVIDOS_KEY);

  if (jaSalvo) {
    const novaLista = listaAtual.filter((s) => chaveDisputaSalva(s) !== chave);
    gravarDisputasSalvasLocal(novaLista);
    pendentes.delete(chave);
    removidos.add(chave);
    gravarSet(PENDENTES_KEY, pendentes);
    gravarSet(REMOVIDOS_KEY, removidos);
    return { lista: novaLista, salvo: false, chave };
  }

  const novoItem: DisputaSalvaRadar = {
    ...item,
    precoCarregando: false,
    salvoEm: new Date().toISOString(),
  };
  const novaLista = [novoItem, ...listaAtual.filter((s) => chaveDisputaSalva(s) !== chave)];
  gravarDisputasSalvasLocal(novaLista);
  removidos.delete(chave);
  pendentes.add(chave);
  gravarSet(PENDENTES_KEY, pendentes);
  gravarSet(REMOVIDOS_KEY, removidos);
  return { lista: novaLista, salvo: true, chave, itemSalvo: novoItem };
}

export function persistirAlternanciaSalvoNaNuvem(resultado: {
  salvo: boolean;
  chave: string;
  itemSalvo?: DisputaSalvaRadar;
}): void {
  if (!resultado.chave) return;
  if (resultado.salvo && resultado.itemSalvo) {
    saveDisputaSalvaRadarToSupabase(
      resultado.chave,
      resultado.itemSalvo,
      resultado.itemSalvo.salvoEm
    )
      .then((ok) => {
        if (ok) {
          const pendentes = lerSet(PENDENTES_KEY);
          pendentes.delete(resultado.chave);
          gravarSet(PENDENTES_KEY, pendentes);
        }
      })
      .catch(() => {});
  } else {
    deleteDisputaSalvaRadarFromSupabase(resultado.chave)
      .then((ok) => {
        if (ok) {
          const removidos = lerSet(REMOVIDOS_KEY);
          removidos.delete(resultado.chave);
          gravarSet(REMOVIDOS_KEY, removidos);
        }
      })
      .catch(() => {});
  }
}

export async function sincronizarDisputasSalvasComNuvem(
  locaisAtuais: DisputaSalvaRadar[]
): Promise<DisputaSalvaRadar[]> {
  const res = await fetchDisputasSalvasRadarFromSupabase();
  if (!res.ok) return locaisAtuais;

  const pendentes = lerSet(PENDENTES_KEY);
  const removidos = lerSet(REMOVIDOS_KEY);
  const mapa = new Map<string, DisputaSalvaRadar>();

  // Primeiro adiciona remotos (ignorando itens removidos localmente ainda pendentes de delete)
  for (const raw of res.rows) {
    const chave = chaveDisputaSalva(raw);
    if (!chave) continue;
    if (removidos.has(chave)) {
      deleteDisputaSalvaRadarFromSupabase(chave)
        .then((ok) => {
          if (ok) {
            const set = lerSet(REMOVIDOS_KEY);
            set.delete(chave);
            gravarSet(REMOVIDOS_KEY, set);
          }
        })
        .catch(() => {});
      continue;
    }
    mapa.set(chave, { ...raw, precoCarregando: false });
  }

  // Preserva itens locais pendentes de upload e reenvia em segundo plano
  for (const local of locaisAtuais) {
    const chave = chaveDisputaSalva(local);
    if (!chave) continue;
    if (pendentes.has(chave) || !mapa.has(chave)) {
      if (pendentes.has(chave)) {
        mapa.set(chave, local);
        saveDisputaSalvaRadarToSupabase(chave, local, local.salvoEm)
          .then((ok) => {
            if (ok) {
              const set = lerSet(PENDENTES_KEY);
              set.delete(chave);
              gravarSet(PENDENTES_KEY, set);
            }
          })
          .catch(() => {});
      }
    }
  }

  const mesclada = Array.from(mapa.values()).sort(
    (a, b) => new Date(b.salvoEm).getTime() - new Date(a.salvoEm).getTime()
  );
  gravarDisputasSalvasLocal(mesclada);
  return mesclada;
}
