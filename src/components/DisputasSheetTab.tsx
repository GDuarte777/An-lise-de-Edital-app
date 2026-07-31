import { useState, useEffect } from "react";
import { 
  Table, Plus, Download, Copy, Trash2, Edit2, Search, Filter, Sparkles, 
  CheckCircle, DollarSign, Calendar, Landmark, FileSpreadsheet, ArrowUpDown, 
  Upload, History, LayoutGrid, Layers, FileText, Check, AlertCircle, RefreshCw, X
} from "lucide-react";
import { DisputaRow, DisputaStatus, EditalAnalysis } from "../types";
import { apiFetch, prepareAttachmentForServer } from "../utils/aiClientHelper";
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
    observacoes
  };
}

// 1 Example item only as requested
const INITIAL_DISPUTAS: DisputaRow[] = [
  {
    id: "disp-101",
    orgao: "TRF 3ª Região - São Paulo",
    uasgUndCompradora: "090012 - TRF3",
    numeroLicitacao: "PE 14/2026",
    portal: "Compras.gov.br",
    produtoItem: "Laptops Corporativos i7 16GB NVMe",
    quantidade: 100,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 4500000.00,
    nossoValorAlvo: 4120000.00,
    valorMinimoPiso: 3850000.00,
    dataHoraDisputa: "2026-08-05 10:00",
    status: "Agendada",
    observacoes: "Monitorar concorrência da Lenovo e Dell. Margem estimada em 18%."
  }
];

