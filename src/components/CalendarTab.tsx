import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Filter, Landmark, AlertCircle
} from "lucide-react";
import { DisputaRow, DisputaStatus, DisputaStatusType } from "../types";
import {
  fetchDisputasFromSupabase,
  fetchStatusDisputasFromSupabase,
  subscribeToSupabaseTable
} from "../utils/supabaseClient";
import { parseDisputaDate, getContrastTextColor } from "../utils/disputaDates";
import DisputaDateTag from "./DisputaDateTag";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface CalendarTabProps {
  onNavigateToDisputas?: () => void;
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const formatBRL = (value: number) =>
  (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Chave estável por dia de calendário local (evita o deslocamento de fuso
// horário que toISOString() introduziria).
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

// Gera as células do mês (7 colunas), completando com dias do mês anterior/
// seguinte só o necessário para fechar semanas inteiras — sem linha extra fixa.
function getCalendarCells(monthDate: Date): { date: Date; inMonth: boolean }[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const next = new Date(cells[cells.length - 1].date);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }
  return cells;
}

export default function CalendarTab({ onNavigateToDisputas }: CalendarTabProps) {
  const [statusTypes, setStatusTypes] = useState<DisputaStatusType[]>(() => {
    const saved = localStorage.getItem("aip_disputas_status_types");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  });

  const [disputas, setDisputas] = useState<DisputaRow[]>(() => {
    const saved = localStorage.getItem("aip_disputas_sheet");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  });

  const [statusFilter, setStatusFilter] = useState<string>("Todas");
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeConnectedRef = useRef(false);

  // Calendário é somente leitura: um refetch completo a cada evento é
  // suficiente (sem a necessidade do merge granular INSERT/UPDATE/DELETE
  // usado na Planilha, que existe lá para preservar edições locais pendentes).
  const refreshFromSupabase = useCallback(async () => {
    try {
      const [dbRows, dbTypes] = await Promise.all([
        fetchDisputasFromSupabase(),
        fetchStatusDisputasFromSupabase()
      ]);
      if (Array.isArray(dbRows)) {
        setDisputas(dbRows);
        localStorage.setItem("aip_disputas_sheet", JSON.stringify(dbRows));
      }
      if (Array.isArray(dbTypes) && dbTypes.length > 0) {
        setStatusTypes(dbTypes);
        localStorage.setItem("aip_disputas_status_types", JSON.stringify(dbTypes));
      }
    } catch (e) {
      console.warn("Erro ao buscar dados do Supabase para o calendário:", e);
    }
  }, []);

  useEffect(() => {
    refreshFromSupabase();

    const unsubscribe = subscribeToSupabaseTable(
      "planilhas_disputas",
      () => refreshFromSupabase(),
      (status) => {
        if (status === "SUBSCRIBED") {
          realtimeConnectedRef.current = true;
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        } else if (status === "CLOSED" || status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          realtimeConnectedRef.current = false;
          if (!pollingIntervalRef.current) {
            pollingIntervalRef.current = setInterval(() => {
              if (!realtimeConnectedRef.current) refreshFromSupabase();
            }, 30000);
          }
        }
      }
    );

    const handleSync = () => refreshFromSupabase();
    window.addEventListener("focus", handleSync);
    window.addEventListener("aip_sync_disputas", handleSync);
    window.addEventListener("aip_edital_history_updated", handleSync);

    return () => {
      unsubscribe();
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      window.removeEventListener("focus", handleSync);
      window.removeEventListener("aip_sync_disputas", handleSync);
      window.removeEventListener("aip_edital_history_updated", handleSync);
    };
  }, [refreshFromSupabase]);

  const sortedStatusTypes = useMemo(
    () => [...statusTypes].sort((a, b) => a.position - b.position),
    [statusTypes]
  );

  const getStatusColor = useCallback(
    (status: DisputaStatus): string => statusTypes.find(s => s.label === status)?.color || "#71717a",
    [statusTypes]
  );

  const filteredDisputas = useMemo(
    () => statusFilter === "Todas" ? disputas : disputas.filter(r => r.status === statusFilter),
    [disputas, statusFilter]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DisputaRow[]>();
    filteredDisputas.forEach(row => {
      const date = parseDisputaDate(row.dataHoraDisputa);
      if (!date) return;
      const key = dayKey(date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    });
    map.forEach(list => list.sort((a, b) => {
      const da = parseDisputaDate(a.dataHoraDisputa)?.getTime() || 0;
      const db = parseDisputaDate(b.dataHoraDisputa)?.getTime() || 0;
      return da - db;
    }));
    return map;
  }, [filteredDisputas]);

  const disputasSemData = useMemo(
    () => filteredDisputas.filter(r => !parseDisputaDate(r.dataHoraDisputa)),
    [filteredDisputas]
  );

  const upcomingDisputas = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return filteredDisputas
      .map(row => ({ row, date: parseDisputaDate(row.dataHoraDisputa) }))
      .filter((e): e is { row: DisputaRow; date: Date } => e.date !== null && e.date.getTime() >= startOfToday.getTime())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 8);
  }, [filteredDisputas]);

  const today = new Date();
  const cells = useMemo(() => getCalendarCells(currentMonth), [currentMonth]);
  const monthLabel = currentMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthLabelCapitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  const goToMonth = (delta: number) => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };
  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const selectedDayEvents = selectedDay ? (eventsByDay.get(dayKey(selectedDay)) || []) : [];

  return (
    <div className="flex flex-col gap-5 select-text font-sans text-foreground">

      {/* ─────────── Cabeçalho ─────────── */}
      <div className="flex items-start gap-3 min-w-0">
        <span className="shrink-0 rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">Calendário de Disputas</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            As datas de sessão extraídas pela IA nas análises de editais aparecem aqui automaticamente.
          </p>
        </div>
      </div>

      {/* Aviso de disputas sem data reconhecível */}
      {disputasSemData.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          <span className="text-foreground">
            {disputasSemData.length} disputa{disputasSemData.length === 1 ? "" : "s"} sem data de sessão reconhecível não aparece{disputasSemData.length === 1 ? "" : "m"} no calendário.
          </span>
          {onNavigateToDisputas && (
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onNavigateToDisputas}>
              Ver na Planilha
            </Button>
          )}
        </div>
      )}

      {/* ─────────── Filtro por status + legenda ─────────── */}
      <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-input bg-muted px-2.5 py-1.5">
          <Filter className="h-3.5 w-3.5 shrink-0 text-primary" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-w-0 cursor-pointer bg-transparent text-xs font-semibold text-foreground focus:outline-none"
            title="Filtrar por status"
          >
            <option value="Todas">Todos os status</option>
            {sortedStatusTypes.map(s => (
              <option key={s.id} value={s.label}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {sortedStatusTypes.map(s => (
            <span
              key={s.id}
              className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[10px] font-semibold"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </Card>

      {/* ─────────── Grade mensal + próximas disputas ─────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">

        <Card className="min-w-0 gap-3 p-3 sm:p-4">
          {/* Navegação de mês */}
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold capitalize sm:text-base">{monthLabelCapitalized}</h3>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => goToMonth(-1)} title="Mês anterior">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={goToToday}>
                Hoje
              </Button>
              <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => goToMonth(1)} title="Próximo mês">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
            {WEEKDAY_LABELS.map(w => <div key={w}>{w}</div>)}
          </div>

          {/* Grade de dias */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map(({ date, inMonth }) => {
              const key = dayKey(date);
              const events = eventsByDay.get(key) || [];
              const isToday = isSameDay(date, today);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => events.length > 0 && setSelectedDay(date)}
                  className={`flex min-h-16 flex-col items-start gap-0.5 rounded-lg border p-1 text-left transition sm:min-h-24 sm:p-1.5 ${
                    inMonth ? "border-border bg-card" : "border-transparent bg-muted/30 opacity-50"
                  } ${isToday ? "ring-2 ring-primary" : ""} ${events.length > 0 ? "cursor-pointer hover:border-primary/40" : "cursor-default"}`}
                >
                  <span className={`text-[10px] font-bold sm:text-xs ${isToday ? "text-primary" : "text-foreground"}`}>
                    {date.getDate()}
                  </span>

                  {/* Telas maiores: chips de texto com hora + órgão */}
                  <div className="hidden w-full min-w-0 flex-col gap-0.5 sm:flex">
                    {events.slice(0, 2).map(row => (
                      <span
                        key={row.id}
                        className="truncate rounded px-1 py-0.5 text-[9px] font-semibold"
                        style={{ backgroundColor: getStatusColor(row.status), color: getContrastTextColor(getStatusColor(row.status)) }}
                        title={`${row.orgao} — ${row.dataHoraDisputa}`}
                      >
                        {row.orgao}
                      </span>
                    ))}
                    {events.length > 2 && (
                      <span className="text-[9px] font-semibold text-muted-foreground">+{events.length - 2} mais</span>
                    )}
                  </div>

                  {/* Telas pequenas: pontos coloridos, um por evento (máx. 4) */}
                  <div className="flex w-full flex-wrap gap-0.5 sm:hidden">
                    {events.slice(0, 4).map(row => (
                      <span
                        key={row.id}
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: getStatusColor(row.status) }}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Próximas disputas */}
        <Card className="min-w-0 gap-3 p-3 sm:p-4">
          <h3 className="text-sm font-bold">Próximas Disputas</h3>
          {upcomingDisputas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma disputa futura com data definida.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {upcomingDisputas.map(({ row, date }) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedDay(date)}
                  className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-2 text-left transition hover:border-primary/40"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getStatusColor(row.status) }} />
                    <span className="truncate text-xs font-semibold">{row.orgao || "Órgão não informado"}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-3.5">
                    <span className="font-mono text-[10px] text-success">{row.dataHoraDisputa}</span>
                    <DisputaDateTag value={row.dataHoraDisputa} className="px-1.5 py-0 text-[9px]" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ─────────── Diálogo com as disputas do dia selecionado ─────────── */}
      <Dialog open={!!selectedDay} onOpenChange={(open) => { if (!open) setSelectedDay(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedDay?.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedDayEvents.length} disputa{selectedDayEvents.length === 1 ? "" : "s"} agendada{selectedDayEvents.length === 1 ? "" : "s"} nesta data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {selectedDayEvents.map(row => (
              <div key={row.id} className="space-y-1.5 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold" title={row.orgao}>{row.orgao || "Órgão não informado"}</p>
                  <Badge
                    className="shrink-0 border-0 font-bold"
                    style={{ backgroundColor: getStatusColor(row.status), color: getContrastTextColor(getStatusColor(row.status)) }}
                  >
                    {row.status}
                  </Badge>
                </div>
                <p className="truncate font-mono text-xs font-bold text-primary">{row.numeroLicitacao}</p>
                {row.produtoItem && <p className="line-clamp-2 text-xs text-muted-foreground">{row.produtoItem}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-success">
                    <Landmark className="h-3.5 w-3.5" />
                    {row.dataHoraDisputa}
                  </span>
                  {row.nossoValorAlvo > 0 && (
                    <span className="font-mono text-xs font-bold">{formatBRL(row.nossoValorAlvo)}</span>
                  )}
                </div>
                {row.linkPNCP && (
                  <a
                    href={row.linkPNCP.startsWith("http") ? row.linkPNCP : `https://${row.linkPNCP}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Abrir edital no PNCP <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>

          {onNavigateToDisputas && (
            <Button type="button" variant="outline" onClick={() => { setSelectedDay(null); onNavigateToDisputas(); }}>
              Ver na Planilha de Disputas
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
