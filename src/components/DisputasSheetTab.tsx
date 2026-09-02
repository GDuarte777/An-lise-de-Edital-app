import { useState, useEffect, useRef, useCallback } from "react";
import {
  Table, Plus, Download, Copy, Trash2, Edit2, Search, Filter, Sparkles,
  CheckCircle, DollarSign, Calendar, Landmark, FileSpreadsheet, ArrowUpDown,
  Upload, History, LayoutGrid, Layers, FileText, Check, AlertCircle, RefreshCw, X, ExternalLink, Database,
  Kanban, Palette, GripVertical, Pencil, MoreHorizontal, Target
} from "lucide-react";
import { DisputaRow, DisputaStatus, DisputaStatusType, EditalAnalysis } from "../types";
import { apiFetch, prepareAttachmentForServer, formatAiError, readJsonResponse } from "../utils/aiClientHelper";
import {
  fetchDisputasFromSupabase,
  saveDisputaToSupabase,
  deleteDisputaFromSupabase,
  subscribeToSupabaseTable,
  mapDisputaFromDb,
  generateUUID,
  getSupabaseFullSchemaSQL,
  fetchStatusDisputasFromSupabase,
  saveStatusDisputaToSupabase,
  deleteStatusDisputaFromSupabase
} from "../utils/supabaseClient";
import confetti from "canvas-confetti";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface DisputasSheetTabProps {
  activeEdital?: EditalAnalysis | null;
  onNavigateToAnalyzer?: () => void;
}

interface AnalyzedEditalOption {
  id: string;
  title: string;
  edital: EditalAnalysis;
  dateStr: string;
}

function parseBRLNumber(val: any): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).trim();
  if (!str) return 0;

  if (str.includes(",") && str.includes(".")) {
    const lastDot = str.lastIndexOf(".");
    const lastComma = str.lastIndexOf(",");
    if (lastComma > lastDot) {
      // Brazilian format: 1.250.000,50
      const cleaned = str.replace(/[^0-9,]/g, "").replace(",", ".");
      return parseFloat(cleaned) || 0;
    } else {
      // US format: 1,250,000.50
      const cleaned = str.replace(/[^0-9.]/g, "");
      return parseFloat(cleaned) || 0;
    }
  } else if (str.includes(",")) {
    const cleaned = str.replace(/[^0-9,]/g, "").replace(",", ".");
    return parseFloat(cleaned) || 0;
  } else {
    const cleaned = str.replace(/[^0-9.]/g, "");
    return parseFloat(cleaned) || 0;
  }
}

function extractEditalFields(editalObj: EditalAnalysis, fileNameFallback?: string) {
  const iden: any = editalObj.identificacaoCertame || {};
  const fin: any = editalObj.viabilidadeFinanceira || {};
  const editalAny: any = editalObj;

  const orgao = iden.orgaoComprador || editalAny.orgao || (fileNameFallback ? fileNameFallback.replace(/\.[^/.]+$/, "") : "Órgão do Edital Analisado");

  const uasg = iden.codigoUASG || iden.uasg || iden.identificacaoNumerica || editalAny.uasg || "UASG 090012";

  const numeroLicitacao = iden.numeroLicitacao || iden.identificacaoNumerica || iden.modalidade || "PE Edital/2026";

  const portal = iden.portalEletronico || iden.portal || "Compras.gov.br";

  const firstItem = editalObj.itensEdital?.[0] || editalAny.itens?.[0];
  const produtoItem = firstItem?.descricao || editalObj.descricaoProduto || editalAny.objeto || "Objeto da licitação analisada";

  const quantidade = Number(firstItem?.quantidade) || 1;
  const unidadeMedida = firstItem?.unidade || "Unidade";

  const rawValEstimado = fin.valorEstimado || fin.valorEstimadoTotal || firstItem?.valorEstimado || firstItem?.valorUnitarioEstimado || editalAny.valorEstimado || 0;
  const valorEstimadoItem = parseBRLNumber(rawValEstimado);

  const nossoValorAlvo = fin.nossoValorSugerido ? parseBRLNumber(fin.nossoValorSugerido) : (valorEstimadoItem > 0 ? Number((valorEstimadoItem * 0.90).toFixed(2)) : 0);
  const valorMinimoPiso = fin.precoPisoMinimo ? parseBRLNumber(fin.precoPisoMinimo) : (valorEstimadoItem > 0 ? Number((valorEstimadoItem * 0.82).toFixed(2)) : 0);

  const dataHoraDisputa = iden.dataHoraSessao || iden.dataAbertura || iden.dataSessao || new Date().toLocaleDateString("pt-BR") + " 09:00";

  const linkPNCP = iden.linkPNCP || editalObj.linkPNCP || editalAny.linkPNCP || (iden.idContratacaoPNCP ? `https://pncp.gov.br/app/editais/${iden.idContratacaoPNCP}` : editalAny.idContratacaoPNCP ? `https://pncp.gov.br/app/editais/${editalAny.idContratacaoPNCP}` : "");

  const veredito = editalObj.parecerFinal?.veredito || (editalObj.parecerFinal as any)?.recomendacao || "Favorável";
  const observacoes = (editalObj as any).resumoExecutivo || `Extraído de análise do edital. Veredito: ${veredito}`;

  return {
    orgao,
    uasgUndCompradora: uasg,
    numeroLicitacao,
    portal,
    produtoItem,
    quantidade,
    unidadeMedida,
    valorEstimadoItem,
    nossoValorAlvo,
    valorMinimoPiso,
    dataHoraDisputa,
    observacoes,
    linkPNCP
  };
}

// Initial empty array - only user/Supabase data exists
const INITIAL_DISPUTAS: DisputaRow[] = [];

// Status padrões, criados automaticamente na primeira vez que o usuário abre a planilha.
// A partir daí são apenas registros normais do usuário: podem ser renomeados,
// recoloridos ou excluídos livremente, como qualquer status criado por ele.
const DEFAULT_STATUS_TYPES: Omit<DisputaStatusType, "id">[] = [
  { label: "Agendada", color: "#64748b", position: 0 },
  { label: "Em Disputa", color: "#f59e0b", position: 1 },
  { label: "Vencida", color: "#22c55e", position: 2 },
  { label: "Em Recurso", color: "#8b5cf6", position: 3 },
  { label: "Homologada", color: "#10b981", position: 4 },
  { label: "Perdida", color: "#ef4444", position: 5 },
  { label: "Cancelada", color: "#71717a", position: 6 }
];

// Paleta de cores oferecida para o usuário escolher ao criar/editar um status.
const STATUS_COLOR_PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981",
  "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7",
  "#d946ef", "#ec4899", "#f43f5e", "#64748b"
];

const VIEW_MODES: { id: "spreadsheet" | "dashboard" | "kanban"; label: string; icon: typeof FileSpreadsheet }[] = [
  { id: "spreadsheet", label: "Planilha", icon: FileSpreadsheet },
  { id: "dashboard", label: "Painel", icon: LayoutGrid },
  { id: "kanban", label: "Kanban", icon: Kanban }
];

const PORTAL_OPTIONS = ["Compras.gov.br", "BLL Compras", "Licitações-e", "Bec SP", "PNCP", "Outro Portal"];

const SORT_FIELDS: { key: keyof DisputaRow; label: string }[] = [
  { key: "dataHoraDisputa", label: "Data da disputa" },
  { key: "orgao", label: "Órgão comprador" },
  { key: "status", label: "Status" },
  { key: "valorEstimadoItem", label: "Valor estimado" },
  { key: "nossoValorAlvo", label: "Nosso alvo" }
];

// Estilo comum dos campos editáveis da planilha: ocupam a largura disponível
// e nunca ultrapassam a coluna, evitando rolagem horizontal.
const CELL_INPUT =
  "w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-foreground transition hover:border-input focus:border-primary focus:bg-background focus:outline-none";

