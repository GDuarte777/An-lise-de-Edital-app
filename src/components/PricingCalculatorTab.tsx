import React, { useState, useEffect } from "react";
import { 
  Calculator, Landmark, MapPin, Calendar, Coins, TrendingUp, AlertTriangle, CheckCircle, 
  HelpCircle, ChevronRight, Save, ClipboardList, Info, FileSpreadsheet, Trash2, Plus, Folder, Percent, Tag, ShoppingBag, Truck, BadgePercent
} from "lucide-react";
import { EditalAnalysis } from "../types";
import { addSyncedItem } from "../utils/googleSync";
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
        color: "text-amber-400 bg-amber-500/15 border-amber-500/20",
        message: "A margem de lucro está abaixo dos níveis saudáveis de 10%. Custos adicionais de expedição podem liquidar o lucro."
      };
    }
    if (margemLucroPercentual <= 22) {
      return {
        label: "Margem Positiva / Viável",
        color: "text-indigo-400 bg-indigo-500/15 border-indigo-500/20",
        message: "Excelente. A simulação mostra viabilidade financeira positiva com margem dentro dos limites previstos."
      };
    }
    return {
      label: "Margem Altamente Lucrativa",
      color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/20",
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
    <div id="pricing-calculator-tab" className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-slate-100 animate-fade-in select-text">
      
      {/* LEFT COLUMN: SELECT ORGAO AND PREGAO METADATA */}
      <div className="lg:col-span-5 space-y-6">
        
        {/* Selector Header */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-5 md:p-6 space-y-5">
          <div className="flex items-center gap-3 border-b border-white/15 pb-3">
            <div className="bg-indigo-500/10 p-2 rounded-xl text-indigo-400">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm md:text-base">Selecione o Edital</h3>
              <p className="text-slate-400 text-[11px] font-normal">Identificação de certames em conformidade com o histórico</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Folder className="w-3.5 h-3.5 text-indigo-400" />
                Histórico de Pregões Analisados
              </label>
              <select
                value={selectedEditalId}
                onChange={(e) => handleEditalSelect(e.target.value)}
                className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/35 transition cursor-pointer"
              >
                <option value="">-- Escolher Edital Analisado no Histórico --</option>
                {history.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} ({item.date.split(" ")[0]})
                  </option>
                ))}
              </select>
              {history.length === 0 && (
                <span className="text-[10px] text-amber-400/80 mt-1 block leading-normal">
                  ⚠️ Nenhum edital disponível no seu histórico local ainda. Vá na primeira aba para analisar e preencher dados de pregão via IA.
                </span>
              )}
            </div>

            <div className="border-t border-white/10 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-white">Editar Dados Cadastrais do Pregão</span>
                <span className="text-[10px] text-slate-500 font-mono">Formulário de Entrada</span>
              </div>

              {/* Organ */}
              <div>
                <label className="block text-[10px] text-slate-400 font-mono mb-1">Nome do Órgão Comprador</label>
                <div className="relative">
                  <Landmark className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={orgaoComprador}
                    onChange={(e) => setOrgaoComprador(e.target.value)}
                    placeholder="ex: Tribunal Regional Eleitoral da 3ª Região"
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition-all font-sans"
                  />
                </div>
              </div>

              {/* Item Objeto */}
              <div>
                <label className="block text-[10px] text-slate-400 font-mono mb-1">Item / Descrição do Produto</label>
                <div className="relative">
                  <ShoppingBag className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={descricaoProduto}
                    onChange={(e) => setDescricaoProduto(e.target.value)}
                    placeholder="ex: Aparelhos de Telecomunicação Sem Fio Tipo B"
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition-all font-sans"
                  />
                </div>
              </div>

              {/* Inputs Grid items */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-slate-400 font-mono mb-1">Número do Pregão / Código</label>
                  <div className="relative">
                    <Tag className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={identificacaoNumerica}
                      onChange={(e) => setIdentificacaoNumerica(e.target.value)}
                      placeholder="Nº Pregão"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition font-sans"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-mono mb-1">Pasta do Processo</label>
                  <div className="relative">
                    <Folder className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={pastaProcesso}
                      onChange={(e) => setPastaProcesso(e.target.value)}
                      placeholder="Pasta"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition font-sans"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-slate-400 font-mono mb-1">Nº do Processo</label>
                  <input
                    type="text"
                    value={numeroProcesso}
                    onChange={(e) => setNumeroProcesso(e.target.value)}
                    placeholder="Número Processo"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-mono mb-1">Data/Horário Disputa</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={dataHoraSessao}
                      onChange={(e) => setDataHoraSessao(e.target.value)}
                      placeholder="Data Sessão"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition font-sans"
                    />
                  </div>
                </div>
              </div>

              {/* Endereco Entrega */}
              <div>
                <label className="block text-[10px] text-slate-400 font-mono mb-1">Local / Endereço de Entrega</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={enderecoEntrega}
                    onChange={(e) => setEnderecoEntrega(e.target.value)}
                    placeholder="Almoxarifado central, Av. Brasil nº 40"
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition font-sans"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 font-mono mb-1">Título da Planilha de Custos</label>
                <input
                  type="text"
                  value={simulationTitle}
                  onChange={(e) => setSimulationTitle(e.target.value)}
                  placeholder="ex: Simulação Pregão TRE"
                  className="w-full bg-indigo-500/5 border border-indigo-500/20 rounded-xl px-3 py-2 text-xs text-indigo-300 font-semibold focus:outline-hidden focus:border-indigo-500 transition font-sans"
                />
              </div>

            </div>
          </div>
        </div>

        {/* Informações Auxiliares dos Pilares das Licitações */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-xs text-slate-400 space-y-3 font-sans">
          <h4 className="font-bold text-white flex items-center gap-1.5">
            <Info className="w-4 h-4 text-indigo-400" />
            Por que calcular a margem exata?
          </h4>
          <p className="leading-relaxed">
            Muitas empresas vencem o lance na disputa de pregão com preços inexequíveis por esquecer de subtrair <strong>líquidas de frete total rateado</strong> ou <strong>alíquotas tributárias estaduais/federais</strong>.
          </p>
          <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 text-slate-300 flex items-start gap-2.5 leading-snug">
            <CheckCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>Utilize este painel para registrar e salvar o seu target de disputa com segurança legal.</span>
          </div>
        </div>

      </div>

      {/* RIGHT COLUMN: CALCULATION PRICING SPREADSHEET & RESULTS PANEL */}
      <div className="lg:col-span-7 space-y-6">
        
        {/* Main interactive calculation sheet card */}
        <div className="bg-[#0f1424] border border-white/10 rounded-2xl p-5 md:p-6 space-y-6 shadow-xl relative overflow-hidden">
          
          <div className="absolute top-0 right-0 p-4 font-mono text-[9px] text-[#2ebd85]/30 uppercase tracking-widest leading-none">
            Financial Audit Module
          </div>

          <div className="flex items-center gap-2.5 border-b border-white/10 pb-4">
            <div className="bg-emerald-500/10 p-2.5 rounded-xl text-emerald-400 shrink-0">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Planilha de Composição de Custos & Rentabilidade</h3>
              <p className="text-[11px] text-slate-400">Insira as tarifas unitárias para apuração automatizada</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
            
            {/* Box Receitas/Ganhos */}
            <div className="space-y-4 bg-slate-900/40 p-4 rounded-xl border border-white/5">
              <h5 className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5 text-indigo-400">
                <Coins className="w-3.5 h-3.5" />
                A. Receitas do Lote
              </h5>

              {/* Valor Máximo Unitário */}
              <div>
                <span className="block text-[10px] text-slate-400 font-mono mb-1 flex items-center justify-between">
                  Valor Máximo Aceitável (Unitário)
                  <span className="text-slate-500 text-[9px]">Anunciado no Edital</span>
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-semibold font-sans">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorMaximo || ""}
                    onChange={(e) => setValorMaximo(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#07090f] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 font-semibold focus:outline-hidden focus:border-indigo-500 transition font-sans"
                  />
                </div>
              </div>

              {/* Valor Ganho Unitário */}
              <div>
                <span className="block text-[10px] text-slate-400 font-mono mb-1 flex items-center justify-between">
                  Valor Ganho / Lance Fechado (Unitário)
                  <span className="text-emerald-400/80 font-bold text-[9px]">Preço Final de Venda</span>
                </span>
                <div className="relative font-bold">
                  <span className="absolute left-3 top-2.5 text-xs text-emerald-400 font-bold font-sans">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorGanhoUnitario || ""}
                    onChange={(e) => setValorGanhoUnitario(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#07090f] border border-emerald-500/20 text-emerald-300 rounded-xl pl-9 pr-3 py-2 text-xs font-bold focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition font-sans"
                  />
                </div>
              </div>

              {/* Quantidade de produtos */}
              <div>
                <span className="block text-[10px] text-slate-400 font-mono mb-1 flex items-center justify-between">
                  Quantidade total de itens
                  <span className="text-slate-500 text-[9px]">Lote Geral</span>
                </span>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    value={quantidade || ""}
                    onChange={(e) => setQuantidade(parseInt(e.target.value) || 0)}
                    className="w-full bg-[#07090f] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 font-semibold focus:outline-hidden focus:border-indigo-500 transition font-sans"
                  />
                </div>
              </div>
            </div>

            {/* Box Despesas/Custos */}
            <div className="space-y-4 bg-slate-900/40 p-4 rounded-xl border border-white/5">
              <h5 className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5 text-rose-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                B. Custos e Tributação
              </h5>

              {/* Custo Unitário do Fornecedor */}
              <div>
                <span className="block text-[10px] text-slate-400 font-mono mb-1 flex items-center justify-between">
                  Custo Unitário de Compra (Fornecedor)
                  <span className="text-slate-500 text-[9px]">Nota Fiscal Fornecedor</span>
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-semibold font-sans">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={custoUnitario || ""}
                    onChange={(e) => setCustoUnitario(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#07090f] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 font-semibold focus:outline-hidden focus:border-indigo-500 transition font-sans"
                  />
                </div>
              </div>

              {/* Valor de frete total */}
              <div>
                <span className="block text-[10px] text-slate-400 font-mono mb-1 flex items-center justify-between">
                  Valor de Frete Total
                  <span className="text-slate-500 text-[9px]">Transportadora / Rateio</span>
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-semibold font-sans">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorFreteTotal || ""}
                    onChange={(e) => setValorFreteTotal(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#07090f] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 font-semibold focus:outline-hidden focus:border-indigo-500 transition font-sans"
                  />
                </div>
              </div>

              {/* Aliquota de imposto */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-[10px] text-slate-400 font-mono mb-1">Tributos %</span>
                  <div className="relative">
                    <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-bold font-sans">%</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={aliquotaImposto || ""}
                      onChange={(e) => setAliquotaImposto(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#07090f] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 font-semibold focus:outline-hidden focus:border-indigo-500 transition font-sans"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-[10px] text-slate-400 font-mono mb-1">Outros Custos total</span>
                  <div className="relative">
                    <span className="absolute left-1.5 top-2.5 text-[9px] text-slate-500 font-bold font-sans">R$</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={outrasDespesasTotais || ""}
                      onChange={(e) => setOutrasDespesasTotais(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#07090f] border border-white/10 rounded-xl pl-5 pr-1 py-2 text-xs text-slate-200 font-semibold focus:outline-hidden focus:border-indigo-500 transition font-sans"
                    />
                  </div>
                </div>
              </div>

            </div>

          </div>

          {/* Demosntrativo de Resultados & High-Contrast Card */}
          <div className="bg-slate-900/60 rounded-xl p-5 border border-white/10 space-y-4">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-3.5 gap-2">
              <h4 className="font-bold text-white text-xs uppercase tracking-wide flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#2ebd85]" />
                C. Demonstrativo Real do Exercício Financeiro
              </h4>
              <div className="text-[10px] font-semibold text-slate-400 flex items-center gap-2">
                Faturamento Global Estimado:
                <span className="text-white font-bold font-mono">
                  R$ {faturamentoGanhoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Profit results layout */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              
              <div className="bg-[#0c101d] rounded-xl p-3 border border-white/5 text-center space-y-1">
                <span className="block text-[9px] text-slate-500 uppercase tracking-wider font-mono">Lucro por Unidade</span>
                <span className={`block text-lg font-extrabold font-sans ${lucroPorUnidadeCalculado < 0 ? "text-rose-400" : lucroPorUnidadeCalculado <= 10 ? "text-amber-400" : "text-emerald-400"}`}>
                  R$ {lucroPorUnidadeCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="block text-[9px] text-slate-400">por lote unitário</span>
              </div>

              <div className="bg-[#0c101d] rounded-xl p-3 border border-indigo-500/10 text-center space-y-1">
                <span className="block text-[9px] text-indigo-400 uppercase tracking-wider font-mono font-bold">LUCRO TOTAL DO LOTE</span>
                <span className={`block text-xl font-black font-sans ${lucroTotalCalculado < 0 ? "text-rose-400" : lucroTotalCalculado <= 1000 ? "text-amber-400" : "text-emerald-400"}`}>
                  R$ {lucroTotalCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
                <span className="block text-[9px] text-slate-400">lucro operacional líquido</span>
              </div>

              <div className="bg-[#0c101d] rounded-xl p-3 border border-white/5 text-center space-y-1">
                <span className="block text-[9px] text-slate-500 uppercase tracking-wider font-mono">Margem de Lucro</span>
                <span className={`block text-lg font-extrabold font-sans ${margemLucroPercentual < 0 ? "text-rose-400" : margemLucroPercentual <= 8 ? "text-amber-400" : "text-emerald-400"}`}>
                  {margemLucroPercentual.toFixed(2)} %
                </span>
                <span className="block text-[9px] text-slate-400">margem líquida real</span>
              </div>

            </div>

            {/* Imposto and discount summary details list */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px] font-medium leading-relaxed font-sans pt-1 border-t border-white/5 text-slate-400">
              <div>
                <span>Custo Produto total:</span>
                <span className="block text-slate-200 font-mono">R$ {custoAquisicaoTotal.toLocaleString("pt-BR")}</span>
              </div>
              <div>
                <span>Tributos s/ Faturamento:</span>
                <span className="block text-slate-200 font-mono text-rose-400">R$ {impostosCalculados.toLocaleString("pt-BR")}</span>
              </div>
              <div>
                <span>Rateio de Frete Unidade:</span>
                <span className="block text-slate-200 font-mono">R$ {(quantidade > 0 ? valorFreteTotal / quantidade : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span>Desconto p/ Governo:</span>
                <span className="block text-indigo-400 font-semibold font-mono">
                  {descontoPercentual.toFixed(1)}% (R$ {descontoOferecidoR$.toLocaleString("pt-BR")})
                </span>
              </div>
            </div>

            {/* Margin Safety Bar Indicator */}
            <div className="space-y-2 border-t border-white/5 pt-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Indicador de Viabilidade de Margem:</span>
                <span className={`font-bold uppercase tracking-tight py-0.5 px-2 rounded-full text-[9px] border ${marginAnalysis.color}`}>
                  {marginAnalysis.label}
                </span>
              </div>
              <div className="w-full bg-[#07090f] h-2.5 rounded-full overflow-hidden border border-white/5 flex gap-0.5">
                <div 
                  className={`h-full transition-all duration-300 ${
                    margemLucroPercentual < 0 
                      ? "bg-rose-500 w-[15%]" 
                      : margemLucroPercentual <= 10 
                        ? "bg-amber-500" 
                        : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(10, margemLucroPercentual))}%` }}
                ></div>
              </div>
              <p className="text-[10px] text-slate-400 italic leading-relaxed pt-1 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                {marginAnalysis.message}
              </p>
            </div>

          </div>

          {/* Action Row buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 justify-end pt-2">
            
            <button
              onClick={handleSaveSimulation}
              className="w-full sm:w-auto bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs py-3.5 px-5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4 text-slate-300" />
              Salvar Simulação no Histórico
            </button>

            <button
              onClick={handleSyncCalculationToGoogle}
              className="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs py-3.5 px-5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 border border-emerald-500/20"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Sincronizar Planilha com Workspace Google
            </button>

          </div>

        </div>

        {/* LIST OF SAVED SIMULATIONS */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h4 className="font-bold text-white text-xs uppercase tracking-wide flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-indigo-400" />
              Cenários de Planilhas Salvas ({simulations.length})
            </h4>
            {simulations.length > 0 && (
              <div className="flex items-center gap-1.5">
                {showConfirmClearSimulations ? (
                  <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-1 duration-150">
                    <button
                      onClick={() => {
                        setSimulations([]);
                        localStorage.removeItem("aip_pricing_simulations");
                        setShowConfirmClearSimulations(false);
                      }}
                      className="text-[9px] text-emerald-400 hover:text-emerald-300 font-bold bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 rounded border border-emerald-500/20 transition-all cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setShowConfirmClearSimulations(false)}
                      className="text-[9px] text-slate-400 hover:text-white bg-white/5 px-2 py-1 rounded border border-white/10 transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConfirmClearSimulations(true)}
                    className="text-[9px] bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/20 text-rose-400 font-bold px-2 py-1 rounded cursor-pointer transition"
                  >
                    Apagar Tudo
                  </button>
                )}
              </div>
            )}
          </div>

          {simulations.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-[11px] leading-relaxed">
              Você ainda não tem simulações persistidas para este navegador.<br />
              Monte os dados e clique em <b>"Salvar Simulação"</b> acima!
            </div>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {simulations.map((sim) => {
                const totalRevenue = sim.valorGanhoUnitario * sim.quantidade;
                const unitCostReal = sim.custoUnitario + ((sim.valorFreteTotal + (totalRevenue * (sim.aliquotaImposto / 100)) + sim.outrasDespesasTotais) / sim.quantidade);
                const unitProfit = sim.valorGanhoUnitario - unitCostReal;
                const profitRate = totalRevenue > 0 ? (unitProfit * sim.quantidade / totalRevenue) * 100 : 0;
                
                return (
                  <div key={sim.id} className="bg-slate-900/50 hover:bg-slate-900/85 border border-white/5 hover:border-white/10 p-3.5 rounded-xl text-xs space-y-3 transition">
                    
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h5 className="font-bold text-white text-[12px] leading-tight flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          {sim.title}
                        </h5>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">{sim.date} • {sim.orgaoComprador || "Órgão Comprador Geral"}</p>
                      </div>
                      
                      <button
                        onClick={() => {
                          const updated = simulations.filter(s => s.id !== sim.id);
                          setSimulations(updated);
                        }}
                        className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 border border-transparent hover:border-rose-500/15 cursor-pointer transition"
                        title="Deletar cenário"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="p-2.5 bg-slate-950/60 rounded-lg divide-y divide-white/5 text-[11px] space-y-2">
                      
                      {/* Bidding metadata indicators */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pb-2">
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase tracking-tighter">Pregão</span>
                          <span className="text-white font-semibold block truncate" title={sim.identificacaoNumerica}>{sim.identificacaoNumerica || "N/A"}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase tracking-tighter">Pasta</span>
                          <span className="text-white font-semibold block truncate" title={sim.pastaProcesso}>{sim.pastaProcesso || "N/A"}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase tracking-tighter">Número</span>
                          <span className="text-white font-semibold block truncate" title={sim.numeroProcesso}>{sim.numeroProcesso || "N/A"}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase tracking-tighter">Destino</span>
                          <span className="text-white font-semibold block truncate" title={sim.enderecoEntrega}>{sim.enderecoEntrega || "N/A"}</span>
                        </div>
                      </div>

                      {/* Math results */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 leading-tight">
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase">Qtd de Itens</span>
                          <span className="font-bold text-slate-300 font-mono">{sim.quantidade}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500">Valor Ganho Un:</span>
                          <span className="font-bold text-emerald-400 font-mono">R$ {sim.valorGanhoUnitario.toLocaleString("pt-BR")}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-slate-500 uppercase">Margem Margem</span>
                          <span className={`font-bold font-mono ${profitRate < 0 ? "text-rose-400" : profitRate <= 10 ? "text-amber-400" : "text-emerald-400"}`}>
                            {profitRate.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-indigo-400 font-bold uppercase">LUCRO total</span>
                          <span className={`font-bold font-mono ${unitProfit < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                            R$ {(unitProfit * sim.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                          </span>
                        </div>
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
                        setSelectedEditalId("");
                      }}
                      className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold text-[10px] uppercase tracking-wide cursor-pointer ml-auto"
                    >
                      Restaurar Cenário para Edição
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
