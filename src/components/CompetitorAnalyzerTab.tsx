import { useState, useEffect } from "react";
import { 
  fetchCompetitorsFromSupabase,
  saveCompetitorToSupabase,
  deleteCompetitorFromSupabase,
  subscribeToSupabaseTable
} from "../utils/supabaseClient";
import { 
  FileText, CheckCircle, AlertTriangle, Trash2, Loader2, Play, Sparkles, 
  Copy, Check, Scale, ShieldAlert, Users, Award, Download, ArrowRight, ClipboardPaste, Info, FileUp, ListTodo, History, Settings2, HelpCircle
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import confetti from "canvas-confetti";
import { getActiveAiConfig, apiFetch, prepareAttachmentsForServer, validateApiKeyFormat, formatAiError } from "../utils/aiClientHelper";
import { CompetitorAnalysis, CompetitorHistoryItem, EditalAnalysis } from "../types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";

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
  const [fileSizeErrorModal, setFileSizeErrorModal] = useState<{ show: boolean; fileName: string; fileSizeMb: string } | null>(null);

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

  useEffect(() => {
    const syncEditalHistory = () => {
      try {
        const saved = localStorage.getItem("aip_edital_history");
        if (saved) {
          setEditalHistory(JSON.parse(saved));
        }
      } catch (e) {}
    };
    window.addEventListener("aip_edital_history_updated", syncEditalHistory);
    window.addEventListener("storage", syncEditalHistory);
    return () => {
      window.removeEventListener("aip_edital_history_updated", syncEditalHistory);
      window.removeEventListener("storage", syncEditalHistory);
    };
  }, []);

  // Competitor audit history (Supabase with Local fallback)
  const [competitorHistory, setCompetitorHistory] = useState<CompetitorHistoryItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

    const unsubscribe = subscribeToSupabaseTable("historico_concorrentes", () => {
      loadCompetitorHistory();
    });

    const handleFocus = () => loadCompetitorHistory();
    window.addEventListener("focus", handleFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
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

  const maxSizeBytes = 60 * 1024 * 1024; // 60 MB

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      if (file.size > maxSizeBytes) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        setFileSizeErrorModal({ show: true, fileName: file.name, fileSizeMb: sizeMb });
        return;
      }

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
    e.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setCompetitorFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCustomEditalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxSizeBytes) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setFileSizeErrorModal({ show: true, fileName: file.name, fileSizeMb: sizeMb });
      e.target.value = "";
      return;
    }

    setCustomEditalFileDetails({
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`
    });

    const reader = new FileReader();
    reader.onload = (event) => {
      setCustomEditalText(event.target?.result as string);
    };
    reader.readAsText(file);
    e.target.value = "";
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

    // Validate API key before sending
    const aiConfig = getActiveAiConfig();
    const keyError = validateApiKeyFormat(aiConfig.apiKey, aiConfig.provider);
    if (keyError) { alert(keyError); return; }

    setLoading(true);
    // 60s timeout
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 60_000);
    try {
      const preparedFiles = await prepareAttachmentsForServer(competitorFiles);

      const response = await apiFetch("/api/analyze-competitor", {
        method: "POST",
        signal: abortCtrl.signal,
        body: {
          competitorName: competitorName,
          competitorDocumentText,
          files: preparedFiles,
          editalText: editalTextToAnalyze,
          focusItems
        }
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
        alert("A IA não retornou dados estruturados. Tente novamente.");
      }
    } catch (e: any) {
      console.error(e);
      if (e?.name === "AbortError" || e?.message?.includes("aborted")) {
        alert("⏱️ Análise excedeu 60 segundos. Tente novamente.");
      } else {
        alert(formatAiError(e));
      }
    } finally {
      clearTimeout(timeoutId);
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
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => {
        setDeletingId(prev => prev === id ? null : prev);
      }, 4000);
      return;
    }

    deleteCompetitorFromSupabase(id).catch((err) => console.warn("Erro ao deletar concorrente do Supabase:", err));
    const updated = competitorHistory.filter(h => h.id !== id);
    setCompetitorHistory(updated);
    localStorage.setItem("aip_competitors_history", JSON.stringify(updated));
    if (activeAnalysis && competitorHistory.find(h => h.id === id)?.analysis === activeAnalysis) {
      setActiveAnalysis(null);
    }
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">

      {/* Banner de Operação Simplificada */}
      <Card className="rounded-2xl p-6 justify-between shadow-xs relative overflow-hidden">
        <div className="space-y-1.5 relative z-10">
          <Badge variant="outline" className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full uppercase tracking-wider border-primary/20 font-mono">
            Inteligência Artificial Autônoma
          </Badge>
          <h2 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Auditoria Sem Esforço de Concorrentes
          </h2>
          <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
            Esqueça formulários longos. Apenas selecione ou envie o Edital, suba os arquivos do concorrente e deixe a nossa IA extrair nomes, marcas, prazos e furos jurídicos sozinha!
          </p>
        </div>
      </Card>

      {/* Main Orchestration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Simplified Drag & Drop Panel */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="rounded-2xl p-5 gap-5 shadow-xs">

            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" />
                Configuração Direta
              </h3>
              <span className="text-[10px] text-primary flex items-center gap-1 font-semibold">
                <Check className="w-3.5 h-3.5" /> 100% Automatizado
              </span>
            </div>

            {/* Passo 1: Edital Regras do Jogo */}
            <div className="space-y-3">
              <Label className="text-[11px] font-bold text-foreground uppercase tracking-wider block font-mono">
                Passo 1: Referência do Edital (Exigências)
              </Label>

              {/* Selector Pills */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted rounded-xl border text-[10px] font-semibold text-muted-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditalSource("history")}
                  disabled={editalHistory.length === 0}
                  className={`h-auto py-1.5 rounded-lg text-center text-[10px] font-semibold transition-all cursor-pointer ${
                    editalSource === "history"
                      ? "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
                      : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                  }`}
                >
                  Do Histórico
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditalSource("custom")}
                  className={`h-auto py-1.5 rounded-lg text-center text-[10px] font-semibold transition-all cursor-pointer ${
                    editalSource === "custom"
                      ? "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
                      : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                  }`}
                >
                  Novo Edital
                </Button>
              </div>

              {editalSource === "history" && editalHistory.length > 0 && (
                <div className="space-y-2">
                  <Select value={selectedHistoryEditalId} onValueChange={setSelectedHistoryEditalId}>
                    <SelectTrigger className="w-full text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editalHistory.map((h: any) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.title} ({h.date})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {editalSource === "custom" && (
                <div className="space-y-2">
                  <div className="border border-dashed rounded-xl p-2.5 bg-muted hover:bg-accent transition-colors text-center cursor-pointer relative">
                    <input
                      type="file"
                      accept=".txt,.pdf"
                      onChange={handleCustomEditalFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center justify-center gap-1.5 text-[10px] text-foreground">
                      <FileUp className="w-4 h-4 text-primary" />
                      <span>{customEditalFileDetails ? `Selecionado: ${customEditalFileDetails.name}` : "Carregar PDF ou TXT do Edital"}</span>
                    </div>
                  </div>
                  <Textarea
                    value={customEditalText}
                    onChange={(e) => setCustomEditalText(e.target.value)}
                    placeholder="Cole aqui o texto do Termo de Referência ou exigências do Edital..."
                    rows={4}
                    className="w-full text-[11px] p-3 font-mono"
                  />
                </div>
              )}
            </div>

            {/* Passo 2: Documentação do Concorrente */}
            <div className="space-y-3">
              <Label className="text-[11px] font-bold text-foreground uppercase tracking-wider block font-mono">
                Passo 2: Enviar Documentação do Concorrente
              </Label>

              {/* Drag and Drop premium dropzone */}
              <div className="border-2 border-dashed border-primary/30 hover:border-primary/60 rounded-xl p-5 bg-primary/5 hover:bg-primary/10 transition-all text-center cursor-pointer relative group">
                <input
                  type="file"
                  multiple
                  accept=".txt,.pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center text-primary transition-colors">
                    <FileUp className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-foreground">
                      {competitorFiles.length > 0
                        ? `${competitorFiles.length} Arquivos Adicionados`
                        : "Carregar Documentos do Concorrente (Proposta, Catálogo, Certidões)"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Suporta múltiplos arquivos PDF, TXT, Imagens. Clique ou arraste.
                    </p>
                  </div>
                </div>
              </div>

              {/* Lista de arquivos carregados do concorrente */}
              {competitorFiles.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto bg-muted p-2.5 rounded-xl border scrollbar-thin">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider font-mono">
                    Arquivos Adicionados ({competitorFiles.length}):
                  </p>
                  <div className="space-y-1">
                    {competitorFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-card border px-2.5 py-1.5 rounded-lg text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="text-foreground truncate font-medium max-w-[180px]" title={file.name}>
                            {file.name}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                            ({file.size})
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveFile(idx)}
                          className="text-muted-foreground hover:text-destructive p-0.5 h-auto w-auto rounded hover:bg-destructive/10 transition-colors cursor-pointer shrink-0 ml-2"
                          title="Remover arquivo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Text fallback area for convenience */}
              <div className="relative">
                <Textarea
                  value={competitorDocumentText}
                  onChange={(e) => setCompetitorDocumentText(e.target.value)}
                  placeholder="Ou cole o texto copiado da proposta, chat do pregão ou memorial descritivo..."
                  rows={6}
                  className="w-full text-[11px] p-3 font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setCompetitorDocumentText(text);
                    } catch (err) {
                      console.error("Incapaz de ler da área de transferência", err);
                    }
                  }}
                  className="absolute bottom-3 right-3 h-auto px-2.5 py-1.5 rounded-lg text-[10px] cursor-pointer flex items-center gap-1.5 font-semibold"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Colar Proposta
                </Button>
              </div>
            </div>

            {/* Collapsible Advanced Options */}
            <div className="border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="h-auto p-0 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-transparent flex items-center gap-1.5 select-none"
              >
                <Settings2 className="w-3.5 h-3.5 text-primary" />
                {showAdvanced ? "Ocultar Parâmetros Avançados" : "Mostrar Parâmetros Avançados"}
              </Button>

              {showAdvanced && (
                <div className="space-y-3 pt-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-foreground block font-semibold">Identificar Nome do Concorrente (Opcional - Senão a IA extrai)</Label>
                    <Input
                      type="text"
                      value={competitorName}
                      onChange={(e) => setCompetitorName(e.target.value)}
                      placeholder="Ex: Alfa Comércio Ltda"
                      className="w-full text-[11px] px-3 py-2 h-auto"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-foreground block font-semibold">Foco da Auditoria (Opcional)</Label>
                    <Input
                      type="text"
                      value={focusItems}
                      onChange={(e) => setFocusItems(e.target.value)}
                      placeholder="Análise Geral ou especificar ex: Certidões, Wi-Fi, etc."
                      className="w-full text-[11px] px-3 py-2 h-auto"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Trigger Button */}
            <Button
              type="button"
              disabled={loading}
              onClick={handleRunAudit}
              className="w-full font-bold text-xs py-3 h-auto rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Extraindo Dados e Auditando com IA...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Iniciar Auditoria Automática</span>
                </>
              )}
            </Button>
          </Card>
        </div>

        {/* Right Side: Results Display */}
        <div className="lg:col-span-7 space-y-6">
          
          {activeAnalysis ? (
            <Card className="rounded-2xl p-5 shadow-xs gap-5 min-h-[580px]">

              {/* Header Analysis Results */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">
                      Resultado da Auditoria: {competitorName || "Concorrente Identificado"}
                    </h3>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 font-semibold">
                    <Award className="w-3.5 h-3.5 text-primary" />
                    Auditoria Completa 360° realizada com Sucesso
                  </p>
                </div>

                {/* Compliance Flag Badge */}
                {activeAnalysis.isCompliant ? (
                  <Badge variant="success" className="text-xs px-3 py-1.5 rounded-full font-bold gap-1.5 shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-success-foreground animate-pulse" />
                    COMPLIANTE (Edital Atendido)
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-xs px-3 py-1.5 rounded-full font-bold gap-1.5 shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-destructive-foreground animate-ping" />
                    FALHAS DETECTADAS (Risco de Desclassificação)
                  </Badge>
                )}
              </div>

              {/* Sub-tabs Selection within results */}
              <div className="bg-muted p-1 border rounded-xl flex gap-1 select-none text-xs">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveSubTab("report")}
                  className={`flex-1 h-auto py-2 rounded-lg font-bold transition-all cursor-pointer ${
                    activeSubTab === "report" ? "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90" : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                  }`}
                >
                  Relatório Legal
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveSubTab("irregularities")}
                  className={`flex-1 h-auto py-2 rounded-lg font-bold transition-all cursor-pointer gap-1.5 ${
                    activeSubTab === "irregularities" ? "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90" : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                  }`}
                >
                  Furos Encontrados
                  <Badge variant="destructive" className="text-[10px] font-mono px-1.5 py-0.2 rounded-md">
                    {activeAnalysis.irregularidadesEncontradas?.length || 0}
                  </Badge>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveSubTab("appeal")}
                  className={`flex-1 h-auto py-2 rounded-lg font-bold transition-all cursor-pointer gap-1 ${
                    activeSubTab === "appeal" ? "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90" : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                  }`}
                >
                  Minuta do Recurso
                  <Sparkles className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Sub-tabs contents */}
              <div className="flex-1 overflow-y-auto max-h-[460px] pr-1 scrollbar-thin">
                
                {/* 1. Markdown Audit Report */}
                {activeSubTab === "report" && (
                  <div className="bg-muted border rounded-xl p-4.5 text-xs text-foreground space-y-4 leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeAnalysis.analiseEstiloMarkdown}</ReactMarkdown>

                    {/* Strengths Section */}
                    {activeAnalysis.pontosFortesConcorrente?.length > 0 && (
                      <div className="border-t pt-4 mt-4 space-y-2">
                        <span className="text-[10px] font-bold text-success uppercase tracking-wider block font-mono">
                          Pontos Corretos de Conformidade do Concorrente:
                        </span>
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {activeAnalysis.pontosFortesConcorrente.map((pt, idx) => (
                            <li key={idx} className="bg-success/10 border border-success/20 p-2 rounded-lg text-foreground flex items-start gap-1.5 text-[11px]">
                              <CheckCircle className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
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
                      <div className="bg-muted border p-8 rounded-xl text-center space-y-2">
                        <CheckCircle className="w-10 h-10 text-success mx-auto" />
                        <h4 className="font-bold text-foreground text-xs">Nenhuma Irregularidade Mapeada</h4>
                        <p className="text-[10px] text-muted-foreground max-w-md mx-auto">
                          A proposta analisada atende rigorosamente a todos os critérios e padrões especificados para a amostragem de dados deste foco.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 flex items-start gap-2.5 text-[11px] text-destructive">
                          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
                          <p>
                            Abaixo estão listadas as brechas identificadas. As de gravidade <strong>ALTA</strong> impedem a habilitação técnica ou jurídica e servem como fundamento legal para o pregoeiro desclassificar a empresa concorrente.
                          </p>
                        </div>

                        {activeAnalysis.irregularidadesEncontradas.map((irreg, idx) => (
                          <div key={idx} className="bg-muted border rounded-xl p-4 space-y-3 hover:border-primary/30 transition-all">
                            <div className="flex items-center justify-between border-b pb-2">
                              <span className="text-[10px] font-mono text-muted-foreground">Brecha #{idx + 1}</span>
                              <Badge
                                variant={irreg.gravidade === "ALTA" ? "destructive" : irreg.gravidade === "MÉDIA" ? "warning" : "secondary"}
                                className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase"
                              >
                                Gravidade: {irreg.gravidade}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                              <div className="bg-card p-2.5 rounded-lg border space-y-1">
                                <span className="text-[10px] font-bold text-primary block">O que o Edital Exige:</span>
                                <p className="text-foreground leading-normal">{irreg.campoExigido}</p>
                              </div>
                              <div className="bg-card p-2.5 rounded-lg border space-y-1">
                                <span className="text-[10px] font-bold text-destructive block">O que o Concorrente Entregou:</span>
                                <p className="text-foreground leading-normal">{irreg.propostaConcorrente}</p>
                              </div>
                            </div>

                            <div className="bg-warning/10 border border-warning/20 p-3 rounded-lg space-y-1 text-[11px]">
                              <span className="text-[10px] font-bold text-warning block">Fundamento Legal / Base Jurídica:</span>
                              <p className="text-foreground font-mono text-[10px] leading-relaxed">{irreg.baseLegal}</p>
                            </div>

                            <div className="bg-card p-2.5 rounded-lg text-[11px] border">
                              <span className="text-[10px] font-bold text-muted-foreground block">Impacto Prático (Como Recorrer):</span>
                              <p className="text-foreground leading-normal">{irreg.impacto}</p>
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
                    <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 flex items-start gap-2.5 text-[11px] text-primary">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>
                        A minuta abaixo foi estruturada de acordo com os requisitos formais de petições e recursos do direito administrativo brasileiro, citando as infrações cometidas. Ajuste os colchetes com os dados de sua empresa.
                      </p>
                    </div>

                    <div className="relative bg-muted border rounded-xl p-4 font-mono text-[11px] leading-relaxed text-foreground overflow-x-auto select-text whitespace-pre-wrap max-h-[350px]">
                      {activeAnalysis.modeloRecurso}
                    </div>

                    <div className="flex gap-2.5">
                      <Button
                        type="button"
                        onClick={handleCopyAppeal}
                        className="flex-1 h-auto font-bold text-xs py-2.5 rounded-xl cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Copiado com Sucesso!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>Copiar Minuta de Recurso</span>
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleDownloadAppeal}
                        className="h-auto text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer flex items-center gap-2"
                        title="Baixar como arquivo Markdown .md"
                      >
                        <Download className="w-4 h-4 text-muted-foreground" />
                        <span>Baixar .MD</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            /* Empty State */
            <Card className="rounded-2xl p-8 shadow-xs text-center gap-4 justify-center items-center min-h-[580px]">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Scale className="w-8 h-8" />
              </div>
              <div className="space-y-1 max-w-md">
                <h4 className="font-bold text-foreground text-sm">Pronto para Analisar</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Basta selecionar o edital de referência ou fazer upload das regras no "Passo 1" e anexar os documentos do concorrente no "Passo 2".
                </p>
                <p className="text-[11px] text-primary font-semibold pt-1">
                  A Inteligência Artificial extrairá automaticamente o nome do concorrente, as marcas/especificações e as brechas legais de desclassificação.
                </p>
              </div>
            </Card>
          )}

        </div>

      </div>

      {/* Historical Competitor Audits */}
      {competitorHistory.length > 0 && (
        <Card className="rounded-2xl p-5 shadow-xs gap-4">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider font-mono flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            Histórico de Auditoria de Concorrentes
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {competitorHistory.map((item) => (
              <div
                key={item.id}
                onClick={() => handleLoadFromHistory(item)}
                className="bg-muted hover:bg-card border hover:border-primary/30 p-3.5 rounded-xl cursor-pointer transition-all flex flex-col justify-between gap-3 group"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-primary font-mono font-semibold">{item.date}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={(e) => handleDeleteHistory(item.id, e)}
                      className={`h-auto p-1 px-1.5 rounded transition-all text-[9px] font-bold flex items-center gap-1 cursor-pointer ${
                        deletingId === item.id
                          ? "bg-destructive/10 text-destructive border border-destructive/20 animate-pulse"
                          : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      }`}
                      title={deletingId === item.id ? "Clique novamente para confirmar" : "Excluir auditoria"}
                    >
                      {deletingId === item.id ? "Confirmar?" : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  <h4 className="font-bold text-foreground text-xs truncate group-hover:text-primary transition-colors">
                    {item.competitorName || "Concorrente Oculto"}
                  </h4>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">
                    Foco: {item.focusItems ? item.focusItems.slice(0, 35) + "..." : "Análise Geral"}
                  </p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <FileText className="w-3 h-3 text-primary" />
                    {item.editalTitle || "Edital Associado"}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <Badge
                    variant={item.analysis.isCompliant ? "success" : "destructive"}
                    className="text-[9px] font-bold px-1.5 py-0.2 rounded font-mono"
                  >
                    {item.analysis.isCompliant ? "COMPLIANTE" : "INCOMPATIVEL"}
                  </Badge>
                  <span className="text-[10px] font-bold text-primary flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    Visualizar
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Modal Popup de Alerta de Tamanho de Arquivo Excedido (> 60MB) */}
      <Dialog open={!!(fileSizeErrorModal && fileSizeErrorModal.show)} onOpenChange={(open) => { if (!open) setFileSizeErrorModal(null); }}>
        <DialogContent className="max-w-md p-6 overflow-hidden text-left">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-primary" />

          <DialogHeader className="flex-row items-start gap-3.5 space-y-0 text-left sm:text-left">
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive shrink-0">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-lg font-bold text-foreground leading-tight">
                Arquivo Maior que 60 MB
              </DialogTitle>
              <DialogDescription className="text-xs text-destructive font-medium">
                Tamanho limite por anexo: <span className="underline font-bold">60 MB</span>
              </DialogDescription>
            </div>
          </DialogHeader>

          {fileSizeErrorModal && (
            <div className="bg-muted border rounded-xl p-4 text-xs space-y-3 text-foreground">
              <p className="leading-relaxed">
                O arquivo <strong className="text-foreground">"{fileSizeErrorModal.fileName}"</strong> possui <strong className="text-destructive font-semibold">{fileSizeErrorModal.fileSizeMb} MB</strong> e excede o limite máximo permitido.
              </p>
              <div className="space-y-1.5 text-muted-foreground border-t pt-2.5">
                <p className="font-semibold text-foreground">💡 Como proceder:</p>
                <ul className="list-disc list-inside space-y-1 pl-1 text-[11px]">
                  <li>Comprima ou divida o PDF em arquivos menores (&lt; 60 MB);</li>
                  <li>Ou copie o texto relevante do documento e cole no campo de texto livre.</li>
                </ul>
              </div>
            </div>
          )}

          <DialogFooter className="pt-1 sm:justify-end">
            <Button
              type="button"
              onClick={() => setFileSizeErrorModal(null)}
              className="px-5 py-2.5 h-auto rounded-xl font-semibold flex items-center gap-2 cursor-pointer shadow-xs text-xs"
            >
              <Check className="w-4 h-4" />
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
