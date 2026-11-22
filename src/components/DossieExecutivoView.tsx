import React, { useState, useEffect, useMemo } from "react";
import {
  EditalAnalysis,
  DossieExecutivoData,
  DossieParametroOficial,
  DossiePontoAtencao,
  DossieChecklistCategoria,
} from "../types";
import {
  TEMAS_DOSSIE,
  construirDossieExecutivo,
  gerarPdfDossieExecutivo,
  parseValorMonetario,
  formatarMoedaBR,
} from "../utils/dossieExecutivo";
import { resolverCapagPorOrgaoOuLocal, obterEstiloNotaCapag } from "../utils/capagData";
import {
  FileDown,
  Edit3,
  Check,
  Plus,
  Trash2,
  RotateCcw,
  Search,
  ExternalLink,
  Globe,
  ShieldAlert,
  CheckCircle2,
  TrendingUp,
  Landmark,
  Coins,
  Calendar,
  Sparkles,
  Palette,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

interface DossieExecutivoViewProps {
  edital: EditalAnalysis;
  selectedItemNumbers: number[];
  pncpUrl: string | null;
  idContratacaoPncp: string;
  uasg: string;
  dataHoraDisputa: string;
  onSaveEditalDossie: (updatedEdital: EditalAnalysis) => void;
  onNavigateToCapag?: (params: { uf?: string; municipio?: string; orgao?: string }) => void;
}

/**
 * Renderiza texto com suporte a `**negrito**` para escaneabilidade cognitiva imediata.
 */
function RichInlineText({
  text,
  className = "",
  boldClassName = "font-bold text-slate-950",
}: {
  text: string;
  className?: string;
  boldClassName?: string;
}) {
  if (!text) return null;
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className={className}>
      {parts.map((part, idx) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={idx} className={boldClassName}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </span>
  );
}

export default function DossieExecutivoView({
  edital,
  selectedItemNumbers,
  pncpUrl,
  idContratacaoPncp,
  uasg,
  dataHoraDisputa,
  onSaveEditalDossie,
  onNavigateToCapag,
}: DossieExecutivoViewProps) {
  const [dossie, setDossie] = useState<DossieExecutivoData>(() =>
    construirDossieExecutivo(edital, selectedItemNumbers)
  );
  const [itensEditaveis, setItensEditaveis] = useState<NonNullable<EditalAnalysis["itensEdital"]>>(() => {
    const todos = Array.isArray(edital.itensEdital) ? edital.itensEdital : [];
    if (selectedItemNumbers && selectedItemNumbers.length > 0) {
      const filtrados = todos.filter(it => selectedItemNumbers.includes(it.numero));
      if (filtrados.length > 0) return filtrados;
    }
    return todos;
  });

  const [isEditing, setIsEditing] = useState(false);
  const [searchItemTerm, setSearchItemTerm] = useState("");
  const [checkedPegadinhas, setCheckedPegadinhas] = useState<Record<number, boolean>>({});
  const [checkedHabilitacao, setCheckedHabilitacao] = useState<Record<number, boolean>>({});
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Sincroniza quando o edital ativo ou os itens selecionados mudam
  useEffect(() => {
    setDossie(construirDossieExecutivo(edital, selectedItemNumbers));
    const todos = Array.isArray(edital.itensEdital) ? edital.itensEdital : [];
    if (selectedItemNumbers && selectedItemNumbers.length > 0) {
      const filtrados = todos.filter(it => selectedItemNumbers.includes(it.numero));
      setItensEditaveis(filtrados.length > 0 ? filtrados : todos);
    } else {
      setItensEditaveis(todos);
    }
    setIsEditing(false);
    setCheckedPegadinhas({});
    setCheckedHabilitacao({});
  }, [edital, selectedItemNumbers.join(",")]);

  const tema = TEMAS_DOSSIE[dossie.temaCor || "emerald"] || TEMAS_DOSSIE.emerald;

  // Diagnóstico CAPAG do órgão comprador
  const capagEnte = useMemo(() => {
    const pncpMeta = (edital as any).dadosOficiaisPNCP || {};
    return resolverCapagPorOrgaoOuLocal({
      uf: pncpMeta.uf,
      municipio: pncpMeta.municipio,
      orgao:
        edital.identificacaoCertame?.orgaoComprador ||
        pncpMeta.orgao ||
        dossie.subtituloOrgao ||
        edital.rawText,
    });
  }, [edital, dossie.subtituloOrgao]);

  const capagEstilo = obterEstiloNotaCapag(capagEnte.notaCapag);

  // Cálculo do valor global e quantidades dos itens exibidos
  const resumoFinanceiro = useMemo(() => {
    let totalValor = 0;
    let totalQtd = 0;
    for (const it of itensEditaveis) {
      const q = Number(it.quantidade) || 0;
      const u = parseValorMonetario(it.valorEstimado);
      totalQtd += q;
      if (q > 0 && u > 0) {
        totalValor += q * u;
      } else if (u > 0) {
        totalValor += u;
      }
    }
    const valorFormatado =
      totalValor > 0
        ? formatarMoedaBR(totalValor)
        : edital.viabilidadeFinanceira?.valorEstimado || "Consultar Edital";
    return {
      totalValor,
      totalQtd,
      valorFormatado,
    };
  }, [itensEditaveis, edital.viabilidadeFinanceira?.valorEstimado]);

  const itensFiltrados = useMemo(() => {
    if (!searchItemTerm.trim()) return itensEditaveis;
    const termo = searchItemTerm.toLowerCase().trim();
    return itensEditaveis.filter(
      it =>
        String(it.numero).includes(termo) ||
        (it.descricao || "").toLowerCase().includes(termo) ||
        (it.valorEstimado || "").toLowerCase().includes(termo)
    );
  }, [itensEditaveis, searchItemTerm]);

  const persistChanges = (nextDossie: DossieExecutivoData, nextItens = itensEditaveis) => {
    setDossie(nextDossie);
    // Mescla itens editados de volta na lista completa do edital
    const originais = Array.isArray(edital.itensEdital) ? edital.itensEdital : [];
    const mapaEditados = new Map(nextItens.map(i => [i.numero, i]));
    const itensMesclados =
      originais.length > 0 && selectedItemNumbers.length > 0 && selectedItemNumbers.length < originais.length
        ? originais.map(orig => mapaEditados.get(orig.numero) || orig)
        : nextItens;

    onSaveEditalDossie({
      ...edital,
      dossieExecutivo: nextDossie,
      itensEdital: itensMesclados,
    });
  };

  const handleThemeChange = (novoTema: "emerald" | "terracotta" | "navy") => {
    const atualizado: DossieExecutivoData = { ...dossie, temaCor: novoTema };
    persistChanges(atualizado);
  };

  const handleSaveEdits = () => {
    persistChanges(dossie, itensEditaveis);
    setIsEditing(false);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2500);
  };

  const handleResetDossie = () => {
    const limpo: EditalAnalysis = { ...edital, dossieExecutivo: undefined };
    const reconstruido = construirDossieExecutivo(limpo, selectedItemNumbers);
    setDossie(reconstruido);
    onSaveEditalDossie({ ...edital, dossieExecutivo: reconstruido });
  };

  const handleDownloadPdf = () => {
    if (isEditing) {
      persistChanges(dossie, itensEditaveis);
      setIsEditing(false);
    }
    gerarPdfDossieExecutivo(dossie, itensEditaveis, {
      veredito: edital.parecerFinal?.veredito || "Analisar Condições",
      grauRisco: edital.parecerFinal?.grauRisco || "Médio",
      capagLabel: `Nota ${capagEnte.notaCapag} (${capagEnte.veredito.statusPagador})`,
      valorGlobalFormatado: resumoFinanceiro.valorFormatado,
    });
  };

  // Manipuladores de edição da Tabela 1 (Dados Oficiais)
  const updateParametroOficial = (idx: number, field: keyof DossieParametroOficial, value: string) => {
    const next = [...dossie.dadosOficiais];
    next[idx] = { ...next[idx], [field]: value };
    setDossie({ ...dossie, dadosOficiais: next });
  };

  const addParametroOficial = () => {
    setDossie({
      ...dossie,
      dadosOficiais: [
        ...dossie.dadosOficiais,
        { parametro: "Novo Parâmetro do Edital", regra: "Descreva a regra oficial com **destaques em negrito**." },
      ],
    });
  };

  const removeParametroOficial = (idx: number) => {
    setDossie({
      ...dossie,
      dadosOficiais: dossie.dadosOficiais.filter((_, i) => i !== idx),
    });
  };

  // Manipuladores de edição da Tabela 2 (Planilha de Itens)
  const updateItemPlanilha = (
    idx: number,
    field: "numero" | "descricao" | "quantidade" | "unidade" | "valorEstimado",
    value: string | number
  ) => {
    const next = [...itensEditaveis];
    next[idx] = { ...next[idx], [field]: value };
    setItensEditaveis(next);
  };

  const addItemPlanilha = () => {
    const nextNum =
      itensEditaveis.length > 0 ? Math.max(...itensEditaveis.map(i => Number(i.numero) || 0)) + 1 : 1;
    setItensEditaveis([
      ...itensEditaveis,
      {
        numero: nextNum,
        descricao: "Novo item / especificação técnica",
        quantidade: 1,
        unidade: "un",
        valorEstimado: "R$ 0,00",
      },
    ]);
  };

  const removeItemPlanilha = (idx: number) => {
    setItensEditaveis(itensEditaveis.filter((_, i) => i !== idx));
  };

  // Manipuladores de edição da Seção 3 (Pontos de Atenção / Pegadinhas)
  const updatePontoAtencao = (idx: number, field: keyof DossiePontoAtencao, value: string) => {
    const next = [...dossie.pontosAtencao];
    next[idx] = { ...next[idx], [field]: value };
    setDossie({ ...dossie, pontosAtencao: next });
  };

  const addPontoAtencao = () => {
    const nextIdx = dossie.pontosAtencao.length + 1;
    setDossie({
      ...dossie,
      pontosAtencao: [
        ...dossie.pontosAtencao,
        {
          prefixo: `PONTO DE ATENÇÃO ${nextIdx}`,
          titulo: "Nova Exigência Crítica ou Pegadinha (Item X.Y)",
          descricao: "Descreva o risco de desclassificação e a orientação prática para a equipe.",
        },
      ],
    });
  };

  const removePontoAtencao = (idx: number) => {
    setDossie({
      ...dossie,
      pontosAtencao: dossie.pontosAtencao.filter((_, i) => i !== idx),
    });
  };

  // Manipuladores de edição da Seção 4 (Checklist Categorizado)
  const updateChecklistCat = (idx: number, field: keyof DossieChecklistCategoria, value: string) => {
    const next = [...dossie.checklistCategorizado];
    next[idx] = { ...next[idx], [field]: value };
    setDossie({ ...dossie, checklistCategorizado: next });
  };

  const addChecklistCat = () => {
    setDossie({
      ...dossie,
      checklistCategorizado: [
        ...dossie.checklistCategorizado,
        {
          categoria: "Nova Categoria de Habilitação",
          descricao: "Liste os documentos e certidões exigidos nesta categoria.",
        },
      ],
    });
  };

  const removeChecklistCat = (idx: number) => {
    setDossie({
      ...dossie,
      checklistCategorizado: dossie.checklistCategorizado.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════════════════════════
          BARRA DE CONTROLE DO DOSSIÊ EXECUTIVO (TEMA, EDIÇÃO INLINE & PDF A4)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-card border border-border rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground mr-1">
            <Palette className="w-4 h-4 text-primary" />
            <span>Tema do Dossiê / PDF:</span>
          </div>

          {(Object.keys(TEMAS_DOSSIE) as Array<"emerald" | "terracotta" | "navy">).map(key => {
            const t = TEMAS_DOSSIE[key];
            const ativo = (dossie.temaCor || "emerald") === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleThemeChange(key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                  ativo
                    ? "bg-accent text-foreground border-primary shadow-2xs"
                    : "bg-background text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: t.primaryHex }}
                />
                <span>{t.nome}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {savedFeedback && (
            <span className="text-xs font-bold text-success flex items-center gap-1 px-2 py-1 bg-success/10 rounded-lg border border-success/30">
              <Check className="w-3.5 h-3.5" />
              Dossiê atualizado!
            </span>
          )}

          {isEditing ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDossie}
                className="text-xs font-semibold gap-1.5"
                title="Restaurar textos originais gerados pela IA"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar Padrão IA</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveEdits}
                className="text-xs font-bold gap-1.5 bg-success hover:bg-success/90 text-white"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Salvar Edições do Dossiê</span>
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="text-xs font-bold gap-1.5 border-primary/40 text-foreground hover:bg-accent"
            >
              <Edit3 className="w-3.5 h-3.5 text-primary" />
              <span>Editar Textos e Pontos de Atenção</span>
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            onClick={handleDownloadPdf}
            className="text-xs font-bold gap-2 text-white shadow-xs cursor-pointer"
            style={{ backgroundColor: tema.primaryHex }}
          >
            <FileDown className="w-4 h-4" />
            <span>Baixar Dossiê em PDF</span>
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Modo de Edição Ativo:</strong> Edite qualquer título, regra, item da planilha ou ponto de atenção abaixo. Use{" "}
              <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900 rounded font-mono">**texto**</code> para destacar palavras em{" "}
              <strong>negrito</strong> no documento e no PDF.
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveEdits}
            className="h-7 px-3 text-xs font-bold bg-amber-700 hover:bg-amber-800 text-white shrink-0"
          >
            Concluir e Salvar
          </Button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          FOLHA EDITORIAL DO DOSSIÊ EXECUTIVO (LAYOUT FIEL AO PDF A4)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white text-slate-900 border border-slate-200 rounded-xl shadow-md overflow-hidden">
        <div className="p-5 sm:p-8 md:p-10 space-y-7 max-w-5xl mx-auto">
          {/* 1. Barra Superior Institucional + Kicker + Título + Subtítulo */}
          <div className="space-y-3">
            <div
              className="h-1.5 w-full rounded-xs"
              style={{ backgroundColor: tema.primaryHex }}
            />

            {isEditing ? (
              <div className="space-y-2.5 pt-1">
                <div>
                  <label className="text-[10px] font-mono uppercase text-slate-500 font-bold block mb-1">
                    Linha Superior (Kicker Institucional)
                  </label>
                  <Input
                    value={dossie.kicker}
                    onChange={e => setDossie({ ...dossie, kicker: e.target.value })}
                    className="bg-slate-50 border-slate-300 text-slate-900 font-bold text-xs uppercase"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase text-slate-500 font-bold block mb-1">
                    Título Principal do Dossiê Executivo
                  </label>
                  <Input
                    value={dossie.titulo}
                    onChange={e => setDossie({ ...dossie, titulo: e.target.value })}
                    className="bg-slate-50 border-slate-300 text-slate-900 font-extrabold text-base"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase text-slate-500 font-bold block mb-1">
                    Subtítulo (Órgão • Processo • Pedido / Objeto)
                  </label>
                  <Input
                    value={dossie.subtituloOrgao}
                    onChange={e => setDossie({ ...dossie, subtituloOrgao: e.target.value })}
                    className="bg-slate-50 border-slate-300 text-slate-800 text-xs"
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p
                    className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider"
                    style={{ color: tema.primaryHex }}
                  >
                    {dossie.kicker}
                  </p>

                  {pncpUrl && (
                    <a
                      href={pncpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded border transition-colors hover:opacity-90"
                      style={{
                        color: tema.primaryHex,
                        backgroundColor: tema.tintHex,
                        borderColor: tema.borderTintHex,
                      }}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Abrir Edital no PNCP</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <h1 className="text-xl sm:text-2xl md:text-[26px] font-extrabold text-slate-950 tracking-tight leading-snug">
                  {dossie.titulo}
                </h1>

                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                  <RichInlineText
                    text={dossie.subtituloOrgao.replace(
                      /(Órgão:|Processo[^:]*:|Pedido[^:]*:|Objeto:|Demandante:|UASG:|ID PNCP:)/g,
                      "**$1**"
                    )}
                  />
                </p>
              </>
            )}

            <div
              className="h-0.5 w-full"
              style={{ backgroundColor: tema.primaryHex }}
            />
          </div>

          {/* 2. Faixa Neuro-Cognitiva de Decisão Rápida (4 Indicadores Executivos) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Indicador 1: Veredito Estratégico */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                <span>Veredito Estratégico</span>
                <TrendingUp className="w-3.5 h-3.5" style={{ color: tema.primaryHex }} />
              </div>
              <p className="text-xs sm:text-sm font-extrabold text-slate-900 mt-1 leading-snug">
                {edital.parecerFinal?.veredito || "Participar com Atenção"}
              </p>
              <span className="text-[10px] text-slate-500 mt-1 truncate">
                Sessão: {dataHoraDisputa}
              </span>
            </div>

            {/* Indicador 2: Grau de Risco & Lances */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                <span>Grau de Risco do Edital</span>
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`text-xs font-extrabold px-2 py-0.5 rounded border ${
                    (edital.parecerFinal?.grauRisco || "").toLowerCase().includes("alto")
                      ? "bg-red-50 text-red-700 border-red-200"
                      : (edital.parecerFinal?.grauRisco || "").toLowerCase().includes("baixo")
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}
                >
                  {edital.parecerFinal?.grauRisco || "Médio"}
                </span>
                <span className="text-[11px] font-semibold text-slate-700">
                  {dossie.pontosAtencao.length} {dossie.pontosAtencao.length === 1 ? "alerta" : "alertas"}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 truncate" title={edital.parecerFinal?.estrategiaLances}>
                {edital.parecerFinal?.estrategiaLances || "Respeitar teto unitário e margem mínima"}
              </span>
            </div>

            {/* Indicador 3: Risco Pagador CAPAG (Tesouro Nacional) */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                <span>Risco Pagador (CAPAG)</span>
                <Landmark className="w-3.5 h-3.5" style={{ color: tema.primaryHex }} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-1.5">
                <span className="text-xs sm:text-sm font-extrabold text-slate-900">
                  Nota {capagEnte.notaCapag} — {capagEnte.veredito.statusPagador}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 mt-1">
                <span className="text-[10px] text-slate-600 truncate">
                  {capagEnte.nome} ({capagEnte.uf})
                </span>
                {onNavigateToCapag && (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateToCapag({
                        uf: capagEnte.uf,
                        municipio: capagEnte.esfera === "Município" ? capagEnte.nome : undefined,
                        orgao: edital.identificacaoCertame?.orgaoComprador,
                      })
                    }
                    className="text-[10px] font-bold underline cursor-pointer shrink-0"
                    style={{ color: tema.primaryHex }}
                  >
                    Ver CAPAG
                  </button>
                )}
              </div>
            </div>

            {/* Indicador 4: Valor Global Estimado */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                <span>Valor Global Estimado</span>
                <Coins className="w-3.5 h-3.5" style={{ color: tema.primaryHex }} />
              </div>
              <p
                className="text-sm sm:text-base font-extrabold font-mono tabular-nums mt-1 truncate"
                style={{ color: tema.primaryHex }}
                title={resumoFinanceiro.valorFormatado}
              >
                {resumoFinanceiro.valorFormatado}
              </p>
              <span className="text-[10px] text-slate-500 mt-1">
                {itensEditaveis.length} {itensEditaveis.length === 1 ? "item" : "itens"} •{" "}
                {resumoFinanceiro.totalQtd.toLocaleString("pt-BR")} unid. totais
              </span>
            </div>
          </div>

          {/* 3. Quadro: SÍNTESE ESTRATÉGICA DA OPORTUNIDADE */}
          <div
            className="bg-slate-50 border border-slate-200 rounded-md p-4 sm:p-5 space-y-2"
            style={{
              boxShadow: `inset 5px 0 0 0 ${tema.primaryHex}`,
            }}
          >
            {isEditing ? (
              <div className="space-y-2 pl-2">
                <Input
                  value={dossie.sinteseTitulo}
                  onChange={e => setDossie({ ...dossie, sinteseTitulo: e.target.value })}
                  className="bg-white border-slate-300 text-slate-900 font-bold text-xs uppercase"
                />
                <Textarea
                  value={dossie.sinteseTexto}
                  onChange={e => setDossie({ ...dossie, sinteseTexto: e.target.value })}
                  rows={4}
                  className="bg-white border-slate-300 text-slate-900 text-xs sm:text-sm leading-relaxed"
                />
              </div>
            ) : (
              <div className="pl-2 space-y-1.5">
                <h2
                  className="text-xs sm:text-sm font-extrabold uppercase tracking-wide"
                  style={{ color: tema.primaryHex }}
                >
                  {dossie.sinteseTitulo}
                </h2>
                <p className="text-xs sm:text-[13.5px] text-slate-800 leading-relaxed">
                  <RichInlineText text={dossie.sinteseTexto} />
                </p>
              </div>
            )}
          </div>

          {/* 4. SEÇÃO 1: DADOS OFICIAIS, VALORES, PRAZO E LOCAL DE ENTREGA */}
          <div className="space-y-3">
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b"
              style={{ borderColor: tema.primaryHex }}
            >
              {isEditing ? (
                <Input
                  value={dossie.secao1Titulo}
                  onChange={e => setDossie({ ...dossie, secao1Titulo: e.target.value })}
                  className="bg-slate-50 border-slate-300 text-slate-900 font-bold text-sm max-w-xl"
                />
              ) : (
                <h3
                  className="text-sm sm:text-base font-extrabold tracking-tight"
                  style={{ color: tema.primaryHex }}
                >
                  {dossie.secao1Titulo}
                </h3>
              )}

              {isEditing && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addParametroOficial}
                  className="h-7 text-xs font-bold gap-1 bg-white text-slate-800 border-slate-300 hover:bg-slate-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Parâmetro</span>
                </Button>
              )}
            </div>

            <div className="overflow-x-auto border border-slate-300 rounded-md">
              <table className="w-full text-left border-collapse text-xs sm:text-[13px]">
                <thead>
                  <tr style={{ backgroundColor: tema.primaryHex }} className="text-white">
                    <th className="py-2.5 px-3.5 font-bold w-1/3 sm:w-[28%] border-r border-white/20">
                      Parâmetro
                    </th>
                    <th className="py-2.5 px-3.5 font-bold">
                      {isEditing ? (
                        <input
                          type="text"
                          value={dossie.colunaRegraTitulo}
                          onChange={e => setDossie({ ...dossie, colunaRegraTitulo: e.target.value })}
                          className="bg-white/15 text-white placeholder-white/70 px-2 py-0.5 rounded w-full text-xs font-bold focus:outline-none"
                        />
                      ) : (
                        dossie.colunaRegraTitulo
                      )}
                    </th>
                    {isEditing && <th className="py-2.5 px-2 w-10 text-center">Ação</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {dossie.dadosOficiais.map((row, idx) => (
                    <tr
                      key={idx}
                      className={idx % 2 === 1 ? "bg-slate-50/90" : "bg-white"}
                    >
                      <td className="py-2.5 px-3.5 font-bold text-slate-900 align-top border-r border-slate-200">
                        {isEditing ? (
                          <Input
                            value={row.parametro}
                            onChange={e => updateParametroOficial(idx, "parametro", e.target.value)}
                            className="bg-white border-slate-300 text-slate-900 font-bold text-xs h-8"
                          />
                        ) : (
                          row.parametro
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-800 leading-relaxed align-top">
                        {isEditing ? (
                          <Textarea
                            value={row.regra}
                            onChange={e => updateParametroOficial(idx, "regra", e.target.value)}
                            rows={2}
                            className="bg-white border-slate-300 text-slate-900 text-xs"
                          />
                        ) : (
                          <RichInlineText text={row.regra} />
                        )}
                      </td>
                      {isEditing && (
                        <td className="py-2.5 px-2 text-center align-top">
                          <button
                            type="button"
                            onClick={() => removeParametroOficial(idx)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                            title="Remover linha"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 5. SEÇÃO 2: PLANILHA DE ITENS, QUANTITATIVOS E VALORES MÁXIMOS */}
          <div className="space-y-3">
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b"
              style={{ borderColor: tema.primaryHex }}
            >
              {isEditing ? (
                <Input
                  value={dossie.secao2Titulo}
                  onChange={e => setDossie({ ...dossie, secao2Titulo: e.target.value })}
                  className="bg-slate-50 border-slate-300 text-slate-900 font-bold text-sm max-w-xl"
                />
              ) : (
                <h3
                  className="text-sm sm:text-base font-extrabold tracking-tight"
                  style={{ color: tema.primaryHex }}
                >
                  {dossie.secao2Titulo}
                </h3>
              )}

              <div className="flex items-center gap-2">
                {itensEditaveis.length > 5 && !isEditing && (
                  <div className="relative w-48 sm:w-60">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchItemTerm}
                      onChange={e => setSearchItemTerm(e.target.value)}
                      placeholder="Filtrar item na planilha..."
                      className="w-full pl-8 pr-2.5 py-1 text-xs bg-slate-50 border border-slate-300 rounded-md text-slate-800 focus:outline-none focus:border-slate-500"
                    />
                  </div>
                )}

                {isEditing && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={addItemPlanilha}
                    className="h-7 text-xs font-bold gap-1 bg-white text-slate-800 border-slate-300 hover:bg-slate-100"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar Item</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Especificação Técnica Comum / Geral do Objeto */}
            {(isEditing || (dossie.especificacaoComum && dossie.especificacaoComum.trim().length > 0)) && (
              <div className="text-xs sm:text-[13px] text-slate-800 leading-relaxed">
                {isEditing ? (
                  <div>
                    <label className="text-[10px] font-mono uppercase text-slate-500 font-bold block mb-1">
                      Especificação Técnica Comum / Resumo Técnico do Objeto (Acima da Planilha)
                    </label>
                    <Textarea
                      value={dossie.especificacaoComum || ""}
                      onChange={e => setDossie({ ...dossie, especificacaoComum: e.target.value })}
                      rows={2}
                      placeholder="Ex: Especificação Técnica Comum (Itens 01 a 09): Calçado ocupacional..."
                      className="bg-slate-50 border-slate-300 text-slate-900 text-xs"
                    />
                  </div>
                ) : (
                  <p>
                    <strong className="font-bold text-slate-950">Especificação Técnica do Objeto: </strong>
                    <RichInlineText text={dossie.especificacaoComum || ""} />
                  </p>
                )}
              </div>
            )}

            {/* Tabela de Itens */}
            <div className="overflow-x-auto border border-slate-300 rounded-md">
              <table className="w-full text-left border-collapse text-xs sm:text-[13px]">
                <thead>
                  <tr style={{ backgroundColor: tema.primaryHex }} className="text-white">
                    <th className="py-2.5 px-3 font-bold text-center w-14 border-r border-white/20">
                      Item
                    </th>
                    <th className="py-2.5 px-3.5 font-bold border-r border-white/20">
                      Descrição Resumida / Especificação Técnica
                    </th>
                    <th className="py-2.5 px-3 font-bold text-right w-24 border-r border-white/20">
                      Qtd.
                    </th>
                    <th className="py-2.5 px-3 font-bold text-right w-28 border-r border-white/20">
                      Unit. Máx.
                    </th>
                    <th className="py-2.5 px-3 font-bold text-right w-32">
                      Total Máx.
                    </th>
                    {isEditing && <th className="py-2.5 px-2 w-10 text-center">Ação</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {itensFiltrados.length > 0 ? (
                    itensFiltrados.map((it, idx) => {
                      const realIdx = itensEditaveis.findIndex(orig => orig.numero === it.numero);
                      const targetIdx = realIdx >= 0 ? realIdx : idx;
                      const qtdNum = Number(it.quantidade) || 0;
                      const unitNum = parseValorMonetario(it.valorEstimado);
                      const totalNum = qtdNum > 0 && unitNum > 0 ? qtdNum * unitNum : unitNum;

                      return (
                        <tr
                          key={`${it.numero}-${idx}`}
                          className={idx % 2 === 1 ? "bg-slate-50/90" : "bg-white"}
                        >
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-900 align-top border-r border-slate-200 tabular-nums">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={it.numero}
                                onChange={e =>
                                  updateItemPlanilha(targetIdx, "numero", Number(e.target.value) || 1)
                                }
                                className="bg-white border-slate-300 text-slate-900 text-xs h-7 w-14 text-center px-1"
                              />
                            ) : (
                              String(it.numero || idx + 1).padStart(2, "0")
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-800 leading-relaxed align-top border-r border-slate-200">
                            {isEditing ? (
                              <Textarea
                                value={it.descricao}
                                onChange={e =>
                                  updateItemPlanilha(targetIdx, "descricao", e.target.value)
                                }
                                rows={2}
                                className="bg-white border-slate-300 text-slate-900 text-xs"
                              />
                            ) : (
                              <RichInlineText text={it.descricao} />
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-900 align-top border-r border-slate-200 tabular-nums whitespace-nowrap">
                            {isEditing ? (
                              <div className="flex items-center gap-1 justify-end">
                                <Input
                                  type="number"
                                  value={it.quantidade}
                                  onChange={e =>
                                    updateItemPlanilha(targetIdx, "quantidade", Number(e.target.value) || 0)
                                  }
                                  className="bg-white border-slate-300 text-slate-900 text-xs h-7 w-16 text-right px-1.5"
                                />
                                <Input
                                  value={it.unidade || "un"}
                                  onChange={e =>
                                    updateItemPlanilha(targetIdx, "unidade", e.target.value)
                                  }
                                  className="bg-white border-slate-300 text-slate-900 text-xs h-7 w-12 px-1"
                                />
                              </div>
                            ) : (
                              `${qtdNum.toLocaleString("pt-BR")} ${it.unidade || "un"}`
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-900 align-top border-r border-slate-200 tabular-nums whitespace-nowrap">
                            {isEditing ? (
                              <Input
                                value={it.valorEstimado || ""}
                                onChange={e =>
                                  updateItemPlanilha(targetIdx, "valorEstimado", e.target.value)
                                }
                                placeholder="R$ 0,00"
                                className="bg-white border-slate-300 text-slate-900 text-xs h-7 w-24 text-right px-1.5"
                              />
                            ) : unitNum > 0 ? (
                              formatarMoedaBR(unitNum)
                            ) : (
                              it.valorEstimado || "—"
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-950 align-top tabular-nums whitespace-nowrap">
                            {totalNum > 0 ? formatarMoedaBR(totalNum) : "—"}
                          </td>
                          {isEditing && (
                            <td className="py-2.5 px-2 text-center align-top">
                              <button
                                type="button"
                                onClick={() => removeItemPlanilha(targetIdx)}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                title="Remover item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={isEditing ? 6 : 5}
                        className="py-6 text-center text-slate-500 text-xs"
                      >
                        Nenhum item encontrado para o filtro informado.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr
                    style={{
                      backgroundColor: tema.tintHex,
                      borderBottom: `2.5px solid ${tema.primaryHex}`,
                    }}
                    className="font-extrabold border-t border-slate-300"
                  >
                    <td
                      colSpan={2}
                      className="py-2.5 px-3.5 uppercase tracking-wide text-xs border-r border-slate-300"
                      style={{ color: tema.primaryHex }}
                    >
                      VALOR GLOBAL ESTIMADO DA CONTRATAÇÃO ({itensEditaveis.length}{" "}
                      {itensEditaveis.length === 1 ? "ITEM" : "ITENS"})
                    </td>
                    <td
                      className="py-2.5 px-3 text-right font-mono tabular-nums border-r border-slate-300 whitespace-nowrap"
                      style={{ color: tema.primaryHex }}
                    >
                      {resumoFinanceiro.totalQtd > 0
                        ? resumoFinanceiro.totalQtd.toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right font-mono border-r border-slate-300"
                      style={{ color: tema.primaryHex }}
                    >
                      —
                    </td>
                    <td
                      className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap"
                      style={{ color: tema.primaryHex }}
                    >
                      {resumoFinanceiro.valorFormatado}
                    </td>
                    {isEditing && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* 6. SEÇÃO 3: PONTOS DE ATENÇÃO ("PEGADINHAS") E RISCOS CRÍTICOS DO EDITAL */}
          <div className="space-y-3.5">
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b"
              style={{ borderColor: tema.primaryHex }}
            >
              {isEditing ? (
                <Input
                  value={dossie.secao3Titulo}
                  onChange={e => setDossie({ ...dossie, secao3Titulo: e.target.value })}
                  className="bg-slate-50 border-slate-300 text-slate-900 font-bold text-sm max-w-xl"
                />
              ) : (
                <h3
                  className="text-sm sm:text-base font-extrabold tracking-tight"
                  style={{ color: tema.primaryHex }}
                >
                  {dossie.secao3Titulo}
                </h3>
              )}

              {isEditing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addPontoAtencao}
                  className="h-7 text-xs font-bold gap-1 bg-white text-red-700 border-red-300 hover:bg-red-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Ponto de Atenção / Pegadinha</span>
                </Button>
              ) : (
                <span className="text-[11px] text-slate-500">
                  Clique em um item para marcar como revisado pela equipe
                </span>
              )}
            </div>

            <ul className="space-y-3">
              {dossie.pontosAtencao.map((pa, idx) => {
                const isChecked = Boolean(checkedPegadinhas[idx]);
                return (
                  <li
                    key={idx}
                    className={`rounded-lg transition-colors ${
                      isEditing
                        ? "p-3.5 bg-red-50/50 border border-red-200 space-y-2"
                        : isChecked
                        ? "p-2.5 bg-emerald-50/40 border border-emerald-200/80 opacity-85"
                        : "p-2.5 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            value={pa.prefixo}
                            onChange={e => updatePontoAtencao(idx, "prefixo", e.target.value)}
                            placeholder="PONTO DE ATENÇÃO 1"
                            className="bg-white border-red-300 text-red-800 font-extrabold text-xs sm:w-52"
                          />
                          <Input
                            value={pa.titulo}
                            onChange={e => updatePontoAtencao(idx, "titulo", e.target.value)}
                            placeholder="Título do ponto crítico e cláusula do edital"
                            className="bg-white border-red-300 text-red-800 font-bold text-xs flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => removePontoAtencao(idx)}
                            className="px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 rounded border border-red-200 flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Excluir</span>
                          </button>
                        </div>
                        <Textarea
                          value={pa.descricao}
                          onChange={e => updatePontoAtencao(idx, "descricao", e.target.value)}
                          rows={3}
                          className="bg-white border-slate-300 text-slate-900 text-xs leading-relaxed"
                        />
                      </div>
                    ) : (
                      <div
                        onClick={() =>
                          setCheckedPegadinhas(prev => ({ ...prev, [idx]: !prev[idx] }))
                        }
                        className="flex items-start gap-2.5 cursor-pointer select-text"
                      >
                        <button
                          type="button"
                          aria-label="Marcar ponto de atenção como revisado"
                          className={`mt-1 w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                            isChecked
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "border-red-400 text-transparent hover:border-red-600"
                          }`}
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <p className="text-xs sm:text-[13.5px] text-slate-800 leading-relaxed">
                          <strong className="font-extrabold text-red-700">
                            {pa.prefixo || `PONTO DE ATENÇÃO ${idx + 1}`} — {pa.titulo}:{" "}
                          </strong>
                          <RichInlineText text={pa.descricao} />
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 7. SEÇÃO 4: CHECKLIST RÁPIDO DE HABILITAÇÃO E PROPOSTA */}
          <div className="space-y-3.5">
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b"
              style={{ borderColor: tema.primaryHex }}
            >
              {isEditing ? (
                <Input
                  value={dossie.secao4Titulo}
                  onChange={e => setDossie({ ...dossie, secao4Titulo: e.target.value })}
                  className="bg-slate-50 border-slate-300 text-slate-900 font-bold text-sm max-w-xl"
                />
              ) : (
                <h3
                  className="text-sm sm:text-base font-extrabold tracking-tight"
                  style={{ color: tema.primaryHex }}
                >
                  {dossie.secao4Titulo}
                </h3>
              )}

              {isEditing && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addChecklistCat}
                  className="h-7 text-xs font-bold gap-1 bg-white text-slate-800 border-slate-300 hover:bg-slate-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Categoria de Habilitação</span>
                </Button>
              )}
            </div>

            <ul className="space-y-2.5">
              {dossie.checklistCategorizado.map((cat, idx) => {
                const isChecked = Boolean(checkedHabilitacao[idx]);
                return (
                  <li
                    key={idx}
                    className={`rounded-lg transition-colors ${
                      isEditing
                        ? "p-3 bg-slate-50 border border-slate-300 space-y-2"
                        : isChecked
                        ? "p-2.5 bg-emerald-50/40 border border-emerald-200/80"
                        : "p-2.5 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={cat.categoria}
                            onChange={e => updateChecklistCat(idx, "categoria", e.target.value)}
                            placeholder="Ex: Jurídica e Fiscal (Item 13.11)"
                            className="bg-white border-slate-300 text-slate-900 font-bold text-xs flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => removeChecklistCat(idx)}
                            className="px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 rounded border border-red-200 flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Excluir</span>
                          </button>
                        </div>
                        <Textarea
                          value={cat.descricao}
                          onChange={e => updateChecklistCat(idx, "descricao", e.target.value)}
                          rows={2}
                          className="bg-white border-slate-300 text-slate-900 text-xs"
                        />
                      </div>
                    ) : (
                      <div
                        onClick={() =>
                          setCheckedHabilitacao(prev => ({ ...prev, [idx]: !prev[idx] }))
                        }
                        className="flex items-start gap-2.5 cursor-pointer select-text"
                      >
                        <button
                          type="button"
                          aria-label="Marcar categoria de habilitação como conferida"
                          className={`mt-1 w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                            isChecked
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "border-slate-400 text-transparent hover:border-slate-700"
                          }`}
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <p className="text-xs sm:text-[13.5px] text-slate-800 leading-relaxed">
                          <strong className="font-extrabold text-slate-950">
                            {cat.categoria}:{" "}
                          </strong>
                          <RichInlineText text={cat.descricao} />
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 8. RODAPÉ OFICIAL DO DOSSIÊ EXECUTIVO */}
          <div className="pt-5 border-t border-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] text-slate-500">
            {isEditing ? (
              <div className="w-full">
                <label className="text-[10px] font-mono uppercase text-slate-500 font-bold block mb-1">
                  Texto do Rodapé das Páginas do PDF
                </label>
                <Input
                  value={dossie.rodapeTexto}
                  onChange={e => setDossie({ ...dossie, rodapeTexto: e.target.value })}
                  className="bg-slate-50 border-slate-300 text-slate-800 text-xs"
                />
              </div>
            ) : (
              <>
                <span>{dossie.rodapeTexto}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-[10px] text-slate-400">
                    UASG: {uasg} • PNCP: {idContratacaoPncp}
                  </span>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="inline-flex items-center gap-1.5 font-bold underline cursor-pointer"
                    style={{ color: tema.primaryHex }}
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>Baixar PDF A4</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
