import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen, Plus, Search, Folder, FolderPlus, Inbox, Layers, Pin, PinOff,
  Trash2, Download, Pencil, Check, X, CloudOff, Cloud, Loader2, FileText, MoreVertical,
} from "lucide-react";
import { Nota, PastaNotas } from "../types";
import {
  FILTRO_TODAS, SEM_PASTA, CORES_PASTA, COR_PASTA_PADRAO, LIMITE_CARACTERES_NOTA,
  validarPasta, criarPasta, ordenarPastas, desvincularNotasDaPasta, reconciliarPastas,
  criarNota, aplicarEdicaoNota, tituloVisivel, previaNota, estatisticasTexto,
  filtrarNotas, contarPorPasta, notaParaMarkdown, nomeArquivoDaNota, quandoAtualizada,
} from "../utils/notas";
import {
  fetchNotasComStatus, saveNotaToSupabase, deleteNotaFromSupabase,
  fetchPastasNotasComStatus, savePastaNotaToSupabase, deletePastaNotaFromSupabase,
  subscribeToSupabaseTable, generateUUID,
} from "../utils/supabaseClient";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";

// ═══════════════════════════════════════════════════════════════════════
// BLOCO DE NOTAS
//
// Três colunas: pastas · lista · editor. As regras de organização (onde a nota
// mora, o que a busca acha, em que ordem a lista sai) ficam em utils/notas.ts,
// que é o que dá para testar sem renderizar.
//
// Duas decisões que valem registro:
//
//  1. O cache local é a fonte de abertura. O Supabase chega depois e só
//     substitui quando RESPONDE (`ok`). Falha de rede devolvendo lista vazia
//     já apagou dados nesta plataforma uma vez — o calendário perdia disputas
//     marcadas à mão.
//  2. A nota aberta nunca é sobrescrita por evento de realtime enquanto tem
//     edição pendente. Sem isso, a sincronização de outro dispositivo
//     apagaria a frase que está sendo digitada.
// ═══════════════════════════════════════════════════════════════════════

const CHAVE_NOTAS = "aip_notas";
const CHAVE_PASTAS = "aip_notas_pastas";

/** Tempo entre a última tecla e a gravação. */
const ESPERA_AUTOSAVE_MS = 800;

type EstadoSalvamento = "ocioso" | "salvando" | "salvo" | "local";

