import React, { useState, useEffect } from "react";
import { 
  Calculator, Landmark, MapPin, Calendar, Coins, TrendingUp, AlertTriangle, CheckCircle, 
  HelpCircle, ChevronRight, Save, ClipboardList, Info, FileSpreadsheet, Trash2, Plus, Folder, Percent, Tag, ShoppingBag, Truck, BadgePercent,
  Sparkles, BrainCircuit, Upload, FileText, Lightbulb, Zap, ShieldCheck, Sliders, RefreshCw, ArrowRight, UploadCloud, Check, X
} from "lucide-react";
import { EditalAnalysis } from "../types";
import { addSyncedItem } from "../utils/googleSync";
import { apiFetch } from "../utils/aiClientHelper";
import confetti from "canvas-confetti";

interface PricingCalculatorTabProps {
  companyData: any;
  activeEdital: EditalAnalysis | null;
}

interface PriceSimulation {
  id: string;
  title: string;
  date: string;
  
  // Edital general details
  orgaoComprador: string;
  descricaoProduto: string; // The item
  dataHoraSessao: string;
  enderecoEntrega: string;
  identificacaoNumerica: string; // Pregão Number
  pastaProcesso: string;
  numeroProcesso: string;

  // Calculadora params
  valorMaximo: number;
  custoUnitario: number;
  valorGanhoUnitario: number;
  quantidade: number;
  valorFreteTotal: number;
  aliquotaImposto: number;
  outrasDespesasTotais: number;
}

// Helper to extract product price and quantity from edital details
function parseEditalPriceAndQty(descricao: string, valorEstimado: string) {
  const desc = (descricao || "").toLowerCase();
  const valText = (valorEstimado || "").toLowerCase();

  let parsedQty = 1;
  let parsedPrice = 0;

  // 1. Extract Quantity
  // Search for patterns like "300 unidades", "150 un", "qtd: 50", etc.
  const qtyRegexes = [
    /(\d+[\d.]*)\s*(?:unidades|unidade|unids|unid|un|items|item|itens|itns|pçs|pcs|peças|pc|maletas|kits|kit|unids|pacotes)/i,
    /(?:qtd|quantidade|items|itens|total|lote de|volume|quant)\s*(?:de)?\s*[:=-]?\s*(\d+[\d.]*)/i
  ];

  for (const regex of qtyRegexes) {
    const matchD = desc.match(regex);
    if (matchD && matchD[1]) {
      const qVal = parseInt(matchD[1].replace(/\./g, ""));
      if (!isNaN(qVal) && qVal > 0) {
        parsedQty = qVal;
        break;
      }
    }
    const matchV = valText.match(regex);
    if (matchV && matchV[1]) {
      const qVal = parseInt(matchV[1].replace(/\./g, ""));
      if (!isNaN(qVal) && qVal > 0) {
        parsedQty = qVal;
        break;
      }
    }
  }

  // Bracket detection fallback e.g. "Cadeira giratória (100 unidades)"
  if (parsedQty === 1) {
    const brackets = desc.match(/\(([^)]+)\)/);
    if (brackets && brackets[1]) {
      const content = brackets[1];
      const numbers = content.match(/(\d+)/);
      if (numbers && numbers[1]) {
        parsedQty = parseInt(numbers[1]);
      }
    }
  }

  // 2. Extract Price (Valor Estimado / Valor Máximo)
  // R$ 1.250,50 -> 1250.50
  const getPrices = (text: string): number[] => {
    const rx = /(?:r\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2}))/gi;
    const matches: number[] = [];
    let match;
    while ((match = rx.exec(text)) !== null) {
      const numStr = match[1].replace(/\./g, "").replace(",", ".");
      const val = parseFloat(numStr);
      if (!isNaN(val)) matches.push(val);
    }
    // Fallback without cents (e.g., R$ 150)
    if (matches.length === 0) {
      const rxSimple = /(?:r\$\s*)?([0-9]+[\d.]*)/gi;
      let matchSimple;
      while ((matchSimple = rxSimple.exec(text)) !== null) {
        const cleaned = matchSimple[1].replace(/\./g, "");
        const val = parseFloat(cleaned);
        if (!isNaN(val) && val > 0) {
          if (val !== parsedQty) {
            matches.push(val);
          }
        }
      }
    }
    return matches;
  };

  const pricesFound = getPrices(valText);
  
  // Search for explicit word triggers indicating unit or global price
  let unitPrices: number[] = [];
  let globalPrices: number[] = [];

  const sentences = valText.split(/[;,]/);
  for (const s of sentences) {
    const nums = getPrices(s);
    if (nums.length > 0) {
      if (s.includes("unit") || s.includes("unidade") || s.includes("item") || s.includes("cada") || s.includes("p/ un") || s.includes("por un")) {
        unitPrices.push(nums[0]);
      } else if (s.includes("global") || s.includes("total") || s.includes("lote")) {
        globalPrices.push(nums[0]);
      }
    }
  }

  if (unitPrices.length > 0) {
    parsedPrice = unitPrices[0];
  } else if (globalPrices.length > 0 && parsedQty > 1) {
    parsedPrice = globalPrices[0] / parsedQty;
  } else if (pricesFound.length > 0) {
    if (pricesFound.length >= 2) {
      const sorted = [...pricesFound].sort((a, b) => a - b);
      parsedPrice = sorted[0];
      const maxPrice = sorted[sorted.length - 1];
      if (parsedQty === 1 && parsedPrice > 0 && maxPrice !== parsedPrice) {
        const ratio = maxPrice / parsedPrice;
        if (Math.abs(ratio - Math.round(ratio)) < 0.05) {
          parsedQty = Math.round(ratio);
        }
      }
    } else {
      const singlePrice = pricesFound[0];
      if (parsedQty > 5 && singlePrice > 1000 && !valText.includes("unit")) {
        parsedPrice = singlePrice / parsedQty;
      } else {
        parsedPrice = singlePrice;
      }
    }
  }

  return {
    price: Math.round(parsedPrice * 100) / 100 || 0,
    quantity: parsedQty || 1
  };
}

