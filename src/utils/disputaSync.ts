import { DisputaRow } from "../types";

const PENDENTES_SYNC_KEY = "aip_disputas_pendentes_sync";

/**
 * Mantém a lista de IDs de disputas criadas/alteradas localmente cujo envio ao
 * banco ainda está em andamento ou falhou. Isso evita que um refresh imediato
 * do Calendário sobrescreva uma disputa recém-inserida pelo Analisador sem
 * ressuscitar registros que foram excluídos intencionalmente em outro aparelho.
 */
export function lerDisputasPendentesSync(): Set<string> {
  try {
    const raw = localStorage.getItem(PENDENTES_SYNC_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

export function marcarDisputaPendenteSync(id: string): void {
  if (!id) return;
  try {
    const set = lerDisputasPendentesSync();
    set.add(id);
    localStorage.setItem(PENDENTES_SYNC_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore storage errors
  }
}

export function limparDisputaPendenteSync(id: string): void {
  if (!id) return;
  try {
    const set = lerDisputasPendentesSync();
    if (!set.has(id)) return;
    set.delete(id);
    localStorage.setItem(PENDENTES_SYNC_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore storage errors
  }
}

export function mesclarDisputasComPendentesLocais(
  dbRows: DisputaRow[],
  localRows: DisputaRow[]
): { rows: DisputaRow[]; pendentesReenviar: DisputaRow[] } {
  const pendentesIds = lerDisputasPendentesSync();
  if (pendentesIds.size === 0 || localRows.length === 0) {
    return { rows: dbRows, pendentesReenviar: [] };
  }

  const localById = new Map(localRows.map((r) => [r.id, r]));
  const dbIds = new Set(dbRows.map((r) => r.id));
  const pendentesReenviar: DisputaRow[] = [];

  const merged = dbRows.map((dbRow) => {
    if (pendentesIds.has(dbRow.id)) {
      const localVersion = localById.get(dbRow.id);
      if (localVersion) {
        pendentesReenviar.push(localVersion);
        return localVersion;
      }
    }
    return dbRow;
  });

  for (const localRow of localRows) {
    if (pendentesIds.has(localRow.id) && !dbIds.has(localRow.id)) {
      merged.unshift(localRow);
      pendentesReenviar.push(localRow);
    }
  }

  return { rows: merged, pendentesReenviar };
}