export default function DisputasSheetTab({ activeEdital }: DisputasSheetTabProps) {
  // Mode Switcher: "spreadsheet" (Planilha Interativa Excel) vs "dashboard" (Painel Visual)
  const [viewMode, setViewMode] = useState<"spreadsheet" | "dashboard">(() => {
    return (localStorage.getItem("aip_disputas_view_mode") as "spreadsheet" | "dashboard") || "spreadsheet";
  });

  const [disputas, setDisputas] = useState<DisputaRow[]>(() => {
    const saved = localStorage.getItem("aip_disputas_sheet");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error(e);
      }
    }
    return INITIAL_DISPUTAS;
  });

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
    observacoes: ""
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
      observacoes: ""
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
      alert("Por favor, informe o nome do Órgão e a Descrição do Produto/Item.");
      return;
    }

    if (editingRow) {
      setDisputas(prev => prev.map(r => r.id === editingRow.id ? { ...r, ...formData } as DisputaRow : r));
      showToast("Disputa atualizada com sucesso na planilha!");
    } else {
      const newRow: DisputaRow = {
        id: "disp-" + Date.now(),
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
        observacoes: formData.observacoes || ""
      };
      setDisputas(prev => [newRow, ...prev]);
      confetti({ particleCount: 35, spread: 40 });
      showToast("Nova linha adicionada com sucesso!");
    }

    setIsModalOpen(false);
  };

  // Add blank row directly in Spreadsheet mode
  const handleAddBlankRow = () => {
    const newRow: DisputaRow = {
      id: "disp-" + Date.now(),
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
      observacoes: ""
    };
    setDisputas(prev => [...prev, newRow]);
    showToast("Nova linha inserida na planilha!");
  };

  // Inline Cell Edit handler for Spreadsheet mode
  const handleCellChange = (id: string, field: keyof DisputaRow, value: any) => {
    setDisputas(prev => prev.map(r => {
      if (r.id === id) {
        return { ...r, [field]: value };
      }
      return r;
    }));
  };

  // Delete Row
  const handleDeleteRow = (id: string) => {
    if (confirm("Tem certeza que deseja remover esta linha da planilha?")) {
      setDisputas(prev => prev.filter(r => r.id !== id));
      showToast("Linha removida com sucesso.", "info");
    }
  };

  // Change Status Quick Handler
  const handleStatusChange = (id: string, newStatus: DisputaStatus) => {
    setDisputas(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
    if (newStatus === "Vencida" || newStatus === "Homologada") {
      confetti({ particleCount: 50, spread: 60 });
    }
    showToast(`Status alterado para "${newStatus}".`);
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (disputas.length === 0) {
      alert("A planilha está vazia.");
      return;
    }

    const headers = [
      "ID",
      "Órgão Comprador",
      "UASG / Cód. Unidade",
      "Nº Licitação",
      "Portal",
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
    const headers = ["Órgão", "UASG/Cod", "Nº Licitação", "Portal", "Produto/Objeto", "Qtd", "Und", "Valor Estimado", "Nosso Alvo", "Preço Piso", "Data Disputa", "Status"];
    const rows = filteredDisputas.map(r => [
      r.orgao,
      r.uasgUndCompradora,
      r.numeroLicitacao,
      r.portal,
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
        return "bg-blue-500/10 text-blue-300 border-blue-500/30";
      case "Em Disputa":
        return "bg-amber-500/10 text-amber-300 border-amber-500/30 animate-pulse";
      case "Vencida":
        return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 font-bold";
      case "Homologada":
        return "bg-teal-500/10 text-teal-300 border-teal-500/30 font-bold";
      case "Em Recurso":
        return "bg-purple-500/10 text-purple-300 border-purple-500/30";
      case "Perdida":
        return "bg-rose-500/10 text-rose-300 border-rose-500/30";
      case "Cancelada":
        return "bg-slate-500/10 text-slate-400 border-slate-500/30";
      default:
        return "bg-slate-800 text-slate-300 border-slate-700";
    }
  };

  // Find active cell object value for formula bar
  const activeRowObj = disputas.find(r => r.id === activeCell?.rowId) || disputas[0];
  const activeCellValue = activeRowObj && activeCell ? activeRowObj[activeCell.colKey] : "";

  return (
    <div id="disputas-sheet-view" className="flex-1 flex flex-col h-full bg-[#0b0f19] overflow-y-auto">
      
      {/* Top Banner & Mode Switcher Bar */}
      <div className="p-5 border-b border-white/10 bg-white/5 backdrop-blur-md flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="bg-emerald-500/10 text-emerald-400 p-2 rounded-xl border border-emerald-500/20 shadow-sm">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>Planilha de Disputas & Pregões</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase">
                  {viewMode === "spreadsheet" ? "Modo Planilha Interativa" : "Modo Painel / Dashboard"}
                </span>
              </h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Alterne livremente entre a visão de **Planilha Excel em Grade** ou a **Visão Painel Visual**.
              </p>
            </div>
          </div>
        </div>

        {/* Mode Selector Toggle + Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Mode Switcher Buttons */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-white/10 shadow-inner">
            <button
              onClick={() => setViewMode("spreadsheet")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition duration-150 cursor-pointer ${
                viewMode === "spreadsheet"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Modelo Planilha</span>
            </button>
            <button
              onClick={() => setViewMode("dashboard")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition duration-150 cursor-pointer ${
                viewMode === "dashboard"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Modelo Painel</span>
            </button>
          </div>

          <div className="h-6 w-px bg-white/10 hidden sm:block" />

          {/* Action buttons */}
          <button
            onClick={handleCopyClipboard}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-semibold px-3 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer"
            title="Copiar dados para colar direto no Excel ou Google Sheets"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            <span>Copiar Tabela</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-bold px-3 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer"
            title="Baixar arquivo .CSV para Excel"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-600/20"
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
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" 
            : "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
        }`}>
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="text-xs font-semibold">{notification.text}</span>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="p-6 pb-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* KPI 1: Disputas Mapeadas */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">Total de Linhas</span>
            <span className="text-2xl font-black text-white mt-1 block">{totalMapeado}</span>
            <span className="text-[10px] text-slate-400 mt-1 block">Itens cadastrados na planilha</span>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
            <Landmark className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 2: Valor Estimado Total */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">Valor Estimado Total</span>
            <span className="text-xl font-black text-slate-200 mt-1 block font-mono">
              {valorTotalEstimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
            <span className="text-[10px] text-slate-400 mt-1 block">Soma de referência dos editais</span>
          </div>
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 3: Nosso Alvo Global */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">Nosso Meta Global</span>
            <span className="text-xl font-black text-indigo-300 mt-1 block font-mono">
              {valorNossoAlvo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
            <span className="text-[10px] text-slate-400 mt-1 block">Soma das nossas propostas</span>
          </div>
          <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 4: Arrematadas / Vencidas */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">Arrematadas / Vencidas</span>
            <span className="text-xl font-black text-emerald-400 mt-1 block font-mono">
              {valorTotalVencido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
            <span className="text-[10px] text-emerald-400/80 mt-1 block font-semibold">
              Taxa de Sucesso: {winRate}% ({disputasVencidas.length} itens)
            </span>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <CheckCircle className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* Filter Toolbar & Search */}
      <div className="p-6 space-y-4">
        
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white/5 p-3.5 border border-white/10 rounded-2xl">
          
          {/* Search box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por órgão, UASG, nº da licitação, produto..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Status Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-white/10 rounded-xl px-2.5 py-1 text-xs text-slate-300">
              <Filter className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="text-[10px] uppercase font-bold text-slate-500">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-xs text-white font-semibold focus:outline-none cursor-pointer"
              >
                <option value="Todas" className="bg-slate-900">Todas</option>
                <option value="Agendada" className="bg-slate-900">Agendadas</option>
                <option value="Em Disputa" className="bg-slate-900">Em Disputa</option>
                <option value="Vencida" className="bg-slate-900">Vencidas</option>
                <option value="Em Recurso" className="bg-slate-900">Em Recurso</option>
                <option value="Homologada" className="bg-slate-900">Homologadas</option>
                <option value="Perdida" className="bg-slate-900">Perdidas</option>
              </select>
            </div>

            {/* Portal Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-white/10 rounded-xl px-2.5 py-1 text-xs text-slate-300">
              <span className="text-[10px] uppercase font-bold text-slate-500">Portal:</span>
              <select
                value={portalFilter}
                onChange={(e) => setPortalFilter(e.target.value)}
                className="bg-transparent text-xs text-white font-semibold focus:outline-none cursor-pointer"
              >
                <option value="Todos" className="bg-slate-900">Todos</option>
                <option value="Compras.gov.br" className="bg-slate-900">Compras.gov.br</option>
                <option value="BLL Compras" className="bg-slate-900">BLL Compras</option>
                <option value="Licitações-e" className="bg-slate-900">Licitações-e</option>
                <option value="Bec SP" className="bg-slate-900">Bec SP</option>
                <option value="PNCP" className="bg-slate-900">PNCP</option>
              </select>
            </div>

            <button
              onClick={handleAddBlankRow}
              className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-bold px-3 py-1 rounded-xl text-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Inserir Linha</span>
            </button>

          </div>

        </div>

        {/* MODE 1: MODELO PLANILHA INTERATIVA EXCEL */}
        {viewMode === "spreadsheet" ? (
          <div className="bg-slate-950 border border-emerald-500/30 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            
            {/* Spreadsheet Top Excel-Style Formula & Active Cell Bar */}
            <div className="bg-[#0c101e] px-4 py-2 border-b border-white/10 flex items-center gap-3 font-mono text-xs">
              
              {/* Selected Cell Tag */}
              <div className="flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold px-2.5 py-1 rounded-md text-[11px] min-w-[110px]">
                <span className="text-emerald-500 font-mono">fx</span>
                <span>{activeCell ? `Célula ${activeCell.colLetter}${disputas.findIndex(r => r.id === activeCell.rowId) + 1}` : 'A1'}</span>
              </div>

              {/* Formula input box for active cell */}
              <div className="flex-1 flex items-center gap-2 bg-slate-900 border border-white/10 rounded-md px-3 py-1">
                <span className="text-slate-500 text-[11px] font-bold">
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
                  className="w-full bg-transparent text-white font-mono text-xs focus:outline-none"
                />
              </div>

            </div>

            {/* Interactive Grid Table */}
            <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
              <table className="w-full border-collapse font-mono text-xs select-none">
                
                {/* Spreadsheet Column Headers (A, B, C, D...) */}
                <thead>
                  <tr className="bg-[#12182c] border-b border-white/10 text-slate-400 text-[10.5px] font-bold">
                    <th className="w-12 py-2 px-2 text-center border-r border-white/10 bg-[#0a0d18] text-slate-500">#</th>
                    <th className="py-2 px-3 border-r border-white/10 text-left min-w-[200px]">A - Órgão Comprador</th>
                    <th className="py-2 px-3 border-r border-white/10 text-left w-36">B - UASG/Cod</th>
                    <th className="py-2 px-3 border-r border-white/10 text-left w-32">C - Nº Licitação</th>
                    <th className="py-2 px-3 border-r border-white/10 text-left w-32">D - Portal</th>
                    <th className="py-2 px-3 border-r border-white/10 text-left min-w-[240px]">E - Produto / Item</th>
                    <th className="py-2 px-2 border-r border-white/10 text-center w-20">F - Qtd</th>
                    <th className="py-2 px-2 border-r border-white/10 text-center w-20">G - Und</th>
                    <th className="py-2 px-3 border-r border-white/10 text-right w-36">H - Val. Estimado</th>
                    <th className="py-2 px-3 border-r border-white/10 text-right w-36">I - Nosso Alvo</th>
                    <th className="py-2 px-3 border-r border-white/10 text-right w-36">J - Preço Piso</th>
                    <th className="py-2 px-3 border-r border-white/10 text-left w-36">K - Data/Hora</th>
                    <th className="py-2 px-3 border-r border-white/10 text-center w-32">L - Status</th>
                    <th className="py-2 px-2 text-center w-16">Ações</th>
                  </tr>
                </thead>

                {/* Grid Rows */}
                <tbody className="divide-y divide-white/10 bg-slate-950 text-slate-200">
                  {filteredDisputas.map((row, index) => (
                    <tr key={row.id} className="hover:bg-indigo-500/10 transition-colors group">
                      
                      {/* Row Index # */}
                      <td className="py-2 px-2 text-center font-bold text-slate-500 border-r border-white/10 bg-[#0a0d18] text-[11px]">
                        {index + 1}
                      </td>

                      {/* Col A: Órgão */}
                      <td 
                        className={`p-1 border-r border-white/10 ${activeCell?.rowId === row.id && activeCell?.colKey === "orgao" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "orgao", colName: "Órgão Comprador", colLetter: "A" })}
                      >
                        <input
                          type="text"
                          value={row.orgao}
                          onChange={(e) => handleCellChange(row.id, "orgao", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-white focus:outline-none focus:bg-slate-900 rounded"
                        />
                      </td>

                      {/* Col B: UASG */}
                      <td 
                        className={`p-1 border-r border-white/10 ${activeCell?.rowId === row.id && activeCell?.colKey === "uasgUndCompradora" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "uasgUndCompradora", colName: "UASG/Cod Unidade", colLetter: "B" })}
                      >
                        <input
                          type="text"
                          value={row.uasgUndCompradora}
                          onChange={(e) => handleCellChange(row.id, "uasgUndCompradora", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-slate-300 focus:outline-none focus:bg-slate-900 rounded"
                        />
                      </td>

                      {/* Col C: Nº Licitação */}
                      <td 
                        className={`p-1 border-r border-white/10 ${activeCell?.rowId === row.id && activeCell?.colKey === "numeroLicitacao" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "numeroLicitacao", colName: "Nº Licitação", colLetter: "C" })}
                      >
                        <input
                          type="text"
                          value={row.numeroLicitacao}
                          onChange={(e) => handleCellChange(row.id, "numeroLicitacao", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-indigo-300 font-bold focus:outline-none focus:bg-slate-900 rounded"
                        />
                      </td>

                      {/* Col D: Portal */}
                      <td 
                        className={`p-1 border-r border-white/10 ${activeCell?.rowId === row.id && activeCell?.colKey === "portal" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "portal", colName: "Portal", colLetter: "D" })}
                      >
                        <select
                          value={row.portal}
                          onChange={(e) => handleCellChange(row.id, "portal", e.target.value)}
                          className="w-full bg-transparent text-xs text-slate-200 px-1 py-1 focus:outline-none focus:bg-slate-900 rounded cursor-pointer"
                        >
                          <option value="Compras.gov.br" className="bg-slate-900">Compras.gov.br</option>
                          <option value="BLL Compras" className="bg-slate-900">BLL Compras</option>
                          <option value="Licitações-e" className="bg-slate-900">Licitações-e</option>
                          <option value="Bec SP" className="bg-slate-900">Bec SP</option>
                          <option value="PNCP" className="bg-slate-900">PNCP</option>
                        </select>
                      </td>

                      {/* Col E: Produto / Item */}
                      <td 
                        className={`p-1 border-r border-white/10 ${activeCell?.rowId === row.id && activeCell?.colKey === "produtoItem" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "produtoItem", colName: "Produto / Item", colLetter: "E" })}
                      >
                        <input
                          type="text"
                          value={row.produtoItem}
                          onChange={(e) => handleCellChange(row.id, "produtoItem", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-white focus:outline-none focus:bg-slate-900 rounded"
                        />
                      </td>

                      {/* Col F: Qtd */}
                      <td 
                        className={`p-1 border-r border-white/10 text-center ${activeCell?.rowId === row.id && activeCell?.colKey === "quantidade" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "quantidade", colName: "Quantidade", colLetter: "F" })}
                      >
                        <input
                          type="number"
                          value={row.quantidade}
                          onChange={(e) => handleCellChange(row.id, "quantidade", Number(e.target.value))}
                          className="w-full text-center bg-transparent px-1 py-1 text-xs text-slate-200 focus:outline-none focus:bg-slate-900 rounded"
                        />
                      </td>

                      {/* Col G: Und */}
                      <td 
                        className={`p-1 border-r border-white/10 text-center ${activeCell?.rowId === row.id && activeCell?.colKey === "unidadeMedida" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "unidadeMedida", colName: "Unidade", colLetter: "G" })}
                      >
                        <input
                          type="text"
                          value={row.unidadeMedida}
                          onChange={(e) => handleCellChange(row.id, "unidadeMedida", e.target.value)}
                          className="w-full text-center bg-transparent px-1 py-1 text-xs text-slate-300 focus:outline-none focus:bg-slate-900 rounded"
                        />
                      </td>

                      {/* Col H: Val. Estimado */}
                      <td 
                        className={`p-1 border-r border-white/10 text-right ${activeCell?.rowId === row.id && activeCell?.colKey === "valorEstimadoItem" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "valorEstimadoItem", colName: "Valor Estimado (R$)", colLetter: "H" })}
                      >
                        <input
                          type="number"
                          step="0.01"
                          value={row.valorEstimadoItem}
                          onChange={(e) => handleCellChange(row.id, "valorEstimadoItem", Number(e.target.value))}
                          className="w-full text-right bg-transparent px-2 py-1 text-xs text-slate-300 focus:outline-none focus:bg-slate-900 rounded font-mono"
                        />
                      </td>

                      {/* Col I: Nosso Alvo */}
                      <td 
                        className={`p-1 border-r border-white/10 text-right ${activeCell?.rowId === row.id && activeCell?.colKey === "nossoValorAlvo" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "nossoValorAlvo", colName: "Nosso Valor Alvo (R$)", colLetter: "I" })}
                      >
                        <input
                          type="number"
                          step="0.01"
                          value={row.nossoValorAlvo}
                          onChange={(e) => handleCellChange(row.id, "nossoValorAlvo", Number(e.target.value))}
                          className="w-full text-right bg-transparent px-2 py-1 text-xs text-indigo-300 font-bold focus:outline-none focus:bg-slate-900 rounded font-mono"
                        />
                      </td>

                      {/* Col J: Preço Piso */}
                      <td 
                        className={`p-1 border-r border-white/10 text-right ${activeCell?.rowId === row.id && activeCell?.colKey === "valorMinimoPiso" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "valorMinimoPiso", colName: "Preço Piso (R$)", colLetter: "J" })}
                      >
                        <input
                          type="number"
                          step="0.01"
                          value={row.valorMinimoPiso}
                          onChange={(e) => handleCellChange(row.id, "valorMinimoPiso", Number(e.target.value))}
                          className="w-full text-right bg-transparent px-2 py-1 text-xs text-slate-400 focus:outline-none focus:bg-slate-900 rounded font-mono"
                        />
                      </td>

                      {/* Col K: Data/Hora */}
                      <td 
                        className={`p-1 border-r border-white/10 ${activeCell?.rowId === row.id && activeCell?.colKey === "dataHoraDisputa" ? 'ring-2 ring-emerald-400 bg-emerald-950/30' : ''}`}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: "dataHoraDisputa", colName: "Data e Hora Disputa", colLetter: "K" })}
                      >
                        <input
                          type="text"
                          value={row.dataHoraDisputa}
                          onChange={(e) => handleCellChange(row.id, "dataHoraDisputa", e.target.value)}
                          className="w-full bg-transparent px-2 py-1 text-xs text-slate-300 focus:outline-none focus:bg-slate-900 rounded"
                        />
                      </td>

                      {/* Col L: Status */}
                      <td className="p-1 border-r border-white/10 text-center">
                        <select
                          value={row.status}
                          onChange={(e) => handleStatusChange(row.id, e.target.value as DisputaStatus)}
                          className={`text-[10.5px] font-bold px-2 py-0.5 rounded-lg border focus:outline-none cursor-pointer ${getStatusBadge(row.status)}`}
                        >
                          <option value="Agendada" className="bg-slate-900 text-blue-300">Agendada</option>
                          <option value="Em Disputa" className="bg-slate-900 text-amber-300">Em Disputa</option>
                          <option value="Vencida" className="bg-slate-900 text-emerald-300">Vencida</option>
                          <option value="Em Recurso" className="bg-slate-900 text-purple-300">Em Recurso</option>
                          <option value="Homologada" className="bg-slate-900 text-teal-300">Homologada</option>
                          <option value="Perdida" className="bg-slate-900 text-rose-300">Perdida</option>
                        </select>
                      </td>

                      {/* Actions */}
                      <td className="p-1 text-center">
                        <button
                          onClick={() => handleDeleteRow(row.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition cursor-pointer"
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
            <div className="bg-[#0c101e] px-4 py-2 border-t border-white/10 flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 gap-4">
              <div className="flex items-center gap-4">
                <span className="text-emerald-400 font-bold">∑ Fórmulas de Totais:</span>
                <span>Soma (H): <strong className="text-slate-200">{valorTotalEstimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></span>
                <span>Soma (I): <strong className="text-indigo-300">{valorNossoAlvo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-500">Linhas Totais: {filteredDisputas.length}</span>
                <button
                  onClick={handleAddBlankRow}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1 rounded text-[11px] transition cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Nova Linha</span>
                </button>
              </div>
            </div>

          </div>
        ) : (
          /* MODE 2: MODELO PAINEL / DASHBOARD VISUAL */
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                
                {/* Header */}
                <thead>
                  <tr className="border-b border-white/10 bg-[#0c101e] text-[10.5px] uppercase tracking-wider font-bold text-slate-400 select-none">
                    <th className="py-3.5 px-4 cursor-pointer hover:text-white transition" onClick={() => handleSort("status")}>
                      <div className="flex items-center gap-1">
                        <span>Status</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-500" />
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:text-white transition" onClick={() => handleSort("orgao")}>
                      <div className="flex items-center gap-1">
                        <span>Órgão Comprador</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-500" />
                      </div>
                    </th>
                    <th className="py-3.5 px-4">UASG / Und</th>
                    <th className="py-3.5 px-4">Nº Licitação</th>
                    <th className="py-3.5 px-4">Portal</th>
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
                <tbody className="divide-y divide-white/5 text-xs text-slate-200">
                  {filteredDisputas.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-slate-500">
                        <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                        <p className="font-bold text-sm text-slate-400">Nenhum registro encontrado</p>
                      </td>
                    </tr>
                  ) : (
                    filteredDisputas.map((row) => (
                      <tr key={row.id} className="hover:bg-indigo-500/5 transition-colors group">
                        
                        <td className="py-3 px-4">
                          <select
                            value={row.status}
                            onChange={(e) => handleStatusChange(row.id, e.target.value as DisputaStatus)}
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border focus:outline-none cursor-pointer transition ${getStatusBadge(row.status)}`}
                          >
                            <option value="Agendada" className="bg-slate-900 text-blue-300">Agendada</option>
                            <option value="Em Disputa" className="bg-slate-900 text-amber-300">Em Disputa</option>
                            <option value="Vencida" className="bg-slate-900 text-emerald-300">Vencida</option>
                            <option value="Em Recurso" className="bg-slate-900 text-purple-300">Em Recurso</option>
                            <option value="Homologada" className="bg-slate-900 text-teal-300">Homologada</option>
                            <option value="Perdida" className="bg-slate-900 text-rose-300">Perdida</option>
                          </select>
                        </td>

                        <td className="py-3 px-4 font-semibold text-white max-w-[180px] truncate" title={row.orgao}>
                          {row.orgao}
                        </td>

                        <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">
                          {row.uasgUndCompradora}
                        </td>

                        <td className="py-3 px-4 font-mono font-bold text-indigo-300 text-[11px]">
                          {row.numeroLicitacao}
                        </td>

                        <td className="py-3 px-4 text-slate-300 text-[11px]">
                          <span className="bg-slate-900 px-2 py-0.5 rounded border border-white/5 text-[10.5px]">
                            {row.portal}
                          </span>
                        </td>

                        <td className="py-3 px-4 max-w-[240px]">
                          <p className="line-clamp-2 text-slate-200 leading-snug">{row.produtoItem}</p>
                        </td>

                        <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-300">
                          {row.quantidade} <span className="text-[10px] text-slate-500">{row.unidadeMedida}</span>
                        </td>

                        <td className="py-3 px-4 text-right font-mono text-slate-300">
                          {row.valorEstimadoItem > 0 
                            ? row.valorEstimadoItem.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                            : "—"}
                        </td>

                        <td className="py-3 px-4 text-right font-mono font-bold text-indigo-300">
                          {row.nossoValorAlvo > 0 
                            ? row.nossoValorAlvo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                            : "—"}
                        </td>

                        <td className="py-3 px-4 text-right font-mono text-slate-400 text-[11px]">
                          {row.valorMinimoPiso > 0 
                            ? row.valorMinimoPiso.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                            : "—"}
                        </td>

                        <td className="py-3 px-4 font-mono text-slate-300 text-[11px] whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span>{row.dataHoraDisputa}</span>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5 opacity-80 group-hover:opacity-100 transition">
                            <button
                              onClick={() => handleOpenEditModal(row)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-indigo-300 transition cursor-pointer"
                              title="Editar linha"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteRow(row.id)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto">
          <div className="bg-[#0c101e] border border-indigo-500/30 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-slate-900/80 shrink-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
                <span>{editingRow ? "Editar Registro da Disputa" : "Cadastrar Nova Disputa na Planilha"}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 scrollbar-thin">
              
              {/* Top Auto-Fill Panel (History Pull OR Attachment Upload) */}
              {!editingRow && (
                <div className="bg-gradient-to-r from-indigo-950/60 to-slate-900 p-3.5 sm:p-4 rounded-xl border border-indigo-500/30 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse shrink-0" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Preenchimento Automatizado via IA
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    
                    {/* Option A: Puxar do Histórico de Editais Analisados */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-indigo-300 uppercase flex items-center gap-1">
                        <History className="w-3 h-3 shrink-0" />
                        <span>Puxar do Histórico Analisado</span>
                      </label>
                      <select
                        value={selectedHistoryId}
                        onChange={(e) => handleApplyHistoryEdital(e.target.value)}
                        className="w-full bg-slate-950 border border-indigo-500/30 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer truncate"
                      >
                        <option value="">-- Selecione do histórico --</option>
                        {historyOptions.map(opt => (
                          <option key={opt.id} value={opt.id} className="bg-slate-900">
                            {opt.title} ({opt.dateStr})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Option B: Upload de Anexo para Preencher Automático */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-emerald-300 uppercase flex items-center gap-1">
                        <Upload className="w-3 h-3 shrink-0" />
                        <span>Anexo / Edital (Preencher IA)</span>
                      </label>
                      <label className="flex items-center justify-center gap-2 w-full bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold py-2 px-3 rounded-xl cursor-pointer transition">
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
                    <div className="flex items-center gap-2 text-xs text-indigo-300 font-mono animate-pulse pt-1">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
                      <span>{extractStatusText}</span>
                    </div>
                  )}
                </div>
              )}

              <form id="disputa-form" onSubmit={handleSaveForm} className="space-y-4">
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  
                  {/* Órgão */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Órgão Comprador *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Tribunal Regional Federal da 3ª Região"
                      value={formData.orgao}
                      onChange={(e) => setFormData({ ...formData, orgao: e.target.value })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* UASG / Código Und */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">UASG / Código Unidade</label>
                    <input
                      type="text"
                      placeholder="Ex: 090012 - TRF3"
                      value={formData.uasgUndCompradora}
                      onChange={(e) => setFormData({ ...formData, uasgUndCompradora: e.target.value })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Nº Licitação */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Nº Licitação / Processo</label>
                    <input
                      type="text"
                      placeholder="Ex: Pregão Eletrônico 14/2026"
                      value={formData.numeroLicitacao}
                      onChange={(e) => setFormData({ ...formData, numeroLicitacao: e.target.value })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Portal */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Portal Eletrônico</label>
                    <select
                      value={formData.portal}
                      onChange={(e) => setFormData({ ...formData, portal: e.target.value })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="Compras.gov.br">Compras.gov.br</option>
                      <option value="BLL Compras">BLL Compras</option>
                      <option value="Licitações-e">Licitações-e (Banco do Brasil)</option>
                      <option value="Bec SP">Bec SP</option>
                      <option value="PNCP">PNCP - Portal Nacional</option>
                      <option value="Outro Portal">Outro Portal</option>
                    </select>
                  </div>

                </div>

                {/* Produto / Objeto */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Produto / Objeto *</label>
                  <textarea
                    required
                    rows={2}
                    placeholder="Descrição detalhada do item/produto cotado na disputa..."
                    value={formData.produtoItem}
                    onChange={(e) => setFormData({ ...formData, produtoItem: e.target.value })}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  
                  {/* Quantidade */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Quantidade</label>
                    <input
                      type="number"
                      min={1}
                      value={formData.quantidade}
                      onChange={(e) => setFormData({ ...formData, quantidade: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>

                  {/* Unidade Medida */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Unidade</label>
                    <input
                      type="text"
                      placeholder="Unidade, Caixa, Lote"
                      value={formData.unidadeMedida}
                      onChange={(e) => setFormData({ ...formData, unidadeMedida: e.target.value })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as DisputaStatus })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
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
                    <label className="text-[10px] uppercase font-bold text-slate-400">Valor Estimado (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.valorEstimadoItem || ""}
                      onChange={(e) => setFormData({ ...formData, valorEstimadoItem: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>

                  {/* Nosso Valor Alvo */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-indigo-300">Nosso Lance Alvo (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.nossoValorAlvo || ""}
                      onChange={(e) => setFormData({ ...formData, nossoValorAlvo: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-indigo-500/30 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Preço Mínimo Piso */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Preço Mínimo Piso (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.valorMinimoPiso || ""}
                      onChange={(e) => setFormData({ ...formData, valorMinimoPiso: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>

                </div>

                {/* Data e Hora */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Data e Hora da Disputa</label>
                  <input
                    type="text"
                    placeholder="Ex: 2026-08-15 09:30 ou 15/08/2026 09:30"
                    value={formData.dataHoraDisputa}
                    onChange={(e) => setFormData({ ...formData, dataHoraDisputa: e.target.value })}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                {/* Observações */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Observações & Estratégia de Lance</label>
                  <input
                    type="text"
                    placeholder="Anotações internas, concorrentes mapeados, margem esperada..."
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

              </form>

            </div>

            {/* Modal Footer (Always visible & fixed at bottom) */}
            <div className="p-4 border-t border-white/10 bg-[#0a0d18] shrink-0 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-xs hover:bg-white/5 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="disputa-form"
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2 rounded-xl text-xs transition cursor-pointer shadow-lg shadow-indigo-600/20"
              >
                Salvar na Planilha
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
