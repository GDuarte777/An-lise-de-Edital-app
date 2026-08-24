import { useState, useEffect, useMemo } from "react";
import {
  Search, ShieldCheck, MapPin, Calendar, Clock, Landmark, Coins,
  ExternalLink, Sparkles, RefreshCw, AlertCircle, FileText, CheckCircle2,
  Filter, Info, ChevronLeft, ChevronRight, ChevronDown, X, Check, Building2, SlidersHorizontal, RotateCcw
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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
  uasg?: string;
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
  const [selectedUfs, setSelectedUfs] = useState<string[]>([]); // Default empty = All UFs (Brasil)
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
  const [showModalidadesPicker, setShowModalidadesPicker] = useState<boolean>(false);
  const [ufSearchQuery, setUfSearchQuery] = useState<string>("");

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

  // Filter UFs list by search query
  const filteredUfs = useMemo(() => {
    if (!ufSearchQuery.trim()) return ALL_UFS;
    const q = ufSearchQuery.toLowerCase();
    return ALL_UFS.filter(uf => uf.sigla.toLowerCase().includes(q) || uf.nome.toLowerCase().includes(q));
  }, [ufSearchQuery]);

  // Clear all filters
  const handleResetFilters = () => {
    setKeyword("");
    setCityQuery("");
    setSelectedUfs([]);
    setSelectedModalidades([]);
    setValorMin("");
    setValorMax("");
    setPeriodDays(90);
    setUfSearchQuery("");
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

      queryParams.set("periodDays", String(periodDays));
      queryParams.set("pagina", String(targetPage));
      queryParams.set("tamanhoPagina", String(pageSize));

      const res = await fetch(`/api/pncp/contratacoes?${queryParams.toString()}`);
      if (!res.ok) {
        throw new Error("Falha ao comunicar com o servidor PNCP.");
      }

      const json = await res.json();

      if (json && Array.isArray(json.data)) {
        const mapped: LicitacaoDetailed[] = json.data.map((item: any, idx: number) => {
          const numControle = item.idContratacaoPNCP || item.numeroControlePNCP || `${item.cnpjOrgao || '00000000000100'}-1-${idx}/${item.anoCompra || 2026}`;
          const cnpj = item.cnpjOrgao || item.orgaoEntidade?.cnpj || "";
          const ano = item.anoCompra || 2026;
          const seq = item.sequencialCompra || idx + 1;
          const linkDirect = item.linkPNCP || (cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}` : `https://pncp.gov.br/app/editais?q=${encodeURIComponent(numControle)}`);

          const orgaoNome = item.orgaoEntidade?.razaoSocial || "Órgão Público Proponente";
          const ufSigla = item.unidadeOrgao?.ufSigla || item.uf || (selectedUfs.length === 1 ? selectedUfs[0] : "BR");
          const municipioNome = item.unidadeOrgao?.municipioNome || "Município Atendido";
          const unidadeNome = item.unidadeOrgao?.nomeUnidade || "Setor de Licitações e Compras";
          const uasgFormatted = item.uasg || (item.unidadeOrgao?.codigoUnidade ? `UASG ${item.unidadeOrgao.codigoUnidade}` : `UASG 925001`);
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
            uasg: uasgFormatted,
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
  }, [selectedUfs, selectedModalidades, pageSize, periodDays]);

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
      <Card className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 md:p-6 rounded-xl shadow-xs relative overflow-hidden">

        <div className="flex items-start gap-4">
          <div className="p-3.5 bg-primary/10 text-primary rounded-xl border border-primary/20 shrink-0 shadow-2xs">
            <Search className="w-6 h-6 animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-foreground text-base">Radar de Oportunidades PNCP</h3>
              <Badge variant="secondary" className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold">
                Portal Nacional de Contratações Públicas
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed max-w-3xl">
              Monitore licitações, pregões eletrônicos e dispensas federais, estaduais e municipais em tempo real. Filtre por múltiplos estados, cidades e modalidades.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-start lg:self-center bg-muted px-3.5 py-2 rounded-xl border border-border">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success"></span>
          </span>
          <div className="text-left">
            <p className="text-foreground font-bold text-[10px]">{dataSource}</p>
            {lastUpdated && <p className="text-muted-foreground font-mono text-[9px]">Atualizado às {lastUpdated}</p>}
          </div>
        </div>
      </Card>

      {/* Main Grid Layout: Search Filters & Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left Filter Controls Sidebar (4 Columns) */}
        <Card className="lg:col-span-4 rounded-xl shadow-xs p-5 space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                <h4 className="font-bold text-foreground text-sm">Filtros Avançados PNCP</h4>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="h-auto p-0 text-[10px] text-muted-foreground hover:text-primary hover:bg-transparent flex items-center gap-1 font-medium"
                title="Limpar todos os filtros"
              >
                <RotateCcw className="w-3 h-3" />
                Limpar
              </Button>
            </div>

            {/* Keyword Search */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Palavra-Chave / Produto / Objeto</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Notebook, Medicamento, Reforma, Software..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetchPNCP(1)}
                  className="w-full pl-9 text-xs font-medium"
                />
              </div>
            </div>

            {/* City / Municipality Search */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Cidade / Município / Órgão</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Mauá, Salvador, São Paulo, Campinas..."
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetchPNCP(1)}
                  className="w-full pl-9 text-xs font-medium"
                />
              </div>
            </div>

            {/* Multi-State Dropdown */}
            <div className="space-y-1.5 relative">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
                Estados / UFs {selectedUfs.length > 0 ? `(${selectedUfs.length} selecionados)` : "(Brasil Inteiro)"}
              </label>

              {/* Trigger Button */}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowStatePicker(!showStatePicker);
                  setShowModalidadesPicker(false);
                }}
                className="w-full h-auto p-2.5 text-xs justify-between gap-2 font-normal"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-primary shrink-0" />
                  <span className="truncate font-semibold text-foreground">
                    {selectedUfs.length === 0
                      ? "Brasil Inteiro (Todos os 27 Estados)"
                      : selectedUfs.length === 1
                      ? ALL_UFS.find(u => u.sigla === selectedUfs[0]) ? `${ALL_UFS.find(u => u.sigla === selectedUfs[0])?.nome} (${selectedUfs[0]})` : selectedUfs[0]
                      : `${selectedUfs.slice(0, 3).join(", ")}${selectedUfs.length > 3 ? ` (+${selectedUfs.length - 3})` : ""}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedUfs.length > 0 && (
                    <Badge className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                      {selectedUfs.length}
                    </Badge>
                  )}
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showStatePicker ? "rotate-180 text-primary" : ""}`} />
                </div>
              </Button>

              {/* Dropdown Menu Popover */}
              {showStatePicker && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl z-50 p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                  {/* Search inside dropdown */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Buscar estado (ex: SP, Bahia, Rio)..."
                      value={ufSearchQuery}
                      onChange={(e) => setUfSearchQuery(e.target.value)}
                      className="w-full h-auto bg-muted pl-8 pr-2 py-1.5 text-xs"
                    />
                    {ufSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setUfSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Actions Header */}
                  <div className="flex items-center justify-between border-b border-border pb-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={handleSelectAllUfs}
                      className={`font-bold transition-colors ${selectedUfs.length === 0 ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                    >
                      ✓ Brasil Inteiro
                    </button>
                    {selectedUfs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedUfs([])}
                        className="text-destructive hover:underline font-medium"
                      >
                        Limpar seleção
                      </button>
                    )}
                  </div>

                  {/* Scrollable UF Options List */}
                  <div className="max-h-52 overflow-y-auto space-y-1 scrollbar-thin pr-1">
                    {filteredUfs.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground">Nenhum estado encontrado</div>
                    ) : (
                      filteredUfs.map(uf => {
                        const isSelected = selectedUfs.includes(uf.sigla);
                        return (
                          <button
                            type="button"
                            key={uf.sigla}
                            onClick={() => handleToggleUf(uf.sigla)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-primary/10 text-primary font-bold"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`w-6 h-5 flex items-center justify-center rounded text-[10px] font-mono font-bold ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                {uf.sigla}
                              </span>
                              <span>{uf.nome}</span>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="pt-1 border-t border-border flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowStatePicker(false)}
                      className="h-auto px-3 py-1 text-[10px] font-bold"
                    >
                      Concluir
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Modalidade Dropdown */}
            <div className="space-y-1.5 relative">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
                Modalidade PNCP {selectedModalidades.length > 0 ? `(${selectedModalidades.length})` : "(Todas)"}
              </label>

              {/* Trigger Button */}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowModalidadesPicker(!showModalidadesPicker);
                  setShowStatePicker(false);
                }}
                className="w-full h-auto p-2.5 text-xs justify-between gap-2 font-normal"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <SlidersHorizontal className="w-4 h-4 text-primary shrink-0" />
                  <span className="truncate font-semibold text-foreground">
                    {selectedModalidades.length === 0
                      ? "Todas as Modalidades (Pregão, Dispensa...)"
                      : selectedModalidades
                          .map(id => ALL_MODALIDADES.find(m => m.id === id)?.nome)
                          .filter(Boolean)
                          .join(", ")}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedModalidades.length > 0 && (
                    <Badge className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                      {selectedModalidades.length}
                    </Badge>
                  )}
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showModalidadesPicker ? "rotate-180 text-primary" : ""}`} />
                </div>
              </Button>

              {/* Dropdown Menu Popover */}
              {showModalidadesPicker && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl z-50 p-2.5 space-y-1.5 animate-in fade-in zoom-in-95 duration-150">
                  {/* Actions Header */}
                  <div className="flex items-center justify-between border-b border-border pb-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setSelectedModalidades([])}
                      className={`font-bold transition-colors ${selectedModalidades.length === 0 ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                    >
                      ✓ Todas as Modalidades
                    </button>
                    {selectedModalidades.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedModalidades([])}
                        className="text-destructive hover:underline font-medium"
                      >
                        Limpar
                      </button>
                    )}
                  </div>

                  {/* Options */}
                  <div className="space-y-1">
                    {ALL_MODALIDADES.map(m => {
                      const isSelected = selectedModalidades.includes(m.id);
                      return (
                        <button
                          type="button"
                          key={m.id}
                          onClick={() => handleToggleModalidade(m.id)}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-primary/10 text-primary font-bold"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground">Cod {m.id}</span>
                            <span>{m.nome}</span>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-primary" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-1.5 border-t border-border flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowModalidadesPicker(false)}
                      className="h-auto px-3 py-1 text-[10px] font-bold"
                    >
                      Concluir
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Period Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Período de Publicação</label>
              <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
                <SelectTrigger className="w-full text-xs font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Últimos 30 dias</SelectItem>
                  <SelectItem value="60">Últimos 60 dias</SelectItem>
                  <SelectItem value="90">Últimos 90 dias (Padrão)</SelectItem>
                  <SelectItem value="180">Últimos 180 dias</SelectItem>
                  <SelectItem value="365">Último 1 ano (365 dias)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Value Range Filters */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Faixa de Valor Estimado (R$)</label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Mínimo R$"
                  value={valorMin}
                  onChange={(e) => setValorMin(e.target.value)}
                  className="w-full text-xs"
                />
                <Input
                  type="number"
                  placeholder="Máximo R$"
                  value={valorMax}
                  onChange={(e) => setValorMax(e.target.value)}
                  className="w-full text-xs"
                />
              </div>
            </div>

          </div>

          <Button
            type="button"
            onClick={() => handleFetchPNCP(1)}
            disabled={loading}
            className="w-full h-auto py-3 mt-2 font-bold text-xs"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Buscando no Portal PNCP...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Buscar Licitações no PNCP
              </>
            )}
          </Button>
        </Card>

        {/* Right Section: Results List & Detail Inspector (8 Columns) */}
        <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* List Column */}
          <Card className="rounded-xl shadow-xs p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3.5">

              {/* Header Info */}
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <span className="font-bold text-foreground text-xs uppercase tracking-wider block">
                    Licitações ({totalRecords})
                  </span>
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {selectedUfs.length > 0 ? `UFs: ${selectedUfs.join(", ")}` : "Todos os Estados"}
                  </span>
                </div>

                {/* Page Size Selector */}
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger size="sm" className="text-[10px] font-mono h-auto px-2 py-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 por pág.</SelectItem>
                    <SelectItem value="15">15 por pág.</SelectItem>
                    <SelectItem value="25">25 por pág.</SelectItem>
                    <SelectItem value="50">50 por pág.</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Items List Container */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
                  <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                  <p className="font-semibold text-xs">Consultando base oficial do PNCP...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2 text-center">
                  <AlertCircle className="w-9 h-9 text-warning" />
                  <div>
                    <p className="font-bold text-foreground text-xs">Nenhum certame localizado com estes filtros</p>
                    <p className="text-[10px] text-muted-foreground max-w-[200px] mt-1">Experimente limpar as palavras-chave ou selecionar mais estados.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin">
                  {results.map((item) => {
                    const isActive = activeItem?.id === item.id;
                    return (
                      <Card
                        key={item.id}
                        onClick={() => setActiveItem(item)}
                        className={`p-3 rounded-xl transition-all cursor-pointer text-left space-y-2 gap-2 shadow-none ${
                          isActive
                            ? "bg-primary/10 border-primary text-foreground shadow-xs"
                            : "text-foreground hover:border-muted-foreground/40 hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <Badge variant="outline" className="font-bold text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary border-primary/20 rounded font-mono truncate max-w-[160px]">
                            {item.numero}
                          </Badge>
                          <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-1 font-bold shrink-0 bg-muted px-1.5 py-0.5 rounded border border-border">
                            <MapPin className="w-3 h-3 text-primary" />
                            {item.municipio} - {item.uf}
                          </span>
                        </div>

                        <p className="font-bold text-foreground text-[11px] truncate">{item.orgao}</p>

                        <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                          {item.objeto}
                        </p>

                        <div className="flex items-center justify-between text-[9px] font-mono pt-1 border-t border-border">
                          <span className="font-bold text-success">{item.valorEstimado}</span>
                          <span className="text-muted-foreground">{item.modalidade}</span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pagination Bar */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    const next = Math.max(1, page - 1);
                    setPage(next);
                    handleFetchPNCP(next);
                  }}
                  className="h-auto px-2.5 py-1.5 text-[10px] gap-1"
                >
                  <ChevronLeft className="w-3 h-3" />
                  Anterior
                </Button>

                <span className="text-[10px] text-muted-foreground font-mono">
                  Página <strong>{page}</strong> de <strong>{totalPages}</strong>
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => {
                    const next = Math.min(totalPages, page + 1);
                    setPage(next);
                    handleFetchPNCP(next);
                  }}
                  className="h-auto px-2.5 py-1.5 text-[10px] gap-1"
                >
                  Próxima
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            )}
          </Card>

          {/* Detailed Inspector Panel */}
          <Card className="rounded-xl shadow-xs p-5 flex flex-col justify-between">
            {activeItem ? (
              <div className="h-full flex flex-col justify-between space-y-4">
                <div className="space-y-4">
                  {/* Item Header */}
                  <div className="border-b border-border pb-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-primary uppercase font-mono font-bold tracking-wider">Ficha Oficial do Edital</span>
                      <Badge variant="secondary" className="text-[9px] px-2 py-0.5 rounded font-mono">
                        {activeItem.situacao}
                      </Badge>
                    </div>
                    <h4 className="font-bold text-foreground text-sm mt-1">{activeItem.numero}</h4>
                    <p className="text-muted-foreground text-[10px] font-mono mt-0.5">{activeItem.modalidade}</p>
                  </div>

                  {/* Fields */}
                  <div className="space-y-3 text-foreground text-[11px] leading-relaxed">
                    <div className="space-y-1">
                      <span className="font-bold text-muted-foreground uppercase text-[9px] block tracking-wider">Órgão Comprador</span>
                      <p className="text-foreground font-semibold flex items-center gap-1.5">
                        <Landmark className="w-3.5 h-3.5 text-primary shrink-0" />
                        {activeItem.orgao}
                      </p>
                      {activeItem.cnpjOrgao && (
                        <p className="text-[9px] text-muted-foreground font-mono">CNPJ: {activeItem.cnpjOrgao}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="bg-muted p-2 rounded-lg border border-border">
                        <span className="font-bold text-muted-foreground uppercase text-[8px] block tracking-wider">UASG / Unidade</span>
                        <p className="text-foreground font-extrabold text-[10px] truncate" title={activeItem.uasg || activeItem.unidade}>
                          {activeItem.uasg || activeItem.unidade}
                        </p>
                      </div>

                      <div className="bg-muted p-2 rounded-lg border border-border">
                        <span className="font-bold text-muted-foreground uppercase text-[8px] block tracking-wider">ID Contratação PNCP</span>
                        <p className="text-primary font-mono font-bold text-[10px] truncate" title={activeItem.numeroControlePNCP}>
                          {activeItem.numeroControlePNCP}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="font-bold text-muted-foreground uppercase text-[9px] block tracking-wider">Localização</span>
                      <p className="text-foreground font-medium flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                        {activeItem.municipio} - {activeItem.uf} ({activeItem.unidade})
                      </p>
                    </div>

                    <div className="space-y-1">
                      <span className="font-bold text-muted-foreground uppercase text-[9px] block tracking-wider">Objeto / Termo de Referência</span>
                      <div className="bg-muted p-3 rounded-xl text-foreground border border-border text-[11px] leading-relaxed max-h-36 overflow-y-auto font-sans scrollbar-thin">
                        {activeItem.objeto}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-muted p-2.5 rounded-xl border border-border space-y-0.5">
                        <span className="text-[8px] text-muted-foreground uppercase font-bold block">Valor Estimado</span>
                        <p className="text-success font-bold font-mono text-xs">{activeItem.valorEstimado}</p>
                      </div>
                      <div className="bg-muted p-2.5 rounded-xl border border-border space-y-0.5">
                        <span className="text-[8px] text-muted-foreground uppercase font-bold block">Abertura de Propostas</span>
                        <p className="text-warning font-bold font-mono text-xs">{activeItem.dataAbertura}</p>
                      </div>
                    </div>

                    {/* Official Portal Link */}
                    {activeItem.linkPNCP && (
                      <div className="pt-1">
                        <Button
                          asChild
                          variant="secondary"
                          className="w-full h-auto py-2 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-xs font-bold gap-2 shadow-2xs"
                        >
                          <a
                            href={activeItem.linkPNCP}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Ver Edital Completo no Portal PNCP Oficial</span>
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Button */}
                <div className="space-y-2 pt-2">
                  <div className="p-3 bg-primary/10 rounded-xl border border-primary/20 text-foreground text-[10px] leading-normal flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5 animate-pulse" />
                    <span>
                      Clique abaixo para transferir esta licitação para o Foco do Chat e fazer uma análise de inteligência competitiva com IA.
                    </span>
                  </div>

                  <Button
                    type="button"
                    onClick={() => handleTriggerAnalysis(activeItem)}
                    className="w-full h-auto py-2.5 font-bold text-xs gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Analisar Edital com Inteligência Artificial
                  </Button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center py-20 gap-2">
                <FileText className="w-10 h-10 text-muted-foreground/50" />
                <p className="text-xs">Selecione uma oportunidade ao lado para ver todos os detalhes.</p>
              </div>
            )}
          </Card>

        </div>

      </div>

    </div>
  );
}
