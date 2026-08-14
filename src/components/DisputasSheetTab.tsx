import { useState, useEffect, useRef, useCallback } from "react";
import { 
  Table, Plus, Download, Copy, Trash2, Edit2, Search, Filter, Sparkles, 
  CheckCircle, DollarSign, Calendar, Landmark, FileSpreadsheet, ArrowUpDown, 
  Upload, History, LayoutGrid, Layers, FileText, Check, AlertCircle, RefreshCw, X, ExternalLink, Database
} from "lucide-react";
import { DisputaRow, DisputaStatus, EditalAnalysis } from "../types";
import { apiFetch, prepareAttachmentForServer } from "../utils/aiClientHelper";
import { 
  fetchDisputasFromSupabase, 
  saveDisputaToSupabase, 
  deleteDisputaFromSupabase,
  subscribeToSupabaseTable,
  mapDisputaFromDb,
  generateUUID,
  getSupabaseFullSchemaSQL
} from "../utils/supabaseClient";
import confetti from "canvas-confetti";

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

export default function DisputasSheetTab({ activeEdital }: DisputasSheetTabProps) {
  // Mode Switcher: "spreadsheet" (Planilha Interativa Excel) vs "dashboard" (Painel Visual)
  const [viewMode, setViewMode] = useState<"spreadsheet" | "dashboard">(() => {
    return (localStorage.getItem("aip_disputas_view_mode") as "spreadsheet" | "dashboard") || "spreadsheet";
  });

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

  // History Editais list for auto-fill feature
  const [historyOptions, setHistoryOptions] = useState<AnalyzedEditalOption[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");

  // Filters & Sorting State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Todas");
  const [portalFilter, setPortalFilter] = useState<string>("Todos");
  const [sortField, setSortField] = useState<keyof DisputaRow>("dataHoraDisputa");
  const [sortAsc, setSortAsc] = useState(true);

  // Active Cell state for Spreadsheet Mode Formula Bar
  const [activeCell, setActiveCell] = useState<{ rowId: string; colKey: keyof DisputaRow; colName: string; colLetter: string } | null>({
    rowId: disputas[0]?.id || "disp-101",
    colKey: "orgao",
    colName: "Órgão Comprador",
    colLetter: "A"
  });

  // Modal State for Add / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<DisputaRow | null>(null);

  // Modal State for Row Deletion & SQL Setup
  const [rowToDelete, setRowToDelete] = useState<DisputaRow | null>(null);
  const [showSqlSetupModal, setShowSqlSetupModal] = useState(false);
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
  const handleOpenAddModal = () => {
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
      status: "Agendada",
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
            const data = await response.json();
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
        } catch (err) {
          console.error("Erro na extração do anexo:", err);
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

  // Badge status style
  const getStatusBadge = (status: DisputaStatus) => {
    switch (status) {
      case "Agendada":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "Em Disputa":
        return "bg-amber-50 text-amber-700 border-amber-200 animate-pulse";
      case "Vencida":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 font-bold";
      case "Homologada":
        return "bg-teal-50 text-teal-700 border-teal-200 font-bold";
      case "Em Recurso":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "Perdida":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "Cancelada":
        return "bg-gray-100 text-gray-600 border-gray-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  // Find active cell object value for formula bar
  const activeRowObj = disputas.find(r => r.id === activeCell?.rowId) || disputas[0];
  const activeCellValue = activeRowObj && activeCell ? activeRowObj[activeCell.colKey] : "";

  return (
    <div id="disputas-sheet-view" className="flex-1 flex flex-col h-full bg-[#F8F9FA] dark:bg-[#09090B] overflow-y-auto select-text font-sans text-[#111827] dark:text-zinc-100">
      
      {/* Top Banner & Mode Switcher Bar */}
      <div className="p-5 border-b border-[#E5E7EB] dark:border-[#27272A] bg-white dark:bg-[#121212] flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="bg-[#FFF0E5] dark:bg-[#2A170A] text-[#FF5A00] p-2 rounded-xl border border-[#FFD6C2] dark:border-[#4A2410]">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-[#111827] dark:text-zinc-100 tracking-tight flex items-center gap-2">
                <span>Planilha de Disputas & Pregões</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#FFF0E5] dark:bg-[#2A170A] text-[#FF5A00] border border-[#FFD6C2] dark:border-[#4A2410] font-semibold uppercase">
                  {viewMode === "spreadsheet" ? "Modo Planilha Interativa" : "Modo Painel / Dashboard"}
                </span>
              </h2>
              <p className="text-[#6B7280] dark:text-zinc-400 text-xs mt-0.5">
                Alterne livremente entre a visão de **Planilha Excel em Grade** ou a **Visão Painel Visual**.
              </p>
            </div>
          </div>
        </div>

        {/* Mode Selector Toggle + Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Mode Switcher Buttons */}
          <div className="flex items-center bg-[#F3F4F6] dark:bg-[#18181B] p-1 rounded-xl border border-[#E5E7EB] dark:border-[#27272A]">
            <button
              onClick={() => setViewMode("spreadsheet")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition duration-150 cursor-pointer ${
                viewMode === "spreadsheet"
                  ? "bg-[#FF5A00] text-white shadow-xs"
                  : "text-[#6B7280] dark:text-zinc-400 hover:text-[#111827] dark:hover:text-white"
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Modelo Planilha</span>
            </button>
            <button
              onClick={() => setViewMode("dashboard")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition duration-150 cursor-pointer ${
                viewMode === "dashboard"
                  ? "bg-[#FF5A00] text-white shadow-xs"
                  : "text-[#6B7280] dark:text-zinc-400 hover:text-[#111827] dark:hover:text-white"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Modelo Painel</span>
            </button>
          </div>

          <div className="h-6 w-px bg-[#E5E7EB] dark:bg-[#27272A] hidden sm:block" />

          {/* Supabase Realtime live connection badge */}
          <div 
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border bg-white dark:bg-[#18181B] border-[#E5E7EB] dark:border-[#27272A] text-zinc-700 dark:text-zinc-300 shadow-2xs"
            title={realtimeConnected ? "Supabase Realtime ativo: alterações, criações e exclusões sincronizam automaticamente em tempo real." : "Conectando ao Supabase Realtime..."}
          >
            <span className="relative flex h-2 w-2">
              {realtimeConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${realtimeConnected ? "bg-emerald-500" : "bg-amber-400"}`}></span>
            </span>
            <span className="text-[11px] font-medium tracking-tight">
              {realtimeConnected ? "Sincronização Automática Ativa" : "Conectando..."}
            </span>
          </div>

          {lastRealtimeEvent && (Date.now() - lastRealtimeEvent.time < 12000) && (
            <div className="hidden lg:flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded-lg shadow-2xs">
              <Sparkles className="w-3 h-3 text-emerald-500" />
              <span>{lastRealtimeEvent.type}: {lastRealtimeEvent.label.slice(0, 26)}</span>
            </div>
          )}

          <button
            onClick={handleImportFromAnalyzedEditais}
            className="bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 font-semibold px-3 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="Importar itens de todos os Editais Analisados para esta planilha"
          >
            <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>Importar dos Editais</span>
          </button>

          <button
            onClick={() => setShowSqlSetupModal(true)}
            className="bg-white dark:bg-[#18181B] hover:bg-orange-50 dark:hover:bg-orange-950/30 border border-[#D1D5DB] dark:border-[#27272A] hover:border-[#FF5A00]/40 text-[#374151] dark:text-zinc-200 font-semibold px-3 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="Ver/Copiar script SQL para criar tabelas no Supabase"
          >
            <Database className="w-3.5 h-3.5 text-[#FF5A00]" />
            <span>Banco de Dados</span>
          </button>

          <button
            onClick={handleCopyClipboard}
            className="bg-white dark:bg-[#18181B] hover:bg-gray-50 dark:hover:bg-zinc-800 border border-[#D1D5DB] dark:border-[#27272A] text-[#374151] dark:text-zinc-200 font-semibold px-3 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="Copiar dados para colar direto no Excel ou Google Sheets"
          >
            <Copy className="w-3.5 h-3.5 text-[#6B7280] dark:text-zinc-400" />
            <span>Copiar Tabela</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold px-3 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer"
            title="Baixar arquivo .CSV para Excel"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="bg-[#FF5A00] hover:bg-[#E65000] text-white font-bold px-3.5 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Disputa</span>
          </button>

        </div>
      </div>

      {/* Toast Notification */}
      {notification && (
        <div className={`mx-6 mt-4 p-3.5 rounded-xl border flex items-center gap-2.5 animate-fade-in ${
          notification.type === "success" 
            ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
            : "bg-[#FFF0E5] border-[#FFD6C2] text-[#FF5A00]"
        }`}>
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="text-xs font-semibold">{notification.text}</span>
        </div>
      )}



      {/* Filter Toolbar & Search */}
      <div className="p-6 space-y-4">
        
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-[#121212] p-3.5 border border-[#E5E7EB] dark:border-[#27272A] rounded-xl shadow-xs">
          
          {/* Search box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#9CA3AF] dark:text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar por órgão, UASG, nº da licitação, produto..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#111827] dark:text-zinc-100 placeholder:text-[#9CA3AF] dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#FF5A00]"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Status Filter */}
            <div className="flex items-center gap-1.5 bg-[#F9FAFB] dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-lg px-2.5 py-1 text-xs text-[#374151] dark:text-zinc-300">
              <Filter className="w-3.5 h-3.5 text-[#FF5A00] shrink-0" />
              <span className="text-[10px] uppercase font-bold text-[#6B7280] dark:text-zinc-400">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-xs text-[#111827] dark:text-zinc-100 font-semibold focus:outline-none cursor-pointer dark:bg-[#18181B]"
              >
                <option value="Todas">Todas</option>
                <option value="Agendada">Agendadas</option>
                <option value="Em Disputa">Em Disputa</option>
                <option value="Vencida">Vencidas</option>
                <option value="Em Recurso">Em Recurso</option>
                <option value="Homologada">Homologadas</option>
                <option value="Perdida">Perdidas</option>
              </select>
            </div>

            {/* Portal Filter */}
            <div className="flex items-center gap-1.5 bg-[#F9FAFB] dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-lg px-2.5 py-1 text-xs text-[#374151] dark:text-zinc-300">
              <span className="text-[10px] uppercase font-bold text-[#6B7280] dark:text-zinc-400">Portal:</span>
              <select
                value={portalFilter}
                onChange={(e) => setPortalFilter(e.target.value)}
                className="bg-transparent text-xs text-[#111827] dark:text-zinc-100 font-semibold focus:outline-none cursor-pointer dark:bg-[#18181B]"
              >
                <option value="Todos">Todos</option>
                <option value="Compras.gov.br">Compras.gov.br</option>
                <option value="BLL Compras">BLL Compras</option>
                <option value="Licitações-e">Licitações-e</option>
                <option value="Bec SP">Bec SP</option>
                <option value="PNCP">PNCP</option>
              </select>
            </div>

            <button
              onClick={handleAddBlankRow}
              className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold px-3 py-1 rounded-lg text-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Inserir Linha</span>
            </button>

          </div>

        </div>

        {/* MODE 1: MODELO PLANILHA INTERATIVA EXCEL */}
        {viewMode === "spreadsheet" ? (
          <div className="bg-white dark:bg-[#121212] border border-[#E5E7EB] dark:border-[#27272A] rounded-xl overflow-hidden shadow-xs flex flex-col">
            
            {/* Spreadsheet Top Excel-Style Formula & Active Cell Bar */}
            <div className="bg-[#F9FAFB] dark:bg-[#18181B] px-4 py-2 border-b border-[#E5E7EB] dark:border-[#27272A] flex items-center gap-3 font-mono text-xs">
              
              {/* Selected Cell Tag */}
              <div className="flex items-center gap-1.5 bg-[#FFF0E5] dark:bg-[#2A170A] border border-[#FFD6C2] dark:border-[#4A2410] text-[#FF5A00] font-bold px-2.5 py-1 rounded-md text-[11px] min-w-[110px]">
                <span className="font-mono">fx</span>
                <span>{activeCell ? `Célula ${activeCell.colLetter}${disputas.findIndex(r => r.id === activeCell.rowId) + 1}` : 'A1'}</span>
              </div>

              {/* Formula input box for active cell */}
              <div className="flex-1 flex items-center gap-2 bg-white dark:bg-[#121212] border border-[#D1D5DB] dark:border-[#27272A] rounded-md px-3 py-1">
                <span className="text-[#6B7280] dark:text-zinc-400 text-[11px] font-bold">
                  {activeCell?.colName || 'Valor'}:
                </span>
                <input
                  type="text"
                  value={activeCellValue || ""}
                  onChange={(e) => {
                    if (activeCell && activeRowObj) {
                      const fieldKey = activeCell.colKey;
                      let val: any = e.target.value;
                      if (fieldKey === "quantidade" || fieldKey === "valorEstimadoItem" || fieldKey === "nossoValorAlvo" || fieldKey === "valorMinimoPiso") {
                        val = Number(e.target.value) || 0;
                      }
                      handleCellChange(activeCell.rowId, fieldKey, val);
                    }
                  }}
                  placeholder="Edite o valor da célula diretamente aqui ou clique na tabela..."
                  className="w-full bg-transparent text-[#111827] dark:text-zinc-100 font-mono text-xs focus:outline-none"
                />
              </div>

            </div>

            {/* Interactive Grid Table */}
            <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
              <table className="w-full border-collapse font-mono text-xs select-none">
                
                {/* Spreadsheet Column Headers (A, B, C, D...) */}
                <thead>
                  <tr className="bg-[#F3F4F6] dark:bg-[#18181B] border-b border-[#E5E7EB] dark:border-[#27272A] text-[#374151] dark:text-zinc-300 text-[10.5px] font-bold">
                    <th className="w-12 py-2 px-2 text-center border-r border-[#E5E7EB] dark:border-[#27272A] bg-[#E5E7EB] dark:bg-[#27272A] text-[#4B5563] dark:text-zinc-300">#</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-left min-w-[200px]">A - Órgão Comprador</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-left w-36">B - UASG/Cod</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-left w-32">C - Nº Licitação</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-left w-32">D - Portal</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-left min-w-[180px]">E - Link PNCP</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-left min-w-[240px]">F - Produto / Item</th>
                    <th className="py-2 px-2 border-r border-[#E5E7EB] dark:border-[#27272A] text-center w-20">G - Qtd</th>
                    <th className="py-2 px-2 border-r border-[#E5E7EB] dark:border-[#27272A] text-center w-20">H - Und</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-right w-36">I - Val. Estimado</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-right w-36">J - Nosso Alvo</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-right w-36">K - Preço Piso</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-left w-36">L - Data/Hora</th>
                    <th className="py-2 px-3 border-r border-[#E5E7EB] dark:border-[#27272A] text-center w-32">M - Status</th>
                    <th className="py-2 px-2 text-center w-16">Ações</th>
                  </tr>
                </thead>

                {/* Grid Rows */}
                <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#27272A] bg-white dark:bg-[#121212] text-[#111827] dark:text-zinc-100">
                  {filteredDisputas.map((row, index) => (
                    <tr key={row.id} className="hover:bg-[#FFF0E5]/40 dark:hover:bg-zinc-800/60 transition-colors group">
                      
                      {/* Row Index # */}
                      <td className="py-2 px-2 text-center font-bold text-[#6B7280] dark:text-zinc-400 border-r border-[#E5E7EB] dark:border-[#27272A] bg-[#F9FAFB] dark:bg-[#18181B] text-[11px]">
                        {index + 1}
                      </td>

                      {/* Col A: Órgão */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] ${activeCell?.rowId === row.id && activeCell?.colKey === "orgao" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "orgao", colName: "Órgão Comprador", colLetter: "A" })}
                      >
                        <input
                          type="text"
                          value={row.orgao}
                          onChange={(e) => handleCellChange(row.id, "orgao", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded"
                        />
                      </td>

                      {/* Col B: UASG */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] ${activeCell?.rowId === row.id && activeCell?.colKey === "uasgUndCompradora" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "uasgUndCompradora", colName: "UASG/Cod Unidade", colLetter: "B" })}
                      >
                        <input
                          type="text"
                          value={row.uasgUndCompradora}
                          onChange={(e) => handleCellChange(row.id, "uasgUndCompradora", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-[#4B5563] dark:text-zinc-400 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded"
                        />
                      </td>

                      {/* Col C: Nº Licitação */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] ${activeCell?.rowId === row.id && activeCell?.colKey === "numeroLicitacao" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "numeroLicitacao", colName: "Nº Licitação", colLetter: "C" })}
                      >
                        <input
                          type="text"
                          value={row.numeroLicitacao}
                          onChange={(e) => handleCellChange(row.id, "numeroLicitacao", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-[#FF5A00] font-bold focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded"
                        />
                      </td>

                      {/* Col D: Portal */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] ${activeCell?.rowId === row.id && activeCell?.colKey === "portal" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "portal", colName: "Portal", colLetter: "D" })}
                      >
                        <select
                          value={row.portal}
                          onChange={(e) => handleCellChange(row.id, "portal", e.target.value)}
                          className="w-full bg-transparent text-xs text-[#374151] dark:text-zinc-300 px-1 py-1 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded cursor-pointer dark:bg-[#121212]"
                        >
                          <option value="Compras.gov.br">Compras.gov.br</option>
                          <option value="BLL Compras">BLL Compras</option>
                          <option value="Licitações-e">Licitações-e</option>
                          <option value="Bec SP">Bec SP</option>
                          <option value="PNCP">PNCP</option>
                        </select>
                      </td>

                      {/* Col E: Link PNCP */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] ${activeCell?.rowId === row.id && activeCell?.colKey === "linkPNCP" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "linkPNCP", colName: "Link PNCP", colLetter: "E" })}
                      >
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="https://..."
                            value={row.linkPNCP || ""}
                            onChange={(e) => handleCellChange(row.id, "linkPNCP", e.target.value)}
                            className="w-full bg-transparent px-2 py-1 text-xs text-blue-600 dark:text-blue-400 underline focus:no-underline focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded font-mono truncate"
                          />
                          {row.linkPNCP && (
                            <a
                              href={row.linkPNCP.startsWith("http") ? row.linkPNCP : `https://${row.linkPNCP}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded shrink-0 cursor-pointer"
                              title="Abrir Link PNCP"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Col F: Produto / Item */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] ${activeCell?.rowId === row.id && activeCell?.colKey === "produtoItem" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "produtoItem", colName: "Produto / Item", colLetter: "F" })}
                      >
                        <input
                          type="text"
                          value={row.produtoItem}
                          onChange={(e) => handleCellChange(row.id, "produtoItem", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded"
                        />
                      </td>

                      {/* Col G: Qtd */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] text-center ${activeCell?.rowId === row.id && activeCell?.colKey === "quantidade" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "quantidade", colName: "Quantidade", colLetter: "G" })}
                      >
                        <input
                          type="number"
                          value={row.quantidade}
                          onChange={(e) => handleCellChange(row.id, "quantidade", Number(e.target.value))}
                          className="w-full text-center bg-transparent px-1 py-1 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded"
                        />
                      </td>

                      {/* Col H: Und */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] text-center ${activeCell?.rowId === row.id && activeCell?.colKey === "unidadeMedida" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "unidadeMedida", colName: "Unidade", colLetter: "H" })}
                      >
                        <input
                          type="text"
                          value={row.unidadeMedida}
                          onChange={(e) => handleCellChange(row.id, "unidadeMedida", e.target.value)}
                          className="w-full text-center bg-transparent px-1 py-1 text-xs text-[#4B5563] dark:text-zinc-400 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded"
                        />
                      </td>

                      {/* Col I: Val. Estimado */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] text-right ${activeCell?.rowId === row.id && activeCell?.colKey === "valorEstimadoItem" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "valorEstimadoItem", colName: "Valor Estimado (R$)", colLetter: "I" })}
                      >
                        <input
                          type="number"
                          step="0.01"
                          value={row.valorEstimadoItem}
                          onChange={(e) => handleCellChange(row.id, "valorEstimadoItem", Number(e.target.value))}
                          className="w-full text-right bg-transparent px-2 py-1 text-xs text-[#4B5563] dark:text-zinc-400 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded font-mono"
                        />
                      </td>

                      {/* Col J: Nosso Alvo */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] text-right ${activeCell?.rowId === row.id && activeCell?.colKey === "nossoValorAlvo" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "nossoValorAlvo", colName: "Nosso Valor Alvo (R$)", colLetter: "J" })}
                      >
                        <input
                          type="number"
                          step="0.01"
                          value={row.nossoValorAlvo}
                          onChange={(e) => handleCellChange(row.id, "nossoValorAlvo", Number(e.target.value))}
                          className="w-full text-right bg-transparent px-2 py-1 text-xs text-[#FF5A00] font-bold focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded font-mono"
                        />
                      </td>

                      {/* Col K: Preço Piso */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] text-right ${activeCell?.rowId === row.id && activeCell?.colKey === "valorMinimoPiso" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "valorMinimoPiso", colName: "Preço Piso (R$)", colLetter: "K" })}
                      >
                        <input
                          type="number"
                          step="0.01"
                          value={row.valorMinimoPiso}
                          onChange={(e) => handleCellChange(row.id, "valorMinimoPiso", Number(e.target.value))}
                          className="w-full text-right bg-transparent px-2 py-1 text-xs text-[#6B7280] dark:text-zinc-400 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded font-mono"
                        />
                      </td>

                      {/* Col L: Data/Hora */}
                      <td 
                        className={`p-1 border-r border-[#E5E7EB] dark:border-[#27272A] ${activeCell?.rowId === row.id && activeCell?.colKey === "dataHoraDisputa" ? 'ring-2 ring-[#FF5A00] bg-[#FFF0E5]/60 dark:bg-[#FF5A00]/20' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "dataHoraDisputa", colName: "Data e Hora Disputa", colLetter: "L" })}
                      >
                        <input
                          type="text"
                          value={row.dataHoraDisputa}
                          onChange={(e) => handleCellChange(row.id, "dataHoraDisputa", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-[#374151] dark:text-zinc-300 focus:outline-none focus:bg-white dark:focus:bg-[#1F1F23] rounded"
                        />
                      </td>

                      {/* Col L: Status */}
                      <td className="p-1 border-r border-[#E5E7EB] dark:border-[#27272A] text-center">
                        <select
                          value={row.status}
                          onChange={(e) => handleStatusChange(row.id, e.target.value as DisputaStatus)}
                          className={`text-[10.5px] font-bold px-2 py-0.5 rounded-lg border focus:outline-none cursor-pointer ${getStatusBadge(row.status)}`}
                        >
                          <option value="Agendada">Agendada</option>
                          <option value="Em Disputa">Em Disputa</option>
                          <option value="Vencida">Vencida</option>
                          <option value="Em Recurso">Em Recurso</option>
                          <option value="Homologada">Homologada</option>
                          <option value="Perdida">Perdida</option>
                        </select>
                      </td>

                      {/* Actions */}
                      <td className="p-1 text-center">
                        <button
                          onClick={() => handleDeleteRow(row.id)}
                          className="p-1 text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition cursor-pointer"
                          title="Excluir Linha"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>

                    </tr>
                  ))}
                </tbody>

              </table>
            </div>

            {/* Bottom Excel Totals Summary Bar */}
            <div className="bg-[#F9FAFB] dark:bg-[#18181B] px-4 py-2 border-t border-[#E5E7EB] dark:border-[#27272A] flex flex-wrap items-center justify-between text-xs font-mono text-[#4B5563] dark:text-zinc-400 gap-4">
              <div className="flex items-center gap-4">
                <span className="text-[#FF5A00] font-bold">∑ Fórmulas de Totais:</span>
                <span>Soma (H): <strong className="text-[#111827] dark:text-zinc-100">{valorTotalEstimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></span>
                <span>Soma (I): <strong className="text-[#FF5A00]">{valorNossoAlvo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[#6B7280] dark:text-zinc-400">Linhas Totais: {filteredDisputas.length}</span>
                <button
                  onClick={handleAddBlankRow}
                  className="bg-[#FF5A00] hover:bg-[#E65000] text-white font-bold px-3 py-1 rounded text-[11px] transition cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <Plus className="w-3 h-3" />
                  <span>Nova Linha</span>
                </button>
              </div>
            </div>

          </div>
        ) : (
          /* MODE 2: MODELO PAINEL / DASHBOARD VISUAL */
          <div className="bg-white dark:bg-[#121212] border border-[#E5E7EB] dark:border-[#27272A] rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                
                {/* Header */}
                <thead>
                  <tr className="border-b border-[#E5E7EB] dark:border-[#27272A] bg-[#F9FAFB] dark:bg-[#18181B] text-[10.5px] uppercase tracking-wider font-bold text-[#4B5563] dark:text-zinc-400 select-none">
                    <th className="py-3.5 px-4 cursor-pointer hover:text-[#111827] dark:hover:text-white transition" onClick={() => handleSort("status")}>
                      <div className="flex items-center gap-1">
                        <span>Status</span>
                        <ArrowUpDown className="w-3 h-3 text-[#9CA3AF] dark:text-zinc-500" />
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:text-[#111827] dark:hover:text-white transition" onClick={() => handleSort("orgao")}>
                      <div className="flex items-center gap-1">
                        <span>Órgão Comprador</span>
                        <ArrowUpDown className="w-3 h-3 text-[#9CA3AF] dark:text-zinc-500" />
                      </div>
                    </th>
                    <th className="py-3.5 px-4">UASG / Und</th>
                    <th className="py-3.5 px-4">Nº Licitação</th>
                    <th className="py-3.5 px-4">Portal</th>
                    <th className="py-3.5 px-4">Link PNCP</th>
                    <th className="py-3.5 px-4 min-w-[200px]">Produto / Objeto</th>
                    <th className="py-3.5 px-4 text-center">Qtd / Und</th>
                    <th className="py-3.5 px-4 text-right">Val. Estimado</th>
                    <th className="py-3.5 px-4 text-right">Nosso Alvo</th>
                    <th className="py-3.5 px-4 text-right">Preço Piso</th>
                    <th className="py-3.5 px-4">Data / Hora Disputa</th>
                    <th className="py-3.5 px-4 text-center">Ações</th>
                  </tr>
                </thead>

                {/* Body */}
                <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#27272A] text-xs text-[#111827] dark:text-zinc-100 bg-white dark:bg-[#121212]">
                  {filteredDisputas.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-[#6B7280] dark:text-zinc-400">
                        <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-[#9CA3AF] dark:text-zinc-500" />
                        <p className="font-bold text-sm text-[#4B5563] dark:text-zinc-300">Nenhum registro encontrado</p>
                      </td>
                    </tr>
                  ) : (
                    filteredDisputas.map((row) => (
                      <tr key={row.id} className="hover:bg-[#F9FAFB] dark:hover:bg-[#1E1E22] transition-colors group">
                        
                        <td className="py-3 px-4">
                          <select
                            value={row.status}
                            onChange={(e) => handleStatusChange(row.id, e.target.value as DisputaStatus)}
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border focus:outline-none cursor-pointer transition ${getStatusBadge(row.status)}`}
                          >
                            <option value="Agendada">Agendada</option>
                            <option value="Em Disputa">Em Disputa</option>
                            <option value="Vencida">Vencida</option>
                            <option value="Em Recurso">Em Recurso</option>
                            <option value="Homologada">Homologada</option>
                            <option value="Perdida">Perdida</option>
                          </select>
                        </td>

                        <td className="py-3 px-4 font-semibold text-[#111827] dark:text-zinc-100 max-w-[180px] truncate" title={row.orgao}>
                          {row.orgao}
                        </td>

                        <td className="py-3 px-4 font-mono text-[#6B7280] dark:text-zinc-400 text-[11px]">
                          {row.uasgUndCompradora}
                        </td>

                        <td className="py-3 px-4 font-mono font-bold text-[#FF5A00] text-[11px]">
                          {row.numeroLicitacao}
                        </td>

                        <td className="py-3 px-4 text-[#374151] dark:text-zinc-300 text-[11px]">
                          <span className="bg-[#F3F4F6] dark:bg-[#27272A] px-2 py-0.5 rounded border border-[#E5E7EB] dark:border-[#3F3F46] text-[10.5px]">
                            {row.portal}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          {row.linkPNCP ? (
                            <a 
                              href={row.linkPNCP.startsWith("http") ? row.linkPNCP : `https://${row.linkPNCP}`} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/60 transition cursor-pointer"
                              title={row.linkPNCP}
                            >
                              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                              <span>Abrir PNCP</span>
                            </a>
                          ) : (
                            <span className="text-[#9CA3AF] dark:text-zinc-500 text-xs">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-[240px]">
                          <p className="line-clamp-2 text-[#374151] dark:text-zinc-300 leading-snug">{row.produtoItem}</p>
                        </td>

                        <td className="py-3 px-4 text-center font-mono text-[11px] text-[#374151] dark:text-zinc-300">
                          {row.quantidade} <span className="text-[10px] text-[#9CA3AF] dark:text-zinc-500">{row.unidadeMedida}</span>
                        </td>

                        <td className="py-3 px-4 text-right font-mono text-[#374151] dark:text-zinc-300">
                          {row.valorEstimadoItem > 0 
                            ? row.valorEstimadoItem.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                            : "—"}
                        </td>

                        <td className="py-3 px-4 text-right font-mono font-bold text-[#FF5A00]">
                          {row.nossoValorAlvo > 0 
                            ? row.nossoValorAlvo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                            : "—"}
                        </td>

                        <td className="py-3 px-4 text-right font-mono text-[#6B7280] dark:text-zinc-400 text-[11px]">
                          {row.valorMinimoPiso > 0 
                            ? row.valorMinimoPiso.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                            : "—"}
                        </td>

                        <td className="py-3 px-4 font-mono text-[#374151] dark:text-zinc-300 text-[11px] whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-[#FF5A00] shrink-0" />
                            <span>{row.dataHoraDisputa}</span>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5 opacity-80 group-hover:opacity-100 transition">
                            <button
                              onClick={() => handleOpenEditModal(row)}
                              className="p-1.5 rounded-lg bg-[#F3F4F6] dark:bg-[#27272A] hover:bg-[#E5E7EB] dark:hover:bg-zinc-700 text-[#4B5563] dark:text-zinc-300 hover:text-[#111827] dark:hover:text-white transition cursor-pointer"
                              title="Editar linha"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteRow(row.id)}
                              className="p-1.5 rounded-lg bg-[#F3F4F6] dark:bg-[#27272A] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[#4B5563] dark:text-zinc-300 hover:text-rose-600 transition cursor-pointer"
                              title="Excluir da planilha"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                      </tr>
                    ))
                  )}
                </tbody>

              </table>
            </div>
          </div>
        )}

      </div>

      {/* Add / Edit Form Modal with History Pull & Attachment AI Extractions */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-[#121212] border border-[#E5E7EB] dark:border-[#27272A] rounded-2xl max-w-2xl w-full max-h-[92vh] sm:max-h-[88vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            
            {/* Modal Header */}
            <div className="p-3.5 sm:p-5 border-b border-[#E5E7EB] dark:border-[#27272A] flex items-center justify-between bg-[#F9FAFB] dark:bg-[#18181B] shrink-0">
              <h3 className="text-sm sm:text-base font-bold text-[#111827] dark:text-zinc-100 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-[#FF5A00] shrink-0" />
                <span className="truncate">{editingRow ? "Editar Registro da Disputa" : "Cadastrar Nova Disputa na Planilha"}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#6B7280] dark:text-zinc-400 hover:text-[#111827] dark:hover:text-white p-1.5 rounded-lg hover:bg-[#E5E7EB] dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 scrollbar-thin">
              
              {/* Top Auto-Fill Panel (History Pull OR Attachment Upload) */}
              {!editingRow && (
                <div className="bg-[#FFF0E5] dark:bg-[#2A170A] p-3.5 sm:p-4 rounded-xl border border-[#FFD6C2] dark:border-[#4A2410] space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#FF5A00] animate-pulse shrink-0" />
                    <span className="text-xs font-bold text-[#111827] dark:text-zinc-100 uppercase tracking-wider">
                      Preenchimento Automatizado via IA
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    
                    {/* Option A: Puxar do Histórico de Editais Analisados */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[#FF5A00] uppercase flex items-center gap-1">
                        <History className="w-3 h-3 shrink-0" />
                        <span>Puxar do Histórico Analisado</span>
                      </label>
                      <select
                        value={selectedHistoryId}
                        onChange={(e) => handleApplyHistoryEdital(e.target.value)}
                        className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-2.5 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00] cursor-pointer truncate"
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
                      <label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase flex items-center gap-1">
                        <Upload className="w-3 h-3 shrink-0" />
                        <span>Anexo / Edital (Preencher IA)</span>
                      </label>
                      <label className="flex items-center justify-center gap-2 w-full bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold py-2 px-3 rounded-xl cursor-pointer transition">
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
                    <div className="flex items-center gap-2 text-xs text-[#FF5A00] font-mono animate-pulse pt-1">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF5A00] shrink-0" />
                      <span>{extractStatusText}</span>
                    </div>
                  )}
                </div>
              )}

              <form id="disputa-form" onSubmit={handleSaveForm} className="space-y-4">
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  
                  {/* Órgão */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Órgão Comprador *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Tribunal Regional Federal da 3ª Região"
                      value={formData.orgao}
                      onChange={(e) => setFormData({ ...formData, orgao: e.target.value })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 placeholder-[#9CA3AF] dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00]"
                    />
                  </div>

                  {/* UASG / Código Und */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">UASG / Código Unidade</label>
                    <input
                      type="text"
                      placeholder="Ex: 090012 - TRF3"
                      value={formData.uasgUndCompradora}
                      onChange={(e) => setFormData({ ...formData, uasgUndCompradora: e.target.value })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 placeholder-[#9CA3AF] dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00]"
                    />
                  </div>

                  {/* Nº Licitação */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Nº Licitação / Processo</label>
                    <input
                      type="text"
                      placeholder="Ex: Pregão Eletrônico 14/2026"
                      value={formData.numeroLicitacao}
                      onChange={(e) => setFormData({ ...formData, numeroLicitacao: e.target.value })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 placeholder-[#9CA3AF] dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00]"
                    />
                  </div>

                  {/* Portal */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Portal Eletrônico</label>
                    <select
                      value={formData.portal}
                      onChange={(e) => setFormData({ ...formData, portal: e.target.value })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00]"
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
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400 flex items-center gap-1">
                      <ExternalLink className="w-3 h-3 text-[#FF5A00]" />
                      <span>Link PNCP (Portal Nacional de Contratações Públicas)</span>
                    </label>
                    <input
                      type="url"
                      placeholder="Ex: https://pncp.gov.br/app/editais/123456/2026/000001"
                      value={formData.linkPNCP || ""}
                      onChange={(e) => setFormData({ ...formData, linkPNCP: e.target.value })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 placeholder-[#9CA3AF] dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00]"
                    />
                  </div>

                </div>

                {/* Produto / Objeto */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Produto / Objeto *</label>
                  <textarea
                    required
                    rows={2}
                    placeholder="Descrição detalhada do item/produto cotado na disputa..."
                    value={formData.produtoItem}
                    onChange={(e) => setFormData({ ...formData, produtoItem: e.target.value })}
                    className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 placeholder-[#9CA3AF] dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  
                  {/* Quantidade */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Quantidade</label>
                    <input
                      type="number"
                      min={1}
                      value={formData.quantidade}
                      onChange={(e) => setFormData({ ...formData, quantidade: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:border-[#FF5A00]"
                    />
                  </div>

                  {/* Unidade Medida */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Unidade</label>
                    <input
                      type="text"
                      placeholder="Unidade, Caixa, Lote"
                      value={formData.unidadeMedida}
                      onChange={(e) => setFormData({ ...formData, unidadeMedida: e.target.value })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:border-[#FF5A00]"
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as DisputaStatus })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:border-[#FF5A00]"
                    >
                      <option value="Agendada">Agendada</option>
                      <option value="Em Disputa">Em Disputa</option>
                      <option value="Vencida">Vencida</option>
                      <option value="Em Recurso">Em Recurso</option>
                      <option value="Homologada">Homologada</option>
                      <option value="Perdida">Perdida</option>
                      <option value="Cancelada">Cancelada</option>
                    </select>
                  </div>

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  
                  {/* Valor Estimado */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Valor Estimado (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.valorEstimadoItem || ""}
                      onChange={(e) => setFormData({ ...formData, valorEstimadoItem: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:border-[#FF5A00]"
                    />
                  </div>

                  {/* Nosso Valor Alvo */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#FF5A00]">Nosso Lance Alvo (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.nossoValorAlvo || ""}
                      onChange={(e) => setFormData({ ...formData, nossoValorAlvo: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#FF5A00]/20 focus:border-[#FF5A00]"
                    />
                  </div>

                  {/* Preço Mínimo Piso */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Preço Mínimo Piso (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.valorMinimoPiso || ""}
                      onChange={(e) => setFormData({ ...formData, valorMinimoPiso: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:border-[#FF5A00]"
                    />
                  </div>

                </div>

                {/* Data e Hora */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Data e Hora da Disputa</label>
                  <input
                    type="text"
                    placeholder="Ex: 2026-08-15 09:30 ou 15/08/2026 09:30"
                    value={formData.dataHoraDisputa}
                    onChange={(e) => setFormData({ ...formData, dataHoraDisputa: e.target.value })}
                    className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:border-[#FF5A00]"
                  />
                </div>

                {/* Observações */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[#4B5563] dark:text-zinc-400">Observações & Estratégia de Lance</label>
                  <input
                    type="text"
                    placeholder="Anotações internas, concorrentes mapeados, margem esperada..."
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    className="w-full bg-white dark:bg-[#18181B] border border-[#D1D5DB] dark:border-[#27272A] rounded-xl px-3 py-2 text-xs text-[#111827] dark:text-zinc-100 focus:outline-none focus:border-[#FF5A00]"
                  />
                </div>

              </form>

            </div>

            {/* Modal Footer (Always visible & fixed at bottom) */}
            <div className="p-3.5 sm:p-4 border-t border-[#E5E7EB] dark:border-[#27272A] bg-[#F9FAFB] dark:bg-[#18181B] shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl border border-[#D1D5DB] dark:border-[#27272A] text-[#374151] dark:text-zinc-300 hover:bg-[#E5E7EB] dark:hover:bg-zinc-800 transition cursor-pointer text-xs font-semibold text-center"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="disputa-form"
                className="w-full sm:w-auto bg-[#FF5A00] hover:bg-[#E65000] text-white font-bold px-5 py-2.5 rounded-xl text-xs transition cursor-pointer shadow-xs text-center flex items-center justify-center gap-1.5"
              >
                Salvar na Planilha
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Row Deletion Confirmation Modal (Replaces blocked window.confirm) */}
      {rowToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-[#18181B] border border-[#E5E7EB] dark:border-[#27272A] rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-xl text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-base font-bold text-[#111827] dark:text-white leading-tight">
                  Excluir Linha da Planilha?
                </h3>
                <p className="text-xs text-[#6B7280] dark:text-zinc-400">
                  Esta ação removerá o registro selecionado da sua planilha de disputas.
                </p>
              </div>
            </div>

            <div className="bg-[#F9FAFB] dark:bg-[#121215] p-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#27272A] text-xs space-y-1 text-[#374151] dark:text-zinc-300">
              <p><strong className="text-[#111827] dark:text-white">Órgão:</strong> {rowToDelete.orgao || "Não informado"}</p>
              <p><strong className="text-[#111827] dark:text-white">Item:</strong> {rowToDelete.produtoItem || "Sem descrição"}</p>
              <p><strong className="text-[#111827] dark:text-white">Licitação:</strong> {rowToDelete.numeroLicitacao || "N/A"}</p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setRowToDelete(null)}
                className="px-4 py-2 bg-[#F3F4F6] dark:bg-zinc-800 hover:bg-[#E5E7EB] dark:hover:bg-zinc-700 text-[#374151] dark:text-zinc-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteRow}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Sim, Excluir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supabase Database SQL Setup Modal */}
      {showSqlSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-[#18181B] border border-[#E5E7EB] dark:border-[#27272A] rounded-2xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-[#E5E7EB] dark:border-[#27272A] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-900/50 rounded-xl text-[#FF5A00]">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#111827] dark:text-white">
                    Estrutura do Banco de Dados Supabase
                  </h3>
                  <p className="text-xs text-[#6B7280] dark:text-zinc-400">
                    Script SQL completo para inicializar tabelas e permissões
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSqlSetupModal(false)}
                className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-3">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs text-amber-900 dark:text-amber-300">
                💡 <strong>Como usar:</strong> Copie o script SQL abaixo e execute na aba <strong>SQL Editor</strong> do painel Supabase do seu projeto para criar automaticamente as tabelas de <em>planilhas_disputas</em>, <em>editais_analisados</em>, <em>documentos</em> e outras.
              </div>

              <div className="relative">
                <textarea
                  readOnly
                  value={getSupabaseFullSchemaSQL()}
                  rows={14}
                  className="w-full bg-[#0F172A] text-emerald-400 font-mono text-[11px] p-3.5 rounded-xl border border-slate-700 leading-relaxed focus:outline-none select-all"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[#E5E7EB] dark:border-[#27272A] bg-[#F9FAFB] dark:bg-[#121215] flex items-center justify-between gap-3">
              <span className="text-xs text-[#6B7280] dark:text-zinc-400">
                PostgreSQL • Supabase RLS Seguro
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSqlSetupModal(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 text-[#374151] dark:text-zinc-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(getSupabaseFullSchemaSQL());
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2500);
                  }}
                  className="px-4 py-2 bg-[#FF5A00] hover:bg-[#E65000] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {copiedSql ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedSql ? "Copiado com Sucesso!" : "Copiar Script SQL"}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
