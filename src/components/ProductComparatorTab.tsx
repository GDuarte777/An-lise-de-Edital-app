import { useState, useEffect } from "react";
import { 
  Check, X, AlertTriangle, Search, Plus, Trash2, ArrowRight, Sparkles, 
  ChevronDown, ChevronUp, FileText, List, Eye, Info, RefreshCw, Layers, Gauge, ExternalLink
} from "lucide-react";
import { EditalAnalysis } from "../types";

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

  // Load edital history & set initial active edital
  useEffect(() => {
    const saved = localStorage.getItem("aip_edital_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as any[];
        setEditalHistory(parsed);
      } catch (e) {
        console.error("Erro ao carregar histórico de editais:", e);
      }
    }
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
      const response = await fetch("/api/compare-products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requiredSpecs,
          candidateProducts: candidateModels
        })
      });

      if (!response.ok) {
        throw new Error("Erro do servidor ao analisar especificações.");
      }

      const body = await response.json();
      setResults(body.results || []);

      // Auto expand first result
      if (body.results && body.results.length > 0) {
        setExpandedResults({ [body.results[0].originalName]: true });
      }
    } catch (err: any) {
      setGeneralError(err.message || "Erro de rede ou esgotamento na IA. Tente novamente.");
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
      <div className="bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-slate-900/40 border border-indigo-500/20 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex items-start gap-4">
          <div className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 p-3 rounded-xl">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Comparador Inteligente de Produtos e Modelos
              <span className="text-[10px] bg-indigo-500/30 text-indigo-200 font-semibold px-2 py-0.5 rounded-full uppercase">
                Pesquisa Grounded
              </span>
            </h2>
            <p className="text-slate-400 text-sm max-w-4xl">
              Compare as especificações exatas exigidas no Edital com os produtos reais que você possui em estoque ou planeja fornecer. 
              A IA fará uma pesquisa na internet em tempo real sobre a marca/modelo inserida para certificar se ela atende a todas as exigências do órgão comprador.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Left pane: Specs and Candidates Configuration */}
        <div className="lg:col-span-5 space-y-6 flex flex-col justify-between">
          
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-lg backdrop-blur-md flex-1 space-y-5">
            
            {/* Choose edital source */}
            <div>
              <label id="choose-edital-label" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>1. Captar Descrição do Edital</span>
                <span className="text-[10px] text-indigo-400 font-normal lowercase">(ou digite livremente)</span>
              </label>
              <select
                id="edital-select-box"
                value={selectedEditalId}
                onChange={(e) => handleSelectEditalChange(e.target.value)}
                className="w-full bg-[#0d1324] border border-white/10 hover:border-white/20 text-slate-200 text-xs rounded-xl px-3 py-2.5 outline-none focus:border-indigo-600 transition-colors"
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
              <label id="edital-specs-req-lbl" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Especificação Exigida no Edital
              </label>
              <textarea
                id="specs-requirement-textarea"
                rows={4}
                value={requiredSpecs}
                onChange={(e) => {
                  setSelectedEditalId("");
                  setRequiredSpecs(e.target.value);
                }}
                placeholder="Exemplo: Fone de ouvido tipo Headphone com conexão USB. Microfone embutido flexível com cancelamento de ruído. Cabo mínimo de 1.8m. Almofadas auriculares espumadas e fita de cabeça ajustável."
                className="w-full bg-[#0d1324] border border-white/10 text-slate-200 text-xs rounded-xl p-3.5 outline-none focus:ring-1 focus:ring-indigo-600 resize-none font-sans leading-relaxed min-h-[140px]"
              />
            </div>

            {/* Candidate list constructor */}
            <div>
              <label id="candidate-models-lbl" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                2. Seus Candidatos (Produtos que queira oferecer)
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 pointer-events-none">
                    <Layers className="w-4 h-4" />
                  </span>
                  <input
                    id="candidate-input-field"
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Marca e modelo exato (ex: JBL Tune 500BT)"
                    className="w-full bg-[#0d1324] border border-white/10 text-slate-200 pl-9 pr-3 py-2.5 text-xs rounded-xl outline-none focus:border-indigo-600 transition-colors"
                  />
                </div>
                <button
                  id="add-candidate-btn"
                  onClick={handleAddCandidate}
                  className="bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 hover:border-indigo-500/60 p-2.5 rounded-xl text-indigo-300 transition-all flex items-center gap-1.5 cursor-pointer text-xs"
                >
                  <Plus className="w-4.5 h-4.5 font-bold" />
                  <span>Incluir</span>
                </button>
              </div>

              {/* Candidates list preview */}
              <div id="candidates-pills-list" className="mt-3.5 space-y-2 max-h-[160px] overflow-y-auto pr-1">
                {candidateModels.length === 0 ? (
                  <p className="text-slate-500 text-xs italic py-2 text-center">Nenhum modelo cadastrado.</p>
                ) : (
                  candidateModels.map((model, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white/[0.02] border border-white/[0.08] hover:border-white/15 px-3 py-2 rounded-xl flex items-center justify-between text-xs text-slate-200 group transition-all"
                    >
                      <span className="font-semibold truncate">{model}</span>
                      <button
                        onClick={() => handleRemoveCandidate(idx)}
                        className="text-slate-500 hover:text-red-400 p-1 rounded-md hover:bg-white/5 transition-all cursor-pointer"
                        title="Remover produto da comparação"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Error notifications */}
            {generalError && (
              <div className="bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs p-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{generalError}</span>
              </div>
            )}

            {/* Trigger Button */}
            <button
              id="start-comparison-btn"
              onClick={handleCompare}
              disabled={loading}
              className={`w-full font-bold text-xs py-3.5 rounded-xl transition-all cursor-pointer shadow-lg tracking-wide flex items-center justify-center gap-2 border border-white/10 ${
                loading
                  ? "bg-indigo-900/40 text-slate-400 cursor-not-allowed border-indigo-500/20"
                  : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-indigo-600/10"
              }`}
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
            </button>

          </div>
        </div>

        {/* Right pane: Meticulous Comparison Results board */}
        <div className="lg:col-span-7 flex flex-col justify-between">
          
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-lg backdrop-blur-md flex-1 flex flex-col min-h-[480px]">
            <h3 className="text-sm font-bold text-slate-200 border-b border-white/10 pb-4 flex items-center justify-between">
              <span>Resultado da Análise de Conformidade</span>
              {results.length > 0 && (
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-normal">
                  {results.length} produtos analisados
                </span>
              )}
            </h3>

            <div className="flex-1 flex flex-col justify-center mt-4">
              
              {loading && (
                <div id="comparator-loading-screen" className="text-center py-12 space-y-4 max-w-md mx-auto">
                  <div className="relative inline-flex">
                    <div className="w-16 h-16 rounded-full border-4 border-indigo-600/20 border-t-indigo-500 animate-spin"></div>
                    <span className="absolute inset-0 flex items-center justify-center text-indigo-400">
                      <Search className="w-5 h-5 animate-pulse" />
                    </span>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-white font-bold text-sm">Pesquisando especificações reais...</h4>
                    <p className="text-slate-400 text-xs">
                      Buscando fichas técnicas fidedignas dos modelos inseridos na web para evitar desclassificações inesperadas.
                    </p>
                  </div>
                </div>
              )}

              {!loading && results.length === 0 && (
                <div id="comparator-empty-state" className="text-center py-12 space-y-4 max-w-sm mx-auto">
                  <div className="bg-white/5 border border-white/10 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
                    <Layers className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-slate-400 font-bold text-sm">Comparador Ocioso</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">
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
                        <div key={rIdx} className="bg-rose-950/20 border border-rose-500/25 rounded-2xl p-4 text-xs">
                          <p className="font-bold text-rose-400 flex items-center gap-1.5">
                            <X className="w-4.5 h-4.5" />
                            Falha na pesquisa de "{result.originalName}"
                          </p>
                          <p className="text-slate-400 mt-1">{result.error}</p>
                        </div>
                      );
                    }

                    const data = result.data!;
                    const matchStatus = data.matchStatus;
                    const score = data.suitabilityScore;

                    // Match theme colors
                    let badgeColor = "bg-rose-950/40 border-rose-500/30 text-rose-300";
                    let badgeText = "Divergente";
                    let StatusIcon: any = X;

                    if (matchStatus === "ATENDE") {
                      badgeColor = "bg-emerald-950/40 border-emerald-500/30 text-emerald-400";
                      badgeText = "Totalmente Compatível";
                      StatusIcon = CheckedBadgeIcon;
                    } else if (matchStatus === "ATENDE_PARCIALMENTE") {
                      badgeColor = "bg-amber-950/40 border-amber-500/30 text-amber-400";
                      badgeText = "Atenção Crítico";
                      StatusIcon = AlertTriangle;
                    }

                    return (
                      <div 
                        key={rIdx} 
                        className="bg-white/[0.02] border border-white/10 hover:border-white/[0.15] rounded-2xl overflow-hidden transition-all duration-200"
                      >
                        {/* Card Header clickable summary */}
                        <div 
                          onClick={() => toggleExpand(result.originalName)}
                          className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none border-b border-white/[0.04]"
                        >
                          <div className="flex items-center gap-3 truncate">
                            <div className={`p-2 rounded-xl border ${badgeColor} shrink-0`}>
                              <StatusIcon className="w-5 h-5" />
                            </div>
                            <div className="truncate">
                              <h4 className="text-white font-bold text-xs sm:text-sm truncate">{data.productName}</h4>
                              <p className="text-slate-400 text-[10px] mt-0.5 truncate uppercase tracking-widest font-mono">
                                Nome inserido: {result.originalName}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {/* Score Gauge Badge */}
                            <div className="text-right">
                              <span className="text-slate-400 text-[10px] block font-mono">Pontuação</span>
                              <span className={`text-xs font-bold font-mono ${score >= 90 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                                {score}%
                              </span>
                            </div>
                            <div className="text-slate-400 hover:text-white transition-colors">
                              {isExpanded ? <ChevronUp className="w-4.5 h-4.5" /> : <ChevronDown className="w-4.5 h-4.5" />}
                            </div>
                          </div>
                        </div>

                        {/* Card Body - Collapsible Specs Analysis items */}
                        {isExpanded && (
                          <div className="p-5 space-y-5 bg-[#0a0d16]/60 border-t border-white/[0.04] text-xs">
                            
                            {/* Visual Status Callout banner */}
                            <div className={`rounded-xl border p-4 flex gap-3 ${badgeColor} select-text`}>
                              <div className="space-y-1">
                                <h5 className="font-bold">Análise Geral: {badgeText} ({score}% de compatibilidade)</h5>
                                <p className="text-slate-300 leading-relaxed text-[11px]">
                                  {data.conclusion}
                                </p>
                              </div>
                            </div>

                            {/* Bullet-by-Bullet Checklist Analysis */}
                            <div className="space-y-2.5">
                              <h5 className="font-bold text-slate-300 flex items-center gap-1.5 uppercase text-[10px] tracking-wider mb-2">
                                <List className="w-3.5 h-3.5" />
                                Lista de Requisitos vs Ficha Técnica
                              </h5>
                              <div className="space-y-2 select-text">
                                {data.specsAnalysis.map((spec, sIdx) => {
                                  const specStatus = spec.status;
                                  let specBadge = "bg-rose-500/10 border-rose-500/20 text-rose-400";
                                  let specLabel = "Incompatível";
                                  let SpecIcon = X;

                                  if (specStatus === "ATENDE") {
                                    specBadge = "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
                                    specLabel = "Atende";
                                    SpecIcon = Check;
                                  } else if (specStatus === "NAO_ENCONTRADO") {
                                    specBadge = "bg-slate-500/10 border-slate-500/20 text-slate-400";
                                    specLabel = "Indisponível/Dúbio";
                                    SpecIcon = Info;
                                  }

                                  return (
                                    <div key={sIdx} className="bg-white/[0.01] border border-white/[0.06] rounded-xl p-3 space-y-1.5">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-0.5">
                                          <p className="text-slate-400 font-medium font-mono text-[10px] uppercase">Requisito:</p>
                                          <p className="text-slate-200 font-semibold">{spec.requirement}</p>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-[9px] font-semibold tracking-wider uppercase inline-flex items-center gap-1 shrink-0 ${specBadge}`}>
                                          <SpecIcon className="w-3 h-3" />
                                          {specLabel}
                                        </span>
                                      </div>
                                      <div className="bg-black/20 border border-white/[0.03] rounded-lg p-2 mt-2 space-y-1">
                                        <p className="text-slate-400 text-[10px] font-mono leading-tight">Valor Encontrado:</p>
                                        <p className="text-slate-300 font-semibold italic">"{spec.foundSpecText || "Não mencionado na ficha técnica"}"</p>
                                        <p className="text-slate-400 text-[10.5px] mt-1 leading-relaxed leading-snug">{spec.comment}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Pros and Cons panels */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 select-text">
                              {/* Pros panel */}
                              <div className="bg-emerald-950/20 border border-emerald-500/15 rounded-xl p-4 space-y-2">
                                <h5 className="font-bold text-slate-200 flex items-center gap-1.5 uppercase text-[10px] tracking-wider text-emerald-400">
                                  <Check className="w-4 h-4" />
                                  Pontos Fortes (Atende)
                                </h5>
                                <ul className="space-y-1.5">
                                  {data.pros.map((pro, pIdx) => (
                                    <li key={pIdx} className="text-slate-300 flex items-start gap-1.5 text-[11px] leading-relaxed">
                                      <span className="text-emerald-500 shrink-0 font-bold">•</span>
                                      <span>{pro}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              {/* Cons panel */}
                              <div className="bg-rose-950/20 border border-rose-500/15 rounded-xl p-4 space-y-2">
                                <h5 className="font-bold text-slate-200 flex items-center gap-1.5 uppercase text-[10px] tracking-wider text-rose-400">
                                  <X className="w-4 h-4" />
                                  Riscos / Desvantagens
                                </h5>
                                <ul className="space-y-1.5">
                                  {data.cons.map((con, cIdx) => (
                                    <li key={cIdx} className="text-slate-300 flex items-start gap-1.5 text-[11px] leading-relaxed">
                                      <span className="text-rose-500 shrink-0 font-bold">•</span>
                                      <span>{con}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            {/* Real Reference Url Sources */}
                            {result.sources && result.sources.length > 0 && (
                              <div className="border-t border-white/[0.05] pt-4 select-text">
                                <h5 className="font-bold text-slate-400 flex items-center gap-1.5 uppercase text-[10px] tracking-wider mb-2">
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
                                        className="bg-[#0e1222] border border-white/[0.04] p-2.5 rounded-xl hover:bg-indigo-950/30 hover:border-indigo-500/30 text-[11.5px] text-slate-300 flex items-start gap-2 justify-between transition-all"
                                      >
                                        <div className="truncate space-y-0.5">
                                          <p className="font-semibold text-slate-300 truncate">{linkTitle}</p>
                                          <p className="text-[10px] text-indigo-400 truncate">{linkUrl}</p>
                                        </div>
                                        <ExternalLink className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
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

            </div>
          </div>
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
