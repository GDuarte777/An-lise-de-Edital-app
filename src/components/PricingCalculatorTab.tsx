import React, { useState, useEffect } from "react";
import { 
  Calculator, Landmark, MapPin, Calendar, Coins, TrendingUp, AlertTriangle, CheckCircle, 
  HelpCircle, ChevronRight, Save, ClipboardList, Info, FileSpreadsheet, Trash2, Plus, Folder, Percent, Tag, ShoppingBag, Truck, BadgePercent,
  Sparkles, BrainCircuit, Upload, FileText, Lightbulb, Zap, ShieldCheck, Sliders, RefreshCw, ArrowRight, UploadCloud, Check
} from "lucide-react";
import { EditalAnalysis } from "../types";
import { addSyncedItem } from "../utils/googleSync";
import { apiFetch, formatAiError, readJsonResponse } from "../utils/aiClientHelper";
import {
  fetchSimulacoesFromSupabase,
  saveSimulacaoToSupabase,
  deleteSimulacaoFromSupabase,
  subscribeToSupabaseTable
} from "../utils/supabaseClient";
import confetti from "canvas-confetti";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

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

  // Lista de simulações (Supabase com fallback Local e Realtime)
  const [simulations, setSimulations] = useState<PriceSimulation[]>(() => {
    try {
      const saved = localStorage.getItem("aip_pricing_simulations");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [showConfirmClearSimulations, setShowConfirmClearSimulations] = useState(false);

  useEffect(() => {
    async function loadSimulations() {
      try {
        const dbSims = await fetchSimulacoesFromSupabase();
        if (dbSims && dbSims.length > 0) {
          setSimulations(dbSims);
          localStorage.setItem("aip_pricing_simulations", JSON.stringify(dbSims));
          return;
        }
      } catch (e) {
        console.warn("Falha ao buscar simulações do Supabase:", e);
      }

      try {
        const saved = localStorage.getItem("aip_pricing_simulations");
        if (saved) {
          setSimulations(JSON.parse(saved));
        }
      } catch (e) {}
    }
    loadSimulations();

    const unsubscribe = subscribeToSupabaseTable("simulacoes_precos", () => {
      loadSimulations();
    });

    const handleFocus = () => loadSimulations();
    window.addEventListener("focus", handleFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

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

      const resData = await readJsonResponse(res);
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

      const resData = await readJsonResponse(res);
      const rawReply = resData.reply || "";
      const parsed = parseAiJson(rawReply);
      if (parsed) {
        setAiStrategyResult(parsed);
      }
    } catch (err: any) {
      console.error("Erro na análise estratégica IA:", err);
      // Silent: just log — UI shows nothing if strategy fails (non-critical)
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

      const resData = await readJsonResponse(res);
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
    } catch (e: any) {
      console.error("Erro ao importar cotação:", e);
      alert(formatAiError(e));
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

    saveSimulacaoToSupabase(newSim).catch(e => console.warn("Erro ao salvar simulação no Supabase:", e));
    setSimulations(prev => [newSim, ...prev]);
    confetti({ particleCount: 80, spread: 50, origin: { y: 0.8 } });
  };

  // Get risk evaluation of the margin
  const getMarginState = () => {
    if (margemLucroPercentual < 0) {
      return {
        label: "Danos Financeiros / Prejuízo",
        color: "text-destructive bg-destructive/15 border-destructive/20",
        message: "O valor ganho não cobre os custos operacionais do lote. Operação altamente perigosa!"
      };
    }
    if (margemLucroPercentual <= 8) {
      return {
        label: "Margem Crítica",
        color: "text-warning bg-warning/15 border-warning/30",
        message: "A margem de lucro está abaixo dos níveis saudáveis de 10%. Custos adicionais de expedição podem liquidar o lucro."
      };
    }
    if (margemLucroPercentual <= 22) {
      return {
        label: "Margem Positiva / Viável",
        color: "text-primary bg-primary/10 border-primary/20",
        message: "Excelente. A simulação mostra viabilidade financeira positiva com margem dentro dos limites previstos."
      };
    }
    return {
      label: "Margem Altamente Lucrativa",
      color: "text-success bg-success/15 border-success/30",
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
    <div id="pricing-calculator-tab" className="space-y-6 text-foreground animate-fade-in select-text max-w-7xl mx-auto">

      {/* TOP CONTROLS & HEADER */}
      <Card className="flex-col md:flex-row items-stretch md:items-center justify-between gap-4 px-4 md:px-5 py-4 md:py-5">

        {/* Title & Edital Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="bg-primary p-2.5 rounded-xl text-primary-foreground shrink-0">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-foreground text-base md:text-lg">Calculadora de Precificação</h2>
              {activeEdital && (
                <Badge variant="outline" className="text-[10px] font-bold truncate max-w-[200px] font-mono rounded-full">
                  {activeEdital.identificacaoCertame?.orgaoComprador || activeEdital.identificacaoCertame?.identificacaoNumerica || "Edital Ativo"}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs mt-0.5">
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
              className="bg-background border border-input rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer max-w-[220px]"
            >
              <option value="">-- Puxar Edital do Histórico --</option>
              {history.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          )}

          <Button
            onClick={handleAiEstimate}
            disabled={isEstimatingAi}
            size="sm"
            className="font-bold rounded-xl"
            title="IA calcula custo estimado, frete e impostos para este item"
          >
            {isEstimatingAi ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>Preencher com IA</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowQuoteModal(true)}
            className="font-bold rounded-xl"
            title="Importar cotação do fornecedor em texto ou arquivo"
          >
            <UploadCloud className="w-3.5 h-3.5 text-success" />
            <span>Importar Cotação</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleAiStrategicAnalysis}
            disabled={isAnalyzingStrategy}
            className="font-bold rounded-xl border-success/30 text-success hover:bg-success/10 hover:text-success"
            title="Análise estratégica de risco e limite de Stop-Loss"
          >
            {isAnalyzingStrategy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5" />}
            <span>Stop-Loss IA</span>
          </Button>
        </div>

      </Card>

      {/* AI Feedback Banner (Compact) */}
      {aiReasoning && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-foreground flex items-start gap-2.5 animate-in fade-in">
          <Lightbulb className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-foreground">Raciocínio da IA:</span> {aiReasoning}
            {aiTips && aiTips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {aiTips.map((tip, idx) => (
                  <span key={idx} className="bg-card border border-border px-2 py-0.5 rounded text-[10px] text-foreground flex items-center gap-1 font-medium">
                    <Zap className="w-3 h-3 text-warning shrink-0" />
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
        <Card className="lg:col-span-6 gap-5 px-5 md:px-6 py-5 md:py-6">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-foreground text-sm uppercase tracking-wide font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              1. Custos & Tributos do Lote
            </h3>
            <span className="text-[10px] text-muted-foreground font-mono font-semibold">Entradas</span>
          </div>

          <div className="space-y-4">
            {/* Custo Unitário */}
            <div>
              <Label className="w-full justify-between text-xs font-semibold text-foreground mb-1">
                <span>Custo Unitário de Compra (Fornecedor)</span>
                <span className="text-[10px] text-muted-foreground font-normal">Nota Fiscal / Fábrica</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-bold font-mono">R$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={custoUnitario || ""}
                  onChange={(e) => setCustoUnitario(parseFloat(e.target.value) || 0)}
                  placeholder="0,00"
                  className="rounded-xl pl-9 pr-3 text-sm text-foreground font-bold font-mono"
                />
              </div>
            </div>

            {/* Quantidade & Valor Máximo em 2 Colunas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="block text-xs font-semibold text-foreground mb-1">
                  Quantidade de Itens
                </Label>
                <Input
                  type="number"
                  min="1"
                  value={quantidade || ""}
                  onChange={(e) => setQuantidade(parseInt(e.target.value) || 0)}
                  className="rounded-xl text-xs text-foreground font-bold font-mono"
                />
              </div>

              <div>
                <Label className="block text-xs font-semibold text-foreground mb-1">
                  Valor Máximo Edital (Un.)
                </Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">R$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorMaximo || ""}
                    onChange={(e) => setValorMaximo(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="rounded-xl pl-8 pr-2 text-xs text-foreground font-semibold font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Frete & Tributos em 2 Colunas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="block text-xs font-semibold text-foreground mb-1">
                  Frete Total (R$)
                </Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">R$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorFreteTotal || ""}
                    onChange={(e) => setValorFreteTotal(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="rounded-xl pl-8 pr-2 text-xs text-foreground font-semibold font-mono"
                  />
                </div>
              </div>

              <div>
                <Label className="block text-xs font-semibold text-foreground mb-1">
                  Alíquota Tributos (%)
                </Label>
                <div className="relative">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-bold font-mono">%</span>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={aliquotaImposto || ""}
                    onChange={(e) => setAliquotaImposto(parseFloat(e.target.value) || 0)}
                    placeholder="6.0"
                    className="rounded-xl px-3 text-xs text-foreground font-semibold font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Outras Despesas */}
            <div>
              <Label className="block text-xs font-semibold text-foreground mb-1">
                Outras Despesas Diretas / Rateio (R$)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">R$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={outrasDespesasTotais || ""}
                  onChange={(e) => setOutrasDespesasTotais(parseFloat(e.target.value) || 0)}
                  placeholder="0,00"
                  className="rounded-xl pl-9 pr-3 text-xs text-foreground font-semibold font-mono"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* RIGHT COLUMN: PREÇO DE VENDA E RESULTADOS */}
        <Card className="lg:col-span-6 gap-5 px-5 md:px-6 py-5 md:py-6 justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-foreground text-sm uppercase tracking-wide font-mono flex items-center gap-2">
                <Coins className="w-4 h-4 text-success" />
                2. Lance Pretendido & Lucratividade
              </h3>
              <span className="text-[10px] text-success font-mono font-bold">Saídas</span>
            </div>

            <div className="space-y-4 pt-1">
              {/* Main Price Output / Input */}
              <div className="bg-muted p-4 rounded-xl border border-border space-y-2">
                <Label className="w-full justify-between text-xs font-bold text-foreground uppercase tracking-wider font-mono">
                  <span>Valor Ganho / Preço de Venda (Unitário)</span>
                  <span className="text-[10px] text-muted-foreground font-mono font-normal">Edição em Tempo Real</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-primary font-black font-mono">R$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorGanhoUnitario || ""}
                    onChange={(e) => setValorGanhoUnitario(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="bg-card text-foreground rounded-xl pl-11 pr-4 text-lg font-black font-mono h-11"
                  />
                </div>

                {/* 1-Click Margin Solver Presets */}
                <div className="pt-2 border-t border-border space-y-1.5">
                  <span className="block text-[10px] text-muted-foreground font-mono flex items-center gap-1 font-bold">
                    <Sliders className="w-3 h-3 text-primary" />
                    Definir Lance por Margem Desejada (1-Clique):
                  </span>
                  <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => applyTargetMargin(18)}
                      className="h-auto py-1.5 px-1 rounded-lg font-bold text-[10px]"
                    >
                      18% Margem
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => applyTargetMargin(12)}
                      className="h-auto py-1.5 px-1 rounded-lg font-bold text-[10px] text-primary border-primary/30 hover:bg-primary hover:text-primary-foreground"
                    >
                      12% Margem
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => applyTargetMargin(7)}
                      className="h-auto py-1.5 px-1 rounded-lg font-bold text-[10px] text-warning border-warning/40 hover:bg-warning hover:text-warning-foreground"
                    >
                      7% Margem
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => applyTargetMargin(2)}
                      className="h-auto py-1.5 px-1 rounded-lg font-bold text-[10px] text-destructive border-destructive/40 hover:bg-destructive hover:text-white"
                    >
                      Stop-Loss (2%)
                    </Button>
                  </div>
                </div>
              </div>

              {/* Results Summary Box */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted p-3 rounded-xl border border-border space-y-0.5">
                  <span className="block text-[9px] text-muted-foreground font-mono uppercase font-semibold">Lucro / Unid.</span>
                  <span className={`block text-sm font-black font-mono ${lucroPorUnidadeCalculado < 0 ? "text-destructive" : "text-success"}`}>
                    R$ {lucroPorUnidadeCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="bg-muted p-3 rounded-xl border border-primary/30 space-y-0.5">
                  <span className="block text-[9px] text-primary font-mono font-bold uppercase">LUCRO TOTAL</span>
                  <span className={`block text-base font-black font-mono ${lucroTotalCalculado < 0 ? "text-destructive" : "text-success"}`}>
                    R$ {lucroTotalCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="bg-muted p-3 rounded-xl border border-border space-y-0.5">
                  <span className="block text-[9px] text-muted-foreground font-mono uppercase font-semibold">Margem %</span>
                  <span className={`block text-sm font-black font-mono ${margemLucroPercentual < 0 ? "text-destructive" : margemLucroPercentual <= 8 ? "text-warning" : "text-success"}`}>
                    {margemLucroPercentual.toFixed(1)} %
                  </span>
                </div>
              </div>

              {/* Quick Metrics Bar */}
              <div className="bg-muted p-3 rounded-xl border border-border text-[11px] flex items-center justify-between text-foreground">
                <div>
                  <span className="text-muted-foreground text-[10px]">Faturamento Total: </span>
                  <span className="font-mono font-bold text-foreground">R$ {faturamentoGanhoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-[10px]">Desconto: </span>
                  <span className="font-mono font-bold text-primary">{descontoPercentual.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
            <Button
              variant="outline"
              onClick={handleSaveSimulation}
              className="font-bold rounded-xl"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Salvar Cenário</span>
            </Button>

            <Button
              onClick={handleSyncCalculationToGoogle}
              className="font-bold rounded-xl border-success/30 bg-success text-success-foreground hover:bg-success/90"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Exportar Google</span>
            </Button>
          </div>
        </Card>

      </div>

      {/* AI STRATEGY RESULT PANEL (IF ACTIVE) */}
      {aiStrategyResult && (
        <Card className="px-4 md:px-5 py-4 md:py-5 gap-3 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-primary" />
              <h4 className="font-extrabold text-foreground text-xs uppercase tracking-wide font-mono">
                Diagnóstico de Pregão & Limite Stop-Loss
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  aiStrategyResult.nivelRisco === "Baixo" ? "success" :
                  aiStrategyResult.nivelRisco === "Médio" ? "warning" :
                  "destructive"
                }
                className="rounded-full font-bold"
              >
                Risco: {aiStrategyResult.nivelRisco}
              </Badge>
              <Badge variant="outline" className="font-mono font-bold text-primary border-primary/20 bg-primary/10">
                Score: {aiStrategyResult.scoreCompetitividade}/100
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-destructive/10 p-3 rounded-xl border border-destructive/20 text-center">
              <span className="block text-[9px] text-destructive font-mono font-bold uppercase">Stop-Loss Limit (Lance Mínimo Seguro)</span>
              <span className="block text-lg font-black text-destructive font-mono mt-0.5">
                R$ {aiStrategyResult.stopLossUnitario.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="bg-muted p-3 rounded-xl border border-border">
              <span className="block text-[9px] text-primary font-mono font-bold uppercase">Recomendação Tática</span>
              <p className="text-xs text-foreground leading-tight mt-0.5">{aiStrategyResult.estrategiaDisputa}</p>
            </div>
          </div>
        </Card>
      )}

      {/* COLLAPSIBLE ACCORDION: DADOS CADASTRAIS DO PREGÃO (OPCIONAL) */}
      <Card className="p-0 gap-0 overflow-hidden">
        <Button
          variant="ghost"
          onClick={() => setShowDetails(!showDetails)}
          className="w-full h-auto justify-between px-5 py-3.5 rounded-none text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-primary" />
            <span>Dados Cadastrais do Pregão / Processo (Opcional)</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-normal">
              {showDetails ? "Ocultar Formulário" : "Expandir Informações de Identificação"}
            </span>
            <ChevronRight className={`w-4 h-4 transition-transform ${showDetails ? "rotate-90" : ""}`} />
          </span>
        </Button>

        {showDetails && (
          <div className="p-5 border-t border-border space-y-4 bg-muted/40 animate-in fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <Label className="block text-[10px] text-muted-foreground mb-1 font-semibold">Órgão Comprador</Label>
                <Input
                  type="text"
                  value={orgaoComprador}
                  onChange={(e) => setOrgaoComprador(e.target.value)}
                  placeholder="ex: Tribunal Regional"
                  className="rounded-xl text-xs"
                />
              </div>

              <div>
                <Label className="block text-[10px] text-muted-foreground mb-1 font-semibold">Item / Descrição do Produto</Label>
                <Input
                  type="text"
                  value={descricaoProduto}
                  onChange={(e) => setDescricaoProduto(e.target.value)}
                  placeholder="ex: Cadeira Giratória"
                  className="rounded-xl text-xs"
                />
              </div>

              <div>
                <Label className="block text-[10px] text-muted-foreground mb-1 font-semibold">Número Pregão / Código</Label>
                <Input
                  type="text"
                  value={identificacaoNumerica}
                  onChange={(e) => setIdentificacaoNumerica(e.target.value)}
                  placeholder="Nº Pregão"
                  className="rounded-xl text-xs"
                />
              </div>

              <div>
                <Label className="block text-[10px] text-muted-foreground mb-1 font-semibold">Pasta do Processo</Label>
                <Input
                  type="text"
                  value={pastaProcesso}
                  onChange={(e) => setPastaProcesso(e.target.value)}
                  placeholder="Pasta"
                  className="rounded-xl text-xs"
                />
              </div>

              <div>
                <Label className="block text-[10px] text-muted-foreground mb-1 font-semibold">Nº do Processo</Label>
                <Input
                  type="text"
                  value={numeroProcesso}
                  onChange={(e) => setNumeroProcesso(e.target.value)}
                  placeholder="Número Processo"
                  className="rounded-xl text-xs"
                />
              </div>

              <div>
                <Label className="block text-[10px] text-muted-foreground mb-1 font-semibold">Local / Endereço de Entrega</Label>
                <Input
                  type="text"
                  value={enderecoEntrega}
                  onChange={(e) => setEnderecoEntrega(e.target.value)}
                  placeholder="Endereço de Entrega"
                  className="rounded-xl text-xs"
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* COLLAPSED / EXPANDABLE SAVED SIMULATIONS */}
      {simulations.length > 0 && (
        <Card className="p-0 gap-0 overflow-hidden">
          <Button
            variant="ghost"
            onClick={() => setShowSavedSimulations(!showSavedSimulations)}
            className="w-full h-auto justify-between px-5 py-3.5 rounded-none text-xs font-bold text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" />
              <span>Simulações Salvas no Histórico ({simulations.length})</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-normal">
                {showSavedSimulations ? "Ocultar Histórico" : "Ver Cenários Salvos"}
              </span>
              <ChevronRight className={`w-4 h-4 transition-transform ${showSavedSimulations ? "rotate-90" : ""}`} />
            </span>
          </Button>

          {showSavedSimulations && (
            <div className="p-5 border-t border-border space-y-3 bg-muted/40 animate-in fade-in">
              <div className="flex items-center justify-between pb-2">
                <span className="text-xs font-semibold text-muted-foreground">Cenários Gravados:</span>
                {showConfirmClearSimulations ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setSimulations([]);
                        localStorage.removeItem("aip_pricing_simulations");
                        setShowConfirmClearSimulations(false);
                      }}
                      className="h-auto py-1 px-2 text-[10px] font-bold"
                    >
                      Confirmar Limpeza
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowConfirmClearSimulations(false)}
                      className="h-auto py-1 px-2 text-[10px]"
                    >
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConfirmClearSimulations(true)}
                    className="text-[10px] text-destructive hover:text-destructive/80 font-medium cursor-pointer"
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
                    <Card key={sim.id} className="p-3.5 gap-2 relative">
                      <div className="flex items-start justify-between">
                        <div>
                          <h5 className="font-bold text-foreground text-xs">{sim.title}</h5>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[240px]">{sim.orgaoComprador || sim.descricaoProduto || "Simulação"}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            deleteSimulacaoFromSupabase(sim.id).catch(e => console.warn("Erro ao deletar do Supabase:", e));
                            const updated = simulations.filter(s => s.id !== sim.id);
                            setSimulations(updated);
                            localStorage.setItem("aip_pricing_simulations", JSON.stringify(updated));
                          }}
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          title="Excluir simulação"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-center pt-1 border-t border-border">
                        <div className="bg-muted p-1.5 rounded">
                          <span className="block text-muted-foreground text-[8px] uppercase">Lance Un.</span>
                          <span className="text-success font-bold">R$ {sim.valorGanhoUnitario}</span>
                        </div>
                        <div className="bg-muted p-1.5 rounded">
                          <span className="block text-muted-foreground text-[8px] uppercase">Margem</span>
                          <span className={`font-bold ${margin < 0 ? "text-destructive" : "text-success"}`}>{margin.toFixed(1)}%</span>
                        </div>
                        <div className="bg-muted p-1.5 rounded">
                          <span className="block text-muted-foreground text-[8px] uppercase">Lucro Total</span>
                          <span className={`font-bold ${profit < 0 ? "text-destructive" : "text-success"}`}>R$ {profit.toFixed(0)}</span>
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
                        className="w-full text-center text-primary hover:text-primary/80 font-bold text-[10px] pt-1 block cursor-pointer"
                      >
                        Restaurar este cenário na Calculadora ↑
                      </button>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* MODAL: IMPORTAR COTAÇÃO DO FORNECEDOR COM IA */}
      <Dialog open={showQuoteModal} onOpenChange={setShowQuoteModal}>
        <DialogContent className="max-w-xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 pr-6">
              <div className="bg-success/10 p-2 sm:p-2.5 rounded-xl text-success border border-success/20 shrink-0">
                <UploadCloud className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm sm:text-base truncate">Importar Cotação de Fornecedor com IA</DialogTitle>
                <DialogDescription className="text-[11px] sm:text-xs truncate">Cole o orçamento ou suba o arquivo para preenchimento automático</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {/* File upload prompt */}
            <div>
              <Label className="w-full justify-between text-[11px] font-bold text-foreground uppercase tracking-wider mb-2 font-mono">
                <span>Anexar Arquivo de Cotação (TXT, CSV, PDF)</span>
                {quoteFileName && <span className="text-success font-mono text-[10px] truncate max-w-[150px]">{quoteFileName}</span>}
              </Label>
              <div className="border-2 border-dashed border-input hover:border-success bg-muted/40 hover:bg-success/5 rounded-xl p-4 text-center transition cursor-pointer relative">
                <input
                  type="file"
                  accept=".txt,.csv,.json,.pdf,.doc,.docx"
                  onChange={handleQuoteFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <Upload className="w-6 h-6 text-success mx-auto mb-2" />
                <span className="text-xs text-foreground font-medium block">
                  {quoteFileName ? `Arquivo selecionado: ${quoteFileName}` : "Clique ou arraste a proposta do fornecedor aqui"}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  A IA vai ler o custo unitário, quantidade, frete e tributos
                </span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-[10px] uppercase font-mono">
                <span className="bg-background px-2 text-muted-foreground">ou cole a mensagem de texto</span>
              </div>
            </div>

            {/* Text Area */}
            <div>
              <Textarea
                rows={5}
                value={quoteText}
                onChange={(e) => setQuoteText(e.target.value)}
                placeholder={`Exemplo de cotação do fornecedor:\n"Cotação Fornecedor TechLtda - Item: Cadeira B2B\nPreço unitário: R$ 145,00\nQuantidade: 50 unidades\nFrete total CIF para SP: R$ 380,00\nImposto IPI: 5%"`}
                className="rounded-xl text-xs leading-relaxed"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowQuoteModal(false)}
              className="font-semibold text-xs rounded-xl"
            >
              Cancelar
            </Button>

            <Button
              type="button"
              onClick={handleParseSupplierQuote}
              disabled={isParsingQuote || !quoteText.trim()}
              className="font-bold text-xs rounded-xl bg-success text-success-foreground hover:bg-success/90"
            >
              {isParsingQuote ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processando com IA...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Extrair e Preencher Calculadora</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
