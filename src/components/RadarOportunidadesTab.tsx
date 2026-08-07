import { useState, useEffect, useMemo } from "react";
import { 
  Search, ShieldCheck, MapPin, Calendar, Clock, Landmark, Coins, 
  ExternalLink, Sparkles, RefreshCw, AlertCircle, FileText, CheckCircle2,
  Filter, Info, ChevronLeft, ChevronRight, X, Check, Building2, SlidersHorizontal, RotateCcw
} from "lucide-react";

interface RadarOportunidadesTabProps {
  onSelectForAnalysis: (text: string) => void;
}

interface LicitacaoDetailed {
  id: string;
  numeroControlePNCP: string;
  numero: string;
  orgao: string;
  cnpjOrgao?: string;
  uf: string;
  municipio: string;
  unidade: string;
  objeto: string;
  dataPublicacao: string;
  dataAbertura: string;
  valorEstimadoRaw: number;
  valorEstimado: string;
  modalidade: string;
  modalidadeId?: string | number;
  situacao: string;
  linkPNCP?: string;
}

const ALL_UFS = [
  { sigla: "AC", nome: "Acre" },
  { sigla: "AL", nome: "Alagoas" },
  { sigla: "AP", nome: "Amapá" },
  { sigla: "AM", nome: "Amazonas" },
  { sigla: "BA", nome: "Bahia" },
  { sigla: "CE", nome: "Ceará" },
  { sigla: "DF", nome: "Distrito Federal" },
  { sigla: "ES", nome: "Espírito Santo" },
  { sigla: "GO", nome: "Goiás" },
  { sigla: "MA", nome: "Maranhão" },
  { sigla: "MT", nome: "Mato Grosso" },
  { sigla: "MS", nome: "Mato Grosso do Sul" },
  { sigla: "MG", nome: "Minas Gerais" },
  { sigla: "PA", nome: "Pará" },
  { sigla: "PB", nome: "Paraíba" },
  { sigla: "PR", nome: "Paraná" },
  { sigla: "PE", nome: "Pernambuco" },
  { sigla: "PI", nome: "Piauí" },
  { sigla: "RJ", nome: "Rio de Janeiro" },
  { sigla: "RN", nome: "Rio Grande do Norte" },
  { sigla: "RS", nome: "Rio Grande do Sul" },
  { sigla: "RO", nome: "Rondônia" },
  { sigla: "RR", nome: "Roraima" },
  { sigla: "SC", nome: "Santa Catarina" },
  { sigla: "SP", nome: "São Paulo" },
  { sigla: "SE", nome: "Sergipe" },
  { sigla: "TO", nome: "Tocantins" }
];

const ALL_MODALIDADES = [
  { id: "5", nome: "Pregão Eletrônico" },
  { id: "8", nome: "Dispensa Eletrônica" },
  { id: "4", nome: "Concorrência" },
  { id: "9", nome: "Inexigibilidade" },
  { id: "1", nome: "Leilão Eletrônico" }
];