function lerCache<T>(chave: string): T[] {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function gravarCache(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch (err) {
    // Cota do localStorage estourada. Não dá para prometer persistência local,
    // mas também não é motivo para derrubar a tela.
    console.warn(`[Notas] Não foi possível gravar ${chave} no navegador:`, err);
  }
}

// ─────────────────────── linha da coluna de pastas ───────────────────────
//
// Fica FORA do componente de propósito. Declarada dentro do corpo de
// NotepadTab, esta função ganhava identidade nova a cada renderização: o React
// via um tipo de elemento diferente e remontava todas as linhas da coluna — o
// que destrói o menu que acabou de ser aberto e deixa o radix reabrindo em
// laço. Era isso que pendurava o teste de renderização desta aba.

interface ItemPastaProps {
  id: string;
  nome: string;
  cor?: string;
  Icone: typeof Folder;
  total: number;
  ativa: boolean;
  recebendoArraste: boolean;
  arrastandoNota: boolean;
  onSelecionar: (id: string) => void;
  onEntrarArraste: (id: string) => void;
  onSairArraste: (id: string) => void;
  onSoltar: (id: string) => void;
  onRenomear: (id: string, nome: string) => void;
  onTrocarCor: (id: string, cor: string) => void;
  onExcluir: (id: string) => void;
}

function ItemPasta({
  id, nome, cor, Icone, total, ativa, recebendoArraste, arrastandoNota,
  onSelecionar, onEntrarArraste, onSairArraste, onSoltar,
  onRenomear, onTrocarCor, onExcluir,
}: ItemPastaProps) {
  const real = id !== FILTRO_TODAS;

    return (
      <div
        onDragOver={(e) => {
          if (!real || !arrastandoNota) return;
          e.preventDefault();
          onEntrarArraste(id);
        }}
        onDragLeave={() => onSairArraste(id)}
        onDrop={(e) => {
          if (!real || !arrastandoNota) return;
          e.preventDefault();
          onSoltar(id);
        }}
        className={`group/pasta flex items-center gap-1 rounded-lg transition ${
          recebendoArraste ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
        } ${ativa ? "bg-primary/10" : "hover:bg-muted/70"}`}
      >
        <button
          type="button"
          onClick={() => onSelecionar(id)}
          aria-label={`Ver ${nome}`}
          aria-current={ativa ? "true" : undefined}
          title={real && arrastandoNota ? `Soltar a nota em ${nome}` : nome}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs transition ${
            ativa ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {cor ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-inset ring-background"
              style={{ backgroundColor: cor }}
            />
          ) : (
            <Icone className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{nome}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] opacity-70">{total}</span>
        </button>

        {/* Pastas de verdade podem ser renomeadas, recoloridas e excluídas.
            "Todas" e "Sem pasta" são filtros, não pastas. */}
        {real && id !== SEM_PASTA && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={`Opções da pasta ${nome}`}
                className="mr-0.5 h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:opacity-100 group-hover/pasta:opacity-100"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem
                onClick={() => onRenomear(id, nome)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Renomear
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cor
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CORES_PASTA.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Cor ${c}`}
                      onClick={() => onTrocarCor(id, c)}
                      className={`h-5 w-5 cursor-pointer rounded-full transition hover:scale-110 ${
                        cor === c ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover" : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onExcluir(id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir pasta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }

export default function NotepadTab() {
  const [pastas, setPastas] = useState<PastaNotas[]>(() => lerCache<PastaNotas>(CHAVE_PASTAS));
  const [notas, setNotas] = useState<Nota[]>(() => lerCache<Nota>(CHAVE_NOTAS));

  const [pastaAtiva, setPastaAtiva] = useState<string>(FILTRO_TODAS);
  const [busca, setBusca] = useState("");
  const [notaAtivaId, setNotaAtivaId] = useState<string>("");

  const [estado, setEstado] = useState<EstadoSalvamento>("ocioso");
  const [avisoBanco, setAvisoBanco] = useState<string | null>(null);

  const [novaPastaAberta, setNovaPastaAberta] = useState(false);
  const [nomeNovaPasta, setNomeNovaPasta] = useState("");
  const [corNovaPasta, setCorNovaPasta] = useState(COR_PASTA_PADRAO);
  const [erroPasta, setErroPasta] = useState<string | null>(null);

  const [pastaRenomeando, setPastaRenomeando] = useState<string>("");
  const [nomeEmEdicao, setNomeEmEdicao] = useState("");

  const [pastaAlvoArraste, setPastaAlvoArraste] = useState<string | null>(null);
  const [notaArrastada, setNotaArrastada] = useState<string>("");

  // Ids com edição ainda não gravada. É o que protege o texto sendo digitado
  // de ser sobrescrito por um evento de realtime.
  const pendentesRef = useRef<Set<string>>(new Set());
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notasRef = useRef<Nota[]>(notas);

  /**
   * Única porta de escrita das notas.
   *
   * A transformação roda uma vez, aqui, e o ref é atualizado junto com o
   * estado. Derivar valor de dentro de um updater de `setState` não funciona:
   * o React só executa o updater durante a renderização (e duas vezes em
   * StrictMode), então duas edições no mesmo tick — digitar o título e o corpo
   * em seguida — compunham sobre um valor velho e a segunda não era agendada
   * para gravação.
   */
  const aplicarNotas = useCallback((transformar: (atuais: Nota[]) => Nota[]) => {
    const proximas = transformar(notasRef.current);
    notasRef.current = proximas;
    setNotas(proximas);
    return proximas;
  }, []);

  useEffect(() => { gravarCache(CHAVE_NOTAS, notas); }, [notas]);
  useEffect(() => { gravarCache(CHAVE_PASTAS, pastas); }, [pastas]);

  // ───────────────────── carga e sincronização ─────────────────────

  const carregar = useCallback(async () => {
    const [resPastas, resNotas] = await Promise.all([
      fetchPastasNotasComStatus(),
      fetchNotasComStatus(),
    ]);

    // `ok: false` é "não falei com o banco" — o cache local continua valendo.
    if (resPastas.ok) setPastas(ordenarPastas(resPastas.rows as PastaNotas[]));
    if (resNotas.ok) {
      aplicarNotas((atuais) => {
        const vindas = resNotas.rows as Nota[];
        // A nota com edição pendente fica na versão local: o que está na tela
        // é mais novo do que o que o banco devolveu.
        const pendentes = pendentesRef.current;
        if (pendentes.size === 0) return vindas;
        const locais = atuais.filter((n) => pendentes.has(n.id));
        const remotas = vindas.filter((n) => !pendentes.has(n.id));
        return [...locais, ...remotas];
      });
    }
  }, [aplicarNotas]);

  useEffect(() => {
    carregar();
    const cancelarNotas = subscribeToSupabaseTable("notas_bloco", () => carregar());
    const cancelarPastas = subscribeToSupabaseTable("pastas_notas", () => carregar());
    return () => {
      cancelarNotas();
      cancelarPastas();
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
    };
  }, [carregar]);

  // Pasta apagada em outro dispositivo não deve engolir a nota: ela volta
  // para a raiz, onde o usuário consegue vê-la.
  useEffect(() => {
    aplicarNotas((atuais) => {
      const reconciliadas = reconciliarPastas(atuais, pastas);
      return reconciliadas.some((n, i) => n !== atuais[i]) ? reconciliadas : atuais;
    });
  }, [pastas, aplicarNotas]);

  // ───────────────────── gravação ─────────────────────

  const gravarNota = useCallback(async (nota: Nota) => {
    setEstado("salvando");
    const res = await saveNotaToSupabase(nota);
    pendentesRef.current.delete(nota.id);
    if (res.success) {
      setEstado("salvo");
      setAvisoBanco(null);
    } else {
      setEstado("local");
      setAvisoBanco(res.message);
    }
  }, []);

  /** Agenda a gravação. Digitar de novo reinicia a espera. */
  const agendarGravacao = useCallback((nota: Nota) => {
    pendentesRef.current.add(nota.id);
    setEstado("salvando");
    if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
    temporizadorRef.current = setTimeout(() => {
      const atual = notasRef.current.find((n) => n.id === nota.id);
      if (atual) gravarNota(atual);
    }, ESPERA_AUTOSAVE_MS);
  }, [gravarNota]);

  const editarNota = useCallback(
    (id: string, campos: Partial<Pick<Nota, "titulo" | "conteudo" | "pastaId" | "fixada">>) => {
      const atual = notasRef.current.find((n) => n.id === id);
      if (!atual) return;
      const editada = aplicarEdicaoNota(atual, campos);
      aplicarNotas((atuais) => atuais.map((n) => (n.id === id ? editada : n)));
      agendarGravacao(editada);
    },
    [aplicarNotas, agendarGravacao],
  );

  // ───────────────────── ações ─────────────────────

  const novaNota = useCallback(() => {
    const nova = criarNota({ id: generateUUID(), pastaId: pastaAtiva });
    aplicarNotas((atuais) => [nova, ...atuais]);
    setNotaAtivaId(nova.id);
    setBusca("");
    // Só vai ao banco quando tiver conteúdo: nota recém-criada e abandonada não
    // precisa virar linha vazia na tabela.
    pendentesRef.current.add(nova.id);
    setEstado("ocioso");
  }, [pastaAtiva, aplicarNotas]);

  const excluirNota = useCallback(async (id: string) => {
    const alvo = notasRef.current.find((n) => n.id === id);
    if (!alvo) return;
    const rotulo = tituloVisivel(alvo);
    if (!window.confirm(`Excluir a nota "${rotulo}"? Isso não pode ser desfeito.`)) return;

    aplicarNotas((atuais) => atuais.filter((n) => n.id !== id));
    pendentesRef.current.delete(id);
    setNotaAtivaId((atual) => (atual === id ? "" : atual));
    await deleteNotaFromSupabase(id);
  }, [aplicarNotas]);

  const baixarNota = useCallback((nota: Nota) => {
    const pasta = pastas.find((p) => p.id === nota.pastaId) || null;
    const blob = new Blob([notaParaMarkdown(nota, pasta)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivoDaNota(nota);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [pastas]);

  const adicionarPasta = useCallback(async () => {
    const validacao = validarPasta(nomeNovaPasta, pastas);
    if (!validacao.ok) {
      setErroPasta(validacao.erros.nome || "Nome inválido.");
      return;
    }
    const nova = criarPasta({ id: generateUUID(), nome: validacao.nome, cor: corNovaPasta }, pastas);
    setPastas((atuais) => ordenarPastas([...atuais, nova]));
    setNomeNovaPasta("");
    setCorNovaPasta(COR_PASTA_PADRAO);
    setErroPasta(null);
    setNovaPastaAberta(false);
    setPastaAtiva(nova.id);

    const res = await savePastaNotaToSupabase(nova);
    if (!res.success) setAvisoBanco(res.message);
  }, [nomeNovaPasta, corNovaPasta, pastas]);

  const renomearPasta = useCallback(async (id: string) => {
    const validacao = validarPasta(nomeEmEdicao, pastas, id);
    if (!validacao.ok) {
      setErroPasta(validacao.erros.nome || "Nome inválido.");
      return;
    }
    const atualizada = pastas.find((p) => p.id === id);
    if (!atualizada) return;
    const nova = { ...atualizada, nome: validacao.nome };
    setPastas((atuais) => atuais.map((p) => (p.id === id ? nova : p)));
    setPastaRenomeando("");
    setErroPasta(null);
    const res = await savePastaNotaToSupabase(nova);
    if (!res.success) setAvisoBanco(res.message);
  }, [nomeEmEdicao, pastas]);

  const trocarCorPasta = useCallback(async (id: string, cor: string) => {
    const alvo = pastas.find((p) => p.id === id);
    if (!alvo) return;
    const nova = { ...alvo, cor };
    setPastas((atuais) => atuais.map((p) => (p.id === id ? nova : p)));
    const res = await savePastaNotaToSupabase(nova);
    if (!res.success) setAvisoBanco(res.message);
  }, [pastas]);

  const excluirPasta = useCallback(async (id: string) => {
    const alvo = pastas.find((p) => p.id === id);
    if (!alvo) return;
    const dentro = notasRef.current.filter((n) => n.pastaId === id);
    const aviso = dentro.length > 0
      ? `Excluir a pasta "${alvo.nome}"? As ${dentro.length} nota(s) dentro dela vão para "Sem pasta" — nenhuma será apagada.`
      : `Excluir a pasta "${alvo.nome}"?`;
    if (!window.confirm(aviso)) return;

    // A nota é texto do usuário: ela sobrevive à pasta.
    const soltas = aplicarNotas((atuais) => desvincularNotasDaPasta(atuais, id));
    setPastas((atuais) => atuais.filter((p) => p.id !== id));
    setPastaAtiva((atual) => (atual === id ? FILTRO_TODAS : atual));

    await deletePastaNotaFromSupabase(id);
    for (const nota of soltas.filter((n) => dentro.some((d) => d.id === n.id))) {
      await saveNotaToSupabase(nota);
    }
  }, [pastas, aplicarNotas]);

  const iniciarRenomeio = useCallback((id: string, nome: string) => {
    setPastaRenomeando(id);
    setNomeEmEdicao(nome);
    setErroPasta(null);
  }, []);

  const marcarAlvoArraste = useCallback((id: string) => setPastaAlvoArraste(id), []);
  const limparAlvoArraste = useCallback(
    (id: string) => setPastaAlvoArraste((atual) => (atual === id ? null : atual)),
    [],
  );

  const moverNotaParaPasta = useCallback((notaId: string, pastaId: string) => {
    const alvo = notasRef.current.find((n) => n.id === notaId);
    if (!alvo || alvo.pastaId === pastaId) return;
    editarNota(notaId, { pastaId });
  }, [editarNota]);

  const soltarNaPasta = useCallback(
    (pastaId: string) => {
      if (notaArrastada) moverNotaParaPasta(notaArrastada, pastaId);
      setPastaAlvoArraste(null);
      setNotaArrastada("");
    },
    [notaArrastada, moverNotaParaPasta],
  );

  /** Props iguais em toda linha da coluna, para os três pontos de chamada. */
  const propsComunsPasta = {
    arrastandoNota: Boolean(notaArrastada),
    onSelecionar: setPastaAtiva,
    onEntrarArraste: marcarAlvoArraste,
    onSairArraste: limparAlvoArraste,
    onSoltar: soltarNaPasta,
    onRenomear: iniciarRenomeio,
    onTrocarCor: trocarCorPasta,
    onExcluir: excluirPasta,
  };

  // ───────────────────── dados derivados ─────────────────────

  const pastasOrdenadas = useMemo(() => ordenarPastas(pastas), [pastas]);
  const contagens = useMemo(() => contarPorPasta(notas), [notas]);
  const visiveis = useMemo(
    () => filtrarNotas(notas, { pastaId: pastaAtiva, busca }),
    [notas, pastaAtiva, busca],
  );

  const notaAtiva = useMemo(
    () => notas.find((n) => n.id === notaAtivaId) || null,
    [notas, notaAtivaId],
  );

  // Trocar de pasta ou buscar pode esconder a nota aberta; o editor acompanha
  // a lista em vez de mostrar algo que não está mais nela.
  useEffect(() => {
    if (notaAtivaId && !visiveis.some((n) => n.id === notaAtivaId)) {
      setNotaAtivaId(visiveis[0]?.id || "");
    }
  }, [visiveis, notaAtivaId]);

  const stats = useMemo(() => estatisticasTexto(notaAtiva?.conteudo || ""), [notaAtiva?.conteudo]);
  const pastaDaNotaAtiva = notaAtiva ? pastas.find((p) => p.id === notaAtiva.pastaId) : null;

  // Ctrl/Cmd+S grava na hora, em vez de esperar o debounce.
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        const atual = notasRef.current.find((n) => n.id === notaAtivaId);
        if (!atual) return;
        e.preventDefault();
        if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
        gravarNota(atual);
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, [notaAtivaId, gravarNota]);

  // ───────────────────── pastas: item da coluna ─────────────────────


  const indicadorSalvamento = () => {
    if (estado === "salvando") {
      return (
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Salvando…
        </span>
      );
    }
    if (estado === "salvo") {
      return (
        <span className="flex items-center gap-1.5 text-[11px] text-success">
          <Cloud className="h-3 w-3" />
          Salvo no banco
        </span>
      );
    }
    if (estado === "local") {
      return (
        <span
          className="flex items-center gap-1.5 text-[11px] text-warning"
          title={avisoBanco || undefined}
        >
          <CloudOff className="h-3 w-3" />
          Salva neste navegador, mas não no banco
        </span>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-5 select-text font-sans text-foreground">

      {/* ─────────── Cabeçalho ─────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="shrink-0 rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
            <NotebookPen className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">Bloco de Notas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Anotações suas, organizadas em pastas e sincronizadas entre dispositivos. Arraste uma
              nota para uma pasta para guardá-la lá.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Popover
            open={novaPastaAberta}
            onOpenChange={(aberto) => {
              setNovaPastaAberta(aberto);
              if (!aberto) {
                setErroPasta(null);
                setNomeNovaPasta("");
              }
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <FolderPlus className="h-3.5 w-3.5" />
                Nova pasta
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="nome-nova-pasta" className="text-xs font-semibold">
                  Nome da pasta
                </label>
                <Input
                  id="nome-nova-pasta"
                  value={nomeNovaPasta}
                  onChange={(e) => {
                    setNomeNovaPasta(e.target.value);
                    setErroPasta(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarPasta();
                    }
                  }}
                  placeholder="Ex.: Pregões de novembro"
                  className="h-8 text-xs"
                />
                {erroPasta && <p className="text-[11px] font-medium text-destructive">{erroPasta}</p>}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold">Cor</p>
                <div className="flex flex-wrap gap-2">
                  {CORES_PASTA.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Cor ${c}`}
                      onClick={() => setCorNovaPasta(c)}
                      className={`h-6 w-6 cursor-pointer rounded-full transition hover:scale-110 ${
                        corNovaPasta === c
                          ? "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                          : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <Button type="button" size="sm" className="w-full" onClick={adicionarPasta}>
                <Check className="h-3.5 w-3.5" />
                Criar pasta
              </Button>
            </PopoverContent>
          </Popover>

          <Button type="button" size="sm" onClick={novaNota}>
            <Plus className="h-3.5 w-3.5" />
            Nova nota
          </Button>
        </div>
      </div>

      {/* ─────────── Três colunas ─────────── */}
      <div className="grid gap-4 lg:grid-cols-[15rem_19rem_minmax(0,1fr)]">

        {/* ─── Coluna 1: pastas ─── */}
        <aside className="space-y-1 rounded-xl border border-border bg-card p-2 lg:self-start">
          <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Pastas
          </p>

          <ItemPasta
            id={FILTRO_TODAS}
            nome="Todas as notas"
            Icone={Layers}
            total={contagens[FILTRO_TODAS] || 0}
            ativa={pastaAtiva === FILTRO_TODAS}
            recebendoArraste={false}
            {...propsComunsPasta}
          />
          <ItemPasta
            id={SEM_PASTA}
            nome="Sem pasta"
            Icone={Inbox}
            total={contagens[SEM_PASTA] || 0}
            ativa={pastaAtiva === SEM_PASTA}
            recebendoArraste={pastaAlvoArraste === SEM_PASTA}
            {...propsComunsPasta}
          />

          {pastasOrdenadas.length > 0 && <div className="my-1 border-t border-border" />}

          {pastasOrdenadas.map((p) =>
            pastaRenomeando === p.id ? (
              <div key={p.id} className="space-y-1 px-1 py-1">
                <Input
                  autoFocus
                  value={nomeEmEdicao}
                  onChange={(e) => {
                    setNomeEmEdicao(e.target.value);
                    setErroPasta(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      renomearPasta(p.id);
                    }
                    if (e.key === "Escape") {
                      setPastaRenomeando("");
                      setErroPasta(null);
                    }
                  }}
                  className="h-7 text-xs"
                  aria-label={`Novo nome para ${p.nome}`}
                />
                {erroPasta && <p className="text-[10px] font-medium text-destructive">{erroPasta}</p>}
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 flex-1 text-[11px]"
                    onClick={() => renomearPasta(p.id)}
                  >
                    Salvar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px]"
                    onClick={() => {
                      setPastaRenomeando("");
                      setErroPasta(null);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <ItemPasta
                key={p.id}
                id={p.id}
                nome={p.nome}
                cor={p.cor}
                Icone={Folder}
                total={contagens[p.id] || 0}
                ativa={pastaAtiva === p.id}
                recebendoArraste={pastaAlvoArraste === p.id}
                {...propsComunsPasta}
              />
            ),
          )}

          {pastasOrdenadas.length === 0 && (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
              Nenhuma pasta ainda. Crie uma para separar as anotações por certame, órgão ou mês.
            </p>
          )}
        </aside>

        {/* ─── Coluna 2: lista ─── */}
        <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar no título e no texto…"
              aria-label="Buscar notas"
              className="h-8 pl-8 text-xs"
            />
          </div>

          <div
            className="min-h-[12rem] space-y-1.5 overflow-y-auto scrollbar-thin"
            style={{ maxHeight: "60vh" }}
          >
            {visiveis.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center">
                <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {busca
                    ? "Nenhuma nota com esse termo."
                    : notas.length === 0
                      ? "Seu bloco está vazio. Clique em “Nova nota” para começar."
                      : "Nenhuma nota nesta pasta."}
                </p>
              </div>
            ) : (
              visiveis.map((n) => {
                const ativa = n.id === notaAtivaId;
                const pasta = pastas.find((p) => p.id === n.pastaId);
                const previa = previaNota(n);

                return (
                  <article
                    key={n.id}
                    draggable
                    onDragStart={(e) => {
                      setNotaArrastada(n.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setNotaArrastada("");
                      setPastaAlvoArraste(null);
                    }}
                    onClick={() => setNotaAtivaId(n.id)}
                    className={`group cursor-pointer rounded-lg border p-2.5 transition ${
                      ativa
                        ? "border-primary/50 bg-primary/5 shadow-2xs"
                        : "border-border bg-background hover:border-primary/30 hover:bg-muted/40"
                    } ${notaArrastada === n.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <h3
                        className={`line-clamp-2 min-w-0 text-[12px] font-semibold leading-snug ${
                          ativa ? "text-primary" : ""
                        }`}
                      >
                        {tituloVisivel(n)}
                      </h3>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={n.fixada ? "Desafixar" : "Fixar no topo"}
                          onClick={(e) => {
                            e.stopPropagation();
                            editarNota(n.id, { fixada: !n.fixada });
                          }}
                          className={`h-6 w-6 transition ${
                            n.fixada
                              ? "text-warning"
                              : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          }`}
                        >
                          {n.fixada ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Excluir nota"
                          onClick={(e) => {
                            e.stopPropagation();
                            excluirNota(n.id);
                          }}
                          className="h-6 w-6 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {previa && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        {previa}
                      </p>
                    )}

                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{quandoAtualizada(n.atualizadaEm)}</span>
                      {pasta && (
                        <span className="flex min-w-0 items-center gap-1">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: pasta.cor }}
                          />
                          <span className="truncate">{pasta.nome}</span>
                        </span>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {/* ─── Coluna 3: editor ─── */}
        <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
          {!notaAtiva ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <span className="rounded-2xl border border-border bg-muted/50 p-3 text-muted-foreground">
                <NotebookPen className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-semibold">Nenhuma nota aberta</p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Escolha uma nota na lista ou crie outra. O texto é salvo sozinho enquanto você
                  escreve.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={novaNota}>
                <Plus className="h-3.5 w-3.5" />
                Criar primeira nota
              </Button>
            </div>
          ) : (
            <>
              {/* Barra do editor */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
                <select
                  value={notaAtiva.pastaId || SEM_PASTA}
                  onChange={(e) => editarNota(notaAtiva.id, { pastaId: e.target.value })}
                  aria-label="Pasta desta nota"
                  className="h-7 min-w-0 max-w-[12rem] cursor-pointer truncate rounded-md border border-input bg-background px-2 text-[11px] text-foreground focus:border-primary focus:outline-none"
                >
                  <option value={SEM_PASTA}>Sem pasta</option>
                  {pastasOrdenadas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>

                {pastaDaNotaAtiva && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: pastaDaNotaAtiva.cor }}
                    />
                    {pastaDaNotaAtiva.nome}
                  </Badge>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`h-7 gap-1.5 text-[11px] ${notaAtiva.fixada ? "text-warning" : ""}`}
                    onClick={() => editarNota(notaAtiva.id, { fixada: !notaAtiva.fixada })}
                  >
                    {notaAtiva.fixada ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                    {notaAtiva.fixada ? "Fixada" : "Fixar"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-[11px]"
                    title="Baixar esta nota como arquivo .md"
                    onClick={() => baixarNota(notaAtiva)}
                  >
                    <Download className="h-3 w-3" />
                    Baixar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => excluirNota(notaAtiva.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Excluir
                  </Button>
                </div>
              </div>

              {/* Título e corpo */}
              <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                <input
                  value={notaAtiva.titulo}
                  onChange={(e) => editarNota(notaAtiva.id, { titulo: e.target.value })}
                  placeholder="Título da nota"
                  aria-label="Título da nota"
                  className="w-full border-none bg-transparent px-1 text-base font-bold tracking-tight text-foreground placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none sm:text-lg"
                />
                <textarea
                  value={notaAtiva.conteudo}
                  onChange={(e) => editarNota(notaAtiva.id, { conteudo: e.target.value })}
                  placeholder="Escreva aqui. Prazos, telefones do pregoeiro, o que conferir antes da sessão…"
                  aria-label="Conteúdo da nota"
                  maxLength={LIMITE_CARACTERES_NOTA}
                  className="min-h-[45vh] w-full flex-1 resize-none border-none bg-transparent px-1 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                />
              </div>

              {/* Rodapé: contagem e estado de gravação */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {stats.palavras} {stats.palavras === 1 ? "palavra" : "palavras"} ·{" "}
                  {stats.caracteres} {stats.caracteres === 1 ? "caractere" : "caracteres"}
                </span>
                {indicadorSalvamento()}
              </div>
            </>
          )}
        </section>
      </div>

      {/* O aviso do banco fica fora do rodapé do editor para continuar visível
          mesmo com nenhuma nota aberta — é informação sobre a sincronização
          inteira, não sobre uma nota. */}
      {avisoBanco && estado === "local" && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-foreground">
          <strong>Suas notas estão salvas neste navegador, mas o banco não aceitou a gravação.</strong>{" "}
          Elas não vão aparecer em outro dispositivo até isso ser resolvido. Detalhe técnico:{" "}
          {avisoBanco}
        </p>
      )}
    </div>
  );
}