export default function PricingCalculatorTab({ companyData, activeEdital }: PricingCalculatorTabProps) {
  // Histórico de Editais analisados
  const [history, setHistory] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem("aip_edital_history");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Lista de simulações salvas localmente
  const [simulations, setSimulations] = useState<PriceSimulation[]>(() => {
    try {
      const saved = localStorage.getItem("aip_pricing_simulations");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [showConfirmClearSimulations, setShowConfirmClearSimulations] = useState(false);

  // Active simulation forms fields
  const [selectedEditalId, setSelectedEditalId] = useState<string>("");
  const [simulationTitle, setSimulationTitle] = useState<string>("Minha Simulação");

  // Edital details inputs
  const [orgaoComprador, setOrgaoComprador] = useState<string>("");
  const [descricaoProduto, setDescricaoProduto] = useState<string>("");
  const [dataHoraSessao, setDataHoraSessao] = useState<string>("");
  const [enderecoEntrega, setEnderecoEntrega] = useState<string>("");
  const [identificacaoNumerica, setIdentificacaoNumerica] = useState<string>("");
  const [pastaProcesso, setPastaProcesso] = useState<string>("");
  const [numeroProcesso, setNumeroProcesso] = useState<string>("");

  // Bidding financial inputs (filled automatically from edital details)
  const [valorMaximo, setValorMaximo] = useState<number>(0);
  const [quantidade, setQuantidade] = useState<number>(1);

  // Other input variables which the user must type manually
  const [custoUnitario, setCustoUnitario] = useState<number>(0);
  const [valorGanhoUnitario, setValorGanhoUnitario] = useState<number>(0);
  const [valorFreteTotal, setValorFreteTotal] = useState<number>(0);
  const [aliquotaImposto, setAliquotaImposto] = useState<number>(0);
  const [outrasDespesasTotais, setOutrasDespesasTotais] = useState<number>(0);

  // AI automation states
  const [isEstimatingAi, setIsEstimatingAi] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiTips, setAiTips] = useState<string[] | null>(null);

  const [isAnalyzingStrategy, setIsAnalyzingStrategy] = useState(false);
  const [aiStrategyResult, setAiStrategyResult] = useState<{
    stopLossUnitario: number;
    nivelRisco: "Baixo" | "Médio" | "Alto" | "Crítico";
    estrategiaDisputa: string;
    alertas: string[];
    pontosFortes: string[];
    scoreCompetitividade: number;
  } | null>(null);

  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const [isParsingQuote, setIsParsingQuote] = useState(false);
  const [quoteFileName, setQuoteFileName] = useState<string | null>(null);

  // Layout collapsed toggles for visual cleanliness
  const [showDetails, setShowDetails] = useState(false);
  const [showSavedSimulations, setShowSavedSimulations] = useState(false);

  // Helper to safely parse AI JSON
  const parseAiJson = (text: string) => {
    try {
      const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("Erro ao converter JSON da IA:", e, text);
      return null;
    }
  };

  // AI Function 1: Estimate costs, taxes, freight, and recommended bid
  const handleAiEstimate = async () => {
    if (!descricaoProduto && !orgaoComprador) {
      alert("Por favor, selecione um edital ou preencha a descrição do produto/órgão para a IA poder estimar.");
      return;
    }

    setIsEstimatingAi(true);
    setAiReasoning(null);
    setAiTips(null);

    try {
      const systemInstruction = `Você é um analista especialista em formação de preços e inteligência financeira para licitações e pregões públicos no Brasil.
Sua missão é estimar valores realistas de mercado B2B e custos operacionais para a planilha de composição de preço da empresa.
Retorne RIGOROSAMENTE apenas um JSON válido sem nenhum texto explicativo fora do JSON.`;

      const prompt = `
Analise o item de licitação e estime os custos e a proposta financeira ideal:
- Item / Produto: "${descricaoProduto}"
- Órgão Comprador: "${orgaoComprador}"
- Quantidade Requerida: ${quantidade || 1}
- Valor Máximo Estimado no Edital (Unitário): R$ ${valorMaximo || 0}
- Endereço / Local de Entrega: "${enderecoEntrega || "Geral"}"
- Dados da Empresa Licitante: ${JSON.stringify(companyData || {})}

Com base nas médias atuais do mercado atacadista brasileiro, rotas de frete e regime tributário típico (ex: Simples Nacional ~6% a 10%), estime:
1. "custoUnitario": Custo médio de aquisição direto do fornecedor/fábrica (R$ por unidade).
2. "valorFreteTotal": Frete total estimado de entrega para a quantidade solicitada (R$).
3. "aliquotaImposto": Porcentagem estimada de tributos sobre o faturamento do lote (ex: 6.0 para Simples Nacional ou 12.0 para Lucro Presumido).
4. "outrasDespesasTotais": Custos indiretos estimados (embalagem, seguro, embalagem especial) em R$.
5. "valorGanhoUnitario": Preço de venda/lance recomendado (por unidade) para obter uma margem líquida saudável (~12% a 18%) e ainda ser competitivo.
6. "explicacaoRaciocinio": Uma frase concisa justificando como os custos foram estimados.
7. "dicasCompetitividade": Um array de 2 a 3 dicas práticas para o pregão (ex: logístico, tributário, negociação fornecedor).

Estrutura JSON esperada:
{
  "custoUnitario": number,
  "valorFreteTotal": number,
  "aliquotaImposto": number,
  "outrasDespesasTotais": number,
  "valorGanhoUnitario": number,
  "explicacaoRaciocinio": "string",
  "dicasCompetitividade": ["string", "string"]
}`;

      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [{ role: "user", content: prompt }],
          systemInstruction
        }
      });

      const resData = await res.json();
      const rawReply = resData.reply || "";
      const parsed = parseAiJson(rawReply);
      if (parsed) {
        if (typeof parsed.custoUnitario === "number" && parsed.custoUnitario > 0) setCustoUnitario(parsed.custoUnitario);
        if (typeof parsed.valorFreteTotal === "number") setValorFreteTotal(parsed.valorFreteTotal);
        if (typeof parsed.aliquotaImposto === "number") setAliquotaImposto(parsed.aliquotaImposto);
        if (typeof parsed.outrasDespesasTotais === "number") setOutrasDespesasTotais(parsed.outrasDespesasTotais);
        if (typeof parsed.valorGanhoUnitario === "number" && parsed.valorGanhoUnitario > 0) setValorGanhoUnitario(parsed.valorGanhoUnitario);

        if (parsed.explicacaoRaciocinio) setAiReasoning(parsed.explicacaoRaciocinio);
        if (Array.isArray(parsed.dicasCompetitividade)) setAiTips(parsed.dicasCompetitividade);

        confetti({ particleCount: 60, spread: 45, origin: { y: 0.7 } });
      } else {
        alert("A IA gerou a resposta em formato não padrão. Tente novamente.");
      }
    } catch (error) {
      console.error("Erro na estimativa IA:", error);
      alert("Falha ao comunicar com o serviço de IA. Verifique sua conexão e tente novamente.");
    } finally {
      setIsEstimatingAi(false);
    }
  };

  // AI Function 2: Strategic Stop-Loss & Auction Tactics
  const handleAiStrategicAnalysis = async () => {
    setIsAnalyzingStrategy(true);
    try {
      const systemInstruction = `Você é um estrategista sênior de pregões eletrônicos e inteligência competitiva em compras públicas.
Análise a formação de preço da empresa e defina a estratégia de lances e o Stop-Loss (preço limite seguro).
Retorne RIGOROSAMENTE apenas um JSON válido sem marcações explicativas fora do JSON.`;

      const prompt = `
Analise a formação de preços atual do pregão:
- Item: "${descricaoProduto}"
- Órgão: "${orgaoComprador}"
- Quantidade: ${quantidade}
- Valor Máximo Edital: R$ ${valorMaximo}
- Lance Atual Pretendido (Unitário): R$ ${valorGanhoUnitario}
- Custo Unitário de Compra: R$ ${custoUnitario}
- Frete Total: R$ ${valorFreteTotal}
- Alíquota Tributos: ${aliquotaImposto}%
- Outras Despesas: R$ ${outrasDespesasTotais}

Responda em formato JSON:
{
  "stopLossUnitario": number (preço unitário mínimo de venda antes de zerar a margem líquida),
  "nivelRisco": "Baixo" | "Médio" | "Alto" | "Crítico",
  "scoreCompetitividade": number (0 a 100 indicando a força da proposta frente ao mercado público),
  "estrategiaDisputa": "Recomendação tática concisa de como conduzir os lances na disputa do pregão eletrônico.",
  "alertas": ["alerta 1", "alerta 2"],
  "pontosFortes": ["ponto forte 1", "ponto forte 2"]
}`;

      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [{ role: "user", content: prompt }],
          systemInstruction
        }
      });

      const resData = await res.json();
      const rawReply = resData.reply || "";
      const parsed = parseAiJson(rawReply);
      if (parsed) {
        setAiStrategyResult(parsed);
      }
    } catch (err) {
      console.error("Erro na análise estratégica IA:", err);
    } finally {
      setIsAnalyzingStrategy(false);
    }
  };

  // AI Function 3: Extract Supplier Quote (Text or File)
  const handleParseSupplierQuote = async () => {
    if (!quoteText.trim()) {
      alert("Cole o texto da cotação ou orçamento do fornecedor.");
      return;
    }

    setIsParsingQuote(true);
    try {
      const systemInstruction = `Você é um extrator de dados financeiros de cotações de fornecedores e propostas comerciais.
Extraia os valores numéricos de custo, frete, impostos e quantidade a partir do texto ou orçamento fornecido.
Retorne RIGOROSAMENTE apenas um JSON válido sem nenhum texto adicional.`;

      const prompt = `
Extraia os dados financeiros relevantes deste orçamento/cotação de fornecedor:
"${quoteText}"

Retorne o JSON no seguinte formato:
{
  "custoUnitario": number (preço de custo unitário do produto sem frete/imposto se destacado, ou preço final por unidade),
  "quantidade": number (quantidade cotada),
  "valorFreteTotal": number (valor de frete se mencionado, senão 0),
  "outrasDespesasTotais": number (outros custos ou taxas adicionais mencionadas, senão 0),
  "aliquotaImposto": number (porcentagem de IPI/ICMS/tributo se indicada no orçamento, senão 0),
  "fornecedorNome": "Nome do Fornecedor se identificado ou 'Fornecedor'",
  "resumo": "Breve resumo do que foi identificado"
}`;

      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [{ role: "user", content: prompt }],
          systemInstruction
        }
      });

      const resData = await res.json();
      const rawReply = resData.reply || "";
      const parsed = parseAiJson(rawReply);
      if (parsed) {
        if (typeof parsed.custoUnitario === "number" && parsed.custoUnitario > 0) {
          setCustoUnitario(parsed.custoUnitario);
        }
        if (typeof parsed.quantidade === "number" && parsed.quantidade > 0) {
          setQuantidade(parsed.quantidade);
        }
        if (typeof parsed.valorFreteTotal === "number") {
          setValorFreteTotal(parsed.valorFreteTotal);
        }
        if (typeof parsed.outrasDespesasTotais === "number") {
          setOutrasDespesasTotais(parsed.outrasDespesasTotais);
        }
        if (typeof parsed.aliquotaImposto === "number" && parsed.aliquotaImposto > 0) {
          setAliquotaImposto(parsed.aliquotaImposto);
        }

        confetti({ particleCount: 50, spread: 40 });
        setShowQuoteModal(false);
        setQuoteText("");
        setQuoteFileName(null);
        alert(`Cotação importada com sucesso! Dados aplicados para: ${parsed.fornecedorNome || "Fornecedor"}`);
      } else {
        alert("Não foi possível extrair números estruturados desta cotação. Tente ajustar o texto.");
      }
    } catch (e) {
      console.error("Erro ao importar cotação:", e);
      alert("Ocorreu um erro ao processar a cotação com a IA.");
    } finally {
      setIsParsingQuote(false);
    }
  };

  // Helper for file upload reading in quote modal
  const handleQuoteFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setQuoteFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setQuoteText(prev => prev ? `${prev}\n\n--- Conteúdo do Arquivo (${file.name}) ---\n${content}` : content);
      }
    };
    reader.readAsText(file);
  };

  // Preset Scenario Math Solver
  const applyTargetMargin = (targetMarginPercent: number) => {
    if (quantidade <= 0) return;
    const totalCostBeforeTax = (custoUnitario * quantidade) + valorFreteTotal + outrasDespesasTotais;
    const factor = 1 - ((aliquotaImposto + targetMarginPercent) / 100);

    if (factor <= 0) {
      alert("A soma da taxa de imposto e da margem desejada excede 100%. Ajuste a alíquota de imposto.");
      return;
    }

    const revenueRequired = totalCostBeforeTax / factor;
    const unitPriceRequired = Math.round((revenueRequired / quantidade) * 100) / 100;
    setValorGanhoUnitario(unitPriceRequired);
    confetti({ particleCount: 40, spread: 35, origin: { y: 0.8 } });
  };

  // Load from current active edital inside the store, if it matches
  useEffect(() => {
    if (activeEdital) {
      setOrgaoComprador(activeEdital.identificacaoCertame?.orgaoComprador || "");
      setDescricaoProduto(activeEdital.descricaoProduto || "");
      setDataHoraSessao(activeEdital.identificacaoCertame?.dataHoraSessao || "");
      setEnderecoEntrega(activeEdital.logisticaCronograma?.enderecoEntrega || "");
      setIdentificacaoNumerica(activeEdital.identificacaoCertame?.identificacaoNumerica || "");
      
      // Auto-extract numbers from identifications
      setNumeroProcesso(activeEdital.identificacaoCertame?.identificacaoNumerica || "");
      setPastaProcesso("Pasta " + (activeEdital.identificacaoCertame?.identificacaoNumerica?.substring(0, 5) || "01"));

      // Auto-fill price and quantity from edital details
      const parsed = parseEditalPriceAndQty(
        activeEdital.descricaoProduto || "", 
        activeEdital.viabilidadeFinanceira?.valorEstimado || ""
      );
      setValorMaximo(parsed.price);
      setQuantidade(parsed.quantity);

      // Remaining fields must start blank/0 for custom user insertion
      setCustoUnitario(0);
      setValorGanhoUnitario(0);
      setValorFreteTotal(0);
      setAliquotaImposto(0);
      setOutrasDespesasTotais(0);

      setSimulationTitle(`Simulação - ${activeEdital.identificacaoCertame?.orgaoComprador?.substring(0, 20) || "Pregão"}`);
    }
  }, [activeEdital]);

  // Fetch updated history just in case
  useEffect(() => {
    try {
      const saved = localStorage.getItem("aip_edital_history");
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {}
  }, []);

  // Sync to localstorage whenever simulations change
  useEffect(() => {
    localStorage.setItem("aip_pricing_simulations", JSON.stringify(simulations));
  }, [simulations]);

  // Handle Edital Dropdown selection change
  const handleEditalSelect = (editalId: string) => {
    setSelectedEditalId(editalId);
    if (!editalId) return;

    const matched = history.find((h: any) => h.id === editalId);
    if (matched && matched.analysis) {
      const analysis: EditalAnalysis = matched.analysis;
      setOrgaoComprador(analysis.identificacaoCertame?.orgaoComprador || "");
      setDescricaoProduto(analysis.descricaoProduto || "");
      setDataHoraSessao(analysis.identificacaoCertame?.dataHoraSessao || "");
      setEnderecoEntrega(analysis.logisticaCronograma?.enderecoEntrega || "");
      setIdentificacaoNumerica(analysis.identificacaoCertame?.identificacaoNumerica || "");
      
      // Default extraction
      setNumeroProcesso(analysis.identificacaoCertame?.identificacaoNumerica || "");
      setPastaProcesso("Pasta " + (analysis.identificacaoCertame?.identificacaoNumerica?.substring(0, 5) || "01"));

      // Estimate real price and real item quantity from edital
      const parsed = parseEditalPriceAndQty(
        analysis.descricaoProduto || "", 
        analysis.viabilidadeFinanceira?.valorEstimado || ""
      );
      setValorMaximo(parsed.price);
      setQuantidade(parsed.quantity);

      // Keep user inputs clear (blank / zero) for manual typing as requested
      setCustoUnitario(0);
      setValorGanhoUnitario(0);
      setValorFreteTotal(0);
      setAliquotaImposto(0);
      setOutrasDespesasTotais(0);

      setSimulationTitle(`Simulação - ${analysis.identificacaoCertame?.orgaoComprador?.substring(0, 25) || "Processo"}`);
    }
  };

  // Perform core financial computations
  const faturamentoGanhoTotal = valorGanhoUnitario * quantidade;
  const faturamentoEstimadoMaximo = valorMaximo * quantidade;
  
  // Real margins and tax subtractions of bidding
  const impostosCalculados = faturamentoGanhoTotal * (aliquotaImposto / 100);
  const custoAquisicaoTotal = custoUnitario * quantidade;
  const custoGeralLote = custoAquisicaoTotal + valorFreteTotal + impostosCalculados + outrasDespesasTotais;
  
  const lucroTotalCalculado = faturamentoGanhoTotal - custoGeralLote;
  const lucroPorUnidadeCalculado = quantidade > 0 ? lucroTotalCalculado / quantidade : 0;
  const margemLucroPercentual = faturamentoGanhoTotal > 0 ? (lucroTotalCalculado / faturamentoGanhoTotal) * 100 : 0;
  
  // Economy comparison for government or discounts
  const descontoOferecidoR$ = valorMaximo - valorGanhoUnitario;
  const descontoPercentual = valorMaximo > 0 ? (descontoOferecidoR$ / valorMaximo) * 100 : 0;

  // Handle Save Simulation
  const handleSaveSimulation = () => {
    const newSim: PriceSimulation = {
      id: Date.now().toString(),
      title: simulationTitle || "Planilha de Custo S/N",
      date: new Date().toLocaleString("pt-BR"),
      orgaoComprador,
      descricaoProduto,
      dataHoraSessao,
      enderecoEntrega,
      identificacaoNumerica,
      pastaProcesso,
      numeroProcesso,
      valorMaximo,
      custoUnitario,
      valorGanhoUnitario,
      quantidade,
      valorFreteTotal,
      aliquotaImposto,
      outrasDespesasTotais
    };

    setSimulations(prev => [newSim, ...prev]);
    confetti({ particleCount: 80, spread: 50, origin: { y: 0.8 } });
  };

  // Get risk evaluation of the margin
  const getMarginState = () => {
    if (margemLucroPercentual < 0) {
      return {
        label: "Danos Financeiros / Prejuízo",
        color: "text-rose-400 bg-rose-500/15 border-rose-500/20",
        message: "O valor ganho não cobre os custos operacionais do lote. Operação altamente perigosa!"
      };
    }
    if (margemLucroPercentual <= 8) {
      return {
        label: "Margem Crítica",
        color: "text-amber-800 bg-amber-50 border-amber-200",
        message: "A margem de lucro está abaixo dos níveis saudáveis de 10%. Custos adicionais de expedição podem liquidar o lucro."
      };
    }
    if (margemLucroPercentual <= 22) {
      return {
        label: "Margem Positiva / Viável",
        color: "text-blue-800 bg-blue-50 border-blue-200",
        message: "Excelente. A simulação mostra viabilidade financeira positiva com margem dentro dos limites previstos."
      };
    }
    return {
      label: "Margem Altamente Lucrativa",
      color: "text-emerald-800 bg-emerald-50 border-emerald-200",
      message: "Operação espetacular! Fornecimento de altíssima rentabilidade para a empresa."
    };
  };

  const marginAnalysis = getMarginState();

  // Export to Google Sheets simulation
  const handleSyncCalculationToGoogle = () => {
    const textReport = `
=== SIMULAÇÃO DE CUSTO E COMPOSIÇÃO DE PREÇO ===
Data da Planilha: ${new Date().toLocaleString("pt-BR")}
Órgão Comprador: ${orgaoComprador}
Objeto/Item: ${descricaoProduto}
Identificação / Pregão: ${identificacaoNumerica}
Número do Processo: ${numeroProcesso} - Pasta: ${pastaProcesso}
--------------------------------------------------
DADOS FINANCEIROS SIMULADOS:
Valor Máximo Limite Unitário: R$ ${valorMaximo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
Valor Fechado Unitário: R$ ${valorGanhoUnitario.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
Custo de Compra (Fornecedor) Unitário: R$ ${custoUnitario.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
Quantidade Requerida: ${quantidade} Unidades
Frete Total Estimado: R$ ${valorFreteTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
Alíquota de Tributação (%): ${aliquotaImposto} %
Despesas Administrativas Externas: R$ ${outrasDespesasTotais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
--------------------------------------------------
RESULTADOS PROCESSADOS:
Faturamento Bruto do Lote: R$ ${faturamentoGanhoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
Custo Operacional Total: R$ ${custoGeralLote.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
Impostos Declarados no Lote: R$ ${impostosCalculados.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
LUCRO LÍQUIDO POR UNIDADE: R$ ${lucroPorUnidadeCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
LUCRO LÍQUIDO TOTAL: R$ ${lucroTotalCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
MARGEM LÍQUIDA CALCULADA: ${margemLucroPercentual.toFixed(2)}%
DESCONTO DADO AO ÓRGÃO: ${descontoPercentual.toFixed(2)}%
--------------------------------------------------
Status da Simulação: ${marginAnalysis.label}
`;

    addSyncedItem(`Simulação de Custos Pregão - ${orgaoComprador.substring(0, 30)}`, "sheet", textReport);
    confetti({ particleCount: 50, spread: 40 });
    alert("Sincronismo Concluído! A simulação financeira foi arquivada e sincronizada na sua conta Google Workspace com sucesso.");
  };

  return (
    <div id="pricing-calculator-tab" className="space-y-6 text-[#111827] animate-fade-in select-text max-w-7xl mx-auto">
      
      {/* TOP CONTROLS & HEADER */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 md:p-5 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        
        {/* Title & Edital Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="bg-[#FF5A00] p-2.5 rounded-xl text-white shrink-0 shadow-xs">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-[#111827] text-base md:text-lg">Calculadora de Precificação</h2>
              {activeEdital && (
                <span className="bg-[#FF5A00]/10 text-[#FF5A00] border border-[#FF5A00]/20 text-[10px] font-bold px-2 py-0.5 rounded-full truncate max-w-[200px] font-mono">
                  {activeEdital.identificacaoCertame?.orgaoComprador || activeEdital.identificacaoCertame?.identificacaoNumerica || "Edital Ativo"}
                </span>
              )}
            </div>
            <p className="text-[#6B7280] text-xs mt-0.5">
              Calculador rápido de custos, tributos, margem e valor de lance ideal
            </p>
          </div>
        </div>

        {/* Edital Selector & IA Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {history.length > 0 && (
            <select
              value={selectedEditalId}
              onChange={(e) => handleEditalSelect(e.target.value)}
              className="bg-white border border-[#D1D5DB] rounded-xl px-3 py-2 text-xs text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#FF5A00] cursor-pointer max-w-[220px]"
            >
              <option value="">-- Puxar Edital do Histórico --</option>
              {history.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleAiEstimate}
            disabled={isEstimatingAi}
            className="bg-[#FF5A00] hover:bg-[#E04F00] active:bg-[#C74400] text-white font-bold text-xs py-2 px-3.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            title="IA calcula custo estimado, frete e impostos para este item"
          >
            {isEstimatingAi ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-200" />}
            <span>Preencher com IA</span>
          </button>

          <button
            onClick={() => setShowQuoteModal(true)}
            className="bg-white hover:bg-[#F3F4F6] border border-[#D1D5DB] text-[#374151] font-bold text-xs py-2 px-3.5 rounded-xl transition cursor-pointer flex items-center gap-1.5"
            title="Importar cotação do fornecedor em texto ou arquivo"
          >
            <UploadCloud className="w-3.5 h-3.5 text-emerald-600" />
            <span>Importar Cotação</span>
          </button>

          <button
            onClick={handleAiStrategicAnalysis}
            disabled={isAnalyzingStrategy}
            className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 font-bold text-xs py-2 px-3.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            title="Análise estratégica de risco e limite de Stop-Loss"
          >
            {isAnalyzingStrategy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5 text-emerald-600" />}
            <span>Stop-Loss IA</span>
          </button>
        </div>

      </div>

      {/* AI Feedback Banner (Compact) */}
      {aiReasoning && (
        <div className="bg-[#FF5A00]/10 border border-[#FF5A00]/20 rounded-xl p-3 text-xs text-[#C74400] flex items-start gap-2.5 animate-in fade-in">
          <Lightbulb className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-[#111827]">Raciocínio da IA:</span> {aiReasoning}
            {aiTips && aiTips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {aiTips.map((tip, idx) => (
                  <span key={idx} className="bg-white border border-[#E5E7EB] px-2 py-0.5 rounded text-[10px] text-[#374151] flex items-center gap-1 font-medium">
                    <Zap className="w-3 h-3 text-amber-500 shrink-0" />
                    {tip}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MAIN TWO-COLUMN CALCULATOR CARD */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT COLUMN: ENTRADAS DE CUSTO */}
        <div className="lg:col-span-6 bg-white border border-[#E5E7EB] rounded-2xl p-5 md:p-6 space-y-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-3">
            <h3 className="font-bold text-[#111827] text-sm uppercase tracking-wide font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              1. Custos & Tributos do Lote
            </h3>
            <span className="text-[10px] text-[#6B7280] font-mono font-semibold">Entradas</span>
          </div>

          <div className="space-y-4">
            {/* Custo Unitário */}
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-1 flex items-center justify-between">
                <span>Custo Unitário de Compra (Fornecedor)</span>
                <span className="text-[10px] text-[#6B7280]">Nota Fiscal / Fábrica</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-[#6B7280] font-bold font-mono">R$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={custoUnitario || ""}
                  onChange={(e) => setCustoUnitario(parseFloat(e.target.value) || 0)}
                  placeholder="0,00"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[#111827] font-bold font-mono focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition"
                />
              </div>
            </div>

            {/* Quantidade & Valor Máximo em 2 Colunas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1">
                  Quantidade de Itens
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantidade || ""}
                  onChange={(e) => setQuantidade(parseInt(e.target.value) || 0)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-2 text-xs text-[#111827] font-bold font-mono focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1">
                  Valor Máximo Edital (Un.)
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-[#6B7280] font-mono">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorMaximo || ""}
                    onChange={(e) => setValorMaximo(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl pl-8 pr-2 py-2 text-xs text-[#111827] font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition"
                  />
                </div>
              </div>
            </div>

            {/* Frete & Tributos em 2 Colunas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1">
                  Frete Total (R$)
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-[#6B7280] font-mono">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorFreteTotal || ""}
                    onChange={(e) => setValorFreteTotal(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl pl-8 pr-2 py-2 text-xs text-[#111827] font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1">
                  Alíquota Tributos (%)
                </label>
                <div className="relative">
                  <span className="absolute right-3 top-2 text-xs text-[#6B7280] font-bold font-mono">%</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={aliquotaImposto || ""}
                    onChange={(e) => setAliquotaImposto(parseFloat(e.target.value) || 0)}
                    placeholder="6.0"
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-2 text-xs text-[#111827] font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition"
                  />
                </div>
              </div>
            </div>

            {/* Outras Despesas */}
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-1">
                Outras Despesas Diretas / Rateio (R$)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-xs text-[#6B7280] font-mono">R$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={outrasDespesasTotais || ""}
                  onChange={(e) => setOutrasDespesasTotais(parseFloat(e.target.value) || 0)}
                  placeholder="0,00"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl pl-9 pr-3 py-2 text-xs text-[#111827] font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition"
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: PREÇO DE VENDA E RESULTADOS */}
        <div className="lg:col-span-6 bg-white border border-[#E5E7EB] rounded-2xl p-5 md:p-6 space-y-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-3">
              <h3 className="font-bold text-[#111827] text-sm uppercase tracking-wide font-mono flex items-center gap-2">
                <Coins className="w-4 h-4 text-emerald-600" />
                2. Lance Pretendido & Lucratividade
              </h3>
              <span className="text-[10px] text-emerald-700 font-mono font-bold">Saídas</span>
            </div>

            <div className="space-y-4 pt-1">
              {/* Main Price Output / Input */}
              <div className="bg-[#F9FAFB] p-4 rounded-xl border border-[#E5E7EB] space-y-2">
                <label className="block text-xs font-bold text-[#111827] uppercase tracking-wider flex items-center justify-between font-mono">
                  <span>Valor Ganho / Preço de Venda (Unitário)</span>
                  <span className="text-[10px] text-[#6B7280] font-mono font-normal">Edição em Tempo Real</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-base text-[#FF5A00] font-black font-mono">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorGanhoUnitario || ""}
                    onChange={(e) => setValorGanhoUnitario(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="w-full bg-white border border-[#D1D5DB] text-[#111827] rounded-xl pl-11 pr-4 py-2.5 text-lg font-black font-mono focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition"
                  />
                </div>

                {/* 1-Click Margin Solver Presets */}
                <div className="pt-2 border-t border-[#E5E7EB] space-y-1.5">
                  <span className="block text-[10px] text-[#6B7280] font-mono flex items-center gap-1 font-bold">
                    <Sliders className="w-3 h-3 text-[#FF5A00]" />
                    Definir Lance por Margem Desejada (1-Clique):
                  </span>
                  <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => applyTargetMargin(18)}
                      className="bg-gray-100 hover:bg-[#111827] hover:text-white text-[#374151] border border-[#E5E7EB] py-1.5 rounded-lg font-bold transition cursor-pointer text-center"
                    >
                      18% Margem
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTargetMargin(12)}
                      className="bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-800 border border-blue-200 py-1.5 rounded-lg font-bold transition cursor-pointer text-center"
                    >
                      12% Margem
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTargetMargin(7)}
                      className="bg-amber-50 hover:bg-amber-600 hover:text-white text-amber-800 border border-amber-200 py-1.5 rounded-lg font-bold transition cursor-pointer text-center"
                    >
                      7% Margem
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTargetMargin(2)}
                      className="bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-800 border border-rose-200 py-1.5 rounded-lg font-bold transition cursor-pointer text-center"
                    >
                      Stop-Loss (2%)
                    </button>
                  </div>
                </div>
              </div>

              {/* Results Summary Box */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#E5E7EB] space-y-0.5">
                  <span className="block text-[9px] text-[#6B7280] font-mono uppercase font-semibold">Lucro / Unid.</span>
                  <span className={`block text-sm font-black font-mono ${lucroPorUnidadeCalculado < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                    R$ {lucroPorUnidadeCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#FF5A00]/30 space-y-0.5">
                  <span className="block text-[9px] text-[#FF5A00] font-mono font-bold uppercase">LUCRO TOTAL</span>
                  <span className={`block text-base font-black font-mono ${lucroTotalCalculado < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                    R$ {lucroTotalCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#E5E7EB] space-y-0.5">
                  <span className="block text-[9px] text-[#6B7280] font-mono uppercase font-semibold">Margem %</span>
                  <span className={`block text-sm font-black font-mono ${margemLucroPercentual < 0 ? "text-rose-600" : margemLucroPercentual <= 8 ? "text-amber-600" : "text-emerald-700"}`}>
                    {margemLucroPercentual.toFixed(1)} %
                  </span>
                </div>
              </div>

              {/* Quick Metrics Bar */}
              <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#E5E7EB] text-[11px] flex items-center justify-between text-[#374151]">
                <div>
                  <span className="text-[#6B7280] text-[10px]">Faturamento Total: </span>
                  <span className="font-mono font-bold text-[#111827]">R$ {faturamentoGanhoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-[#6B7280] text-[10px]">Desconto: </span>
                  <span className="font-mono font-bold text-[#FF5A00]">{descontoPercentual.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#F3F4F6]">
            <button
              onClick={handleSaveSimulation}
              className="bg-white hover:bg-[#F3F4F6] border border-[#D1D5DB] text-[#374151] font-bold text-xs py-2.5 px-4 rounded-xl transition cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5 text-[#6B7280]" />
              <span>Salvar Cenário</span>
            </button>

            <button
              onClick={handleSyncCalculationToGoogle}
              className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Exportar Google</span>
            </button>
          </div>
        </div>

      </div>

      {/* AI STRATEGY RESULT PANEL (IF ACTIVE) */}
      {aiStrategyResult && (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 md:p-5 space-y-3 shadow-xs animate-in fade-in">
          <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-2.5">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-[#FF5A00]" />
              <h4 className="font-extrabold text-[#111827] text-xs uppercase tracking-wide font-mono">
                Diagnóstico de Pregão & Limite Stop-Loss
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                aiStrategyResult.nivelRisco === "Baixo" ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
                aiStrategyResult.nivelRisco === "Médio" ? "bg-blue-50 text-blue-800 border-blue-200" :
                "bg-amber-50 text-amber-800 border-amber-200"
              }`}>
                Risco: {aiStrategyResult.nivelRisco}
              </span>
              <span className="text-[10px] bg-[#FF5A00]/10 text-[#FF5A00] font-mono font-bold px-2 py-0.5 rounded border border-[#FF5A00]/20">
                Score: {aiStrategyResult.scoreCompetitividade}/100
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-rose-50 p-3 rounded-xl border border-rose-200 text-center">
              <span className="block text-[9px] text-rose-800 font-mono font-bold uppercase">Stop-Loss Limit (Lance Mínimo Seguro)</span>
              <span className="block text-lg font-black text-rose-900 font-mono mt-0.5">
                R$ {aiStrategyResult.stopLossUnitario.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#E5E7EB]">
              <span className="block text-[9px] text-[#FF5A00] font-mono font-bold uppercase">Recomendação Tática</span>
              <p className="text-xs text-[#374151] leading-tight mt-0.5">{aiStrategyResult.estrategiaDisputa}</p>
            </div>
          </div>
        </div>
      )}

      {/* COLLAPSIBLE ACCORDION: DADOS CADASTRAIS DO PREGÃO (OPCIONAL) */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-xs">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-bold text-[#374151] hover:text-[#111827] hover:bg-[#F9FAFB] transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-[#FF5A00]" />
            <span>Dados Cadastrais do Pregão / Processo (Opcional)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#6B7280] font-normal">
              {showDetails ? "Ocultar Formulário" : "Expandir Informações de Identificação"}
            </span>
            <ChevronRight className={`w-4 h-4 transition-transform ${showDetails ? "rotate-90" : ""}`} />
          </div>
        </button>

        {showDetails && (
          <div className="p-5 border-t border-[#E5E7EB] space-y-4 bg-[#F9FAFB] animate-in fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-[#6B7280] mb-1 font-semibold">Órgão Comprador</label>
                <input
                  type="text"
                  value={orgaoComprador}
                  onChange={(e) => setOrgaoComprador(e.target.value)}
                  placeholder="ex: Tribunal Regional"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-1.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#6B7280] mb-1 font-semibold">Item / Descrição do Produto</label>
                <input
                  type="text"
                  value={descricaoProduto}
                  onChange={(e) => setDescricaoProduto(e.target.value)}
                  placeholder="ex: Cadeira Giratória"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-1.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#6B7280] mb-1 font-semibold">Número Pregão / Código</label>
                <input
                  type="text"
                  value={identificacaoNumerica}
                  onChange={(e) => setIdentificacaoNumerica(e.target.value)}
                  placeholder="Nº Pregão"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-1.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#6B7280] mb-1 font-semibold">Pasta do Processo</label>
                <input
                  type="text"
                  value={pastaProcesso}
                  onChange={(e) => setPastaProcesso(e.target.value)}
                  placeholder="Pasta"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-1.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#6B7280] mb-1 font-semibold">Nº do Processo</label>
                <input
                  type="text"
                  value={numeroProcesso}
                  onChange={(e) => setNumeroProcesso(e.target.value)}
                  placeholder="Número Processo"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-1.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#6B7280] mb-1 font-semibold">Local / Endereço de Entrega</label>
                <input
                  type="text"
                  value={enderecoEntrega}
                  onChange={(e) => setEnderecoEntrega(e.target.value)}
                  placeholder="Endereço de Entrega"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3 py-1.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* COLLAPSED / EXPANDABLE SAVED SIMULATIONS */}
      {simulations.length > 0 && (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-xs">
          <button
            onClick={() => setShowSavedSimulations(!showSavedSimulations)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-bold text-[#374151] hover:text-[#111827] hover:bg-[#F9FAFB] transition cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-[#FF5A00]" />
              <span>Simulações Salvas no Histórico ({simulations.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#6B7280] font-normal">
                {showSavedSimulations ? "Ocultar Histórico" : "Ver Cenários Salvos"}
              </span>
              <ChevronRight className={`w-4 h-4 transition-transform ${showSavedSimulations ? "rotate-90" : ""}`} />
            </div>
          </button>

          {showSavedSimulations && (
            <div className="p-5 border-t border-[#E5E7EB] space-y-3 bg-[#F9FAFB] animate-in fade-in">
              <div className="flex items-center justify-between pb-2">
                <span className="text-xs font-semibold text-[#6B7280]">Cenários Gravados:</span>
                {showConfirmClearSimulations ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSimulations([]);
                        localStorage.removeItem("aip_pricing_simulations");
                        setShowConfirmClearSimulations(false);
                      }}
                      className="text-[10px] text-rose-800 hover:text-rose-900 font-bold bg-rose-100 px-2 py-1 rounded border border-rose-200 cursor-pointer"
                    >
                      Confirmar Limpeza
                    </button>
                    <button
                      onClick={() => setShowConfirmClearSimulations(false)}
                      className="text-[10px] text-[#374151] hover:text-[#111827] bg-white px-2 py-1 rounded border border-[#D1D5DB] cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConfirmClearSimulations(true)}
                    className="text-[10px] text-rose-600 hover:text-rose-800 font-medium cursor-pointer"
                  >
                    Limpar Histórico de Simulações
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {simulations.map((sim) => {
                  const totalRevenue = sim.valorGanhoUnitario * sim.quantidade;
                  const totalCost = (sim.custoUnitario * sim.quantidade) + sim.valorFreteTotal + sim.outrasDespesasTotais;
                  const tax = totalRevenue * (sim.aliquotaImposto / 100);
                  const profit = totalRevenue - totalCost - tax;
                  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

                  return (
                    <div key={sim.id} className="bg-white border border-[#E5E7EB] rounded-xl p-3.5 space-y-2 relative shadow-xs">
                      <div className="flex items-start justify-between">
                        <div>
                          <h5 className="font-bold text-[#111827] text-xs">{sim.title}</h5>
                          <p className="text-[10px] text-[#6B7280] truncate max-w-[240px]">{sim.orgaoComprador || sim.descricaoProduto || "Simulação"}</p>
                        </div>
                        <button
                          onClick={() => {
                            const updated = simulations.filter(s => s.id !== sim.id);
                            setSimulations(updated);
                            localStorage.setItem("aip_pricing_simulations", JSON.stringify(updated));
                          }}
                          className="text-[#6B7280] hover:text-rose-600 p-1 cursor-pointer"
                          title="Excluir simulação"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-center pt-1 border-t border-[#E5E7EB]">
                        <div className="bg-[#F9FAFB] p-1.5 rounded">
                          <span className="block text-[#6B7280] text-[8px] uppercase">Lance Un.</span>
                          <span className="text-emerald-700 font-bold">R$ {sim.valorGanhoUnitario}</span>
                        </div>
                        <div className="bg-[#F9FAFB] p-1.5 rounded">
                          <span className="block text-[#6B7280] text-[8px] uppercase">Margem</span>
                          <span className={`font-bold ${margin < 0 ? "text-rose-600" : "text-emerald-700"}`}>{margin.toFixed(1)}%</span>
                        </div>
                        <div className="bg-[#F9FAFB] p-1.5 rounded">
                          <span className="block text-[#6B7280] text-[8px] uppercase">Lucro Total</span>
                          <span className={`font-bold ${profit < 0 ? "text-rose-600" : "text-emerald-700"}`}>R$ {profit.toFixed(0)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setOrgaoComprador(sim.orgaoComprador || "");
                          setDescricaoProduto(sim.descricaoProduto || "");
                          setDataHoraSessao(sim.dataHoraSessao || "");
                          setEnderecoEntrega(sim.enderecoEntrega || "");
                          setIdentificacaoNumerica(sim.identificacaoNumerica || "");
                          setPastaProcesso(sim.pastaProcesso || "");
                          setNumeroProcesso(sim.numeroProcesso || "");
                          setValorMaximo(sim.valorMaximo);
                          setCustoUnitario(sim.custoUnitario);
                          setValorGanhoUnitario(sim.valorGanhoUnitario);
                          setQuantidade(sim.quantidade);
                          setValorFreteTotal(sim.valorFreteTotal);
                          setAliquotaImposto(sim.aliquotaImposto);
                          setOutrasDespesasTotais(sim.outrasDespesasTotais);
                          setSimulationTitle(sim.title);
                        }}
                        className="w-full text-center text-[#FF5A00] hover:text-[#E04F00] font-bold text-[10px] pt-1 block cursor-pointer"
                      >
                        Restaurar este cenário na Calculadora ↑
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: IMPORTAR COTAÇÃO DO FORNECEDOR COM IA */}
      {showQuoteModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-[#E5E7EB] rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-xl relative">
            
            <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-4">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-700">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-[#111827] text-base">Importar Cotação de Fornecedor com IA</h3>
                  <p className="text-xs text-[#6B7280]">Cole o texto do orçamento, e-mail ou suba o arquivo para preenchimento automático</p>
                </div>
              </div>

              <button
                onClick={() => setShowQuoteModal(false)}
                className="text-[#6B7280] hover:text-[#111827] p-1 rounded-lg hover:bg-[#F3F4F6] transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* File upload prompt */}
              <div>
                <label className="block text-[11px] font-bold text-[#374151] uppercase tracking-wider mb-2 flex items-center justify-between font-mono">
                  <span>Anexar Arquivo de Cotação (TXT, CSV, PDF)</span>
                  {quoteFileName && <span className="text-emerald-700 font-mono text-[10px]">{quoteFileName}</span>}
                </label>
                <div className="border-2 border-dashed border-[#D1D5DB] hover:border-emerald-500 bg-[#F9FAFB] hover:bg-emerald-50/50 rounded-xl p-4 text-center transition cursor-pointer relative">
                  <input
                    type="file"
                    accept=".txt,.csv,.json,.pdf,.doc,.docx"
                    onChange={handleQuoteFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <Upload className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
                  <span className="text-xs text-[#374151] font-medium block">
                    {quoteFileName ? `Arquivo selecionado: ${quoteFileName}` : "Clique ou arraste a proposta do fornecedor aqui"}
                  </span>
                  <span className="text-[10px] text-[#6B7280] mt-0.5 block">
                    A IA vai ler o custo unitário, quantidade, frete e tributos
                  </span>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#E5E7EB]"></div>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-mono">
                  <span className="bg-white px-2 text-[#6B7280]">ou cole a mensagem de texto</span>
                </div>
              </div>

              {/* Text Area */}
              <div>
                <textarea
                  rows={6}
                  value={quoteText}
                  onChange={(e) => setQuoteText(e.target.value)}
                  placeholder={`Exemplo de cotação do fornecedor:\n"Cotação Fornecedor TechLtda - Item: Cadeira B2B\nPreço unitário: R$ 145,00\nQuantidade: 50 unidades\nFrete total CIF para SP: R$ 380,00\nImposto IPI: 5%"`}
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl p-3.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00] transition font-sans leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#F3F4F6]">
              <button
                type="button"
                onClick={() => setShowQuoteModal(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] transition cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleParseSupplierQuote}
                disabled={isParsingQuote || !quoteText.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs py-2.5 px-5 rounded-xl transition-all cursor-pointer flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                {isParsingQuote ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Processando com IA...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-200" />
                    Extrair e Preencher Calculadora
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