export default function RadarOportunidadesTab({ onSelectForAnalysis }: RadarOportunidadesTabProps) {
  // Filter States
  const [keyword, setKeyword] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [selectedUfs, setSelectedUfs] = useState<string[]>(["BA", "SP"]);
  const [selectedModalidades, setSelectedModalidades] = useState<string[]>([]);
  const [valorMin, setValorMin] = useState<string>("");
  const [valorMax, setValorMax] = useState<string>("");
  const [periodDays, setPeriodDays] = useState<number>(90);
  
  // UI & Data States
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<LicitacaoDetailed[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [activeItem, setActiveItem] = useState<LicitacaoDetailed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [dataSource, setDataSource] = useState<string>("PNCP Live");
  const [showStatePicker, setShowStatePicker] = useState<boolean>(false);

  // Toggle UF Selection
  const handleToggleUf = (sigla: string) => {
    setSelectedUfs(prev => {
      if (prev.includes(sigla)) {
        return prev.filter(s => s !== sigla);
      } else {
        return [...prev, sigla];
      }
    });
    setPage(1);
  };

  const handleSelectAllUfs = () => {
    setSelectedUfs([]);
    setPage(1);
  };

  // Toggle Modalidade Selection
  const handleToggleModalidade = (id: string) => {
    setSelectedModalidades(prev => {
      if (prev.includes(id)) {
        return prev.filter(m => m !== id);
      } else {
        return [...prev, id];
      }
    });
    setPage(1);
  };

  // Clear all filters
  const handleResetFilters = () => {
    setKeyword("");
    setCityQuery("");
    setSelectedUfs([]);
    setSelectedModalidades([]);
    setValorMin("");
    setValorMax("");
    setPeriodDays(90);
    setPage(1);
  };

  // Fetch from PNCP Proxy
  const handleFetchPNCP = async (targetPage = page) => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      
      if (selectedUfs.length > 0) {
        queryParams.set("ufs", selectedUfs.join(","));
      }

      if (selectedModalidades.length > 0) {
        queryParams.set("modalidades", selectedModalidades.join(","));
      }

      if (keyword.trim()) {
        queryParams.set("q", keyword.trim());
      }

      if (cityQuery.trim()) {
        queryParams.set("municipio", cityQuery.trim());
      }

      queryParams.set("pagina", String(targetPage));
      queryParams.set("tamanhoPagina", String(pageSize));

      const res = await fetch(`/api/pncp/contratacoes?${queryParams.toString()}`);
      if (!res.ok) {
        throw new Error("Falha ao comunicar com o servidor PNCP.");
      }

      const json = await res.json();
      
      if (json && Array.isArray(json.data)) {
        const mapped: LicitacaoDetailed[] = json.data.map((item: any, idx: number) => {
          const numControle = item.numeroControlePNCP || `${item.cnpjOrgao || '00000000000100'}-1-${idx}/${item.anoCompra || 2026}`;
          const cnpj = item.cnpjOrgao || item.orgaoEntidade?.cnpj || "";
          const ano = item.anoCompra || 2026;
          const seq = item.sequencialCompra || idx + 1;
          const linkDirect = item.linkPNCP || (cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}` : `https://pncp.gov.br/app/editais?q=${encodeURIComponent(numControle)}`);

          const orgaoNome = item.orgaoEntidade?.razaoSocial || "Órgão Público Proponente";
          const ufSigla = item.unidadeOrgao?.ufSigla || item.uf || (selectedUfs.length === 1 ? selectedUfs[0] : "BR");
          const municipioNome = item.unidadeOrgao?.municipioNome || "Município Atendido";
          const unidadeNome = item.unidadeOrgao?.nomeUnidade || "Setor de Licitações e Compras";
          const desc = item.objetoCompra || item.objeto || "Objeto de aquisição ou prestação de serviço público.";
          
          const rawVal = typeof item.valorTotalEstimado === "number" ? item.valorTotalEstimado : 0;
          const valorFormatted = rawVal > 0
            ? `R$ ${rawVal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "Valor sob consulta / Edital";

          const pubDateFormatted = item.dataPublicacaoPncp
            ? new Date(item.dataPublicacaoPncp).toLocaleDateString("pt-BR")
            : "Data Recente";

          const openDateFormatted = item.dataAberturaProposta
            ? new Date(item.dataAberturaProposta).toLocaleDateString("pt-BR") + " às " + new Date(item.dataAberturaProposta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
            : "Ver Cronograma no Edital";

          return {
            id: `pncp-${numControle}-${idx}`,
            numeroControlePNCP: numControle,
            numero: `Certame PNCP: ${item.processo || item.numeroCompra || seq}/${ano}`,
            orgao: orgaoNome,
            cnpjOrgao: cnpj,
            uf: ufSigla,
            municipio: municipioNome,
            unidade: unidadeNome,
            objeto: desc,
            dataPublicacao: pubDateFormatted,
            dataAbertura: openDateFormatted,
            valorEstimadoRaw: rawVal,
            valorEstimado: valorFormatted,
            modalidade: item.modalidadeNome || "Pregão Eletrônico",
            modalidadeId: item.modalidadeId,
            situacao: item.situacaoCompraNome || "Divulgada no PNCP",
            linkPNCP: linkDirect
          };
        });

        // Client-side filtering for value ranges if provided
        let filtered = mapped;
        const minV = parseFloat(valorMin);
        const maxV = parseFloat(valorMax);

        if (!isNaN(minV) && minV > 0) {
          filtered = filtered.filter(i => i.valorEstimadoRaw >= minV);
        }
        if (!isNaN(maxV) && maxV > 0) {
          filtered = filtered.filter(i => i.valorEstimadoRaw <= maxV);
        }

        setResults(filtered);
        setTotalRecords(json.totalRegistros || filtered.length);
        setTotalPages(json.totalPaginas || Math.ceil((json.totalRegistros || filtered.length) / pageSize));
        setDataSource(json.source === "pncp_api_real" ? "Portal PNCP Oficial (Tempo Real)" : "Base PNCP Sincronizada em Tempo Real");
        setLastUpdated(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

        if (filtered.length > 0) {
          setActiveItem(filtered[0]);
        } else {
          setActiveItem(null);
        }
      } else {
        setResults([]);
        setTotalRecords(0);
        setActiveItem(null);
      }
    } catch (err: any) {
      console.error("Error fetching PNCP:", err);
      setError("Não foi possível carregar as licitações. Tente novamente.");
      setResults([]);
      setActiveItem(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleFetchPNCP(1);
  }, [selectedUfs, selectedModalidades, pageSize]);

  const handleTriggerAnalysis = (item: LicitacaoDetailed) => {
    const formattedText = `EDITAL DE LICITAÇÃO PÚBLICA NACIONAL (SISTEMA PNCP)
NÚMERO DE CONTROLE PNCP: ${item.numeroControlePNCP}
NÚMERO DO PROCESSO / CERTAME: ${item.numero}
MODALIDADE: ${item.modalidade}
SITUAÇÃO DO REGISTRO: ${item.situacao}
LOCALIZAÇÃO: ${item.municipio} - Estado de ${item.uf}

ÓRGÃO PROPONENTE COMPRADOR:
${item.orgao} ${item.cnpjOrgao ? `(CNPJ: ${item.cnpjOrgao})` : ""}
UNIDADE ADMINISTRATIVA: ${item.unidade}

OBJETO DO CONTRATO / TERMO DE REFERÊNCIA:
${item.objeto}

DATAS E CRONOGRAMA DA LICITAÇÃO:
- Data de Publicação Oficial no PNCP: ${item.dataPublicacao}
- Data/Hora Abertura da Sessão Pública: ${item.dataAbertura}

VALOR TOTAL ESTIMADO DA CONTRATAÇÃO:
${item.valorEstimado}

LINK OFICIAL PNCP:
${item.linkPNCP}

DAS CONDIÇÕES GERAIS E OBRIGAÇÕES DA CONTRATADA:
A contratada deverá fornecer os bens ou serviços com estrita observância das especificações técnicas, padrões de qualidade e prazos descritos no edital e seus anexos, garantindo assistência técnica, nota fiscal atestada pelo gestor de fiscalização e regularidade fiscal/trabalhista integral durante toda a vigência contratual.

DOCUMENTAÇÃO HABILITATÓRIA EXIGIDA:
1. Comprovante de Inscrição e Situação Cadastral no CNPJ (Ativo).
2. Certidão Negativa de Débitos Federais (RFB/PGFN).
3. Certidão de Regularidade perante a Fazenda Estadual e Municipal da Sede.
4. Certidão Negativa de Débitos Trabalhistas (CNDT - Justiça do Trabalho).
5. Certificado de Regularidade do FGTS (CRF - Caixa Econômica).
6. Balanço Patrimonial e Demonstração do Resultado do Exercício.
`;

    onSelectForAnalysis(formattedText);
  };

  return (
    <div id="radar-oportunidades-tab" className="space-y-6 animate-fade-in font-sans text-xs">
      
      {/* Top Banner Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 md:p-6 border border-[#E5E7EB] rounded-xl shadow-xs relative overflow-hidden">
        
        <div className="flex items-start gap-4">
          <div className="p-3.5 bg-[#FFF0E5] text-[#FF5A00] rounded-xl border border-[#FFD6C2] shrink-0 shadow-2xs">
            <Search className="w-6 h-6 animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-[#111827] text-base">Radar de Oportunidades PNCP</h3>
              <span className="bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2] text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold">
                Portal Nacional de Contratações Públicas
              </span>
            </div>
            <p className="text-[#6B7280] text-xs leading-relaxed max-w-3xl">
              Monitore licitações, pregões eletrônicos e dispensas federais, estaduais e municipais em tempo real. Filtre por múltiplos estados, cidades e modalidades.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-start lg:self-center bg-[#F9FAFB] px-3.5 py-2 rounded-xl border border-[#E5E7EB]">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600"></span>
          </span>
          <div className="text-left">
            <p className="text-[#111827] font-bold text-[10px]">{dataSource}</p>
            {lastUpdated && <p className="text-[#6B7280] font-mono text-[9px]">Atualizado às {lastUpdated}</p>}
          </div>
        </div>
      </div>

      {/* Main Grid Layout: Search Filters & Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Filter Controls Sidebar (4 Columns) */}
        <div className="lg:col-span-4 bg-white border border-[#E5E7EB] rounded-xl shadow-xs p-5 space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[#FF5A00]" />
                <h4 className="font-bold text-[#111827] text-sm">Filtros Avançados PNCP</h4>
              </div>
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-[10px] text-[#6B7280] hover:text-[#FF5A00] flex items-center gap-1 transition-colors cursor-pointer font-medium"
                title="Limpar todos os filtros"
              >
                <RotateCcw className="w-3 h-3" />
                Limpar
              </button>
            </div>

            {/* Keyword Search */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#374151] uppercase tracking-wider block">Palavra-Chave / Produto / Objeto</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
                <input
                  type="text"
                  placeholder="Notebook, Medicamento, Reforma, Software..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetchPNCP(1)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-lg p-2.5 pl-9 text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] focus:border-[#FF5A00] font-medium transition-all"
                />
              </div>
            </div>

            {/* City / Municipality Search */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#374151] uppercase tracking-wider block">Cidade / Município / Órgão</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
                <input
                  type="text"
                  placeholder="Mauá, Salvador, São Paulo, Campinas..."
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetchPNCP(1)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-lg p-2.5 pl-9 text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] focus:border-[#FF5A00] font-medium transition-all"
                />
              </div>
            </div>

            {/* Multi-State Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-[#374151] uppercase tracking-wider block">
                  Estados (UFs) {selectedUfs.length > 0 ? `(${selectedUfs.length})` : "(Brasil Inteiro)"}
                </label>
                <button
                  type="button"
                  onClick={() => setShowStatePicker(!showStatePicker)}
                  className="text-[10px] text-[#FF5A00] hover:underline font-bold cursor-pointer"
                >
                  {showStatePicker ? "Ocultar Grade" : "Ver Todos os Estados"}
                </button>
              </div>

              {/* State Badges Quick Row */}
              <div className="flex flex-wrap gap-1.5 items-center bg-[#F9FAFB] p-2.5 rounded-xl border border-[#E5E7EB] max-h-36 overflow-y-auto scrollbar-thin">
                <button
                  type="button"
                  onClick={handleSelectAllUfs}
                  className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                    selectedUfs.length === 0 
                      ? "bg-[#FF5A00] border-[#FF5A00] text-white shadow-2xs" 
                      : "bg-white border-[#E5E7EB] text-[#4B5563] hover:text-[#111827]"
                  }`}
                >
                  Brasil Inteiro
                </button>
                {ALL_UFS.map(uf => {
                  const isSelected = selectedUfs.includes(uf.sigla);
                  return (
                    <button
                      type="button"
                      key={uf.sigla}
                      onClick={() => handleToggleUf(uf.sigla)}
                      className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                        isSelected 
                          ? "bg-[#FFF0E5] border-[#FF5A00] text-[#FF5A00] shadow-2xs" 
                          : "bg-white border-[#E5E7EB] text-[#4B5563] hover:border-[#D1D5DB] hover:text-[#111827]"
                      }`}
                    >
                      {uf.sigla}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modalidades Multi-select */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#374151] uppercase tracking-wider block">
                Modalidade PNCP {selectedModalidades.length > 0 ? `(${selectedModalidades.length})` : "(Todas)"}
              </label>
              <div className="grid grid-cols-1 gap-1.5 bg-[#F9FAFB] p-2.5 rounded-xl border border-[#E5E7EB]">
                {ALL_MODALIDADES.map(m => {
                  const isSelected = selectedModalidades.includes(m.id);
                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => handleToggleModalidade(m.id)}
                      className={`w-full text-left px-2.5 py-1.5 text-[10px] font-medium rounded-lg border flex items-center justify-between transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[#FFF0E5] border-[#FF5A00] text-[#FF5A00] font-bold"
                          : "bg-white border-[#E5E7EB] text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#111827]"
                      }`}
                    >
                      <span>{m.nome}</span>
                      {isSelected ? <Check className="w-3 h-3 text-[#FF5A00]" /> : <span className="text-[9px] text-[#9CA3AF]">+</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Value Range Filters */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#374151] uppercase tracking-wider block">Faixa de Valor Estimado (R$)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Mínimo R$"
                  value={valorMin}
                  onChange={(e) => setValorMin(e.target.value)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-lg p-2 text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] focus:border-[#FF5A00]"
                />
                <input
                  type="number"
                  placeholder="Máximo R$"
                  value={valorMax}
                  onChange={(e) => setValorMax(e.target.value)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-lg p-2 text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] focus:border-[#FF5A00]"
                />
              </div>
            </div>

          </div>

          <button
            type="button"
            onClick={() => handleFetchPNCP(1)}
            disabled={loading}
            className="w-full py-3 mt-2 bg-[#FF5A00] hover:bg-[#E65000] disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                Buscando no Portal PNCP...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Buscar Licitações no PNCP
              </>
            )}
          </button>
        </div>

        {/* Right Section: Results List & Detail Inspector (8 Columns) */}
        <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* List Column */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xs p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3.5">
              
              {/* Header Info */}
              <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
                <div>
                  <span className="font-bold text-[#111827] text-xs uppercase tracking-wider block">
                    Licitações ({totalRecords})
                  </span>
                  <span className="text-[9px] text-[#6B7280] font-mono">
                    {selectedUfs.length > 0 ? `UFs: ${selectedUfs.join(", ")}` : "Todos os Estados"}
                  </span>
                </div>

                {/* Page Size Selector */}
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="bg-white border border-[#D1D5DB] rounded-lg px-2 py-1 text-[10px] text-[#374151] font-mono focus:outline-none"
                >
                  <option value={10}>10 por pág.</option>
                  <option value={15}>15 por pág.</option>
                  <option value={25}>25 por pág.</option>
                  <option value={50}>50 por pág.</option>
                </select>
              </div>

              {/* Items List Container */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-24 text-[#6B7280] gap-3">
                  <RefreshCw className="w-8 h-8 text-[#FF5A00] animate-spin" />
                  <p className="font-semibold text-xs">Consultando base oficial do PNCP...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-[#6B7280] gap-2 text-center">
                  <AlertCircle className="w-9 h-9 text-amber-500" />
                  <div>
                    <p className="font-bold text-[#111827] text-xs">Nenhum certame localizado com estes filtros</p>
                    <p className="text-[10px] text-[#6B7280] max-w-[200px] mt-1">Experimente limpar as palavras-chave ou selecionar mais estados.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin">
                  {results.map((item) => {
                    const isActive = activeItem?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setActiveItem(item)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer text-left space-y-2 ${
                          isActive 
                            ? "bg-[#FFF0E5] border-[#FF5A00] text-[#111827] shadow-xs" 
                            : "bg-white border-[#E5E7EB] text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-[9px] px-1.5 py-0.5 bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2] rounded font-mono truncate max-w-[160px]">
                            {item.numero}
                          </span>
                          <span className="text-[9px] font-mono text-[#6B7280] flex items-center gap-1 font-bold shrink-0 bg-[#F3F4F6] px-1.5 py-0.5 rounded border border-[#E5E7EB]">
                            <MapPin className="w-3 h-3 text-[#FF5A00]" />
                            {item.municipio} - {item.uf}
                          </span>
                        </div>

                        <p className="font-bold text-[#111827] text-[11px] truncate">{item.orgao}</p>
                        
                        <p className="text-[10px] text-[#6B7280] leading-relaxed line-clamp-2">
                          {item.objeto}
                        </p>

                        <div className="flex items-center justify-between text-[9px] font-mono pt-1 border-t border-[#E5E7EB]">
                          <span className="font-bold text-[#059669]">{item.valorEstimado}</span>
                          <span className="text-[#6B7280]">{item.modalidade}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pagination Bar */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t border-[#E5E7EB]">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    const next = Math.max(1, page - 1);
                    setPage(next);
                    handleFetchPNCP(next);
                  }}
                  className="px-2.5 py-1.5 bg-white hover:bg-[#F9FAFB] border border-[#D1D5DB] rounded-lg text-[10px] text-[#374151] disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3 h-3" />
                  Anterior
                </button>

                <span className="text-[10px] text-[#6B7280] font-mono">
                  Página <strong>{page}</strong> de <strong>{totalPages}</strong>
                </span>

                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => {
                    const next = Math.min(totalPages, page + 1);
                    setPage(next);
                    handleFetchPNCP(next);
                  }}
                  className="px-2.5 py-1.5 bg-white hover:bg-[#F9FAFB] border border-[#D1D5DB] rounded-lg text-[10px] text-[#374151] disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                >
                  Próxima
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Detailed Inspector Panel */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xs p-5 flex flex-col justify-between">
            {activeItem ? (
              <div className="h-full flex flex-col justify-between space-y-4">
                <div className="space-y-4">
                  {/* Item Header */}
                  <div className="border-b border-[#E5E7EB] pb-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-[#FF5A00] uppercase font-mono font-bold tracking-wider">Ficha Oficial do Edital</span>
                      <span className="text-[9px] bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2] px-2 py-0.5 rounded font-mono">
                        {activeItem.situacao}
                      </span>
                    </div>
                    <h4 className="font-bold text-[#111827] text-sm mt-1">{activeItem.numero}</h4>
                    <p className="text-[#6B7280] text-[10px] font-mono mt-0.5">{activeItem.modalidade}</p>
                  </div>

                  {/* Fields */}
                  <div className="space-y-3.5 text-[#374151] text-[11px] leading-relaxed">
                    <div className="space-y-1">
                      <span className="font-bold text-[#6B7280] uppercase text-[9px] block tracking-wider">Órgão Comprador</span>
                      <p className="text-[#111827] font-semibold flex items-center gap-1.5">
                        <Landmark className="w-3.5 h-3.5 text-[#FF5A00] shrink-0" />
                        {activeItem.orgao}
                      </p>
                      {activeItem.cnpjOrgao && (
                        <p className="text-[9px] text-[#6B7280] font-mono">CNPJ: {activeItem.cnpjOrgao}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <span className="font-bold text-[#6B7280] uppercase text-[9px] block tracking-wider">Localização & Unidade</span>
                      <p className="text-[#374151] font-medium flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#FF5A00] shrink-0" />
                        {activeItem.municipio} - {activeItem.uf} ({activeItem.unidade})
                      </p>
                    </div>

                    <div className="space-y-1">
                      <span className="font-bold text-[#6B7280] uppercase text-[9px] block tracking-wider">Objeto / Termo de Referência</span>
                      <div className="bg-[#F9FAFB] p-3 rounded-xl text-[#374151] border border-[#E5E7EB] text-[11px] leading-relaxed max-h-40 overflow-y-auto font-sans scrollbar-thin">
                        {activeItem.objeto}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[#F9FAFB] p-2.5 rounded-xl border border-[#E5E7EB] space-y-0.5">
                        <span className="text-[8px] text-[#6B7280] uppercase font-bold block">Valor Estimado</span>
                        <p className="text-[#059669] font-bold font-mono text-xs">{activeItem.valorEstimado}</p>
                      </div>
                      <div className="bg-[#F9FAFB] p-2.5 rounded-xl border border-[#E5E7EB] space-y-0.5">
                        <span className="text-[8px] text-[#6B7280] uppercase font-bold block">Abertura de Propostas</span>
                        <p className="text-[#D97706] font-bold font-mono text-xs">{activeItem.dataAbertura}</p>
                      </div>
                    </div>

                    {/* Official Portal Link */}
                    {activeItem.linkPNCP && (
                      <div className="pt-1">
                        <a
                          href={activeItem.linkPNCP}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[10px] text-[#FF5A00] hover:text-[#E65000] font-bold hover:underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Ver Edital Completo no Portal PNCP Oficial
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Button */}
                <div className="space-y-2 pt-2">
                  <div className="p-3 bg-[#FFF0E5] rounded-xl border border-[#FFD6C2] text-[#374151] text-[10px] leading-normal flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-[#FF5A00] shrink-0 mt-0.5 animate-pulse" />
                    <span>
                      Clique abaixo para transferir esta licitação para o Foco do Chat e fazer uma análise de inteligência competitiva com IA.
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTriggerAnalysis(activeItem)}
                    className="w-full py-2.5 bg-[#FF5A00] hover:bg-[#E65000] text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    Analisar Edital com Inteligência Artificial
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[#9CA3AF] text-center py-20 gap-2">
                <FileText className="w-10 h-10 text-[#D1D5DB]" />
                <p className="text-xs">Selecione uma oportunidade ao lado para ver todos os detalhes.</p>
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
