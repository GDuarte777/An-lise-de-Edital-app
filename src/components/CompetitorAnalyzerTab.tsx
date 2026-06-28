import { useState, useEffect } from "react";
import { 
  fetchCompetitorsFromSupabase,
  saveCompetitorToSupabase,
  deleteCompetitorFromSupabase
} from "../utils/supabaseClient";
import { 
  FileText, CheckCircle, AlertTriangle, Trash2, Loader2, Play, Sparkles, 
  Copy, Check, Scale, ShieldAlert, Users, Award, Download, ArrowRight, ClipboardPaste, Info, FileUp, ListTodo, History, Settings2, HelpCircle
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import confetti from "canvas-confetti";
import { CompetitorAnalysis, CompetitorHistoryItem, EditalAnalysis } from "../types";

interface CompetitorAnalyzerTabProps {
  activeEdital: EditalAnalysis | null;
}

export default function CompetitorAnalyzerTab({ activeEdital }: CompetitorAnalyzerTabProps) {
  // Configured inputs (with smart defaults)
  const [competitorName, setCompetitorName] = useState("");
  const [focusItems, setFocusItems] = useState("Análise Completa e Multidisciplinar (Técnica, Documental, Certidões, Prazo, Garantias, Assinaturas)");
  const [competitorDocumentText, setCompetitorDocumentText] = useState("");
  
  // Edital reference strategy
  // "history" (selected history), "custom" (pasted/uploaded edital)
  const [editalSource, setEditalSource] = useState<"history" | "custom">("history");
  const [selectedHistoryEditalId, setSelectedHistoryEditalId] = useState<string>("");
  const [customEditalText, setCustomEditalText] = useState("");
  const [customEditalFileDetails, setCustomEditalFileDetails] = useState<{ name: string; size: string } | null>(null);

  // File upload states for competitor (allows multiple files)
  const [competitorFiles, setCompetitorFiles] = useState<Array<{ name: string; size: string; type: string; base64: string }>>([]);

  // App UI states
  const [loading, setLoading] = useState(false);
  const [activeAnalysis, setActiveAnalysis] = useState<CompetitorAnalysis | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"report" | "irregularities" | "appeal">("report");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Local Edital history for dropdown
  const [editalHistory, setEditalHistory] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem("aip_edital_history");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Competitor audit history (Supabase with Local fallback)
  const [competitorHistory, setCompetitorHistory] = useState<CompetitorHistoryItem[]>([]);

  useEffect(() => {
    async function loadCompetitorHistory() {
      try {
        const dbComps = await fetchCompetitorsFromSupabase();
        if (dbComps && dbComps.length > 0) {
          setCompetitorHistory(dbComps);
          return;
        }
      } catch (e) {
        console.warn("Falha ao buscar concorrentes do Supabase:", e);
      }

      try {
        const saved = localStorage.getItem("aip_competitors_history");
        if (saved) {
          setCompetitorHistory(JSON.parse(saved));
        }
      } catch (e) {
        setCompetitorHistory([]);
      }
    }
    loadCompetitorHistory();
  }, []);

  // Initialize correct source based on editalHistory availability
  useEffect(() => {
    if (editalHistory.length > 0) {
      setEditalSource("history");
      setSelectedHistoryEditalId(editalHistory[0].id);
    } else {
      setEditalSource("custom");
    }
  }, [editalHistory]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      if (file.type === "text/plain") {
        reader.onload = (event) => {
          const textContent = event.target?.result as string;
          // Se for texto plano, colocamos tanto no texto livre quanto adicionamos a lista
          setCompetitorDocumentText(prev => prev ? `${prev}\n\n[Arquivo: ${file.name}]\n${textContent}` : `[Arquivo: ${file.name}]\n${textContent}`);
          
          const base64String = btoa(unescape(encodeURIComponent(textContent)));
          const newFile = {
            name: file.name,
            size: `${(file.size / 1024).toFixed(1)} KB`,
            type: "text/plain",
            base64: base64String
          };
          setCompetitorFiles(prev => {
            if (prev.some(f => f.name === file.name)) return prev;
            return [...prev, newFile];
          });
        };
        reader.readAsText(file);
      } else {
        reader.onload = (event) => {
          const base64String = (event.target?.result as string).split(",")[1];
          const newFile = {
            name: file.name,
            size: `${(file.size / 1024).toFixed(1)} KB`,
            type: file.type || "application/octet-stream",
            base64: base64String
          };
          setCompetitorFiles(prev => {
            if (prev.some(f => f.name === file.name)) return prev;
            return [...prev, newFile];
          });
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const handleRemoveFile = (index: number) => {
    setCompetitorFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCustomEditalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCustomEditalFileDetails({
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`
    });

    const reader = new FileReader();
    reader.onload = (event) => {
      setCustomEditalText(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  // Run audit through API
  const handleRunAudit = async () => {
    // 1. Determine edital content
    let editalTextToAnalyze = "";
    let editalTitle = "Inserção Direta";

    if (editalSource === "history") {
      const found = editalHistory.find(h => h.id === selectedHistoryEditalId);
      if (found) {
        editalTextToAnalyze = found.analysis.rawText || JSON.stringify(found.analysis);
        editalTitle = found.title;
      } else {
        alert("Por favor, selecione um edital do histórico.");
        return;
      }
    } else {
      if (!customEditalText.trim()) {
        alert("Por favor, cole as exigências do edital ou faça upload do Termo de Referência.");
        return;
      }
      editalTextToAnalyze = customEditalText;
      editalTitle = customEditalFileDetails?.name ? `PDF: ${customEditalFileDetails.name}` : "Edital Customizado";
    }

    // Validation
    if (!competitorDocumentText && competitorFiles.length === 0) {
      alert("Por favor, anexe a documentação do concorrente ou cole o texto comercial.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/analyze-competitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorName: competitorName, // Can be empty, AI extracts it
          competitorDocumentText,
          files: competitorFiles,
          editalText: editalTextToAnalyze,
          focusItems
        })
      });

      if (!response.ok) {
        throw new Error("Erro de comunicação com o servidor.");
      }

      const data = await response.json();
      if (data.analysis) {
        const analysisResult: CompetitorAnalysis = data.analysis;
        
        // Dynamically update competitor name state with the extracted one
        const detectedName = analysisResult.competitorName || competitorName || "Concorrente Identificado";
        setCompetitorName(detectedName);

        setActiveAnalysis(analysisResult);
        confetti({ particleCount: 150, spread: 90, origin: { y: 0.85 } });

        // Save to History (Supabase & Local)
        const newHistoryItem: CompetitorHistoryItem = {
          id: Date.now().toString(),
          competitorName: detectedName,
          focusItems,
          date: new Date().toLocaleString("pt-BR"),
          editalTitle,
          analysis: analysisResult
        };

        saveCompetitorToSupabase(newHistoryItem).catch((e) => console.warn("Erro ao salvar concorrente no Supabase:", e));

        setCompetitorHistory(prev => {
          const updated = [newHistoryItem, ...prev];
          localStorage.setItem("aip_competitors_history", JSON.stringify(updated));
          return updated;
        });
      } else {
        alert("Erro ao receber análise estruturada.");
      }
    } catch (e) {
      console.error(e);
      alert("Falha na auditoria automática. Utilizando simulação local inteligente...");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyAppeal = () => {
    if (!activeAnalysis) return;
    navigator.clipboard.writeText(activeAnalysis.modeloRecurso);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadAppeal = () => {
    if (!activeAnalysis) return;
    const element = document.createElement("a");
    const file = new Blob([activeAnalysis.modeloRecurso], { type: 'text/markdown' });
    element.href = URL.createObjectURL(file);
    element.download = `Recurso_${competitorName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleLoadFromHistory = (item: CompetitorHistoryItem) => {
    setCompetitorName(item.competitorName);
    setFocusItems(item.focusItems);
    setActiveAnalysis(item.analysis);
    setActiveSubTab("report");
  };

  const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Tem certeza que deseja excluir esta auditoria do histórico?")) {
      deleteCompetitorFromSupabase(id).catch((err) => console.warn("Erro ao deletar concorrente do Supabase:", err));
      const updated = competitorHistory.filter(h => h.id !== id);
      setCompetitorHistory(updated);
      localStorage.setItem("aip_competitors_history", JSON.stringify(updated));
      if (activeAnalysis && competitorHistory.find(h => h.id === id)?.analysis === activeAnalysis) {
        setActiveAnalysis(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Banner de Operação Simplificada */}
      <div className="bg-slate-900/40 rounded-2xl p-6 border border-white/10 flex flex-col justify-between gap-6 shadow-xl relative overflow-hidden">
        <div className="space-y-1.5 relative z-10">
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full uppercase tracking-wider border border-emerald-500/20">
            Inteligência Artificial Autônoma
          </span>
          <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-400" />
            Auditoria Sem Esforço de Concorrentes
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Esqueça formulários longos. Apenas selecione ou envie o Edital, suba os arquivos do concorrente e deixe a nossa IA extrair nomes, marcas, prazos e furos jurídicos sozinha!
          </p>
        </div>
      </div>

      {/* Main Orchestration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Simplified Drag & Drop Panel */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-950/60 border border-white/10 rounded-2xl p-5 space-y-5 shadow-lg backdrop-blur-sm">
            
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Scale className="w-4 h-4 text-indigo-400" />
                Configuração Direta
              </h3>
              <span className="text-[10px] text-indigo-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> 100% Automatizado
              </span>
            </div>

            {/* Passo 1: Edital Regras do Jogo */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                Passo 1: Referência do Edital (Exigências)
              </label>

              {/* Selector Pills */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 rounded-xl border border-white/5 text-[10px] font-semibold text-slate-400">
                <button
                  type="button"
                  onClick={() => setEditalSource("history")}
                  disabled={editalHistory.length === 0}
                  className={`py-1.5 rounded-lg text-center transition-all cursor-pointer ${
                    editalSource === "history" 
                      ? "bg-slate-800 text-white border border-white/5" 
                      : editalHistory.length === 0 
                        ? "opacity-40 cursor-not-allowed" 
                        : "hover:text-slate-200"
                  }`}
                >
                  Do Histórico
                </button>
                <button
                  type="button"
                  onClick={() => setEditalSource("custom")}
                  className={`py-1.5 rounded-lg text-center transition-all cursor-pointer ${
                    editalSource === "custom" 
                      ? "bg-slate-800 text-white border border-white/5" 
                      : "hover:text-slate-200"
                  }`}
                >
                  Novo Edital
                </button>
              </div>

              {editalSource === "history" && editalHistory.length > 0 && (
                <div className="space-y-2">
                  <select
                    value={selectedHistoryEditalId}
                    onChange={(e) => setSelectedHistoryEditalId(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    {editalHistory.map((h: any) => (
                      <option key={h.id} value={h.id}>
                        {h.title} ({h.date})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {editalSource === "custom" && (
                <div className="space-y-2">
                  <div className="border border-dashed border-white/10 rounded-xl p-2.5 bg-slate-900/30 hover:bg-slate-900/50 transition-colors text-center cursor-pointer relative">
                    <input
                      type="file"
                      accept=".txt,.pdf"
                      onChange={handleCustomEditalFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-300">
                      <FileUp className="w-4 h-4 text-indigo-400" />
                      <span>{customEditalFileDetails ? `Selecionado: ${customEditalFileDetails.name}` : "Carregar PDF ou TXT do Edital"}</span>
                    </div>
                  </div>
                  <textarea
                    value={customEditalText}
                    onChange={(e) => setCustomEditalText(e.target.value)}
                    placeholder="Cole aqui o texto do Termo de Referência ou exigências do Edital..."
                    rows={4}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                  />
                </div>
              )}
            </div>

            {/* Passo 2: Documentação do Concorrente */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                Passo 2: Enviar Documentação do Concorrente
              </label>

              {/* Drag and Drop premium dropzone */}
              <div className="border-2 border-dashed border-indigo-500/20 hover:border-indigo-500/40 rounded-xl p-5 bg-indigo-950/5 hover:bg-indigo-950/10 transition-all text-center cursor-pointer relative group">
                <input
                  type="file"
                  multiple
                  accept=".txt,.pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 group-hover:bg-indigo-500/15 flex items-center justify-center text-indigo-400 transition-colors">
                    <FileUp className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-slate-200">
                      {competitorFiles.length > 0 
                        ? `${competitorFiles.length} Arquivos Adicionados` 
                        : "Carregar Documentos do Concorrente (Proposta, Catálogo, Certidões)"}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Suporta múltiplos arquivos PDF, TXT, Imagens. Clique ou arraste.
                    </p>
                  </div>
                </div>
              </div>

              {/* Lista de arquivos carregados do concorrente */}
              {competitorFiles.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto bg-slate-900/50 p-2.5 rounded-xl border border-white/5 scrollbar-thin">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Arquivos Adicionados ({competitorFiles.length}):
                  </p>
                  <div className="space-y-1">
                    {competitorFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-950/60 border border-white/5 px-2.5 py-1.5 rounded-lg text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="text-slate-200 truncate font-medium max-w-[180px]" title={file.name}>
                            {file.name}
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono shrink-0">
                            ({file.size})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(idx)}
                          className="text-slate-500 hover:text-rose-400 p-0.5 rounded hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0 ml-2"
                          title="Remover arquivo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Text fallback area for convenience */}
              <div className="relative">
                <textarea
                  value={competitorDocumentText}
                  onChange={(e) => setCompetitorDocumentText(e.target.value)}
                  placeholder="Ou cole o texto copiado da proposta, chat do pregão ou memorial descritivo..."
                  rows={6}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setCompetitorDocumentText(text);
                    } catch (err) {
                      console.error("Incapaz de ler da área de transferência", err);
                    }
                  }}
                  className="absolute bottom-3 right-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/15 px-2.5 py-1.5 rounded-lg text-[10px] cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Colar Proposta
                </button>
              </div>
            </div>

            {/* Collapsible Advanced Options */}
            <div className="border-t border-white/5 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[11px] font-semibold text-slate-400 hover:text-white flex items-center gap-1.5 select-none"
              >
                <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
                {showAdvanced ? "Ocultar Parâmetros Avançados" : "Mostrar Parâmetros Avançados"}
              </button>

              {showAdvanced && (
                <div className="space-y-3 pt-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-300 block">Identificar Nome do Concorrente (Opcional - Senão a IA extrai)</label>
                    <input
                      type="text"
                      value={competitorName}
                      onChange={(e) => setCompetitorName(e.target.value)}
                      placeholder="Ex: Alfa Comércio Ltda"
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-300 block">Foco da Auditoria (Opcional)</label>
                    <input
                      type="text"
                      value={focusItems}
                      onChange={(e) => setFocusItems(e.target.value)}
                      placeholder="Análise Geral ou especificar ex: Certidões, Wi-Fi, etc."
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Trigger Button */}
            <button
              type="button"
              disabled={loading}
              onClick={handleRunAudit}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-slate-850 disabled:to-slate-850 disabled:text-slate-500 text-white font-bold text-xs py-3 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 border border-white/10"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Extraindo Dados e Auditando com IA...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 text-emerald-400" />
                  <span>Iniciar Auditoria Automática</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Side: Results Display */}
        <div className="lg:col-span-7 space-y-6">
          
          {activeAnalysis ? (
            <div className="bg-slate-950/60 border border-white/10 rounded-2xl p-5 shadow-lg space-y-5 backdrop-blur-sm flex flex-col min-h-[580px]">
              
              {/* Header Analysis Results */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">
                      Resultado da Auditoria: {competitorName || "Concorrente Identificado"}
                    </h3>
                  </div>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-indigo-400" />
                    Auditoria Completa 360° realizada com Sucesso
                  </p>
                </div>

                {/* Compliance Flag Badge */}
                {activeAnalysis.isCompliant ? (
                  <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5 shadow-md">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    COMPLIANTE (Edital Atendido)
                  </span>
                ) : (
                  <span className="bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5 shadow-md">
                    <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                    FALHAS DETECTADAS (Risco de Desclassificação)
                  </span>
                )}
              </div>

              {/* Sub-tabs Selection within results */}
              <div className="bg-slate-900/60 p-1 border border-white/5 rounded-xl flex gap-1 select-none text-xs">
                <button
                  type="button"
                  onClick={() => setActiveSubTab("report")}
                  className={`flex-1 py-2 text-center rounded-lg font-bold transition-all cursor-pointer ${
                    activeSubTab === "report" ? "bg-slate-800 text-white border border-white/5" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Relatório Legal
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("irregularities")}
                  className={`flex-1 py-2 text-center rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeSubTab === "irregularities" ? "bg-slate-800 text-white border border-white/5" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Furos Encontrados
                  <span className="bg-rose-500/25 border border-rose-500/40 text-rose-300 text-[10px] font-mono px-1.5 py-0.2 rounded-md">
                    {activeAnalysis.irregularidadesEncontradas?.length || 0}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("appeal")}
                  className={`flex-1 py-2 text-center rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    activeSubTab === "appeal" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Minuta do Recurso
                  <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                </button>
              </div>

              {/* Sub-tabs contents */}
              <div className="flex-1 overflow-y-auto max-h-[460px] pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                
                {/* 1. Markdown Audit Report */}
                {activeSubTab === "report" && (
                  <div className="bg-slate-900/30 border border-white/5 rounded-xl p-4.5 text-xs text-slate-300 space-y-4 leading-relaxed">
                    <ReactMarkdown>{activeAnalysis.analiseEstiloMarkdown}</ReactMarkdown>
                    
                    {/* Strengths Section */}
                    {activeAnalysis.pontosFortesConcorrente?.length > 0 && (
                      <div className="border-t border-white/5 pt-4 mt-4 space-y-2">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">
                          Pontos Corretos de Conformidade do Concorrente:
                        </span>
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {activeAnalysis.pontosFortesConcorrente.map((pt, idx) => (
                            <li key={idx} className="bg-emerald-950/20 border border-emerald-500/10 p-2 rounded-lg text-slate-300 flex items-start gap-1.5 text-[11px]">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              <span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Irregularities list mapping cards */}
                {activeSubTab === "irregularities" && (
                  <div className="space-y-4">
                    {!activeAnalysis.irregularidadesEncontradas || activeAnalysis.irregularidadesEncontradas.length === 0 ? (
                      <div className="bg-slate-900/30 border border-white/5 p-8 rounded-xl text-center space-y-2">
                        <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
                        <h4 className="font-bold text-white text-xs">Nenhuma Irregularidade Mapeada</h4>
                        <p className="text-[10px] text-slate-400 max-w-md mx-auto">
                          A proposta analisada atende rigorosamente a todos os critérios e padrões especificados para a amostragem de dados deste foco.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex items-start gap-2.5 text-[11px] text-rose-300">
                          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                          <p>
                            Abaixo estão listadas as brechas identificadas. As de gravidade <strong>ALTA</strong> impedem a habilitação técnica ou jurídica e servem como fundamento legal para o pregoeiro desclassificar a empresa concorrente.
                          </p>
                        </div>

                        {activeAnalysis.irregularidadesEncontradas.map((irreg, idx) => (
                          <div key={idx} className="bg-slate-900/50 border border-white/10 rounded-xl p-4 space-y-3 hover:border-indigo-500/25 transition-all">
                            <div className="flex items-center justify-between border-b border-white/5 pb-2">
                              <span className="text-[10px] font-mono text-slate-400">Brecha #{idx + 1}</span>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                irreg.gravidade === "ALTA" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" :
                                irreg.gravidade === "MÉDIA" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                                "bg-slate-800 text-slate-300 border border-white/10"
                              }`}>
                                Gravidade: {irreg.gravidade}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                              <div className="bg-slate-950/40 p-2.5 rounded-lg space-y-1">
                                <span className="text-[10px] font-bold text-indigo-300 block">O que o Edital Exige:</span>
                                <p className="text-slate-300 leading-normal">{irreg.campoExigido}</p>
                              </div>
                              <div className="bg-slate-950/40 p-2.5 rounded-lg space-y-1">
                                <span className="text-[10px] font-bold text-rose-300 block">O que o Concorrente Entregou:</span>
                                <p className="text-slate-300 leading-normal">{irreg.propostaConcorrente}</p>
                              </div>
                            </div>

                            <div className="bg-indigo-950/20 border border-indigo-500/15 p-3 rounded-lg space-y-1 text-[11px]">
                              <span className="text-[10px] font-bold text-indigo-400 block">Fundamento Legal / Base Jurídica:</span>
                              <p className="text-slate-200 font-mono text-[10px] leading-relaxed">{irreg.baseLegal}</p>
                            </div>

                            <div className="bg-slate-950/50 p-2.5 rounded-lg text-[11px] border border-white/5">
                              <span className="text-[10px] font-bold text-slate-400 block">Impacto Prático (Como Recorrer):</span>
                              <p className="text-slate-300 leading-normal">{irreg.impacto}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Draft Appeal Recurso Administrativo */}
                {activeSubTab === "appeal" && (
                  <div className="space-y-4">
                    <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 flex items-start gap-2.5 text-[11px] text-indigo-300">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>
                        A minuta abaixo foi estruturada de acordo com os requisitos formais de petições e recursos do direito administrativo brasileiro, citando as infrações cometidas. Ajuste os colchetes com os dados de sua empresa.
                      </p>
                    </div>

                    <div className="relative bg-slate-950/80 border border-white/10 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto select-text whitespace-pre-wrap max-h-[350px]">
                      {activeAnalysis.modeloRecurso}
                    </div>

                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={handleCopyAppeal}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-colors flex items-center justify-center gap-2"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-300" />
                            <span>Copiado com Sucesso!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 text-white" />
                            <span>Copiar Minuta de Recurso</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadAppeal}
                        className="bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-300 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer transition-colors flex items-center gap-2"
                        title="Baixar como arquivo Markdown .md"
                      >
                        <Download className="w-4 h-4 text-slate-400" />
                        <span>Baixar .MD</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="bg-slate-950/40 border border-white/10 rounded-2xl p-8 shadow-lg text-center space-y-4 flex flex-col justify-center items-center min-h-[580px]">
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
                <Scale className="w-8 h-8 animate-pulse" />
              </div>
              <div className="space-y-1 max-w-md">
                <h4 className="font-bold text-white text-sm">Pronto para Analisar</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Basta selecionar o edital de referência ou fazer upload das regras no "Passo 1" e anexar os documentos do concorrente no "Passo 2".
                </p>
                <p className="text-[11px] text-indigo-400 font-semibold pt-1">
                  A Inteligência Artificial extrairá automaticamente o nome do concorrente, as marcas/especificações e as brechas legais de desclassificação.
                </p>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Historical Competitor Audits */}
      {competitorHistory.length > 0 && (
        <div className="bg-slate-950/60 border border-white/10 rounded-2xl p-5 shadow-lg space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            Histórico de Auditoria de Concorrentes
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {competitorHistory.map((item) => (
              <div
                key={item.id}
                onClick={() => handleLoadFromHistory(item)}
                className="bg-slate-900/50 hover:bg-slate-900 border border-white/5 hover:border-indigo-500/30 p-3.5 rounded-xl cursor-pointer transition-all flex flex-col justify-between gap-3 group"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-indigo-400 font-mono">{item.date}</span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteHistory(item.id, e)}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-colors"
                      title="Excluir auditoria"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <h4 className="font-bold text-white text-xs truncate group-hover:text-indigo-300 transition-colors">
                    {item.competitorName || "Concorrente Oculto"}
                  </h4>
                  <p className="text-[10px] text-slate-400 line-clamp-1">
                    Foco: {item.focusItems ? item.focusItems.slice(0, 35) + "..." : "Análise Geral"}
                  </p>
                  <p className="text-[10px] text-slate-500 flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {item.editalTitle || "Edital Associado"}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded font-mono ${
                    item.analysis.isCompliant ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                  }`}>
                    {item.analysis.isCompliant ? "COMPLIANTE" : "INCOMPATIVEL"}
                  </span>
                  <span className="text-[10px] font-bold text-indigo-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    Visualizar
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
