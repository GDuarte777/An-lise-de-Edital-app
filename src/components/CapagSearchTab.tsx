import { useState, useEffect, useMemo } from "react";
import {
  Search,
  Landmark,
  MapPin,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  Coins,
  Clock,
  ExternalLink,
  Building2,
  CheckCircle2,
  X,
  RotateCcw,
  SlidersHorizontal,
  Info,
  Scale,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  CAPAG_ESTADOS,
  CAPAG_MUNICIPIOS_PRINCIPAIS,
  NOMES_UF,
  carregarMunicipiosCapagPorUf,
  obterEstiloNotaCapag,
  type EnteCapag,
  type NotaCapag,
} from "../utils/capagData";

interface CapagSearchTabProps {
  initialFocusQuery?: {
    uf?: string;
    municipio?: string;
    orgao?: string;
  } | null;
  onClearInitialFocus?: () => void;
}

export default function CapagSearchTab({
  initialFocusQuery,
  onClearInitialFocus,
}: CapagSearchTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUf, setSelectedUf] = useState<string>("TODAS");
  const [esferaFilter, setEsferaFilter] = useState<"TODOS" | "Estado" | "Município">("TODOS");
  const [notaFilter, setNotaFilter] = useState<"TODAS" | "A" | "B" | "C" | "D">("TODAS");
  const [situacaoDividaFilter, setSituacaoDividaFilter] = useState<"TODOS" | "ADIMPLENTES" | "DEVENDO">("TODOS");

  const [municipiosUfCarregados, setMunicipiosUfCarregados] = useState<EnteCapag[]>([]);
  const [carregandoMunicipiosIbge, setCarregandoMunicipiosIbge] = useState(false);
  const [selectedEnte, setSelectedEnte] = useState<EnteCapag | null>(null);

  // Quando o usuário vem do Radar PNCP ou Análise de Edital clicando em um selo CAPAG
  useEffect(() => {
    if (!initialFocusQuery) return;
    const { uf, municipio } = initialFocusQuery;
    if (uf && uf !== "BR" && NOMES_UF[uf.toUpperCase()]) {
      setSelectedUf(uf.toUpperCase());
    }
    if (municipio && municipio !== "Município Atendido") {
      setSearchQuery(municipio);
    }
    if (onClearInitialFocus) {
      onClearInitialFocus();
    }
  }, [initialFocusQuery, onClearInitialFocus]);

  // Quando uma UF específica é selecionada, carrega todos os municípios daquela UF na API oficial do IBGE
  useEffect(() => {
    if (selectedUf === "TODAS") {
      setMunicipiosUfCarregados([]);
      return;
    }

    let cancelado = false;
    setCarregandoMunicipiosIbge(true);
    carregarMunicipiosCapagPorUf(selectedUf)
      .then((lista) => {
        if (!cancelado) {
          setMunicipiosUfCarregados(lista);
        }
      })
      .finally(() => {
        if (!cancelado) {
          setCarregandoMunicipiosIbge(false);
        }
      });

    return () => {
      cancelado = true;
    };
  }, [selectedUf]);

  // Fecha o modal com ESC
  useEffect(() => {
    if (!selectedEnte) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedEnte(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEnte]);

  // Base combinada de Estados + Municípios (usa todos os municípios do IBGE quando uma UF está selecionada)
  const baseCompleta = useMemo(() => {
    if (selectedUf !== "TODAS") {
      const estadoDaUf = CAPAG_ESTADOS.filter((e) => e.uf === selectedUf);
      const muns =
        municipiosUfCarregados.length > 0
          ? municipiosUfCarregados
          : CAPAG_MUNICIPIOS_PRINCIPAIS.filter((m) => m.uf === selectedUf);

      // Garante que os municípios principais curados prevaleçam sobre os gerados
      const mapaMuns = new Map<string, EnteCapag>();
      for (const m of muns) {
        mapaMuns.set(m.nome.toLowerCase(), m);
      }
      for (const mCurado of CAPAG_MUNICIPIOS_PRINCIPAIS.filter((m) => m.uf === selectedUf)) {
        mapaMuns.set(mCurado.nome.toLowerCase(), mCurado);
      }

      return [...estadoDaUf, ...Array.from(mapaMuns.values())];
    }

    return [...CAPAG_ESTADOS, ...CAPAG_MUNICIPIOS_PRINCIPAIS];
  }, [selectedUf, municipiosUfCarregados]);

  const resultadosFiltrados = useMemo(() => {
    const q = searchQuery
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

    return baseCompleta.filter((ente) => {
      if (selectedUf !== "TODAS" && ente.uf !== selectedUf) return false;
      if (esferaFilter !== "TODOS" && ente.esfera !== esferaFilter) return false;

      if (notaFilter !== "TODAS") {
        if (notaFilter === "A" && ente.notaCapag !== "A" && ente.notaCapag !== "A+") return false;
        if (notaFilter !== "A" && ente.notaCapag !== notaFilter) return false;
      }

      if (situacaoDividaFilter === "ADIMPLENTES" && ente.veredito.estaDevendoFornecedores) {
        return false;
      }
      if (situacaoDividaFilter === "DEVENDO" && !ente.veredito.estaDevendoFornecedores) {
        return false;
      }

      if (q) {
        const nomeNorm = ente.nome
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const ufNorm = ente.uf.toLowerCase();
        const nomeUfNorm = ente.nomeUf
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const ibgeNorm = ente.codigoIbge.toLowerCase();

        if (
          !nomeNorm.includes(q) &&
          ufNorm !== q &&
          !nomeUfNorm.includes(q) &&
          !ibgeNorm.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [baseCompleta, searchQuery, selectedUf, esferaFilter, notaFilter, situacaoDividaFilter]);

  const estatisticas = useMemo(() => {
    const total = resultadosFiltrados.length;
    const classeA = resultadosFiltrados.filter((e) => e.notaCapag === "A+" || e.notaCapag === "A").length;
    const classeB = resultadosFiltrados.filter((e) => e.notaCapag === "B").length;
    const classeCeD = resultadosFiltrados.filter((e) => e.notaCapag === "C" || e.notaCapag === "D").length;
    const devendoCurtoPrazo = resultadosFiltrados.filter((e) => e.veredito.estaDevendoFornecedores).length;
    return { total, classeA, classeB, classeCeD, devendoCurtoPrazo };
  }, [resultadosFiltrados]);

  const handleLimparFiltros = () => {
    setSearchQuery("");
    setSelectedUf("TODAS");
    setEsferaFilter("TODOS");
    setNotaFilter("TODAS");
    setSituacaoDividaFilter("TODOS");
  };

  const renderCorNotaIndicador = (nota: string) => {
    if (nota === "A") return "bg-success/15 text-success border-success/30";
    if (nota === "B") return "bg-primary/15 text-primary border-primary/30";
    return "bg-destructive/15 text-destructive border-destructive/30";
  };

  return (
    <div id="capag-search-tab" className="space-y-6 animate-fade-in font-sans text-xs">
      {/* Cabeçalho Institucional CAPAG */}
      <Card className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 md:p-6 rounded-xl shadow-xs">
        <div className="flex items-start gap-4">
          <div className="p-3.5 bg-primary/10 text-primary rounded-xl border border-primary/20 shrink-0 shadow-2xs">
            <Scale className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-foreground text-base">
                Consulta CAPAG &amp; Risco Pagador (Tesouro Nacional / STN)
              </h3>
              <Badge variant="secondary" className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold">
                Portaria MF nº 1.583 • Siconfi
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed max-w-3xl">
              Pesquise qualquer <strong>Estado</strong> ou <strong>Município</strong> antes de entrar na disputa para
              saber se é um <strong>Bom Pagador (Classe A+, A ou B)</strong> ou se está com{" "}
              <strong>caixa comprometido / devendo Restos a Pagar (Classe C ou D)</strong>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="text-xs font-semibold gap-1.5"
          >
            <a
              href="https://www.tesourotransparente.gov.br/temas/estados-e-municipios/capacidade-de-pagamento-capag"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-primary" />
              Portal Oficial Tesouro Transparente
            </a>
          </Button>
        </div>
      </Card>

      {/* Cards de Resumo Executivo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 rounded-xl border border-success/30 bg-success/5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-success">
              Classe A+ e A (Excelentes Pagadores)
            </span>
            <ShieldCheck className="w-4 h-4 text-success" />
          </div>
          <p className="text-2xl font-extrabold font-mono text-foreground">{estatisticas.classeA}</p>
          <p className="text-[10px] text-muted-foreground">
            Caixa líquido positivo • Pagamento médio em 15 a 30 dias
          </p>
        </Card>

        <Card className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              Classe B (Bons Pagadores / Regular)
            </span>
            <CheckCircle2 className="w-4 h-4 text-primary" />
          </div>
          <p className="text-2xl font-extrabold font-mono text-foreground">{estatisticas.classeB}</p>
          <p className="text-[10px] text-muted-foreground">
            Solvência regular • Recomendado giro de 30 a 45 dias
          </p>
        </Card>

        <Card className="p-4 rounded-xl border border-warning/40 bg-warning/5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-warning">
              Classe C e D (Alerta Fiscal / Risco)
            </span>
            <AlertTriangle className="w-4 h-4 text-warning" />
          </div>
          <p className="text-2xl font-extrabold font-mono text-foreground">{estatisticas.classeCeD}</p>
          <p className="text-[10px] text-muted-foreground">
            Exige margem de segurança financeira (+7% a +18%)
          </p>
        </Card>

        <Card className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">
              Com Pressão de Restos a Pagar
            </span>
            <Coins className="w-4 h-4 text-destructive" />
          </div>
          <p className="text-2xl font-extrabold font-mono text-foreground">{estatisticas.devendoCurtoPrazo}</p>
          <p className="text-[10px] text-muted-foreground">
            Obrigações de curto prazo elevadas frente ao caixa livre
          </p>
        </Card>
      </div>

      {/* Barra Horizontal de Pesquisa e Filtros CAPAG */}
      <Card className="p-5 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            <h4 className="font-bold text-foreground text-sm">
              Pesquisar Estado ou Município no CAPAG
            </h4>
            {carregandoMunicipiosIbge && (
              <span className="inline-flex items-center gap-1 text-[10px] text-primary font-mono">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Carregando todos os municípios da UF ({selectedUf}) no IBGE...
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleLimparFiltros}
            className="h-auto p-0 text-[10px] text-muted-foreground hover:text-primary hover:bg-transparent flex items-center gap-1 font-medium"
          >
            <RotateCcw className="w-3 h-3" />
            Limpar Filtros
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 items-end">
          {/* Campo de Busca por Nome */}
          <div className="space-y-1.5 lg:col-span-2">
            <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
              Estado, Município ou Código IBGE
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Ex: São Paulo, Curitiba, Mauá, Minas Gerais, Bahia..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 text-xs font-medium"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Seletor de Estado (UF) */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
              Filtrar por Estado (UF)
            </label>
            <Select value={selectedUf} onValueChange={setSelectedUf}>
              <SelectTrigger className="w-full text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Brasil Inteiro (27 UFs + Capitais)</SelectItem>
                {Object.entries(NOMES_UF).map(([sigla, nome]) => (
                  <SelectItem key={sigla} value={sigla}>
                    {sigla} — {nome} (Ver todos os municípios)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filtro por Nota CAPAG */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
              Classe / Nota CAPAG
            </label>
            <Select
              value={notaFilter}
              onValueChange={(v) => setNotaFilter(v as "TODAS" | "A" | "B" | "C" | "D")}
            >
              <SelectTrigger className="w-full text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas as Classes (A+, A, B, C, D)</SelectItem>
                <SelectItem value="A">Somente Classe A+ e A (Excelente)</SelectItem>
                <SelectItem value="B">Somente Classe B (Regular / Bom)</SelectItem>
                <SelectItem value="C">Somente Classe C (Alerta Fiscal)</SelectItem>
                <SelectItem value="D">Somente Classe D (Alto Risco)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro por Situação de Dívida / Caixa */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
              Situação de Caixa / Dívida
            </label>
            <Select
              value={situacaoDividaFilter}
              onValueChange={(v) => setSituacaoDividaFilter(v as "TODOS" | "ADIMPLENTES" | "DEVENDO")}
            >
              <SelectTrigger className="w-full text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos os Entes Públicos</SelectItem>
                <SelectItem value="ADIMPLENTES">Com Sobra de Caixa (Bons Pagadores)</SelectItem>
                <SelectItem value="DEVENDO">Com Pressão de Restos a Pagar / Dívida</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Botões Rápidos de Esfera */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase text-muted-foreground mr-1">Esfera:</span>
            {(["TODOS", "Estado", "Município"] as const).map((esf) => (
              <Button
                key={esf}
                type="button"
                size="sm"
                variant={esferaFilter === esf ? "default" : "outline"}
                onClick={() => setEsferaFilter(esf)}
                className="h-7 px-3 text-[11px] font-semibold cursor-pointer"
              >
                {esf === "TODOS"
                  ? "Estados & Municípios"
                  : esf === "Estado"
                  ? "Somente Governos Estaduais (27 UFs)"
                  : "Somente Prefeituras Municipais"}
              </Button>
            ))}
          </div>

          <span className="text-[10px] text-muted-foreground font-mono">
            Exibindo <strong>{resultadosFiltrados.length}</strong>{" "}
            {resultadosFiltrados.length === 1 ? "ente público" : "entes públicos"}
            {selectedUf !== "TODAS" ? ` em ${NOMES_UF[selectedUf]} (${selectedUf})` : ""}
          </span>
        </div>
      </Card>

      {/* Grid de Cards dos Estados e Municípios */}
      {resultadosFiltrados.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <AlertTriangle className="w-9 h-9 text-warning mx-auto" />
          <div className="space-y-1">
            <p className="font-bold text-foreground text-sm">
              Nenhum Estado ou Município encontrado com estes filtros
            </p>
            <p className="text-muted-foreground text-xs max-w-md mx-auto">
              Para pesquisar qualquer um dos 5.570 municípios do país, selecione o <strong>Estado (UF)</strong> no filtro
              acima para carregar todas as cidades do IBGE daquela região.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleLimparFiltros}>
            Restaurar Todos os Estados e Capitais
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {resultadosFiltrados.slice(0, 90).map((ente) => {
            const estilo = obterEstiloNotaCapag(ente.notaCapag);
            return (
              <Card
                key={ente.id}
                onClick={() => setSelectedEnte(ente)}
                className={`p-4 rounded-xl border ${estilo.cardBorder} hover:border-primary/60 transition-all cursor-pointer flex flex-col justify-between space-y-3.5 shadow-2xs hover:shadow-md`}
              >
                {/* Topo do Card: Esfera, Nome e Nota CAPAG */}
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className="text-[9px] font-mono px-1.5 py-0 uppercase font-bold"
                        >
                          {ente.esfera === "Estado" ? (
                            <span className="flex items-center gap-1">
                              <Landmark className="w-2.5 h-2.5 text-primary" />
                              Governo Estadual
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <Building2 className="w-2.5 h-2.5 text-primary" />
                              Prefeitura Municipal
                            </span>
                          )}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-0.5 font-semibold">
                          <MapPin className="w-3 h-3 text-primary" />
                          {ente.uf}
                        </span>
                        {ente.regimeRecuperacaoFiscal && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono bg-destructive/10 text-destructive border-destructive/30"
                          >
                            Em RRF
                          </Badge>
                        )}
                      </div>

                      <h4 className="font-bold text-foreground text-sm leading-snug truncate" title={ente.nome}>
                        {ente.esfera === "Município" ? `Prefeitura de ${ente.nome} - ${ente.uf}` : ente.nome}
                      </h4>
                    </div>

                    {/* Selo Grande da Nota CAPAG */}
                    <div
                      className={`px-3 py-1.5 rounded-xl border ${estilo.badgeBg} ${estilo.badgeText} ${estilo.badgeBorder} text-center shrink-0`}
                    >
                      <span className="block text-[8px] font-mono uppercase font-bold tracking-wider">
                        CAPAG
                      </span>
                      <span className="font-extrabold font-mono text-base leading-none">
                        {ente.notaCapag}
                      </span>
                    </div>
                  </div>

                  {/* Banner de Veredito Rápido: Bom Pagador vs Está Devendo */}
                  <div
                    className={`p-2.5 rounded-lg border ${estilo.badgeBg} ${estilo.badgeBorder} flex items-center justify-between gap-2`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {ente.veredito.estaDevendoFornecedores ? (
                        <AlertTriangle className={`w-4 h-4 shrink-0 ${estilo.badgeText}`} />
                      ) : (
                        <ShieldCheck className={`w-4 h-4 shrink-0 ${estilo.badgeText}`} />
                      )}
                      <span className={`font-bold text-[11px] truncate ${estilo.badgeText}`}>
                        {ente.veredito.statusPagador}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] font-mono shrink-0 ${estilo.badgeBg} ${estilo.badgeText} ${estilo.badgeBorder}`}
                    >
                      {ente.veredito.estaDevendoFornecedores ? "Atenção: Dívida / Caixa" : "Caixa Adimplente"}
                    </Badge>
                  </div>

                  {/* Os 3 Indicadores Fiscais do Tesouro Nacional */}
                  <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                    <div className="bg-muted/70 border border-border rounded-lg p-2 text-center">
                      <span className="text-[8px] text-muted-foreground font-mono uppercase block truncate">
                        1. Endividamento
                      </span>
                      <span className="font-extrabold font-mono text-xs text-foreground">
                        {ente.indicadores.endividamento.valorPercentual}%
                      </span>
                      <span
                        className={`mt-0.5 inline-block px-1.5 py-0 rounded text-[8px] font-mono font-bold border ${renderCorNotaIndicador(
                          ente.indicadores.endividamento.nota
                        )}`}
                      >
                        Nota {ente.indicadores.endividamento.nota}
                      </span>
                    </div>

                    <div className="bg-muted/70 border border-border rounded-lg p-2 text-center">
                      <span className="text-[8px] text-muted-foreground font-mono uppercase block truncate">
                        2. Poupança Corr.
                      </span>
                      <span className="font-extrabold font-mono text-xs text-foreground">
                        {ente.indicadores.poupancaCorrente.valorPercentual}%
                      </span>
                      <span
                        className={`mt-0.5 inline-block px-1.5 py-0 rounded text-[8px] font-mono font-bold border ${renderCorNotaIndicador(
                          ente.indicadores.poupancaCorrente.nota
                        )}`}
                      >
                        Nota {ente.indicadores.poupancaCorrente.nota}
                      </span>
                    </div>

                    <div className="bg-muted/70 border border-border rounded-lg p-2 text-center">
                      <span className="text-[8px] text-muted-foreground font-mono uppercase block truncate">
                        3. Liquidez/Caixa
                      </span>
                      <span className="font-extrabold font-mono text-xs text-foreground">
                        {ente.indicadores.liquidez.valorPercentual}%
                      </span>
                      <span
                        className={`mt-0.5 inline-block px-1.5 py-0 rounded text-[8px] font-mono font-bold border ${renderCorNotaIndicador(
                          ente.indicadores.liquidez.nota
                        )}`}
                      >
                        Nota {ente.indicadores.liquidez.nota}
                      </span>
                    </div>
                  </div>

                  {/* Explicação Direta sobre Caixa e Restos a Pagar */}
                  <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                    {ente.veredito.resumoDividaCaixa}
                  </p>
                </div>

                {/* Rodapé do Card: Prazo Estimado + Margem Recomendada + Botão Detalhes */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-[10px] gap-2">
                    <span className="text-muted-foreground flex items-center gap-1 truncate">
                      <Clock className="w-3 h-3 text-primary shrink-0" />
                      {ente.veredito.prazoMedioRecebimento}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] gap-2">
                    <span className="font-semibold text-foreground flex items-center gap-1 truncate">
                      <TrendingUp className="w-3 h-3 text-success shrink-0" />
                      Margem: {ente.veredito.margemFinanceiraRecomendada}
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEnte(ente);
                    }}
                    className="w-full h-auto py-1.5 text-[10px] font-bold gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                  >
                    <Info className="w-3.5 h-3.5" />
                    Ver Diagnóstico Fiscal Completo
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Dossiê Fiscal Completo do Estado / Município */}
      {selectedEnte && (() => {
        const estilo = obterEstiloNotaCapag(selectedEnte.notaCapag);
        return (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/65 backdrop-blur-xs overflow-y-auto animate-fade-in"
            onClick={() => setSelectedEnte(null)}
          >
            <Card
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl border border-border bg-card flex flex-col overflow-hidden my-auto"
            >
              {/* Cabeçalho do Modal */}
              <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-border bg-muted/60 shrink-0">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-mono uppercase font-bold">
                      {selectedEnte.esfera === "Estado" ? "Governo Estadual" : "Prefeitura Municipal"} • IBGE{" "}
                      {selectedEnte.codigoIbge}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-mono font-bold ${estilo.badgeBg} ${estilo.badgeText} ${estilo.badgeBorder}`}
                    >
                      Nota CAPAG {selectedEnte.notaCapag}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      CAUC: {selectedEnte.regularidadeCauc}
                    </Badge>
                  </div>
                  <h4 className="font-bold text-foreground text-base sm:text-lg truncate">
                    {selectedEnte.esfera === "Município"
                      ? `Prefeitura Municipal de ${selectedEnte.nome} (${selectedEnte.uf})`
                      : `${selectedEnte.nome} (${selectedEnte.uf})`}
                  </h4>
                  <p className="text-muted-foreground text-[11px] font-mono">{selectedEnte.fonteOficial}</p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedEnte(null)}
                  className="h-8 w-8 p-0 rounded-lg shrink-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Conteúdo Rolável */}
              <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1 scrollbar-thin">
                {/* Bloco 1: Veredito Direto para o Licitante */}
                <div className={`p-4 rounded-xl border ${estilo.badgeBg} ${estilo.badgeBorder} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {selectedEnte.veredito.estaDevendoFornecedores ? (
                        <AlertTriangle className={`w-5 h-5 ${estilo.badgeText}`} />
                      ) : (
                        <ShieldCheck className={`w-5 h-5 ${estilo.badgeText}`} />
                      )}
                      <div>
                        <span className="text-[9px] font-mono uppercase tracking-wider font-bold text-muted-foreground block">
                          Veredito Automático para o Licitante
                        </span>
                        <h5 className={`text-sm font-extrabold ${estilo.badgeText}`}>
                          {selectedEnte.veredito.statusPagador} (Risco {selectedEnte.veredito.nivelRisco})
                        </h5>
                      </div>
                    </div>

                    <div className="px-3 py-1.5 rounded-lg bg-card border border-border text-right">
                      <span className="text-[8px] font-mono uppercase text-muted-foreground block">
                        Situação de Curto Prazo
                      </span>
                      <span
                        className={`font-bold text-xs ${
                          selectedEnte.veredito.estaDevendoFornecedores ? "text-destructive" : "text-success"
                        }`}
                      >
                        {selectedEnte.veredito.estaDevendoFornecedores
                          ? "Pressão de Restos a Pagar / Caixa"
                          : "Caixa Livre Positivo (Adimplente)"}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-foreground leading-relaxed font-medium">
                    {selectedEnte.veredito.resumoDividaCaixa}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="bg-card/90 p-3 rounded-lg border border-border">
                      <span className="text-[9px] font-mono uppercase text-muted-foreground font-bold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-primary" />
                        Prazo Médio Estimado de Pagamento
                      </span>
                      <p className="text-foreground font-bold text-xs mt-1">
                        {selectedEnte.veredito.prazoMedioRecebimento}
                      </p>
                    </div>

                    <div className="bg-card/90 p-3 rounded-lg border border-border">
                      <span className="text-[9px] font-mono uppercase text-muted-foreground font-bold flex items-center gap-1">
                        <Coins className="w-3.5 h-3.5 text-success" />
                        Margem de Segurança Recomendada
                      </span>
                      <p className="text-foreground font-bold text-xs mt-1">
                        {selectedEnte.veredito.margemFinanceiraRecomendada}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Bloco 2: Os 3 Indicadores Oficiais do Tesouro Nacional (STN) */}
                <div className="space-y-3">
                  <h5 className="font-bold text-foreground text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <Scale className="w-4 h-4 text-primary" />
                    Os 3 Indicadores Fiscais Oficiais do Tesouro Nacional (Portaria MF nº 1.583)
                  </h5>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {Object.values(selectedEnte.indicadores).map((ind) => (
                      <div key={ind.codigo} className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-bold text-muted-foreground">
                            Indicador {ind.codigo} ({ind.sigla})
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-extrabold border ${renderCorNotaIndicador(
                              ind.nota
                            )}`}
                          >
                            Nota {ind.nota}
                          </span>
                        </div>
                        <p className="font-bold text-foreground text-xs leading-snug">{ind.nome}</p>
                        <div className="flex items-baseline justify-between">
                          <span className="text-lg font-extrabold font-mono text-primary">
                            {ind.valorPercentual}%
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground">
                            Meta A: {ind.limiteNotaA}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{ind.descricaoCurta}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bloco 3: Estratégia Comercial e Amparo na Lei 14.133/2021 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl border border-border bg-card space-y-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold text-primary block">
                      Estratégia Comercial Recomendada na Disputa
                    </span>
                    <p className="text-xs text-foreground leading-relaxed">
                      {selectedEnte.veredito.estrategiaComercial}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-border bg-card space-y-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold text-success block">
                      Proteção Jurídica ao Licitante (Lei 14.133/2021)
                    </span>
                    <p className="text-xs text-foreground leading-relaxed">
                      {selectedEnte.veredito.amparoLegal}
                    </p>
                  </div>
                </div>
              </div>

              {/* Rodapé do Modal com Links Oficiais STN / Siconfi */}
              <div className="p-4 sm:p-5 border-t border-border bg-muted/60 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <Button asChild variant="outline" size="sm" className="text-xs font-semibold gap-1.5">
                    <a
                      href={selectedEnte.linkTesouroTransparente}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5 text-primary" />
                      Boletim CAPAG no Tesouro Transparente
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="text-xs font-semibold gap-1.5">
                    <a
                      href={selectedEnte.linkSiconfi}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-primary" />
                      Consultar RGF / Restos a Pagar no Siconfi
                    </a>
                  </Button>
                </div>

                <Button
                  type="button"
                  onClick={() => setSelectedEnte(null)}
                  className="w-full sm:w-28 text-xs font-bold"
                >
                  Fechar
                </Button>
              </div>
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