const formatBRL = (value: number) =>
  (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Campo rotulado da grade editável — o rótulo mantém o dado compreensível
// mesmo quando a grade se empilha em telas estreitas.
function SheetField({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="mb-0.5 block text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// Campo monetário: prefixo "R$" fixo e milhares separados quando fora de foco,
// para o valor ficar legível sem atrapalhar a digitação.
function MoneyInput({
  value,
  onChange,
  className = ""
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const display = editing
    ? String(value ?? 0)
    : (value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex items-center gap-1 rounded border border-transparent px-1.5 py-1 transition focus-within:border-primary focus-within:bg-background hover:border-input">
      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">R$</span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,-]/g, "").replace(",", ".");
          onChange(Number(raw) || 0);
        }}
        className={cn(
          "w-full min-w-0 border-0 bg-transparent p-0 font-mono text-xs text-foreground focus:outline-none",
          className
        )}
      />
    </div>
  );
}

// Paleta de cores reaproveitada pelo Kanban e pelo gerenciador de status.
function ColorSwatches({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-9 gap-1.5">
        {STATUS_COLOR_PALETTE.map(c => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            className={`h-5 w-5 cursor-pointer rounded-full border-2 transition ${color === c ? "border-foreground" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full cursor-pointer rounded-md border border-input bg-transparent"
        title="Escolher qualquer outra cor"
      />
    </div>
  );
}

// Editor de nome + cor de um status.
function StatusColorEditor({
  label,
  color,
  labelPlaceholder,
  autoFocus,
  onLabelChange,
  onLabelCommit,
  onLabelSubmit,
  onColorChange
}: {
  label: string;
  color: string;
  labelPlaceholder?: string;
  autoFocus?: boolean;
  onLabelChange: (value: string) => void;
  onLabelCommit?: () => void;
  onLabelSubmit?: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Nome do status</Label>
        <Input
          autoFocus={autoFocus}
          value={label}
          placeholder={labelPlaceholder}
          onChange={(e) => onLabelChange(e.target.value)}
          onBlur={onLabelCommit}
          onKeyDown={(e) => { if (e.key === "Enter" && onLabelSubmit) onLabelSubmit(); }}
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Cor</Label>
        <ColorSwatches color={color} onChange={onColorChange} />
      </div>
    </>
  );
}

// Escolhe texto claro ou escuro conforme a luminância da cor de fundo, para manter contraste legível.
function getContrastTextColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

export default function DisputasSheetTab({ activeEdital }: DisputasSheetTabProps) {
  // Mode Switcher: "spreadsheet" (Planilha Interativa Excel), "dashboard" (Painel Visual) ou "kanban" (Quadro Kanban)
  const [viewMode, setViewMode] = useState<"spreadsheet" | "dashboard" | "kanban">(() => {
    return (localStorage.getItem("aip_disputas_view_mode") as "spreadsheet" | "dashboard" | "kanban") || "spreadsheet";
  });

  // Tipos de status personalizados do usuário (rótulo + cor), usados nos seletores
  // de status e como colunas do quadro Kanban.
  const [statusTypes, setStatusTypes] = useState<DisputaStatusType[]>(() => {
    const saved = localStorage.getItem("aip_disputas_status_types");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  });
  const statusTypesSeededRef = useRef(false);

  // Initialize with empty array — Supabase is the source of truth
  // localStorage is used only as offline cache/fallback display until Supabase loads
  const [disputas, setDisputas] = useState<DisputaRow[]>(() => {
    const saved = localStorage.getItem("aip_disputas_sheet");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((r: any) => r.id !== "disp-101");
        }
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  });

  const [syncingWithSupabase, setSyncingWithSupabase] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [lastRealtimeEvent, setLastRealtimeEvent] = useState<{ type: "INSERT" | "UPDATE" | "DELETE"; label: string; time: number } | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeConnectedRef = useRef(false);

  // ═══════════════════════════════════════════════════════════════════
  // SUPABASE → fonte da verdade. Substitui completamente o estado local.
  // Itens locais pendentes (criados offline) são re-salvos no Supabase
  // caso ainda não existam no banco — mas o banco NUNCA é sobrescrito
  // por dados locais que já foram deletados remotamente.
  // ═══════════════════════════════════════════════════════════════════
  const refreshFromSupabase = useCallback(async (showToastFeedback = false) => {
    setSyncingWithSupabase(true);
    try {
      const dbRows = await fetchDisputasFromSupabase();
      if (Array.isArray(dbRows)) {
        setDisputas(prev => {
          // Build a set of IDs that exist in the DB
          const dbIds = new Set(dbRows.map(r => r.id));

          // Find local rows that are NOT yet in DB (created offline / pending upload)
          // Only upload those — never re-upload rows that the DB doesn't have
          // because they may have been intentionally deleted from another device
          const pendingLocalRows = prev.filter(r => !dbIds.has(r.id));
          if (pendingLocalRows.length > 0) {
            pendingLocalRows.forEach(r => {
              saveDisputaToSupabase(r).catch(() => {});
            });
          }

          // Supabase is the source of truth — use DB rows as the final state
          // Pending local rows are appended optimistically while they upload
          const finalRows = [...dbRows, ...pendingLocalRows];
          localStorage.setItem("aip_disputas_sheet", JSON.stringify(finalRows));
          return finalRows;
        });

        if (showToastFeedback) {
          showToast(`Sincronizado! ${dbRows.length} planilha(s) carregada(s) do Supabase.`);
        }
      }
    } catch (e) {
      console.warn("Erro ao buscar disputas do Supabase:", e);
    } finally {
      setSyncingWithSupabase(false);
    }
  }, []);

  // Load from Supabase on mount and listen to Realtime changes (INSERT, UPDATE, DELETE)
  useEffect(() => {
    refreshFromSupabase(false);

    // Subscribe to granular real-time changes from Supabase across all devices & tabs
    const unsubscribe = subscribeToSupabaseTable(
      "planilhas_disputas",
      (payload: any) => {
        if (!payload) return;

        const eventType = payload.eventType; // 'INSERT' | 'UPDATE' | 'DELETE' | '*'
        
        if (eventType === "INSERT" && payload.new) {
          const newRow = mapDisputaFromDb(payload.new);
          setDisputas(prev => {
            if (prev.some(r => r.id === newRow.id)) {
              const updated = prev.map(r => r.id === newRow.id ? newRow : r);
              localStorage.setItem("aip_disputas_sheet", JSON.stringify(updated));
              return updated;
            }
            const updated = [newRow, ...prev];
            localStorage.setItem("aip_disputas_sheet", JSON.stringify(updated));
            return updated;
          });
          setLastRealtimeEvent({ 
            type: "INSERT", 
            label: newRow.produtoItem || newRow.orgao || "Nova linha", 
            time: Date.now() 
          });
          showToast(`✅ Planilha sincronizada em tempo real: ${newRow.produtoItem?.slice(0, 32) || newRow.orgao}`);
        } else if (eventType === "UPDATE" && payload.new) {
          const updatedRow = mapDisputaFromDb(payload.new);
          setDisputas(prev => {
            const exists = prev.some(r => r.id === updatedRow.id);
            let updated: DisputaRow[];
            if (exists) {
              updated = prev.map(r => r.id === updatedRow.id ? updatedRow : r);
            } else {
              updated = [updatedRow, ...prev];
            }
            localStorage.setItem("aip_disputas_sheet", JSON.stringify(updated));
            return updated;
          });
          setLastRealtimeEvent({ 
            type: "UPDATE", 
            label: updatedRow.produtoItem || updatedRow.orgao || "Linha atualizada", 
            time: Date.now() 
          });
        } else if (eventType === "DELETE" && payload.old?.id) {
          const deletedId = payload.old.id;
          setDisputas(prev => {
            const updated = prev.filter(r => r.id !== deletedId);
            localStorage.setItem("aip_disputas_sheet", JSON.stringify(updated));
            return updated;
          });
          setLastRealtimeEvent({ 
            type: "DELETE", 
            label: `ID: ${deletedId.slice(0, 8)}`, 
            time: Date.now() 
          });
        } else {
          // General fallback for batch or untyped operations
          refreshFromSupabase(false);
        }
      },
      (status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeConnected(true);
          realtimeConnectedRef.current = true;
          // Clear polling fallback when Realtime is active
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        } else if (status === "CLOSED" || status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          setRealtimeConnected(false);
          realtimeConnectedRef.current = false;
          // Start polling fallback every 30s when Realtime is unavailable
          if (!pollingIntervalRef.current) {
            pollingIntervalRef.current = setInterval(() => {
              if (!realtimeConnectedRef.current) {
                refreshFromSupabase(false);
              }
            }, 30000);
          }
        }
      }
    );

    const handleFocus = () => refreshFromSupabase(false);
    const handleCustomSync = () => refreshFromSupabase(false);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("aip_sync_disputas", handleCustomSync);
    window.addEventListener("aip_edital_history_updated", handleCustomSync);

    return () => {
      unsubscribe();
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("aip_sync_disputas", handleCustomSync);
      window.removeEventListener("aip_edital_history_updated", handleCustomSync);
    };
  }, [refreshFromSupabase]);

  // Load the user's custom status types from Supabase. If they have none yet
  // (first time using the feature), seed the defaults and persist them so
  // this is a one-time migration per user.
  useEffect(() => {
    async function loadStatusTypes() {
      try {
        const dbTypes = await fetchStatusDisputasFromSupabase();
        if (dbTypes.length > 0) {
          setStatusTypes(dbTypes);
          localStorage.setItem("aip_disputas_status_types", JSON.stringify(dbTypes));
        } else if (!statusTypesSeededRef.current) {
          statusTypesSeededRef.current = true;
          const seeded: DisputaStatusType[] = DEFAULT_STATUS_TYPES.map(s => ({ ...s, id: generateUUID() }));
          setStatusTypes(seeded);
          localStorage.setItem("aip_disputas_status_types", JSON.stringify(seeded));
          seeded.forEach(s => { saveStatusDisputaToSupabase(s).catch(() => {}); });
        }
      } catch (e) {
        console.warn("Erro ao carregar tipos de status:", e);
      }
    }
    loadStatusTypes();
  }, []);

  // Any status still referenced by a dispute but missing from statusTypes (e.g. data
  // imported from elsewhere) gets an auto-generated grey column so nothing is hidden.
  useEffect(() => {
    if (statusTypes.length === 0) return;
    const knownLabels = new Set(statusTypes.map(s => s.label));
    const orphanLabels = Array.from(new Set(disputas.map(r => r.status).filter(s => s && !knownLabels.has(s))));
    if (orphanLabels.length === 0) return;

    const maxPosition = statusTypes.reduce((max, s) => Math.max(max, s.position), -1);
    const orphanTypes: DisputaStatusType[] = orphanLabels.map((label, i) => ({
      id: generateUUID(),
      label,
      color: "#71717a",
      position: maxPosition + 1 + i
    }));
    setStatusTypes(prev => [...prev, ...orphanTypes]);
    orphanTypes.forEach(s => { saveStatusDisputaToSupabase(s).catch(() => {}); });
  }, [disputas, statusTypes]);

  useEffect(() => {
    localStorage.setItem("aip_disputas_status_types", JSON.stringify(statusTypes));
  }, [statusTypes]);

  // Cria um novo tipo de status (usado tanto pelo botão "Novo Status" quanto por "+ Nova Coluna" no Kanban)
  const handleAddStatusType = (label: string, color: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (statusTypes.some(s => s.label.toLowerCase() === trimmed.toLowerCase())) {
      showToast("Já existe um status com esse nome.", "info");
      return;
    }
    const maxPosition = statusTypes.reduce((max, s) => Math.max(max, s.position), -1);
    const newType: DisputaStatusType = { id: generateUUID(), label: trimmed, color, position: maxPosition + 1 };
    setStatusTypes(prev => [...prev, newType]);
    saveStatusDisputaToSupabase(newType).catch(() => {});
    showToast(`Status "${trimmed}" criado com sucesso.`);
  };

  // Renomeia e/ou recolore um status existente. Ao renomear, atualiza também
  // todas as disputas que usam o rótulo antigo, para não perder a referência.
  const handleUpdateStatusType = (id: string, updates: { label?: string; color?: string }) => {
    const current = statusTypes.find(s => s.id === id);
    if (!current) return;
    const newLabel = updates.label?.trim();
    const oldLabel = current.label;
    const updated: DisputaStatusType = {
      ...current,
      label: newLabel || current.label,
      color: updates.color || current.color
    };

    setStatusTypes(prev => prev.map(s => s.id === id ? updated : s));
    saveStatusDisputaToSupabase(updated).catch(() => {});

    if (newLabel && newLabel !== oldLabel) {
      setDisputas(prev => prev.map(r => {
        if (r.status === oldLabel) {
          const renamed = { ...r, status: newLabel };
          saveDisputaToSupabase(renamed).catch(() => {});
          return renamed;
        }
        return r;
      }));
    }
    showToast(`Status "${updated.label}" atualizado.`);
  };

  // Exclui um status. Se houver disputas usando-o, abre o diálogo que pergunta
  // para qual status elas devem ser movidas antes da exclusão.
  const handleDeleteStatusType = (id: string) => {
    const target = statusTypes.find(s => s.id === id);
    if (!target) return;
    if (statusTypes.length <= 1) {
      showToast("É preciso manter ao menos um status cadastrado.", "info");
      return;
    }
    const inUseCount = disputas.filter(r => r.status === target.label).length;
    if (inUseCount > 0) {
      setMoveCardsToStatus(statusTypes.find(s => s.id !== id)?.label || "");
      setStatusToDelete(target);
      return;
    }
    removeStatusType(target);
  };

  const removeStatusType = (target: DisputaStatusType) => {
    setStatusTypes(prev => prev.filter(s => s.id !== target.id));
    deleteStatusDisputaFromSupabase(target.id).catch(() => {});
    showToast(`Status "${target.label}" removido.`, "info");
  };

  // Confirma a exclusão de um status em uso, movendo antes as disputas afetadas.
  const handleConfirmDeleteStatusType = () => {
    if (!statusToDelete) return;
    const target = statusToDelete;
    const destination = moveCardsToStatus;

    setDisputas(prev => prev.map(r => {
      if (r.status === target.label) {
        const moved = { ...r, status: destination };
        saveDisputaToSupabase(moved).catch(() => {});
        return moved;
      }
      return r;
    }));

    removeStatusType(target);
    setStatusToDelete(null);
  };

  // Reordena as colunas (drag-and-drop no Kanban) e persiste a nova posição de cada uma.
  const handleReorderStatusTypes = (orderedIds: string[]) => {
    setStatusTypes(prev => {
      const byId = new Map(prev.map(s => [s.id, s]));
      const reordered = orderedIds
        .map((id, index) => {
          const s = byId.get(id);
          return s ? { ...s, position: index } : null;
        })
        .filter((s): s is DisputaStatusType => !!s);
      reordered.forEach(s => { saveStatusDisputaToSupabase(s).catch(() => {}); });
      return reordered;
    });
  };

  // ─── Kanban board: drag-and-drop state & handlers (mesmo padrão nativo HTML5 usado no resto do app) ───
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragOverColumnLabel, setDragOverColumnLabel] = useState<string | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState("");
  const [newColumnColor, setNewColumnColor] = useState(STATUS_COLOR_PALETTE[0]);

  const [editColumnLabel, setEditColumnLabel] = useState("");
  const [editColumnColor, setEditColumnColor] = useState("");

  const handleCardDragStart = (e: React.DragEvent, disputaId: string) => {
    setDraggingCardId(disputaId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-disputa-id", disputaId);
  };

  const handleCardDragEnd = () => {
    setDraggingCardId(null);
    setDragOverColumnLabel(null);
  };

  const handleColumnBodyDragOver = (e: React.DragEvent, columnLabel: string) => {
    e.preventDefault();
    if (draggingCardId) setDragOverColumnLabel(columnLabel);
  };

  const handleColumnBodyDrop = (e: React.DragEvent, columnLabel: string) => {
    e.preventDefault();
    const disputaId = e.dataTransfer.getData("text/x-disputa-id") || draggingCardId;
    setDraggingCardId(null);
    setDragOverColumnLabel(null);
    if (!disputaId) return;
    const row = disputas.find(r => r.id === disputaId);
    if (row && row.status !== columnLabel) {
      handleStatusChange(disputaId, columnLabel);
    }
  };

  const handleColumnHeaderDragStart = (e: React.DragEvent, columnId: string) => {
    setDraggingColumnId(columnId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-column-id", columnId);
  };

  const handleColumnHeaderDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    if (draggingColumnId && draggingColumnId !== columnId) setDragOverColumnId(columnId);
  };

  const handleColumnHeaderDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    const sourceColumnId = e.dataTransfer.getData("text/x-column-id") || draggingColumnId;
    setDraggingColumnId(null);
    setDragOverColumnId(null);
    if (!sourceColumnId || sourceColumnId === targetColumnId) return;

    const ordered = [...statusTypes].sort((a, b) => a.position - b.position).map(s => s.id);
    const sourceIndex = ordered.indexOf(sourceColumnId);
    const targetIndex = ordered.indexOf(targetColumnId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, sourceColumnId);
    handleReorderStatusTypes(ordered);
  };

  const handleConfirmAddColumn = () => {
    handleAddStatusType(newColumnLabel, newColumnColor);
    setNewColumnLabel("");
    setNewColumnColor(STATUS_COLOR_PALETTE[0]);
    setIsAddColumnOpen(false);
  };

  const handleOpenColumnEditor = (statusType: DisputaStatusType) => {
    setEditColumnLabel(statusType.label);
    setEditColumnColor(statusType.color);
  };

  const handleConfirmEditColumn = (id: string) => {
    handleUpdateStatusType(id, { label: editColumnLabel, color: editColumnColor });
  };

  const sortedStatusTypes = [...statusTypes].sort((a, b) => a.position - b.position);

  // History Editais list for auto-fill feature
  const [historyOptions, setHistoryOptions] = useState<AnalyzedEditalOption[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");

  // Filters & Sorting State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Todas");
  const [portalFilter, setPortalFilter] = useState<string>("Todos");
  const [sortField, setSortField] = useState<keyof DisputaRow>("dataHoraDisputa");
  const [sortAsc, setSortAsc] = useState(true);

  // Modal State for Add / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<DisputaRow | null>(null);

  // Modal State for Row Deletion & SQL Setup
  const [rowToDelete, setRowToDelete] = useState<DisputaRow | null>(null);
  const [showSqlSetupModal, setShowSqlSetupModal] = useState(false);

  // Gerenciador de status (disponível em todos os modos) e exclusão de status em uso
  const [showStatusManager, setShowStatusManager] = useState(false);
  const [statusToDelete, setStatusToDelete] = useState<DisputaStatusType | null>(null);
  const [moveCardsToStatus, setMoveCardsToStatus] = useState<string>("");
  const [copiedSql, setCopiedSql] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<DisputaRow>>({
    orgao: "",
    uasgUndCompradora: "",
    numeroLicitacao: "",
    portal: "Compras.gov.br",
    produtoItem: "",
    quantidade: 1,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 0,
    nossoValorAlvo: 0,
    valorMinimoPiso: 0,
    dataHoraDisputa: "",
    status: "Agendada",
    observacoes: "",
    linkPNCP: ""
  });

  // Attachment auto-extract state inside modal
  const [isExtractingFile, setIsExtractingFile] = useState(false);
  const [extractStatusText, setExtractStatusText] = useState("");

  // Toast / Notification
  const [notification, setNotification] = useState<{ text: string; type: "success" | "info" } | null>(null);

  // Save to localStorage & persist viewMode
  useEffect(() => {
    localStorage.setItem("aip_disputas_sheet", JSON.stringify(disputas));
  }, [disputas]);

  useEffect(() => {
    localStorage.setItem("aip_disputas_view_mode", viewMode);
  }, [viewMode]);

  // Load history from localStorage & props
  useEffect(() => {
    const list: AnalyzedEditalOption[] = [];
    if (activeEdital) {
      list.push({
        id: "active-edital",
        title: `[Ativo] ${activeEdital.identificacaoCertame?.orgaoComprador || 'Órgão Analisado'} (${activeEdital.identificacaoCertame?.identificacaoNumerica || 'PE Ativo'})`,
        edital: activeEdital,
        dateStr: "Análise Atual da Sessão"
      });
    }

    const savedHistory = localStorage.getItem("aip_edital_history");
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed)) {
          parsed.forEach((item: any, idx: number) => {
            const editalObj: EditalAnalysis = item.analysis_data || item.analysis || item;
            if (editalObj && (editalObj.identificacaoCertame || editalObj.descricaoProduto)) {
              const iden = editalObj.identificacaoCertame;
              const orgao = iden?.orgaoComprador || editalObj.descricaoProduto || `Edital #${idx + 1}`;
              const num = iden?.identificacaoNumerica || iden?.modalidade || "Nº N/I";
              list.push({
                id: item.id || `hist-${idx}-${Date.now()}`,
                title: `${orgao} (${num})`,
                edital: editalObj,
                dateStr: item.createdAt ? new Date(item.createdAt).toLocaleDateString("pt-BR") : "Análise Salva"
              });
            }
          });
        }
      } catch (err) {
        console.error("Erro ao carregar histórico:", err);
      }
    }
    setHistoryOptions(list);
  }, [activeEdital]);

  const showToast = (text: string, type: "success" | "info" = "success") => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Open Add Modal
  const handleOpenAddModal = (defaultStatus?: string) => {
    setEditingRow(null);
    setSelectedHistoryId("");
    const now = new Date();
    const formattedDate = now.toISOString().slice(0, 16).replace("T", " ");
    setFormData({
      orgao: "",
      uasgUndCompradora: "",
      numeroLicitacao: "PE " + Math.floor(Math.random() * 900 + 100) + "/2026",
      portal: "Compras.gov.br",
      produtoItem: "",
      quantidade: 1,
      unidadeMedida: "Unidade",
      valorEstimadoItem: 0,
      nossoValorAlvo: 0,
      valorMinimoPiso: 0,
      dataHoraDisputa: formattedDate,
      status: defaultStatus || statusTypes[0]?.label || "Agendada",
      observacoes: "",
      linkPNCP: ""
    });
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (row: DisputaRow) => {
    setEditingRow(row);
    setFormData({ ...row });
    setIsModalOpen(true);
  };

  // Auto-fill form fields from selected History Edital
  const handleApplyHistoryEdital = (historyId: string) => {
    setSelectedHistoryId(historyId);
    if (!historyId) return;

    const selectedOption = historyOptions.find(h => h.id === historyId);
    if (!selectedOption) return;

    const extracted = extractEditalFields(selectedOption.edital);

    setFormData(prev => ({
      ...prev,
      ...extracted,
      status: "Agendada",
      observacoes: `Importado automaticamente do histórico (${selectedOption.title}).`
    }));

    showToast(`Campos preenchidos com os dados de: ${selectedOption.title}!`);
  };

  // Upload Attachment auto-parser inside modal
  const handleModalAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtractingFile(true);
    setExtractStatusText(`Lendo e preparando anexo: ${file.name}...`);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const resultStr = (event.target?.result as string) || "";
        const base64String = resultStr.includes(",") ? resultStr.split(",")[1] : resultStr;
        
        const rawFileObj = {
          id: `att-${Date.now()}`,
          name: file.name,
          type: file.type || "application/pdf",
          base64: base64String
        };

        setExtractStatusText("Enviando anexo para extração via IA...");

        try {
          const prepared = await prepareAttachmentForServer(rawFileObj);

          const response = await apiFetch("/api/analyze-edital", {
            method: "POST",
            body: {
              textInput: `Extraia detalhadamente todos os dados deste edital anexado (${file.name}) para preenchimento de cadastro de disputa em licitação.`,
              attachments: [prepared]
            }
          });

          if (response.ok) {
            const data = await readJsonResponse(response);
            if (data && data.analysis) {
              const editalObj: EditalAnalysis = data.analysis;
              const extracted = extractEditalFields(editalObj, file.name);

              setFormData(prev => ({
                ...prev,
                ...extracted,
                status: "Agendada",
                observacoes: `Extraído automaticamente via IA do anexo ${file.name}.`
              }));

              confetti({ particleCount: 40, spread: 50 });
              showToast(`Valores e dados extraídos com sucesso do anexo ${file.name}!`);
            } else {
              fallbackExtract(file.name);
            }
          } else {
            fallbackExtract(file.name);
          }
        } catch (err: any) {
          console.error("Erro na extração do anexo:", err);
          showToast(formatAiError(err));
          fallbackExtract(file.name);
        } finally {
          setIsExtractingFile(false);
          setExtractStatusText("");
        }
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Erro ao ler arquivo:", err);
      setIsExtractingFile(false);
      setExtractStatusText("");
      fallbackExtract(file.name);
    }
  };

  const fallbackExtract = (fileName: string) => {
    const cleanName = fileName.replace(/\.[^/.]+$/, "");
    setFormData(prev => ({
      ...prev,
      orgao: prev.orgao || `Órgão do Edital (${cleanName})`,
      uasgUndCompradora: prev.uasgUndCompradora || "UASG 090012",
      numeroLicitacao: prev.numeroLicitacao || "PE " + cleanName.slice(-6),
      produtoItem: prev.produtoItem || `Fornecimento / Serviço referente ao arquivo ${fileName}`,
      observacoes: `Anexo cadastrado (${fileName}). Verifique os valores específicos no edital.`
    }));
    showToast(`Campos preenchidos a partir do anexo ${fileName}!`, "info");
  };

  // Save Modal Form
  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.orgao || !formData.produtoItem) {
      showToast("Por favor, informe o nome do Órgão e a Descrição do Produto/Item.", "info");
      return;
    }

    if (editingRow) {
      const updatedRow = { ...editingRow, ...formData } as DisputaRow;
      setDisputas(prev => prev.map(r => r.id === editingRow.id ? updatedRow : r));
      saveDisputaToSupabase(updatedRow).then(res => {
        if (res.success) {
          showToast("Disputa atualizada no Supabase e na planilha!");
        } else {
          showToast("Disputa atualizada na planilha local.", "info");
        }
      }).catch(() => showToast("Disputa salva localmente."));
    } else {
      const newRow: DisputaRow = {
        id: generateUUID(),
        orgao: formData.orgao || "",
        uasgUndCompradora: formData.uasgUndCompradora || "S/N",
        numeroLicitacao: formData.numeroLicitacao || "S/N",
        portal: formData.portal || "Compras.gov.br",
        produtoItem: formData.produtoItem || "",
        quantidade: Number(formData.quantidade) || 1,
        unidadeMedida: formData.unidadeMedida || "Unidade",
        valorEstimadoItem: Number(formData.valorEstimadoItem) || 0,
        nossoValorAlvo: Number(formData.nossoValorAlvo) || 0,
        valorMinimoPiso: Number(formData.valorMinimoPiso) || 0,
        dataHoraDisputa: formData.dataHoraDisputa || new Date().toLocaleString("pt-BR"),
        status: (formData.status as DisputaStatus) || "Agendada",
        observacoes: formData.observacoes || "",
        linkPNCP: formData.linkPNCP || ""
      };
      setDisputas(prev => [newRow, ...prev]);
      confetti({ particleCount: 35, spread: 40 });
      saveDisputaToSupabase(newRow).then(res => {
        if (res.success) {
          showToast("Nova disputa salva com sucesso no Supabase e na planilha!");
        } else {
          showToast("Nova disputa salva na planilha local.", "info");
        }
      }).catch(() => showToast("Nova disputa salva localmente!"));
    }

    setIsModalOpen(false);
  };

  // Add blank row directly in Spreadsheet mode
  const handleAddBlankRow = () => {
    const newRow: DisputaRow = {
      id: generateUUID(),
      orgao: "Novo Órgão Comprador",
      uasgUndCompradora: "000000",
      numeroLicitacao: "PE " + Math.floor(Math.random() * 800 + 100) + "/2026",
      portal: "Compras.gov.br",
      produtoItem: "Novo Item de Disputa",
      quantidade: 1,
      unidadeMedida: "Unidade",
      valorEstimadoItem: 100000.00,
      nossoValorAlvo: 90000.00,
      valorMinimoPiso: 80000.00,
      dataHoraDisputa: new Date().toLocaleDateString("pt-BR") + " 10:00",
      status: "Agendada",
      observacoes: "",
      linkPNCP: ""
    };
    setDisputas(prev => [...prev, newRow]);
    saveDisputaToSupabase(newRow).then(res => {
      if (res.success) {
        showToast("Nova linha salva no Supabase!");
      } else {
        showToast("Nova linha inserida na planilha local.");
      }
    }).catch(e => console.warn("Erro ao salvar disputa no Supabase:", e));
  };

  // Inline Cell Edit handler for Spreadsheet mode
  const handleCellChange = (id: string, field: keyof DisputaRow, value: any) => {
    setDisputas(prev => prev.map(r => {
      if (r.id === id) {
        const updated = { ...r, [field]: value };
        saveDisputaToSupabase(updated).catch(e => console.warn("Erro ao salvar célula no Supabase:", e));
        return updated;
      }
      return r;
    }));
  };

  // Delete Row Trigger (opens in-app confirmation modal, no window.confirm)
  const handleDeleteRow = (id: string) => {
    const row = disputas.find(r => r.id === id);
    if (row) {
      setRowToDelete(row);
    }
  };

  const confirmDeleteRow = () => {
    if (!rowToDelete) return;
    const id = rowToDelete.id;
    setDisputas(prev => prev.filter(r => r.id !== id));
    deleteDisputaFromSupabase(id).catch(() => {});
    showToast("Linha removida com sucesso.", "info");
    setRowToDelete(null);
  };

  // Change Status Quick Handler
  const handleStatusChange = (id: string, newStatus: DisputaStatus) => {
    setDisputas(prev => prev.map(r => {
      if (r.id === id) {
        const updated = { ...r, status: newStatus };
        saveDisputaToSupabase(updated).catch(e => console.warn("Erro ao atualizar status no Supabase:", e));
        return updated;
      }
      return r;
    }));
    if (newStatus === "Vencida" || newStatus === "Homologada") {
      confetti({ particleCount: 50, spread: 60 });
    }
    showToast(`Status alterado para "${newStatus}".`);
  };

  // Import all analyzed edital items directly into the spreadsheet and sync with Supabase
  const handleImportFromAnalyzedEditais = async () => {
    const savedHistory = localStorage.getItem("aip_edital_history");
    let itemsToImport: any[] = [];
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed)) {
          itemsToImport = parsed;
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (itemsToImport.length === 0 && historyOptions.length === 0) {
      showToast("Nenhum edital analisado encontrado para importar.", "info");
      return;
    }

    const sourceList = historyOptions.length > 0 ? historyOptions.map(h => h.edital) : itemsToImport.map(i => i.analysis_data || i.analysis || i);
    const newRows: DisputaRow[] = [];

    sourceList.forEach((editalObj) => {
      if (!editalObj) return;
      const fields = extractEditalFields(editalObj);
      
      if (editalObj.itensEdital && editalObj.itensEdital.length > 1) {
        editalObj.itensEdital.forEach((it: any, idx: number) => {
          const itemVal = parseBRLNumber(it.valorEstimado || it.valorUnitarioEstimado || fields.valorEstimadoItem);
          const row: DisputaRow = {
            id: generateUUID(),
            orgao: fields.orgao,
            uasgUndCompradora: fields.uasgUndCompradora,
            numeroLicitacao: fields.numeroLicitacao,
            portal: fields.portal,
            produtoItem: `[Item ${it.numero || idx + 1}] ${it.descricao || fields.produtoItem}`,
            quantidade: Number(it.quantidade) || 1,
            unidadeMedida: it.unidade || "Unidade",
            valorEstimadoItem: itemVal,
            nossoValorAlvo: Number((itemVal * 0.90).toFixed(2)),
            valorMinimoPiso: Number((itemVal * 0.82).toFixed(2)),
            dataHoraDisputa: fields.dataHoraDisputa,
            status: "Agendada",
            observacoes: fields.observacoes,
            linkPNCP: fields.linkPNCP
          };
          newRows.push(row);
        });
      } else {
        const row: DisputaRow = {
          id: generateUUID(),
          orgao: fields.orgao,
          uasgUndCompradora: fields.uasgUndCompradora,
          numeroLicitacao: fields.numeroLicitacao,
          portal: fields.portal,
          produtoItem: fields.produtoItem,
          quantidade: fields.quantidade,
          unidadeMedida: fields.unidadeMedida,
          valorEstimadoItem: fields.valorEstimadoItem,
          nossoValorAlvo: fields.nossoValorAlvo,
          valorMinimoPiso: fields.valorMinimoPiso,
          dataHoraDisputa: fields.dataHoraDisputa,
          status: "Agendada",
          observacoes: fields.observacoes,
          linkPNCP: fields.linkPNCP
        };
        newRows.push(row);
      }
    });

    if (newRows.length > 0) {
      setDisputas(prev => [...newRows, ...prev]);
      await Promise.all(newRows.map(r => saveDisputaToSupabase(r)));
      confetti({ particleCount: 50, spread: 60 });
      showToast(`${newRows.length} itens de editais importados e sincronizados com o Supabase!`);
    } else {
      showToast("Nenhum novo item encontrado para importar.", "info");
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (disputas.length === 0) {
      showToast("A planilha está vazia.", "info");
      return;
    }

    const headers = [
      "ID",
      "Órgão Comprador",
      "UASG / Cód. Unidade",
      "Nº Licitação",
      "Portal",
      "Link PNCP",
      "Produto / Item",
      "Quantidade",
      "Unidade Medida",
      "Valor Estimado (R$)",
      "Nosso Lance Alvo (R$)",
      "Lance Mínimo Piso (R$)",
      "Data e Hora Disputa",
      "Status",
      "Observações"
    ];

    const rows = disputas.map(r => [
      `"${r.id}"`,
      `"${r.orgao.replace(/"/g, '""')}"`,
      `"${r.uasgUndCompradora.replace(/"/g, '""')}"`,
      `"${r.numeroLicitacao.replace(/"/g, '""')}"`,
      `"${r.portal.replace(/"/g, '""')}"`,
      `"${(r.linkPNCP || "").replace(/"/g, '""')}"`,
      `"${r.produtoItem.replace(/"/g, '""')}"`,
      r.quantidade,
      `"${r.unidadeMedida.replace(/"/g, '""')}"`,
      r.valorEstimadoItem.toFixed(2),
      r.nossoValorAlvo.toFixed(2),
      r.valorMinimoPiso.toFixed(2),
      `"${r.dataHoraDisputa.replace(/"/g, '""')}"`,
      `"${r.status}"`,
      `"${(r.observacoes || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(e => e.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Planilha_Disputas_HORASIS_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Planilha exportada com sucesso em formato CSV!");
  };

  // Copy to Clipboard (TSV format)
  const handleCopyClipboard = () => {
    const headers = ["Órgão", "UASG/Cod", "Nº Licitação", "Portal", "Link PNCP", "Produto/Objeto", "Qtd", "Und", "Valor Estimado", "Nosso Alvo", "Preço Piso", "Data Disputa", "Status"];
    const rows = filteredDisputas.map(r => [
      r.orgao,
      r.uasgUndCompradora,
      r.numeroLicitacao,
      r.portal,
      r.linkPNCP || "",
      r.produtoItem,
      r.quantidade,
      r.unidadeMedida,
      r.valorEstimadoItem.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
      r.nossoValorAlvo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
      r.valorMinimoPiso.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
      r.dataHoraDisputa,
      r.status
    ]);

    const tsv = [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
    navigator.clipboard.writeText(tsv);
    showToast("Dados copiados em formato de tabela! Cole no Excel ou Google Sheets.");
  };

  // Filtering logic
  const filteredDisputas = disputas.filter(row => {
    const matchesSearch = 
      row.orgao.toLowerCase().includes(searchQuery.toLowerCase()) ||
      row.uasgUndCompradora.toLowerCase().includes(searchQuery.toLowerCase()) ||
      row.numeroLicitacao.toLowerCase().includes(searchQuery.toLowerCase()) ||
      row.produtoItem.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (row.linkPNCP && row.linkPNCP.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (row.observacoes && row.observacoes.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === "Todas" || row.status === statusFilter;
    const matchesPortal = portalFilter === "Todos" || row.portal === portalFilter;

    return matchesSearch && matchesStatus && matchesPortal;
  }).sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];
    
    if (typeof valA === "string") valA = (valA as string).toLowerCase();
    if (typeof valB === "string") valB = (valB as string).toLowerCase();

    if (valA! < valB!) return sortAsc ? -1 : 1;
    if (valA! > valB!) return sortAsc ? 1 : -1;
    return 0;
  });

  // KPI calculations
  const totalMapeado = disputas.length;
  const valorTotalEstimado = disputas.reduce((sum, r) => sum + r.valorEstimadoItem, 0);
  const valorNossoAlvo = disputas.reduce((sum, r) => sum + r.nossoValorAlvo, 0);
  const disputasVencidas = disputas.filter(r => r.status === "Vencida" || r.status === "Homologada");
  const valorTotalVencido = disputasVencidas.reduce((sum, r) => sum + r.nossoValorAlvo, 0);
  const winRate = totalMapeado > 0 ? Math.round((disputasVencidas.length / totalMapeado) * 100) : 0;

  // Toggle sort
  const handleSort = (field: keyof DisputaRow) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Encontra a cor cadastrada para um status (ou cinza neutro, se ainda não sincronizada)
  const getStatusColor = (status: DisputaStatus): string => {
    return statusTypes.find(s => s.label === status)?.color || "#71717a";
  };

  // Estilo inline do badge/select de status, calculado a partir da cor cadastrada pelo usuário
  const getStatusBadgeStyle = (status: DisputaStatus): React.CSSProperties => {
    const color = getStatusColor(status);
    return {
      backgroundColor: color,
      color: getContrastTextColor(color),
      borderColor: color
    };
  };

  return (
    <div id="disputas-sheet-view" className="flex flex-col gap-5 select-text font-sans text-foreground">

      {/* ─────────── Cabeçalho: título, modos e ações ─────────── */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">

        <div className="flex items-start gap-3 min-w-0">
          <span className="shrink-0 rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">Planilha de Disputas &amp; Pregões</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {viewMode === "spreadsheet"
                ? "Edite cada disputa direto na grade, como em uma planilha."
                : viewMode === "kanban"
                ? "Arraste as disputas entre as colunas para mudar o status."
                : "Visão geral com indicadores e um cartão para cada disputa."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">

          {/* Alternador de modo — ocupa a linha inteira em telas estreitas */}
          <div className="flex w-full items-center rounded-xl border border-border bg-muted p-1 sm:w-auto">
            {VIEW_MODES.map(mode => {
              const Icon = mode.icon;
              return (
                <Button
                  key={mode.id}
                  type="button"
                  variant={viewMode === mode.id ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode(mode.id)}
                  title={`Modo ${mode.label}`}
                  className="h-auto flex-1 gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-none sm:flex-none"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{mode.label}</span>
                </Button>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowStatusManager(true)}
            title="Criar, renomear, recolorir ou excluir os status das disputas"
          >
            <Palette className="h-3.5 w-3.5" />
            <span>Status</span>
          </Button>

          <Button type="button" size="sm" onClick={() => handleOpenAddModal()} className="font-semibold">
            <Plus className="h-4 w-4" />
            <span>Nova Disputa</span>
          </Button>

          {/* Ações secundárias agrupadas para não poluir a barra */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" title="Mais ações">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handleImportFromAnalyzedEditais} className="cursor-pointer">
                <Layers />
                Importar dos Editais
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyClipboard} className="cursor-pointer">
                <Copy />
                Copiar tabela
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer">
                <Download />
                Exportar CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowSqlSetupModal(true)} className="cursor-pointer">
                <Database />
                Script do banco de dados
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

        </div>
      </div>

      {/* Aviso temporário de ação concluída */}
      {notification && (
        <div className={`flex items-center gap-2.5 rounded-xl border p-3 ${
          notification.type === "success"
            ? "border-success/30 bg-success/10 text-success"
            : "border-primary/20 bg-primary/10 text-primary"
        }`}>
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span className="text-xs font-semibold">{notification.text}</span>
        </div>
      )}

      {/* ─────────── Busca e filtros ─────────── */}
      <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">

        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar por órgão, UASG, nº da licitação, produto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full pl-9 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-input bg-muted px-2.5 py-1.5">
            <Filter className="h-3.5 w-3.5 shrink-0 text-primary" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-w-0 cursor-pointer bg-transparent text-xs font-semibold text-foreground focus:outline-none"
              title="Filtrar por status"
            >
              <option value="Todas">Todos os status</option>
              {sortedStatusTypes.map(s => (
                <option key={s.id} value={s.label}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-input bg-muted px-2.5 py-1.5">
            <select
              value={portalFilter}
              onChange={(e) => setPortalFilter(e.target.value)}
              className="min-w-0 cursor-pointer bg-transparent text-xs font-semibold text-foreground focus:outline-none"
              title="Filtrar por portal"
            >
              <option value="Todos">Todos os portais</option>
              {PORTAL_OPTIONS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <span className="text-[11px] text-muted-foreground">
            {filteredDisputas.length} de {disputas.length}
          </span>

          <span
            className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5"
            title={realtimeConnected
              ? "Sincronização em tempo real ativa com o Supabase."
              : "Conectando ao Supabase..."}
          >
            <span className={`h-2 w-2 rounded-full ${realtimeConnected ? "bg-success" : "bg-warning"}`} />
            <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">
              {realtimeConnected ? "Sincronizado" : "Conectando"}
            </span>
          </span>
        </div>
      </Card>

      {/* ─────────── MODO 1: PLANILHA (grade editável responsiva) ─────────── */}
      {viewMode === "spreadsheet" ? (
        <div className="space-y-2.5">

          {filteredDisputas.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 p-10 text-center">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-semibold text-muted-foreground">Nenhuma disputa encontrada</p>
              <Button type="button" size="sm" onClick={handleAddBlankRow}>
                <Plus className="h-3.5 w-3.5" />
                Adicionar primeira linha
              </Button>
            </Card>
          ) : (
            filteredDisputas.map((row, index) => (
              <Card key={row.id} className="gap-0 p-3 transition hover:border-primary/30">

                {/* Linha principal: posição, órgão, status e exclusão.
                    Em telas estreitas o nome do órgão ocupa a linha inteira. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={row.orgao}
                    onChange={(e) => handleCellChange(row.id, "orgao", e.target.value)}
                    placeholder="Órgão comprador"
                    className={cn(CELL_INPUT, "order-3 w-full text-sm font-semibold sm:order-none sm:w-auto sm:min-w-0 sm:flex-1")}
                  />
                  <select
                    value={row.status}
                    onChange={(e) => handleStatusChange(row.id, e.target.value as DisputaStatus)}
                    style={getStatusBadgeStyle(row.status)}
                    className="ml-auto cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-bold focus:outline-none sm:ml-0"
                  >
                    {sortedStatusTypes.map(s => (
                      <option key={s.id} value={s.label}>{s.label}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteRow(row.id)}
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Excluir esta disputa"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Produto / objeto */}
                <div className="mt-2 sm:pl-7">
                  <SheetField label="Produto / Objeto">
                    <textarea
                      rows={2}
                      value={row.produtoItem}
                      onChange={(e) => handleCellChange(row.id, "produtoItem", e.target.value)}
                      placeholder="Descrição do item disputado"
                      className={cn(CELL_INPUT, "resize-none text-xs leading-snug")}
                    />
                  </SheetField>
                </div>

                {/* Demais campos, em grade que se reorganiza conforme a largura */}
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 pl-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  <SheetField label="Nº Licitação">
                    <input
                      type="text"
                      value={row.numeroLicitacao}
                      onChange={(e) => handleCellChange(row.id, "numeroLicitacao", e.target.value)}
                      className={cn(CELL_INPUT, "font-mono text-xs font-bold text-primary")}
                    />
                  </SheetField>

                  <SheetField label="UASG / Cód.">
                    <input
                      type="text"
                      value={row.uasgUndCompradora}
                      onChange={(e) => handleCellChange(row.id, "uasgUndCompradora", e.target.value)}
                      className={cn(CELL_INPUT, "font-mono text-xs text-muted-foreground")}
                    />
                  </SheetField>

                  <SheetField label="Portal">
                    <select
                      value={row.portal}
                      onChange={(e) => handleCellChange(row.id, "portal", e.target.value)}
                      className={cn(CELL_INPUT, "cursor-pointer text-xs")}
                    >
                      {PORTAL_OPTIONS.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </SheetField>

                  <SheetField label="Data / Hora">
                    <input
                      type="text"
                      value={row.dataHoraDisputa}
                      onChange={(e) => handleCellChange(row.id, "dataHoraDisputa", e.target.value)}
                      className={cn(CELL_INPUT, "font-mono text-xs")}
                    />
                  </SheetField>

                  <SheetField label="Qtd / Unidade">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={row.quantidade}
                        onChange={(e) => handleCellChange(row.id, "quantidade", Number(e.target.value))}
                        className={cn(CELL_INPUT, "w-16 shrink-0 text-center font-mono text-xs")}
                      />
                      <input
                        type="text"
                        value={row.unidadeMedida}
                        onChange={(e) => handleCellChange(row.id, "unidadeMedida", e.target.value)}
                        className={cn(CELL_INPUT, "min-w-0 flex-1 text-xs")}
                      />
                    </div>
                  </SheetField>

                  <SheetField label="Link PNCP">
                    <div className="flex items-center gap-1">
                      <input
                        type="url"
                        value={row.linkPNCP || ""}
                        onChange={(e) => handleCellChange(row.id, "linkPNCP", e.target.value)}
                        placeholder="https://pncp.gov.br/..."
                        className={cn(CELL_INPUT, "min-w-0 flex-1 text-xs")}
                      />
                      {row.linkPNCP && (
                        <a
                          href={row.linkPNCP.startsWith("http") ? row.linkPNCP : `https://${row.linkPNCP}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir edital no PNCP"
                          className="shrink-0 rounded p-1 text-primary hover:bg-primary/10"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </SheetField>

                  <SheetField label="Valor Estimado">
                    <MoneyInput
                      value={row.valorEstimadoItem}
                      onChange={(v) => handleCellChange(row.id, "valorEstimadoItem", v)}
                    />
                  </SheetField>

                  <SheetField label="Nosso Alvo">
                    <MoneyInput
                      value={row.nossoValorAlvo}
                      onChange={(v) => handleCellChange(row.id, "nossoValorAlvo", v)}
                      className="font-bold text-primary"
                    />
                  </SheetField>

                  <SheetField label="Preço Piso">
                    <MoneyInput
                      value={row.valorMinimoPiso}
                      onChange={(v) => handleCellChange(row.id, "valorMinimoPiso", v)}
                      className="text-muted-foreground"
                    />
                  </SheetField>
                </div>
              </Card>
            ))
          )}

          {/* Rodapé com totais da planilha */}
          {filteredDisputas.length > 0 && (
            <Card className="flex flex-col gap-2 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
                <span className="text-muted-foreground">
                  Estimado: <strong className="text-foreground">{formatBRL(valorTotalEstimado)}</strong>
                </span>
                <span className="text-muted-foreground">
                  Nosso alvo: <strong className="text-primary">{formatBRL(valorNossoAlvo)}</strong>
                </span>
                <span className="text-muted-foreground">
                  Linhas: <strong className="text-foreground">{filteredDisputas.length}</strong>
                </span>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={handleAddBlankRow} className="shrink-0">
                <Plus className="h-3.5 w-3.5" />
                Nova linha em branco
              </Button>
            </Card>
          )}
        </div>

      ) : viewMode === "kanban" ? (

        /* ─────────── MODO 2: KANBAN (colunas = status, sem rolagem lateral) ─────────── */
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          {sortedStatusTypes.map(col => {
            const cards = filteredDisputas.filter(r => r.status === col.label);
            const isCardDropTarget = dragOverColumnLabel === col.label && draggingCardId;
            const isColumnDropTarget = dragOverColumnId === col.id && draggingColumnId;

            return (
              <div
                key={col.id}
                draggable
                onDragStart={(e) => handleColumnHeaderDragStart(e, col.id)}
                onDragOver={(e) => handleColumnHeaderDragOver(e, col.id)}
                onDrop={(e) => handleColumnHeaderDrop(e, col.id)}
                className={`flex min-w-0 flex-col rounded-xl border bg-muted/30 transition ${
                  isColumnDropTarget ? "border-primary ring-2 ring-primary/40" : "border-border"
                } ${draggingColumnId === col.id ? "opacity-50" : ""}`}
              >
                {/* Cabeçalho da coluna */}
                <div className="flex cursor-grab items-center justify-between gap-1.5 border-b border-border p-2.5 active:cursor-grabbing">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
                    <span className="truncate text-xs font-bold" title={col.label}>{col.label}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Badge variant="secondary" className="font-mono text-[10px]">{cards.length}</Badge>
                    <Popover onOpenChange={(open) => { if (open) handleOpenColumnEditor(col); }}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          title="Editar nome e cor deste status"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-64 space-y-3">
                        <StatusColorEditor
                          label={editColumnLabel}
                          color={editColumnColor}
                          onLabelChange={setEditColumnLabel}
                          onLabelCommit={() => handleConfirmEditColumn(col.id)}
                          onColorChange={(c) => { setEditColumnColor(c); handleUpdateStatusType(col.id, { color: c }); }}
                        />
                        <div className="flex justify-end border-t border-border pt-2.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteStatusType(col.id)}
                            className="gap-1.5 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Excluir status
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Cartões (área de soltura) */}
                <div
                  onDragOver={(e) => handleColumnBodyDragOver(e, col.label)}
                  onDrop={(e) => handleColumnBodyDrop(e, col.label)}
                  className={`min-h-[90px] flex-1 space-y-2 overflow-y-auto p-2 scrollbar-thin ${
                    isCardDropTarget ? "bg-primary/5" : ""
                  }`}
                  style={{ maxHeight: "58vh" }}
                >
                  {cards.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border py-5 text-center text-[11px] text-muted-foreground">
                      Nenhuma disputa
                    </div>
                  ) : (
                    cards.map(row => (
                      <div
                        key={row.id}
                        draggable
                        onDragStart={(e) => handleCardDragStart(e, row.id)}
                        onDragEnd={handleCardDragEnd}
                        className={`group cursor-grab space-y-1.5 rounded-lg border border-border bg-card p-2.5 shadow-2xs transition hover:border-primary/40 active:cursor-grabbing ${
                          draggingCardId === row.id ? "opacity-40" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p
                            className="line-clamp-2 min-w-0 cursor-pointer text-[11px] font-semibold leading-snug"
                            title={row.orgao}
                            onClick={() => handleOpenEditModal(row)}
                          >
                            {row.orgao || "Órgão não informado"}
                          </p>
                          {/* Em telas sem hover (toque) as ações ficam sempre visíveis */}
                          <div className="flex shrink-0 items-center gap-0.5 transition lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); handleOpenEditModal(row); }}
                              className="h-6 w-6 text-muted-foreground hover:text-primary"
                              title="Editar disputa"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); handleDeleteRow(row.id); }}
                              className="h-6 w-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Excluir disputa"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <p className="truncate font-mono text-[10px] font-bold text-primary">{row.numeroLicitacao}</p>
                        {row.produtoItem && (
                          <p className="line-clamp-2 text-[10.5px] text-muted-foreground">{row.produtoItem}</p>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-0.5">
                          <span className="font-mono text-[10px] font-bold">
                            {row.nossoValorAlvo > 0 ? formatBRL(row.nossoValorAlvo) : "—"}
                          </span>
                          {row.dataHoraDisputa && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {row.dataHoraDisputa}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenAddModal(col.label)}
                  className="flex cursor-pointer items-center justify-center gap-1.5 border-t border-border p-2 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted/60 hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nova disputa
                </button>
              </div>
            );
          })}

          {/* Criar nova coluna / status */}
          <Popover open={isAddColumnOpen} onOpenChange={setIsAddColumnOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex min-h-[120px] w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-3 text-xs font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-muted/40 hover:text-primary"
              >
                <Plus className="h-5 w-5" />
                Nova coluna
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-3">
              <StatusColorEditor
                label={newColumnLabel}
                color={newColumnColor}
                labelPlaceholder="Ex: Aguardando recurso"
                autoFocus
                onLabelChange={setNewColumnLabel}
                onLabelSubmit={handleConfirmAddColumn}
                onColorChange={setNewColumnColor}
              />
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmAddColumn}
                disabled={!newColumnLabel.trim()}
                className="w-full"
              >
                <Check className="h-3.5 w-3.5" />
                Criar coluna
              </Button>
            </PopoverContent>
          </Popover>
        </div>

      ) : (

        /* ─────────── MODO 3: PAINEL (indicadores + cartões) ─────────── */
        <div className="space-y-4">

          {/* Indicadores */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="gap-1 p-3.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <Landmark className="h-3.5 w-3.5" /> Disputas mapeadas
              </span>
              <strong className="text-xl font-bold">{totalMapeado}</strong>
            </Card>
            <Card className="gap-1 p-3.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5" /> Valor estimado
              </span>
              <strong className="font-mono text-lg font-bold">{formatBRL(valorTotalEstimado)}</strong>
            </Card>
            <Card className="gap-1 p-3.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <Target className="h-3.5 w-3.5" /> Nosso alvo total
              </span>
              <strong className="font-mono text-lg font-bold text-primary">{formatBRL(valorNossoAlvo)}</strong>
            </Card>
            <Card className="gap-1 p-3.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5" /> Taxa de vitória
              </span>
              <strong className="text-xl font-bold text-success">{winRate}%</strong>
              <span className="font-mono text-[10px] text-muted-foreground">
                {disputasVencidas.length} ganha(s) · {formatBRL(valorTotalVencido)}
              </span>
            </Card>
          </div>

          {/* Ordenação */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Ordenar por</span>
            <div className="flex items-center gap-1.5 rounded-lg border border-input bg-muted px-2.5 py-1.5">
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as keyof DisputaRow)}
                className="cursor-pointer bg-transparent text-xs font-semibold text-foreground focus:outline-none"
              >
                {SORT_FIELDS.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSortAsc(!sortAsc)}
              title={sortAsc ? "Ordem crescente" : "Ordem decrescente"}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortAsc ? "Crescente" : "Decrescente"}
            </Button>
          </div>

          {/* Cartões das disputas */}
          {filteredDisputas.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 p-10 text-center">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-semibold text-muted-foreground">Nenhuma disputa encontrada</p>
              <Button type="button" size="sm" onClick={() => handleOpenAddModal()}>
                <Plus className="h-3.5 w-3.5" />
                Cadastrar disputa
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredDisputas.map(row => (
                <Card key={row.id} className="gap-2.5 p-3.5 transition hover:border-primary/30">

                  <div className="flex items-start justify-between gap-2">
                    <select
                      value={row.status}
                      onChange={(e) => handleStatusChange(row.id, e.target.value as DisputaStatus)}
                      style={getStatusBadgeStyle(row.status)}
                      className="min-w-0 cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-bold focus:outline-none"
                    >
                      {sortedStatusTypes.map(s => (
                        <option key={s.id} value={s.label}>{s.label}</option>
                      ))}
                    </select>
                    <span className="shrink-0 font-mono text-[11px] font-bold text-primary">{row.numeroLicitacao}</span>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" title={row.orgao}>{row.orgao || "Órgão não informado"}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      UASG {row.uasgUndCompradora || "—"} · {row.portal}
                    </p>
                  </div>

                  <p className="line-clamp-2 text-xs text-muted-foreground">{row.produtoItem || "Objeto não informado"}</p>

                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2 text-center">
                    <div className="min-w-0">
                      <span className="block text-[9.5px] font-bold uppercase text-muted-foreground">Estimado</span>
                      <span className="block truncate font-mono text-[11px]">{formatBRL(row.valorEstimadoItem)}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[9.5px] font-bold uppercase text-muted-foreground">Alvo</span>
                      <span className="block truncate font-mono text-[11px] font-bold text-primary">{formatBRL(row.nossoValorAlvo)}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[9.5px] font-bold uppercase text-muted-foreground">Piso</span>
                      <span className="block truncate font-mono text-[11px]">{formatBRL(row.valorMinimoPiso)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate font-mono">{row.dataHoraDisputa || "Sem data"}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {row.linkPNCP && (
                        <a
                          href={row.linkPNCP.startsWith("http") ? row.linkPNCP : `https://${row.linkPNCP}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir edital no PNCP"
                          className="rounded p-1.5 text-primary hover:bg-primary/10"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEditModal(row)}
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        title="Editar disputa"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteRow(row.id)}
                        className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Excluir disputa"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─────────── Gerenciador de Status (disponível em todos os modos) ─────────── */}
      <Dialog open={showStatusManager} onOpenChange={setShowStatusManager}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-primary" />
              Status das disputas
            </DialogTitle>
            <DialogDescription className="text-xs">
              Estes status valem apenas para a sua conta e são usados na planilha, no painel e como colunas do Kanban.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {sortedStatusTypes.map(s => {
              const emUso = disputas.filter(r => r.status === s.label).length;
              return (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <Popover onOpenChange={(open) => { if (open) handleOpenColumnEditor(s); }}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title="Alterar cor"
                        className="h-6 w-6 shrink-0 cursor-pointer rounded-full border border-black/10"
                        style={{ backgroundColor: s.color }}
                      />
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-60 space-y-2">
                      <Label className="text-[10px] font-bold uppercase text-muted-foreground">Cor</Label>
                      <ColorSwatches
                        color={editColumnColor}
                        onChange={(c) => { setEditColumnColor(c); handleUpdateStatusType(s.id, { color: c }); }}
                      />
                    </PopoverContent>
                  </Popover>

                  <input
                    type="text"
                    defaultValue={s.label}
                    title="Clique para renomear este status"
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value && value !== s.label) handleUpdateStatusType(s.id, { label: value });
                    }}
                    className={cn(CELL_INPUT, "min-w-0 flex-1 text-xs font-semibold")}
                  />

                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {emUso} disputa{emUso === 1 ? "" : "s"}
                  </span>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteStatusType(s.id)}
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Excluir status"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">Criar novo status</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColumnColor}
                onChange={(e) => setNewColumnColor(e.target.value)}
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent"
                title="Escolher cor"
              />
              <Input
                value={newColumnLabel}
                onChange={(e) => setNewColumnLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmAddColumn(); }}
                placeholder="Ex: Aguardando recurso"
                className="h-8 min-w-0 flex-1 text-xs"
              />
              <Button type="button" size="sm" onClick={handleConfirmAddColumn} disabled={!newColumnLabel.trim()} className="shrink-0">
                <Plus className="h-3.5 w-3.5" />
                Criar
              </Button>
            </div>
            <ColorSwatches color={newColumnColor} onChange={setNewColumnColor} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Exclusão de status que ainda está em uso */}
      <Dialog open={!!statusToDelete} onOpenChange={(open) => { if (!open) setStatusToDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-warning" />
              Excluir o status "{statusToDelete?.label}"
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {disputas.filter(r => r.status === statusToDelete?.label).length} disputa(s) usam este status.
              Escolha para qual status elas devem ser movidas antes da exclusão.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">Mover disputas para</Label>
            <select
              value={moveCardsToStatus}
              onChange={(e) => setMoveCardsToStatus(e.target.value)}
              className="w-full cursor-pointer rounded-lg border border-input bg-card px-3 py-2 text-xs font-semibold focus:outline-none"
            >
              {sortedStatusTypes.filter(s => s.id !== statusToDelete?.id).map(s => (
                <option key={s.id} value={s.label}>{s.label}</option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStatusToDelete(null)}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDeleteStatusType} disabled={!moveCardsToStatus}>
              Mover e excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Add / Edit Form Modal with History Pull & Attachment AI Extractions */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 animate-fade-in overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[92vh] sm:max-h-[88vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            
            {/* Modal Header */}
            <div className="p-3.5 sm:p-5 border-b border-border flex items-center justify-between bg-muted shrink-0">
              <h3 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
                <span className="truncate">{editingRow ? "Editar Registro da Disputa" : "Cadastrar Nova Disputa na Planilha"}</span>
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsModalOpen(false)}
                className="shrink-0"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 scrollbar-thin">
              
              {/* Top Auto-Fill Panel (History Pull OR Attachment Upload) */}
              {!editingRow && (
                <div className="bg-primary/10 p-3.5 sm:p-4 rounded-xl border border-primary/20 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary animate-pulse shrink-0" />
                    <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Preenchimento Automatizado via IA
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    
                    {/* Option A: Puxar do Histórico de Editais Analisados */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-primary uppercase flex items-center gap-1">
                        <History className="w-3 h-3 shrink-0" />
                        <span>Puxar do Histórico Analisado</span>
                      </label>
                      <select
                        value={selectedHistoryId}
                        onChange={(e) => handleApplyHistoryEdital(e.target.value)}
                        className="w-full bg-card border border-input rounded-xl px-2.5 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer truncate"
                      >
                        <option value="">-- Selecione do histórico --</option>
                        {historyOptions.map(opt => (
                          <option key={opt.id} value={opt.id}>
                            {opt.title} ({opt.dateStr})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Option B: Upload de Anexo para Preencher Automático */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-success uppercase flex items-center gap-1">
                        <Upload className="w-3 h-3 shrink-0" />
                        <span>Anexo / Edital (Preencher IA)</span>
                      </label>
                      <label className="flex items-center justify-center gap-2 w-full bg-success/10 hover:bg-success/20 border border-success/30 text-success text-xs font-bold py-2 px-3 rounded-xl cursor-pointer transition">
                        <Upload className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{isExtractingFile ? "Analisando..." : "Carregar Anexo (PDF/TXT)"}</span>
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.txt,.docx,.png,.jpg"
                          onChange={handleModalAttachmentUpload}
                          disabled={isExtractingFile}
                        />
                      </label>
                    </div>

                  </div>

                  {isExtractingFile && (
                    <div className="flex items-center gap-2 text-xs text-primary font-mono animate-pulse pt-1">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                      <span>{extractStatusText}</span>
                    </div>
                  )}
                </div>
              )}

              <form id="disputa-form" onSubmit={handleSaveForm} className="space-y-4">
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  
                  {/* Órgão */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Órgão Comprador *</label>
                    <Input
                      type="text"
                      required
                      placeholder="Ex: Tribunal Regional Federal da 3ª Região"
                      value={formData.orgao}
                      onChange={(e) => setFormData({ ...formData, orgao: e.target.value })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                  </div>

                  {/* UASG / Código Und */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">UASG / Código Unidade</label>
                    <Input
                      type="text"
                      placeholder="Ex: 090012 - TRF3"
                      value={formData.uasgUndCompradora}
                      onChange={(e) => setFormData({ ...formData, uasgUndCompradora: e.target.value })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                  </div>

                  {/* Nº Licitação */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Nº Licitação / Processo</label>
                    <Input
                      type="text"
                      placeholder="Ex: Pregão Eletrônico 14/2026"
                      value={formData.numeroLicitacao}
                      onChange={(e) => setFormData({ ...formData, numeroLicitacao: e.target.value })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                  </div>

                  {/* Portal */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Portal Eletrônico</label>
                    <select
                      value={formData.portal}
                      onChange={(e) => setFormData({ ...formData, portal: e.target.value })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    >
                      <option value="Compras.gov.br">Compras.gov.br</option>
                      <option value="BLL Compras">BLL Compras</option>
                      <option value="Licitações-e">Licitações-e (Banco do Brasil)</option>
                      <option value="Bec SP">Bec SP</option>
                      <option value="PNCP">PNCP - Portal Nacional</option>
                      <option value="Outro Portal">Outro Portal</option>
                    </select>
                  </div>

                  {/* Link PNCP */}
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                      <ExternalLink className="w-3 h-3 text-primary" />
                      <span>Link PNCP (Portal Nacional de Contratações Públicas)</span>
                    </label>
                    <Input
                      type="url"
                      placeholder="Ex: https://pncp.gov.br/app/editais/123456/2026/000001"
                      value={formData.linkPNCP || ""}
                      onChange={(e) => setFormData({ ...formData, linkPNCP: e.target.value })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                  </div>

                </div>

                {/* Produto / Objeto */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Produto / Objeto *</label>
                  <Textarea
                    required
                    rows={2}
                    placeholder="Descrição detalhada do item/produto cotado na disputa..."
                    value={formData.produtoItem}
                    onChange={(e) => setFormData({ ...formData, produtoItem: e.target.value })}
                    className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  
                  {/* Quantidade */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Quantidade</label>
                    <Input
                      type="number"
                      min={1}
                      value={formData.quantidade}
                      onChange={(e) => setFormData({ ...formData, quantidade: Number(e.target.value) })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>

                  {/* Unidade Medida */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Unidade</label>
                    <Input
                      type="text"
                      placeholder="Unidade, Caixa, Lote"
                      value={formData.unidadeMedida}
                      onChange={(e) => setFormData({ ...formData, unidadeMedida: e.target.value })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as DisputaStatus })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                    >
                      {statusTypes.map(s => (
                        <option key={s.id} value={s.label}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  
                  {/* Valor Estimado */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Valor Estimado (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.valorEstimadoItem || ""}
                      onChange={(e) => setFormData({ ...formData, valorEstimadoItem: Number(e.target.value) })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>

                  {/* Nosso Valor Alvo */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-primary">Nosso Lance Alvo (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.nossoValorAlvo || ""}
                      onChange={(e) => setFormData({ ...formData, nossoValorAlvo: Number(e.target.value) })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                  </div>

                  {/* Preço Mínimo Piso */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Preço Mínimo Piso (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.valorMinimoPiso || ""}
                      onChange={(e) => setFormData({ ...formData, valorMinimoPiso: Number(e.target.value) })}
                      className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>

                </div>

                {/* Data e Hora */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Data e Hora da Disputa</label>
                  <Input
                    type="text"
                    placeholder="Ex: 2026-08-15 09:30 ou 15/08/2026 09:30"
                    value={formData.dataHoraDisputa}
                    onChange={(e) => setFormData({ ...formData, dataHoraDisputa: e.target.value })}
                    className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Observações */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Observações & Estratégia de Lance</label>
                  <Input
                    type="text"
                    placeholder="Anotações internas, concorrentes mapeados, margem esperada..."
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    className="w-full bg-card border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>

              </form>

            </div>

            {/* Modal Footer (Always visible & fixed at bottom) */}
            <div className="p-3.5 sm:p-4 border-t border-border bg-muted shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                className="w-full sm:w-auto"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                form="disputa-form"
                className="w-full sm:w-auto font-bold"
              >
                Salvar na Planilha
              </Button>
            </div>

          </div>
        </div>
      )}

      {/* Row Deletion Confirmation Modal (Replaces blocked window.confirm) */}
      {rowToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-base font-bold text-foreground leading-tight">
                  Excluir Linha da Planilha?
                </h3>
                <p className="text-xs text-muted-foreground">
                  Esta ação removerá o registro selecionado da sua planilha de disputas.
                </p>
              </div>
            </div>

            <div className="bg-muted p-3.5 rounded-xl border border-border text-xs space-y-1 text-foreground">
              <p><strong className="text-foreground">Órgão:</strong> {rowToDelete.orgao || "Não informado"}</p>
              <p><strong className="text-foreground">Item:</strong> {rowToDelete.produtoItem || "Sem descrição"}</p>
              <p><strong className="text-foreground">Licitação:</strong> {rowToDelete.numeroLicitacao || "N/A"}</p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRowToDelete(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirmDeleteRow}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Sim, Excluir</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Supabase Database SQL Setup Modal */}
      {showSqlSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-card border border-border rounded-2xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/10 border border-primary/20 rounded-xl text-primary">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-foreground">
                    Estrutura do Banco de Dados Supabase
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Script SQL completo para inicializar tabelas e permissões
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowSqlSetupModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-3">
              <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl text-xs text-warning">
                💡 <strong>Como usar:</strong> Copie o script SQL abaixo e execute na aba <strong>SQL Editor</strong> do painel Supabase do seu projeto para criar automaticamente as tabelas de <em>planilhas_disputas</em>, <em>editais_analisados</em>, <em>documentos</em> e outras.
              </div>

              <div className="relative">
                <Textarea
                  readOnly
                  value={getSupabaseFullSchemaSQL()}
                  rows={14}
                  className="w-full bg-foreground text-background font-mono text-[11px] p-3.5 rounded-xl border border-border leading-relaxed focus:outline-none select-all"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border bg-muted flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                PostgreSQL • Supabase RLS Seguro
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowSqlSetupModal(false)}
                >
                  Fechar
                </Button>
                <Button
                  type="button"
                  className="font-bold"
                  onClick={() => {
                    navigator.clipboard.writeText(getSupabaseFullSchemaSQL());
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2500);
                  }}
                >
                  {copiedSql ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedSql ? "Copiado com Sucesso!" : "Copiar Script SQL"}</span>
                </Button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
