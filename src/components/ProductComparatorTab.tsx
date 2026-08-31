import { useState, useEffect } from "react";
import {
  Check, X, AlertTriangle, Search, Plus, Trash2, ArrowRight, Sparkles,
  ChevronDown, ChevronUp, FileText, List, Eye, Info, RefreshCw, Layers, Gauge, ExternalLink
} from "lucide-react";
import { EditalAnalysis } from "../types";
import { getActiveAiConfig, apiFetch, formatAiError, readJsonResponse } from "../utils/aiClientHelper";
import {
  fetchComparadorProdutosFromSupabase,
  saveComparadorProdutoToSupabase,
  subscribeToSupabaseTable
} from "../utils/supabaseClient";
import { Button } from "./ui/button";
import { Card, CardHeader, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";

interface ProductComparatorTabProps {
  activeEdital: EditalAnalysis | null;
}

interface SpecAnalysisItem {
  requirement: string;
  foundSpecText: string;
  status: "ATENDE" | "DIVERGENTE" | "NAO_ENCONTRADO";
  comment: string;
}

interface ProductAnalysisResult {
  productName: string;
  matchStatus: "ATENDE" | "ATENDE_PARCIALMENTE" | "NAO_ATENDE";
  suitabilityScore: number;
  specsAnalysis: SpecAnalysisItem[];
  pros: string[];
  cons: string[];
  conclusion: string;
}

interface ExtendedResult {
  originalName: string;
  success: boolean;
  data?: ProductAnalysisResult;
  sources?: any[];
  error?: string;
}

export default function ProductComparatorTab({ activeEdital }: ProductComparatorTabProps) {
  // Select which edital to pull specs from
  const [editalHistory, setEditalHistory] = useState<any[]>([]);
  const [selectedEditalId, setSelectedEditalId] = useState<string>("");
  const [requiredSpecs, setRequiredSpecs] = useState<string>("");

  // Candidate product models list
  const [newModel, setNewModel] = useState<string>("");
  const [candidateModels, setCandidateModels] = useState<string[]>([]);
  
  // Analysis states
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<ExtendedResult[]>([]);
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({});

  // Error messaging
  const [generalError, setGeneralError] = useState<string>("");

  // Load edital history & saved comparisons from Supabase
  useEffect(() => {
    async function loadComparisons() {
      try {
        const dbComps = await fetchComparadorProdutosFromSupabase();
        if (dbComps && dbComps.length > 0) {
          const latest = dbComps[0];
          if (latest.dados_comparacao?.results) {
            setResults(latest.dados_comparacao.results);
            if (latest.dados_comparacao.results.length > 0) {
              setExpandedResults({ [latest.dados_comparacao.results[0].originalName]: true });
            }
          }
          if (latest.especificacoes_exigidas && !requiredSpecs) {
            setRequiredSpecs(latest.especificacoes_exigidas);
          }
          if (latest.candidatos && latest.candidatos.length > 0 && candidateModels.length === 0) {
            setCandidateModels(latest.candidatos);
          }
        }
      } catch (e) {
        console.warn("Falha ao carregar comparações do Supabase:", e);
      }
    }
    loadComparisons();

    const unsubscribe = subscribeToSupabaseTable("comparador_produtos", () => {
      loadComparisons();
    });

    const saved = localStorage.getItem("aip_edital_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as any[];
        setEditalHistory(parsed);
      } catch (e) {
        console.error("Erro ao carregar histórico de editais:", e);
      }
    }

    return () => {
      unsubscribe();
    };
  }, []);

  // Sync with active or selected edital
  useEffect(() => {
    if (activeEdital) {
      setRequiredSpecs(activeEdital.descricaoProduto || "");
      setSelectedEditalId("active");
    } else {
      setSelectedEditalId("");
      setRequiredSpecs("");
    }
  }, [activeEdital]);

  const handleSelectEditalChange = (id: string) => {
    setSelectedEditalId(id);
    if (id === "active") {
      if (activeEdital) {
        setRequiredSpecs(activeEdital.descricaoProduto || "");
      }
    } else if (id) {
      const selectedItem = editalHistory[parseInt(id)];
      if (selectedItem) {
        const analysis = selectedItem.analysis || selectedItem;
        setRequiredSpecs(analysis.descricaoProduto || "");
      }
    } else {
      setRequiredSpecs("");
    }
  };

  const handleAddCandidate = () => {
    const trimmed = newModel.trim();
    if (trimmed && !candidateModels.includes(trimmed)) {
      setCandidateModels([...candidateModels, trimmed]);
      setNewModel("");
    }
  };

  const handleRemoveCandidate = (index: number) => {
    setCandidateModels(candidateModels.filter((_, i) => i !== index));
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddCandidate();
    }
  };

  const handleCompare = async () => {
    if (!requiredSpecs.trim()) {
      setGeneralError("Por favor, preencha a descrição do produto requerida pelo Edital.");
      return;
    }
    if (candidateModels.length === 0) {
      setGeneralError("Insira pelo menos 1 modelo de produto para comparação.");
      return;
    }

    setGeneralError("");
    setLoading(true);
    setResults([]);

    try {
      const response = await apiFetch("/api/compare-products", {
        method: "POST",
        body: {
          requiredSpecs,
          candidateProducts: candidateModels
        }
      });

      if (!response.ok) {
        throw new Error("Erro do servidor ao analisar especificações.");
      }

      const body = await readJsonResponse(response);
      const resList = body.results || [];
      setResults(resList);

      // Auto expand first result
      if (resList.length > 0) {
        setExpandedResults({ [resList[0].originalName]: true });
      }

      // Save to Supabase in real-time
      saveComparadorProdutoToSupabase({
        edital_id: selectedEditalId || "manual",
        especificacoes_exigidas: requiredSpecs,
        candidatos: candidateModels,
        dados_comparacao: { results: resList }
      }).catch(e => console.warn("Erro ao salvar comparador no Supabase:", e));
    } catch (err: any) {
      setGeneralError(formatAiError(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (name: string) => {
    setExpandedResults(prev => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div id="product-comparator-view" className="space-y-6">

      {/* Introduction Card */}
      <Card className="border-primary/20 bg-primary/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
        <CardContent className="flex items-start gap-4">
          <div className="bg-primary/10 border border-primary/30 text-primary p-3 rounded-xl">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              Comparador Inteligente de Produtos e Modelos
              <Badge variant="secondary" className="text-[10px] uppercase">
                Pesquisa Grounded
              </Badge>
            </h2>
            <p className="text-muted-foreground text-sm max-w-4xl">
              Compare as especificações exatas exigidas no Edital com os produtos reais que você possui em estoque ou planeja fornecer.
              A IA fará uma pesquisa na internet em tempo real sobre a marca/modelo inserida para certificar se ela atende a todas as exigências do órgão comprador.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

        {/* Left pane: Specs and Candidates Configuration */}
        <div className="lg:col-span-5 space-y-6 flex flex-col justify-between">

          <Card className="flex-1">
            <CardContent className="space-y-5">

            {/* Choose edital source */}
            <div>
              <Label id="choose-edital-label" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between w-full">
                <span>1. Captar Descrição do Edital</span>
                <span className="text-[10px] text-primary font-normal lowercase">(ou digite livremente)</span>
              </Label>
              <select
                id="edital-select-box"
                value={selectedEditalId}
                onChange={(e) => handleSelectEditalChange(e.target.value)}
                className="w-full border-input bg-transparent dark:bg-input/30 hover:border-ring/50 text-foreground text-xs rounded-xl px-3 py-2.5 border outline-none focus:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-colors"
              >
                <option value="">-- Autônomo (Colar descrição manualmente) --</option>
                {activeEdital && (
                  <option value="active">
                    ★ Edital Ativo em Memória ({activeEdital.identificacaoCertame?.orgaoComprador?.substring(0, 30) || "Análise Atual"}...)
                  </option>
                )}
                {editalHistory.map((historyItem, index) => {
                  const item = historyItem.analysis || historyItem;
                  return (
                    <option key={index} value={index.toString()}>
                      Pregão {item.identificacaoCertame?.identificacaoNumerica || index + 1} - {item.identificacaoCertame?.orgaoComprador?.substring(0, 35) || historyItem.title || "Sem órgão"}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Specefication input area */}
            <div>
              <Label id="edital-specs-req-lbl" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Especificação Exigida no Edital
              </Label>
              <Textarea
                id="specs-requirement-textarea"
                rows={4}
                value={requiredSpecs}
                onChange={(e) => {
                  setSelectedEditalId("");
                  setRequiredSpecs(e.target.value);
                }}
                placeholder="Exemplo: Fone de ouvido tipo Headphone com conexão USB. Microfone embutido flexível com cancelamento de ruído. Cabo mínimo de 1.8m. Almofadas auriculares espumadas e fita de cabeça ajustável."
                className="w-full text-xs rounded-xl p-3.5 resize-none font-sans leading-relaxed min-h-[140px]"
              />
            </div>

            {/* Candidate list constructor */}
            <div>
              <Label id="candidate-models-lbl" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                2. Seus Candidatos (Produtos que queira oferecer)
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground pointer-events-none">
                    <Layers className="w-4 h-4" />
                  </span>
                  <Input
                    id="candidate-input-field"
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Marca e modelo exato (ex: JBL Tune 500BT)"
                    className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl"
                  />
                </div>
                <Button
                  id="add-candidate-btn"
                  type="button"
                  variant="secondary"
                  onClick={handleAddCandidate}
                  className="rounded-xl text-xs"
                >
                  <Plus className="w-4.5 h-4.5 font-bold" />
                  <span>Incluir</span>
                </Button>
              </div>

              {/* Candidates list preview */}
              <div id="candidates-pills-list" className="mt-3.5 space-y-2 max-h-[160px] overflow-y-auto pr-1">
                {candidateModels.length === 0 ? (
                  <p className="text-muted-foreground text-xs italic py-2 text-center">Nenhum modelo cadastrado.</p>
                ) : (
                  candidateModels.map((model, idx) => (
                    <div
                      key={idx}
                      className="bg-muted/40 border border-border hover:border-ring/40 px-3 py-2 rounded-xl flex items-center justify-between text-xs text-foreground group transition-all"
                    >
                      <span className="font-semibold truncate">{model}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveCandidate(idx)}
                        className="text-muted-foreground hover:text-destructive size-6 rounded-md"
                        title="Remover produto da comparação"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Error notifications */}
            {generalError && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs p-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{generalError}</span>
              </div>
            )}

            {/* Trigger Button */}
            <Button
              id="start-comparison-btn"
              type="button"
              onClick={handleCompare}
              disabled={loading}
              className="w-full font-bold text-xs py-3.5 h-auto rounded-xl tracking-wide"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4.5 h-4.5 animate-spin mr-1" />
                  Comparando via Google Grounding...
                </>
              ) : (
                <>
                  <Search className="w-4.5 h-4.5" />
                  Comparar Produtos com IA
                </>
              )}
            </Button>

            </CardContent>
          </Card>
        </div>

        {/* Right pane: Meticulous Comparison Results board */}
        <div className="lg:col-span-7 flex flex-col justify-between">

          <Card className="flex-1 flex flex-col min-h-[480px]">
            <CardHeader className="border-b pb-4">
              <h3 className="text-sm font-bold text-foreground flex items-center justify-between">
                <span>Resultado da Análise de Conformidade</span>
                {results.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    {results.length} produtos analisados
                  </Badge>
                )}
              </h3>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col justify-center">

              {loading && (
                <div id="comparator-loading-screen" className="text-center py-12 space-y-4 max-w-md mx-auto">
                  <div className="relative inline-flex">
                    <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
                    <span className="absolute inset-0 flex items-center justify-center text-primary">
                      <Search className="w-5 h-5 animate-pulse" />
                    </span>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-foreground font-bold text-sm">Pesquisando especificações reais...</h4>
                    <p className="text-muted-foreground text-xs">
                      Buscando fichas técnicas fidedignas dos modelos inseridos na web para evitar desclassificações inesperadas.
                    </p>
                  </div>
                </div>
              )}

              {!loading && results.length === 0 && (
                <div id="comparator-empty-state" className="text-center py-12 space-y-4 max-w-sm mx-auto">
                  <div className="bg-muted/40 border border-border w-14 h-14 rounded-2xl flex items-center justify-center mx-auto text-muted-foreground">
                    <Layers className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-muted-foreground font-bold text-sm">Comparador Ocioso</h4>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Insira as especificações requeridas do Edital no formulário e adicione os modelos de fones ou produtos correspondentes para ver a análise aqui.
                    </p>
                  </div>
                </div>
              )}

              {/* Result card items */}
              {!loading && results.length > 0 && (
                <div className="space-y-4 overflow-y-auto max-h-[580px] pr-1">
                  {results.map((result, rIdx) => {
                    const isExpanded = !!expandedResults[result.originalName];
                    
                    if (!result.success) {
                      return (
                        <div key={rIdx} className="bg-destructive/10 border border-destructive/25 rounded-2xl p-4 text-xs">
                          <p className="font-bold text-destructive flex items-center gap-1.5">
                            <X className="w-4.5 h-4.5" />
                            Falha na pesquisa de "{result.originalName}"
                          </p>
                          <p className="text-muted-foreground mt-1">{result.error}</p>
                        </div>
                      );
                    }

                    const data = result.data!;
                    const matchStatus = data.matchStatus;
                    const score = data.suitabilityScore;

                    // Match theme colors
                    let badgeColor = "bg-destructive/10 border-destructive/30 text-destructive";
                    let badgeVariant: "destructive" | "success" | "warning" = "destructive";
                    let badgeText = "Divergente";
                    let StatusIcon: any = X;

                    if (matchStatus === "ATENDE") {
                      badgeColor = "bg-success/10 border-success/30 text-success";
                      badgeVariant = "success";
                      badgeText = "Totalmente Compatível";
                      StatusIcon = CheckedBadgeIcon;
                    } else if (matchStatus === "ATENDE_PARCIALMENTE") {
                      badgeColor = "bg-warning/10 border-warning/30 text-warning";
                      badgeVariant = "warning";
                      badgeText = "Atenção Crítico";
                      StatusIcon = AlertTriangle;
                    }

                    return (
                      <div
                        key={rIdx}
                        className="bg-card border border-border hover:border-ring/30 rounded-2xl overflow-hidden transition-all duration-200"
                      >
                        {/* Card Header clickable summary */}
                        <div
                          onClick={() => toggleExpand(result.originalName)}
                          className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none border-b border-border"
                        >
                          <div className="flex items-center gap-3 truncate">
                            <div className={`p-2 rounded-xl border ${badgeColor} shrink-0`}>
                              <StatusIcon className="w-5 h-5" />
                            </div>
                            <div className="truncate">
                              <h4 className="text-foreground font-bold text-xs sm:text-sm truncate">{data.productName}</h4>
                              <p className="text-muted-foreground text-[10px] mt-0.5 truncate uppercase tracking-widest font-mono">
                                Nome inserido: {result.originalName}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <Badge variant={badgeVariant} className="text-[9px] uppercase tracking-wider hidden sm:inline-flex">
                              {badgeText}
                            </Badge>
                            {/* Score Gauge Badge */}
                            <div className="text-right">
                              <span className="text-muted-foreground text-[10px] block font-mono">Pontuação</span>
                              <span className={`text-xs font-bold font-mono ${score >= 90 ? "text-success" : score >= 60 ? "text-warning" : "text-destructive"}`}>
                                {score}%
                              </span>
                            </div>
                            <div className="text-muted-foreground hover:text-foreground transition-colors">
                              {isExpanded ? <ChevronUp className="w-4.5 h-4.5" /> : <ChevronDown className="w-4.5 h-4.5" />}
                            </div>
                          </div>
                        </div>

                        {/* Card Body - Collapsible Specs Analysis items */}
                        {isExpanded && (
                          <div className="p-5 space-y-5 bg-muted/30 border-t border-border text-xs">

                            {/* Visual Status Callout banner */}
                            <div className={`rounded-xl border p-4 flex gap-3 ${badgeColor} select-text`}>
                              <div className="space-y-1">
                                <h5 className="font-bold">Análise Geral: {badgeText} ({score}% de compatibilidade)</h5>
                                <p className="text-foreground/80 leading-relaxed text-[11px]">
                                  {data.conclusion}
                                </p>
                              </div>
                            </div>

                            {/* Bullet-by-Bullet Checklist Analysis */}
                            <div className="space-y-2.5">
                              <h5 className="font-bold text-muted-foreground flex items-center gap-1.5 uppercase text-[10px] tracking-wider mb-2">
                                <List className="w-3.5 h-3.5" />
                                Lista de Requisitos vs Ficha Técnica
                              </h5>
                              <div className="space-y-2 select-text">
                                {data.specsAnalysis.map((spec, sIdx) => {
                                  const specStatus = spec.status;
                                  let specVariant: "destructive" | "success" | "secondary" = "destructive";
                                  let specLabel = "Incompatível";
                                  let SpecIcon = X;

                                  if (specStatus === "ATENDE") {
                                    specVariant = "success";
                                    specLabel = "Atende";
                                    SpecIcon = Check;
                                  } else if (specStatus === "NAO_ENCONTRADO") {
                                    specVariant = "secondary";
                                    specLabel = "Indisponível/Dúbio";
                                    SpecIcon = Info;
                                  }

                                  return (
                                    <div key={sIdx} className="bg-background border border-border rounded-xl p-3 space-y-1.5">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-0.5">
                                          <p className="text-muted-foreground font-medium font-mono text-[10px] uppercase">Requisito:</p>
                                          <p className="text-foreground font-semibold">{spec.requirement}</p>
                                        </div>
                                        <Badge variant={specVariant} className="text-[9px] uppercase tracking-wider shrink-0">
                                          <SpecIcon className="w-3 h-3" />
                                          {specLabel}
                                        </Badge>
                                      </div>
                                      <div className="bg-muted/40 border border-border rounded-lg p-2 mt-2 space-y-1">
                                        <p className="text-muted-foreground text-[10px] font-mono leading-tight">Valor Encontrado:</p>
                                        <p className="text-foreground/90 font-semibold italic">"{spec.foundSpecText || "Não mencionado na ficha técnica"}"</p>
                                        <p className="text-muted-foreground text-[10.5px] mt-1 leading-relaxed leading-snug">{spec.comment}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Pros and Cons panels */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 select-text">
                              {/* Pros panel */}
                              <div className="bg-success/10 border border-success/15 rounded-xl p-4 space-y-2">
                                <h5 className="font-bold text-success flex items-center gap-1.5 uppercase text-[10px] tracking-wider">
                                  <Check className="w-4 h-4" />
                                  Pontos Fortes (Atende)
                                </h5>
                                <ul className="space-y-1.5">
                                  {data.pros.map((pro, pIdx) => (
                                    <li key={pIdx} className="text-foreground/80 flex items-start gap-1.5 text-[11px] leading-relaxed">
                                      <span className="text-success shrink-0 font-bold">•</span>
                                      <span>{pro}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              {/* Cons panel */}
                              <div className="bg-destructive/10 border border-destructive/15 rounded-xl p-4 space-y-2">
                                <h5 className="font-bold text-destructive flex items-center gap-1.5 uppercase text-[10px] tracking-wider">
                                  <X className="w-4 h-4" />
                                  Riscos / Desvantagens
                                </h5>
                                <ul className="space-y-1.5">
                                  {data.cons.map((con, cIdx) => (
                                    <li key={cIdx} className="text-foreground/80 flex items-start gap-1.5 text-[11px] leading-relaxed">
                                      <span className="text-destructive shrink-0 font-bold">•</span>
                                      <span>{con}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            {/* Real Reference Url Sources */}
                            {result.sources && result.sources.length > 0 && (
                              <div className="border-t border-border pt-4 select-text">
                                <h5 className="font-bold text-muted-foreground flex items-center gap-1.5 uppercase text-[10px] tracking-wider mb-2">
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  Citações & Fontes de Pesquisa Encontradas
                                </h5>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                                  {result.sources.map((src: any, sIdx: number) => {
                                    const linkTitle = src.title || src.web?.title || `Fonte de consulta [${sIdx+1}]`;
                                    const linkUrl = src.uri || src.web?.uri || "#";
                                    return (
                                      <a
                                        key={sIdx}
                                        href={linkUrl}
                                        target="_blank"
                                        referrerPolicy="no-referrer"
                                        className="bg-background border border-border p-2.5 rounded-xl hover:bg-primary/5 hover:border-primary/30 text-[11.5px] text-foreground/80 flex items-start gap-2 justify-between transition-all"
                                      >
                                        <div className="truncate space-y-0.5">
                                          <p className="font-semibold text-foreground/80 truncate">{linkTitle}</p>
                                          <p className="text-[10px] text-primary truncate">{linkUrl}</p>
                                        </div>
                                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                                      </a>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

            </CardContent>
          </Card>
        </div>

      </div>

    </div>
  );
}

// Inline fallback icon components
function CheckedBadgeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
      />
    </svg>
  );
}
