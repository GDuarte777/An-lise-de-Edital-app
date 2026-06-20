import { useState } from "react";
import { EditalAnalysis, CompanyData, SyncItem } from "../types";
import { 
  FileUp, FileText, CheckCircle2, AlertTriangle, Clock, ArrowRight, Loader2, Play, 
  Sparkles, RefreshCw, ChevronRight, FileCode, CheckSquare, Edit3, Settings, ClipboardPaste, 
  Coins, HelpCircle, HardDriveDownload, MonitorCheck, Save, Send, Database, FileSpreadsheet, Eye,
  Trash2, ShieldCheck, ShieldAlert, Award, TrendingUp, Landmark, MapPin, Gauge
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { addSyncedItem, syncAnalysisToGoogleSheets } from "../utils/googleSync";
import confetti from "canvas-confetti";

// Portuguese demo data for instant simulation & testing convenience
const DEMO_EDITAL_TEXT = `
EDITAL DE PREGÃO ELETRÔNICO Nº 14/2026

OBJETIVO: Aquisição de 100 computadores portáteis (laptops) corporativos de alta performance para a Secretaria Estadual de Educação e Cultura, visando o atendimento das unidades escolares do Município Sede.

REQUISITOS ADICIONAIS DOS PRODUTOS:
Os laptops devem conter no mínimo processador Intel Core i5 de 11ª geração ou equivalente, 16GB de memória RAM, 512GB SSD e tela FHD de 14 polegadas. Garantia mínima residencial de 12 meses fornecida pelo fabricante.

DAS DATAS E PRAZOS DE ENTREGA:
A contratante deverá efetuar a entrega integral dos notebooks no Almoxarifado Central do Estado no prazo peremptório e máximo de 15 dias corridos contados e sacramentados a partir da data de assinatura da nota de empenho. Sob pena de multa contratual de 0,5% por dia de atraso injustificado.

DAS CONDIÇÕES E PRAZO DE PAGAMENTO:
O adimplemento financeiro ocorrerá em parcela única, no prazo de até 30 dias contados do protocolo da fatura instruída com o devido termo de recebimento definitivo pelo gestor do almoxarifado.

DOCUMENTOS DE HABILITAÇÃO EXIGIDOS (CRÍTICOS):
Para fins de habilitação fiscal e trabalhista, neste pregão, as empresas proponentes devem obrigatoriamente anexar na plataforma governamental os seguintes documentos vigentes:
1. Certidão Conjunta Receita Federal e Tributos Federais.
2. Certificado de Regularidade Fiscal Trabalhista (CNDT).
3. Certificado de Regularidade do FGTS (CRF) expedido pela Caixa Econômica.
4. Certidão de Regularidade perante a SEFAZ (Fazenda Estadual do domicilio social).
5. Certidão de Regularidade com a Fazenda Municipal.
6. Cópia do Balanço Patrimonial registrado na junta comercial do último exercício (2025).
7. Autodeclaração conjunta eletrônica de regularidade.
`;

const DEMO_CUSTOM_TEMPLATE = `
DECLARAÇÃO DE COMPROMISSO DE ASSISTÊNCIA TÉCNICA E MANUTENÇÃO

A empresa [Razão Social], inscrita no CNPJ sob o nº [CNPJ], sediada em [Endereço], declara formalmente, sob as penalidades legais, que possui plena capacidade técnica instalada e se compromete a fornecer assistência técnica local autorizada pelo fabricante para os laptops do Pregão Eletrônico nº 14/2026, pelo período mínimo de 12 (doze) meses, no almoxarifado central, devendo efetuar o reparo ou substituição dos equipamentos com vício ou defeito em até 48 horas úteis após a notificação formal realizada pelo fiscal do contrato.

Por ser a expressão da verdade, firmamos a presente.

[Localidade], [Data de Junho de 2026].

_______________________________________________
Representante Legal da Empresa: [Representante Legal]
CPF: [CPF do Representante]
`;

interface EditalAnalyzerTabProps {
  companyData: CompanyData;
  activeEdital: EditalAnalysis | null;
  setActiveEdital: (analysis: EditalAnalysis | null) => void;
  onOpenDocPreview: (title: string, markdown: string, type: "proposal" | "declaration") => void;
}

export default function EditalAnalyzerTab({ companyData, activeEdital, setActiveEdital, onOpenDocPreview }: EditalAnalyzerTabProps) {
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileDetails, setFileDetails] = useState<{ name: string; size: string; type: string } | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);

  // Extra Prompt/Customization states for document creation
  const [extraInstructions, setExtraInstructions] = useState("");
  const [uploadedTemplateText, setUploadedTemplateText] = useState("");
  const [showCustomDocForm, setShowCustomDocForm] = useState(false);
  
  // Document generation processing states
  const [generatingDoc, setGeneratingDoc] = useState<string | null>(null);

  // Sub-tabs for edital analysis view
  const [analysisActiveTab, setAnalysisActiveTab] = useState<"report" | "struc" | "checklist">("report");

  // Histórico Local de Editais
  const [history, setHistory] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem("aip_edital_history");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Load Portuguese Demo text instantly to let user play immediately
  const handleLoadDemo = () => {
    setTextInput(DEMO_EDITAL_TEXT);
    setFileDetails(null);
    setFileBase64(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileDetails({
       name: file.name,
       size: `${(file.size / 1024).toFixed(1)} KB`,
       type: file.type || "application/octet-stream"
    });

    const reader = new FileReader();

    if (file.type === "text/plain") {
      reader.onload = (event) => {
        setTextInput(event.target?.result as string);
        setFileBase64(null);
      };
      reader.readAsText(file);
    } else {
      // PDF or other documents are converted to Base64 to be sent to Gemini multimodal interface
      reader.onload = (event) => {
        const base64String = (event.target?.result as string).split(",")[1];
        setFileBase64(base64String);
        // Clear text input since we will prioritize native file reading by Gemini
        setTextInput("");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!textInput && !fileBase64) {
      alert("Por favor, cole o texto do edital ou faça upload de um arquivo primeiro.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/analyze-edital", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textInput: textInput,
          fileBase64: fileBase64,
          fileName: fileDetails?.name,
          fileType: fileDetails?.type
        })
      });

      if (!response.ok) {
        throw new Error("Erro na resposta do servidor.");
      }

      const data = await response.json();
      if (data.analysis) {
        const analysisResult: EditalAnalysis = {
          ...data.analysis,
          rawText: textInput || `Arquivo: ${fileDetails?.name || "Edital Upload"}`
        };
        
        setActiveEdital(analysisResult);
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.8 } });

        // Salvar no Histórico Local
        const newHistoryItem = {
          id: Date.now().toString(),
          title: analysisResult.descricaoProduto 
            ? `Análise - ${analysisResult.descricaoProduto.slice(0, 45)}${analysisResult.descricaoProduto.length > 45 ? "..." : ""}` 
            : (fileDetails?.name ? `Arquivo: ${fileDetails.name}` : `Análise S/N`),
          date: new Date().toLocaleString("pt-BR"),
          analysis: analysisResult
        };
        setHistory(prev => {
          const updated = [newHistoryItem, ...prev];
          localStorage.setItem("aip_edital_history", JSON.stringify(updated));
          return updated;
        });

        // Auto-sync log results dynamically to Google Sheets/Drive simulation!
        syncAnalysisToGoogleSheets(`Análise Edital - ${analysisResult.descricaoProduto.slice(0, 30)}`, analysisResult);
      } else {
        alert("Não foi possível processar a análise com formato estruturado.");
      }
    } catch (e: any) {
      console.error(e);
      alert("Houve um problema ao enviar o arquivo para análise ao Gemini. Por favor, verifique se seu servidor de backend está de pé ou utilize o texto de demonstração.");
    } finally {
      setLoading(false);
    }
  };

  // Document generators proxying to /api/generate-document
  const triggerDocumentGeneration = async (docType: "proposal" | "joint_declaration" | "custom_declaration") => {
    if (!activeEdital) {
      alert("Aviso: Para gerar um documento 100% qualificado, é altamento recomendado fazer a Análise Completa de Edital na caixa acima primeiro!");
    }

    setGeneratingDoc(docType);
    try {
      const response = await fetch("/api/generate-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType,
          analysisData: activeEdital,
          companyData: companyData,
          extraInstructions,
          uploadedTemplateText: docType === "custom_declaration" ? (uploadedTemplateText || DEMO_CUSTOM_TEMPLATE) : undefined
        })
      });

      if (!response.ok) {
        throw new Error("Erro de processamento.");
      }

      const data = await response.json();
      if (data.markdown) {
        const docTitle = docType === "proposal" ? "Proposta Comercial de Licitação.md" : 
                         docType === "joint_declaration" ? "Declaração Conjunta Unificada.md" : 
                         "Declaração Customizada Editalícia.md";
        
        // Open modal
        onOpenDocPreview(docTitle, data.markdown, docType === "proposal" ? "proposal" : "declaration");
        
        // Save to Drive
        addSyncedItem(docTitle, docType === "proposal" ? "proposal" : "declaration", data.markdown);
      }
    } catch (err) {
      console.error(err);
      alert("Não foi possível gerar este documento de declaração automático. Tente novamente.");
    } finally {
      setGeneratingDoc(null);
    }
  };

  return (
    <div id="edital-analyzer-tab" className="space-y-6">
      
      {/* Upload and input form */}
      <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl shadow-lg p-5 md:p-6 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-500/10 text-indigo-400 p-2 rounded-lg border border-indigo-500/20">
              <FileUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Leitura Inteligente de Editais</h3>
              <p className="text-slate-400 text-xs leading-normal">Carregue arquivos em formato PDF, TXT ou cope partes relevantes para que a IA extraia obrigações</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadDemo}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-md border border-white/10 text-slate-200 bg-white/5 hover:bg-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              Usar Exemplo de Pregão
            </button>
            
            {activeEdital && (
              <button
                onClick={() => {
                  setActiveEdital(null);
                  setTextInput("");
                  setFileDetails(null);
                  setFileBase64(null);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-md border border-rose-500/35 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                Limpar Painel
              </button>
            )}
          </div>
        </div>

        {/* Drag and drop panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="border-2 border-dashed border-white/10 hover:border-indigo-500/40 rounded-xl p-5 bg-white/5 transition-all text-center relative">
              <input 
                type="file" 
                id="edital-file-upload" 
                accept=".txt,.pdf"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              />
              <FileUp className="w-8 h-8 text-indigo-400/80 mx-auto mb-2" />
              <p className="text-xs font-semibold text-white">Arraste seu edital ou Clique para buscar</p>
              <p className="text-[10px] text-slate-400 mt-1">Formatos suportados: PDF ou TXT (Max 20MB)</p>

              {fileDetails && (
                <div className="mt-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-2 flex items-center justify-between text-left text-xs text-indigo-300">
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="font-semibold truncate">{fileDetails.name}</span>
                  </div>
                  <span className="shrink-0 font-medium text-slate-300 text-[10px] ml-2 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                    {fileDetails.size}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400">Ou cole a íntegra ou partes do texto do edital:</span>
              <textarea 
                value={textInput}
                onChange={(e) => {
                  setTextInput(e.target.value);
                  if (fileDetails) {
                    setFileDetails(null);
                    setFileBase64(null);
                  }
                }}
                className="w-full h-44 border border-white/10 rounded-xl p-3 text-xs bg-white/5 focus:bg-slate-900/60 text-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-mono leading-relaxed"
                placeholder="Cole as seções do edital sobre objeto, prazo, contraprestação e documentos de habilitação..."
              />
            </div>

            <button
              onClick={handleAnalyze}
              disabled={loading || (!textInput && !fileBase64)}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:bg-white/5 disabled:from-white/5 disabled:to-white/5 disabled:text-slate-500 text-white font-bold py-2.5 rounded-lg text-sm transition-all shadow-lg flex items-center justify-center gap-2 border border-white/10 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Mapeando Cláusulas do Edital com o Gemini...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Mapear e Analisar Edital agora
                </>
              )}
            </button>
          </div>

          {/* Column 2: Info & History */}
          <div className="space-y-4">
            {/* System Instructions Guidance helper info */}
            <div className="bg-white/5 rounded-xl p-4 md:p-5 border border-white/10 flex flex-col justify-between space-y-4 text-xs text-slate-300">
              <div className="space-y-3 leading-normal">
                <h4 className="font-semibold text-white flex items-center gap-1.5 text-sm">
                  <HelpCircle className="w-4 h-4 text-indigo-400" />
                  Como funciona o Analisador de Pregões?
                </h4>
                <p>
                  O processador utiliza o modelo <strong>Gemini 3.5-flash</strong> para decifrar a hermenêutica jurídica pesada de editais de licitação, economizando horas cruciais de leitura árdua:
                </p>
                <ul className="space-y-1.5 list-disc pl-4 text-slate-400">
                  <li>Detecta imediatamente riscos financeiros ocultos ou multas diárias abusivas.</li>
                  <li>Identifica com rigor prazos regimentais de entrega dos produtos comerciais.</li>
                  <li>Estrutura o checklist específico de habilitações criminais, jurídicas e fiscais.</li>
                  <li>Habilita a automação de propostas comerciais de venda direta ao governo.</li>
                </ul>
              </div>

              <div className="border-t border-white/10 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-400 text-[11px]">
                <span className="flex items-center gap-1">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  Durable Workspace Storage
                </span>
                <span className="flex items-center gap-1">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  Sincronismo com Google Sheets & Drive
                </span>
              </div>
            </div>

            {/* Histórico Local de Editais */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 md:p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <h4 className="font-bold text-white flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-indigo-400" />
                  Histórico Local de Editais
                </h4>
                {history.length > 0 && (
                  <button
                    onClick={() => {
                      if (confirm("Tem certeza que deseja apagar todo o histórico para liberar espaço?")) {
                        setHistory([]);
                        localStorage.removeItem("aip_edital_history");
                        setActiveEdital(null);
                      }
                    }}
                    className="text-[10px] text-rose-400 hover:text-rose-300 font-bold tracking-tight bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/20 transition-all cursor-pointer"
                  >
                    Apagar Tudo
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <p className="text-slate-500 text-center py-4 text-[11px]">Nenhuma análise armazenada localmente ainda.</p>
              ) : (
                <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
                  {history.map((item) => {
                    const isSelected = activeEdital && activeEdital.descricaoProduto === item.analysis.descricaoProduto;
                    return (
                      <div 
                        key={item.id}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-[11px] transition duration-150 ${
                          isSelected
                            ? "bg-indigo-600/20 border-indigo-500/45 text-white shadow-xs shadow-indigo-600/10"
                            : "bg-white/5 border-white/5 hover:border-white/10 text-slate-300 hover:text-slate-100"
                        }`}
                      >
                        <button
                          onClick={() => {
                            setActiveEdital(item.analysis);
                            if (item.analysis.rawText) {
                              if (item.analysis.rawText.startsWith("Arquivo: ")) {
                                setFileDetails({
                                  name: item.analysis.rawText.replace("Arquivo: ", ""),
                                  size: "Histórico",
                                  type: "application/pdf"
                                });
                                setTextInput("");
                              } else {
                                setTextInput(item.analysis.rawText);
                                setFileDetails(null);
                              }
                            }
                          }}
                          className="flex-1 text-left truncate mr-2 font-medium cursor-pointer animate-fade-in"
                          title="Clique para carregar esta análise"
                        >
                          <div className="font-semibold truncate leading-tight">{item.title}</div>
                          <div className="text-[9px] text-slate-500 flex items-center gap-1 mt-1 font-mono">
                            <Clock className="w-2.5 h-2.5 shrink-0" />
                            {item.date}
                          </div>
                        </button>
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = history.filter((h: any) => h.id !== item.id);
                            setHistory(updated);
                            localStorage.setItem("aip_edital_history", JSON.stringify(updated));
                            if (isSelected) {
                              setActiveEdital(null);
                              setTextInput("");
                              setFileDetails(null);
                            }
                          }}
                          className="text-slate-500 hover:text-rose-400 p-1 bg-white/5 hover:bg-rose-500/10 rounded transition-colors cursor-pointer shrink-0 ml-1 border border-white/5 hover:border-rose-500/20"
                          title="Apagar análise do histórico"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="bg-white/5 rounded-xl shadow-lg border border-white/10 p-8 text-center space-y-3 animate-pulse backdrop-blur-md">
          <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto" />
          <p className="text-white font-semibold text-sm">Decifrando escopo de contratação pública...</p>
          <p className="text-slate-400 text-xs">Isso pode levar de 5 a 15 segundos dependendo do tamanho das cláusulas fornecidas.</p>
        </div>
      )}

      {/* Analysis Results Display */}
      {activeEdital && !loading && (
        <div className="space-y-6 animate-fade-in" id="analysis-results-section">
          
          {/* Executive Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            <div className="bg-white/5 border border-white/10 backdrop-blur-md text-white p-5 rounded-xl shadow-md space-y-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Descrição Principal do Objeto</span>
              <p className="font-semibold text-slate-100 text-sm md:text-base leading-snug line-clamp-3">
                {activeEdital.descricaoProduto}
              </p>
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md p-5 rounded-xl space-y-1.5 text-emerald-300">
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">Prazo de Entrega ao Governo</span>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="w-5 h-5 text-emerald-400 shrink-0" />
                <p className="font-bold text-white text-sm md:text-base leading-snug">
                  {activeEdital.prazoEntrega}
                </p>
              </div>
            </div>

            <div className="bg-indigo-500/10 border border-indigo-500/20 backdrop-blur-md p-5 rounded-xl space-y-1.5 text-indigo-300">
              <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block">Condição de Recebimento de Valor</span>
              <div className="flex items-center gap-2 mt-1">
                <Coins className="w-5 h-5 text-indigo-400 shrink-0" />
                <p className="font-bold text-white text-sm md:text-base leading-snug">
                  {activeEdital.prazoPagamento}
                </p>
              </div>
            </div>

          </div>

          {/* Tab Selector Menu for Sub-Information Panels */}
          <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-px">
            <button
              onClick={() => setAnalysisActiveTab("report")}
              className={`pb-3 text-xs md:text-sm font-semibold border-b-2 px-1.5 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                analysisActiveTab === "report"
                  ? "border-indigo-500 text-indigo-400 font-bold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-4 h-4 text-indigo-400" />
              Parecer Executivo Sênior (6 Pilares)
            </button>
            <button
              onClick={() => setAnalysisActiveTab("struc")}
              className={`pb-3 text-xs md:text-sm font-semibold border-b-2 px-1.5 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                analysisActiveTab === "struc"
                  ? "border-indigo-500 text-indigo-400 font-bold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Gauge className="w-4 h-4 text-emerald-400" />
              Dossiê Estruturado por Tópicos
            </button>
            <button
              onClick={() => setAnalysisActiveTab("checklist")}
              className={`pb-3 text-xs md:text-sm font-semibold border-b-2 px-1.5 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                analysisActiveTab === "checklist"
                  ? "border-indigo-500 text-indigo-400 font-bold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <CheckSquare className="w-4 h-4 text-blue-400" />
              Checklist & Alertas Rápidos
            </button>
          </div>

          {/* TAB 1: EXECUTIVE BRIEFING (MARKDOWN REPORT) */}
          {analysisActiveTab === "report" && (
            <div className="bg-slate-950/40 p-5 md:p-7 rounded-2xl border border-white/10 shadow-xl space-y-4 animate-fade-in relative overflow-hidden backdrop-blur-md">
              <div className="absolute top-0 right-0 p-4 font-mono text-[9px] text-indigo-400/50 uppercase tracking-widest hidden md:block">
                Senior Market Strategy Report
              </div>
              
              {activeEdital.reportMarkdown ? (
                <div className="prose prose-invert max-w-none text-slate-300 text-xs md:text-sm leading-relaxed space-y-4">
                  <ReactMarkdown components={{
                    h1: ({node, ...props}) => <h1 className="text-sm md:text-base font-bold text-white border-b border-white/10 pb-2 mt-6 mb-3 flex items-center gap-2 uppercase tracking-wide text-indigo-300" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xs md:text-sm font-bold text-slate-100 mt-5 mb-2 border-b border-white/5 pb-1" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-xs font-bold text-indigo-300 mt-4 mb-2" {...props} />,
                    p: ({node, ...props}) => <p className="mb-3 text-slate-300 leading-relaxed font-sans" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-1.5 text-slate-300 font-sans" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-1.5 text-slate-300 font-sans" {...props} />,
                    li: ({node, ...props}) => <li className="leading-relaxed" {...props} />,
                    table: ({node, ...props}) => (
                      <div className="overflow-x-auto my-4 rounded-xl border border-white/10 bg-slate-950/60">
                        <table className="w-full text-left border-collapse text-[11px] md:text-xs" {...props} />
                      </div>
                    ),
                    thead: ({node, ...props}) => <thead className="bg-slate-900 border-b border-white/10 text-slate-200 font-semibold" {...props} />,
                    th: ({node, ...props}) => <th className="p-2.5 font-semibold text-[10px] uppercase tracking-wider text-slate-300" {...props} />,
                    tbody: ({node, ...props}) => <tbody className="divide-y divide-white/5" {...props} />,
                    td: ({node, ...props}) => <td className="p-2.5 text-slate-300 font-sans leading-normal" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-semibold text-white bg-indigo-500/10 px-1 rounded text-indigo-200" {...props} />,
                  }}>{activeEdital.reportMarkdown}</ReactMarkdown>
                </div>
              ) : (
                <div className="text-center py-10 space-y-2">
                  <div className="bg-amber-500/10 text-amber-400 p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto border border-amber-500/20">
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <h5 className="font-bold text-white text-sm">Parecer Executivo Indisponível</h5>
                  <p className="text-slate-400 text-xs max-w-sm mx-auto leading-normal">
                    Este item do histórico foi gerado antes da implementação do analista sênior de 6 pilares. Por favor, faça uma nova análise completa do edital para conferir o parecer completo.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DETAILED STRATEGIC PILLARS */}
          {analysisActiveTab === "struc" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in text-slate-300">
              
              {/* Pillar 1: IDENTIFICATION */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <Landmark className="w-4 h-4 text-indigo-400 shrink-0" />
                  <h4 className="font-bold text-white text-xs uppercase tracking-wide">1. Identificação do Certame</h4>
                </div>
                {activeEdital.identificacaoCertame ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Órgão Comprador / Unidade Gestora</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.identificacaoCertame.orgaoComprador}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Modalidade do Processo</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.identificacaoCertame.modalidade}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Identificação Numérica / PCE</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.identificacaoCertame.identificacaoNumerica}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Sessão Pública (Data/Hora/Fuso)</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.identificacaoCertame.dataHoraSessao}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 2: TECHNICAL SPECIFICATIONS & SNARES */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <Gauge className="w-4 h-4 text-amber-400 shrink-0" />
                  <h4 className="font-bold text-white text-xs uppercase tracking-wide">2. Especificações Técnicas & Pegadinhas</h4>
                </div>
                {activeEdital.especificacoesTecnicas ? (
                  <div className="text-xs space-y-4 pb-1">
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider mb-1.5">Exigências Físicas do Produto (Checklist Mandatório)</span>
                      <ul className="list-disc pl-4 space-y-1 text-slate-200">
                        {activeEdital.especificacoesTecnicas.exigenciasFisicas.map((item, idx) => (
                          <li key={idx} className="leading-snug">{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-amber-400 block font-mono text-[9px] uppercase tracking-wider mb-1.5 font-bold">Pegadinhas Técnicas Ocultas / Risco de Desclassificação</span>
                      <ul className="list-disc pl-4 space-y-1 text-slate-200">
                        {activeEdital.especificacoesTecnicas.pegadinhasOcultas.map((item, idx) => (
                          <li key={idx} className="leading-snug">{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 3: BUREAUCRACY & ENTRY BARRIERS */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                  <h4 className="font-bold text-white text-xs uppercase tracking-wide">3. Burocracia & Barreiras de Entrada</h4>
                </div>
                {activeEdital.burocraciaBarreiras ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Amostra Exigida?</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.burocraciaBarreiras.exigeAmostra}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Carta de Solidariedade/Exclusividade?</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.burocraciaBarreiras.exigeCartaSolidariedade}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Garantia de Proposta ou Contratual?</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.burocraciaBarreiras.exigenciaGarantia}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Consórcios ou Subcontratações?</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.burocraciaBarreiras.consorcioSubcontratacao}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 4: LOGISTICS & RISK ANALYSIS */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                  <h4 className="font-bold text-white text-xs uppercase tracking-wide">4. Logística, Cronograma & Prazo</h4>
                </div>
                {activeEdital.logisticaCronograma ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Prazo Real de Entrega</span>
                      <span className="text-slate-100 font-semibold flex items-center gap-2">
                        {activeEdital.logisticaCronograma.prazoEntregaReal}
                        <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
                          activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("crít") || 
                          activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("relâ")
                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" 
                            : activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("aceit")
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        }`}>
                          {activeEdital.logisticaCronograma.classificacaoPrazo}
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Endereço Exato & Almoxarifado</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.logisticaCronograma.enderecoEntrega}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Prazo de Garantia Requerido</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.logisticaCronograma.prazoGarantia}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 5: FINANCIAL VIABILITY */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <Coins className="w-4 h-4 text-cyan-400 shrink-0" />
                  <h4 className="font-bold text-white text-xs uppercase tracking-wide">5. Viabilidade Financeira & Margem</h4>
                </div>
                {activeEdital.viabilidadeFinanceira ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Valor Estimado (Unitário / Global)</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.viabilidadeFinanceira.valorEstimado}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Distorções Identificadas vs Mercado Privado</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.viabilidadeFinanceira.distorcoesPreco}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider">Prazo de Recebimento de Pagamento</span>
                      <span className="text-slate-100 font-semibold">{activeEdital.viabilidadeFinanceira.prazoPagamento}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 6: CONCLUDING RECOMMENDATION */}
              <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-5 space-y-3 md:col-span-2">
                <div className="flex items-center gap-2 border-b border-indigo-500/30 pb-2">
                  <TrendingUp className="w-4 h-4 text-indigo-400 shrink-0" />
                  <h4 className="font-bold text-white text-xs uppercase tracking-wide">6. Parecer Final do Analista & Estratégia de Lances</h4>
                </div>
                {activeEdital.parecerFinal ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs leading-normal">
                    <div>
                      <span className="text-indigo-400 block font-mono text-[9px] uppercase tracking-wider font-bold">Veredito Final</span>
                      <span className="text-white font-bold bg-indigo-500/20 px-2 py-1 rounded inline-block border border-indigo-500/30 mt-1">{activeEdital.parecerFinal.veredito}</span>
                    </div>
                    <div>
                      <span className="text-indigo-400 block font-mono text-[9px] uppercase tracking-wider font-bold">Grau de Risco Global</span>
                      <span className={`px-2 py-1 rounded font-bold uppercase inline-block border mt-1 ${
                        activeEdital.parecerFinal.grauRisco.toLowerCase().includes("alto") 
                          ? "bg-rose-500/20 text-rose-400 border-rose-500/30" 
                          : activeEdital.parecerFinal.grauRisco.toLowerCase().includes("médio")
                            ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                            : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      }`}>{activeEdital.parecerFinal.grauRisco}</span>
                    </div>
                    <div>
                      <span className="text-indigo-400 block font-mono text-[9px] uppercase tracking-wider font-bold">Estratégia Recomendada de Lances</span>
                      <span className="text-slate-200 block font-semibold mt-1 leading-snug">{activeEdital.parecerFinal.estrategiaLances}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: CHECKLIST & INSTANT ALERTS */}
          {analysisActiveTab === "checklist" && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Opportunities (Oportunidades ou Pontos positivos) */}
                <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 space-y-4">
                  <h4 className="font-bold text-white flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    Pontos Positivos / Vantagens Competitivas
                  </h4>
                  <ul className="space-y-3 pl-1 text-xs text-slate-300 select-none">
                    {activeEdital.pontosPositivos.map((item, idx) => (
                      <li key={idx} className="flex gap-2.5 items-start">
                        <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Warnings (Riscos ou Pegadinhas de Alerta) */}
                <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 space-y-4">
                  <h4 className="font-bold text-white flex items-center gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    Pontos de Alerta / Atenção e Riscos
                  </h4>
                  <ul className="space-y-3 pl-1 text-xs text-slate-300 select-none">
                    {activeEdital.pontosAlerta.map((item, idx) => (
                      <li key={idx} className="flex gap-2.5 items-start">
                        <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Habilitation Documents checklist */}
                <div className="lg:col-span-2 bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
                    <h4 className="font-bold text-white flex items-center gap-2 text-sm">
                      <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0" />
                      Certidões e Documentos Exigidos no Pregão
                    </h4>
                    <span className="text-xs bg-white/5 text-indigo-300 border border-white/10 px-2.5 py-1 rounded-full font-semibold">
                      Exigências habilitatórias decifradas: {activeEdital.documentosExigidos.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeEdital.documentosExigidos.map((doc, idx) => (
                      <div key={idx} className="flex gap-3 bg-white/5 border border-white/5 hover:border-white/10 rounded-xl p-3 text-xs text-slate-200 transition-colors">
                        <div className="bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 h-6 w-6 font-bold rounded-lg flex items-center justify-center shrink-0 text-[10px]">
                          {idx + 1}
                        </div>
                        <div className="leading-tight space-y-1">
                          <span className="font-semibold block text-slate-100">{doc}</span>
                          <span className="text-[10px] text-slate-500">Verifique compatibilidade no painel ao lado ou aba de portfólios</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}


          {/* Action Trigger Area: Document Creation Station */}
          <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-xl p-5 md:p-6 space-y-6">
            <div className="flex items-center gap-2.5 border-b border-white/10 pb-4">
              <div className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 p-2 rounded-lg">
                <Edit3 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Terminal de Automação de Documentos</h3>
                <p className="text-slate-400 text-xs">Gere minutas de habilitações e propostas pré-preenchidas com inteligência artificial</p>
              </div>
            </div>

            {/* Custom inputs row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
              <div className="md:col-span-3">
                <label className="block font-medium text-slate-400 mb-1">Instruções adicionais específicas (Opcional)</label>
                <input 
                  type="text"
                  value={extraInstructions}
                  onChange={(e) => setExtraInstructions(e.target.value)}
                  placeholder="Ex: Ofereça parcelamento em 3x ou adicione que nossos notebooks possuem 3 portas USB"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-hidden focus:bg-slate-900/60 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setShowCustomDocForm(!showCustomDocForm)}
                  className={`w-full py-2.5 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    showCustomDocForm 
                      ? "bg-indigo-600 border border-indigo-500/30 text-white shadow-lg shadow-indigo-600/20" 
                      : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <Settings className="w-3.5 h-3.5" />
                  Declaração com Modelo
                </button>
              </div>
            </div>

            {/* Custom Document Template Paste Accordion */}
            {showCustomDocForm && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 block">Escreva ou Cole o modelo exemplo exigido no edital:</span>
                  <button 
                    onClick={() => setUploadedTemplateText(DEMO_CUSTOM_TEMPLATE)}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold transition-colors"
                  >
                    Utilizar Modelo de Assistência Técnica (Exemplo)
                  </button>
                </div>
                <textarea 
                  value={uploadedTemplateText}
                  onChange={(e) => setUploadedTemplateText(e.target.value)}
                  className="w-full h-36 border border-white/10 rounded-lg p-3 text-[11px] bg-slate-950/40 text-white leading-relaxed font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="Cole aqui o texto da autodeclaração requirida no arquivo de anexos do edital..."
                />
                <p className="text-[10px] text-slate-400">A IA substituirá os espaços marcados como [Razão Social], [CNPJ], [Representante], [Endereço], [CPF], etc., pelos dados da sua empresa cadastrados no Portfólio.</p>
              </div>
            )}

            {/* Main generation buttons group */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-sans">
              
              <button
                disabled={generatingDoc !== null}
                onClick={() => triggerDocumentGeneration("proposal")}
                className="flex flex-col items-center justify-between p-4 bg-gradient-to-br from-indigo-950/30 to-indigo-900/20 hover:from-indigo-950/50 hover:to-indigo-900/40 border border-indigo-500/30 rounded-xl text-center transition-all cursor-pointer group text-white disabled:opacity-50 shadow-md shadow-indigo-950/50"
              >
                <div className="bg-gradient-to-tr from-indigo-500 to-indigo-600 text-white p-2.5 rounded-lg group-hover:scale-105 transition-transform bg-indigo-600">
                  {generatingDoc === "proposal" ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                </div>
                <div className="mt-3">
                  <p className="font-bold text-xs md:text-sm">Criar Proposta Comercial</p>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">Monta a proposta completa de preços e especificações baseando-se no objeto</p>
                </div>
                <ChevronRight className="w-4 h-4 text-indigo-400 mt-2 self-end" />
              </button>

              <button
                disabled={generatingDoc !== null}
                onClick={() => triggerDocumentGeneration("joint_declaration")}
                className="flex flex-col items-center justify-between p-4 bg-gradient-to-br from-emerald-950/30 to-emerald-900/20 hover:from-emerald-950/50 hover:to-emerald-900/40 border border-emerald-500/30 rounded-xl text-center transition-all cursor-pointer group text-white disabled:opacity-50 shadow-md shadow-emerald-950/50"
              >
                <div className="bg-gradient-to-tr from-emerald-500 to-emerald-600 text-white p-2.5 rounded-lg group-hover:scale-105 transition-transform bg-emerald-600">
                  {generatingDoc === "joint_declaration" ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckSquare className="w-5 h-5" />}
                </div>
                <div className="mt-3">
                  <p className="font-bold text-xs md:text-sm">Declaração Conjunta</p>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">Gera autodeclarações de habilitação (Anti-trabalho infantil, ME/EPP, anticorrupção)</p>
                </div>
                <ChevronRight className="w-4 h-4 text-emerald-400 mt-2 self-end" />
              </button>

              <button
                disabled={generatingDoc !== null || (!uploadedTemplateText && !showCustomDocForm)}
                onClick={() => triggerDocumentGeneration("custom_declaration")}
                className="flex flex-col items-center justify-between p-4 bg-gradient-to-br from-blue-950/30 to-blue-900/20 hover:from-blue-950/50 hover:to-blue-900/40 border border-blue-500/30 rounded-xl text-center transition-all cursor-pointer group text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-950/50"
                title={!uploadedTemplateText && !showCustomDocForm ? "Ative o Modelo acima para preencher uma declaração específica" : ""}
              >
                <div className={`p-2.5 rounded-lg group-hover:scale-105 transition-transform text-white ${
                  uploadedTemplateText ? "bg-gradient-to-tr from-blue-500 to-blue-600 bg-blue-600" : "bg-slate-700"
                }`}>
                  {generatingDoc === "custom_declaration" ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCode className="w-5 h-5" />}
                </div>
                <div className="mt-3">
                  <p className="font-bold text-xs md:text-sm">Criar Declaração Exigida</p>
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">Preenche com exatidão as lacunas de um modelo seu baseando-se no edital</p>
                </div>
                <ChevronRight className="w-4 h-4 text-blue-400 mt-2 self-end" />
              </button>

            </div>

          </div>

        </div>
      )}

    </div>
  );
}
