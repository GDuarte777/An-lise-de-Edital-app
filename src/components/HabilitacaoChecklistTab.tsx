import { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck, AlertTriangle, CheckCircle2, Clock, FileWarning, FilePlus2,
  RefreshCw, Copy, Download, ShieldCheck, CalendarClock, ArrowRight
} from "lucide-react";
import { Certificate, EditalAnalysis } from "../types";
import {
  montarChecklistHabilitacao,
  checklistParaTexto,
  rotuloSituacao,
  ExigenciaChecklist,
  ExigenciaSituacao,
  ResultadoHabilitacao,
} from "../utils/habilitacao";
import { useEditalHistory } from "../utils/editalHistory";
import { fetchCertificatesFromSupabase, subscribeToSupabaseTable } from "../utils/supabaseClient";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";

interface HabilitacaoChecklistTabProps {
  activeEdital: EditalAnalysis | null;
  onNavigateToDocs?: () => void;
  onNavigateToCreateDoc?: () => void;
  onNavigateToAnalyzer?: () => void;
}

// Mesma chave usada pela Gestão de Certidões: as duas abas leem o mesmo cache
// local, então o checklist já abre preenchido mesmo antes de o Supabase
// responder (ou quando o usuário está offline).
const CHAVE_CERTIDOES = "aip_certificates";

function lerCertidoesDoCache(): Certificate[] {
  try {
    const bruto = localStorage.getItem(CHAVE_CERTIDOES);
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

const ESTILO_SITUACAO: Record<
  ExigenciaSituacao,
  { variante: "success" | "destructive" | "warning" | "secondary" | "outline"; Icone: typeof CheckCircle2 }
> = {
  coberta: { variante: "success", Icone: CheckCircle2 },
  vence_antes: { variante: "destructive", Icone: CalendarClock },
  vencida: { variante: "destructive", Icone: AlertTriangle },
  sem_arquivo: { variante: "destructive", Icone: FileWarning },
  sem_validade: { variante: "warning", Icone: Clock },
  a_gerar: { variante: "warning", Icone: FilePlus2 },
  nao_cadastrada: { variante: "destructive", Icone: AlertTriangle },
};

export default function HabilitacaoChecklistTab({
  activeEdital,
  onNavigateToDocs,
  onNavigateToCreateDoc,
  onNavigateToAnalyzer,
}: HabilitacaoChecklistTabProps) {
  const historico = useEditalHistory();
  const [certs, setCerts] = useState<Certificate[]>(lerCertidoesDoCache);
  const [carregando, setCarregando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // "" = o edital aberto na sessão; qualquer outro valor é um id do histórico.
  const [editalSelecionadoId, setEditalSelecionadoId] = useState<string>("");

  const carregarCertidoes = async () => {
    setCarregando(true);
    try {
      const doBanco = await fetchCertificatesFromSupabase();
      // Sem Supabase configurado a consulta devolve lista vazia; nesse caso o
      // cache local continua sendo a melhor fonte que temos.
      if (doBanco && doBanco.length > 0) setCerts(doBanco as Certificate[]);
      else setCerts(lerCertidoesDoCache());
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarCertidoes();
    // Se o usuário corrigir uma certidão na outra aba, o checklist reflete sem
    // precisar recarregar a página.
    const cancelar = subscribeToSupabaseTable("certidoes_fiscais", () => {
      carregarCertidoes();
    });
    return cancelar;
  }, []);

  const editalEscolhido = useMemo(() => {
    if (!editalSelecionadoId) {
      return activeEdital ? { titulo: "Edital aberto na sessão", analise: activeEdital } : null;
    }
    const item = historico.find((h) => h.id === editalSelecionadoId);
    return item ? { titulo: item.title, analise: item.analysis } : null;
  }, [editalSelecionadoId, activeEdital, historico]);

  const resultado: ResultadoHabilitacao = useMemo(
    () => montarChecklistHabilitacao(editalEscolhido?.analise ?? null, certs),
    [editalEscolhido, certs],
  );

  const bloqueios = resultado.itens.filter((i) => i.bloqueante);
  const atencao = resultado.itens.filter((i) => !i.bloqueante && i.situacao !== "coberta");
  const ok = resultado.itens.filter((i) => i.situacao === "coberta");

  const diasAteSessao = resultado.dataSessao
    ? Math.ceil(
        (new Date(
          resultado.dataSessao.getFullYear(),
          resultado.dataSessao.getMonth(),
          resultado.dataSessao.getDate(),
        ).getTime() -
          new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) /
          86400000,
      )
    : null;

  const copiarChecklist = async () => {
    const texto = checklistParaTexto(resultado, editalEscolhido?.titulo || "Edital");
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Navegador sem permissão de área de transferência: o botão de baixar
      // continua disponível, então não vale interromper o usuário com alerta.
    }
  };

  const baixarChecklist = () => {
    const texto = checklistParaTexto(resultado, editalEscolhido?.titulo || "Edital");
    const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `checklist-habilitacao-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Checklist de Habilitação</h2>
            <p className="text-xs text-muted-foreground">
              Cruza o que o edital exige com o que você já tem — e projeta a validade para o dia da sessão.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={carregarCertidoes} disabled={carregando}>
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          {resultado.totalExigencias > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={copiarChecklist}>
                <Copy className="w-3.5 h-3.5" />
                {copiado ? "Copiado" : "Copiar"}
              </Button>
              <Button variant="outline" size="sm" onClick={baixarChecklist}>
                <Download className="w-3.5 h-3.5" />
                Baixar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Seletor de edital */}
      {(activeEdital || historico.length > 0) && (
        <Card className="py-3">
          <div className="px-4 flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground shrink-0">
              Edital
            </span>
            <select
              value={editalSelecionadoId}
              onChange={(e) => setEditalSelecionadoId(e.target.value)}
              className="flex-1 min-w-[220px] h-9 rounded-md border bg-background px-3 text-xs text-foreground"
            >
              {activeEdital && <option value="">Edital aberto na sessão</option>}
              {historico.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title}
                </option>
              ))}
            </select>
          </div>
        </Card>
      )}

      {!editalEscolhido ? (
        <Card className="py-10">
          <div className="flex flex-col items-center text-center gap-3 px-6">
            <ClipboardCheck className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm font-bold text-foreground">Nenhum edital analisado ainda</p>
            <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
              O checklist parte da lista de exigências que a análise extrai do edital. Analise um edital e volte
              aqui para ver, item por item, o que já está coberto e o que trava sua habilitação.
            </p>
            {onNavigateToAnalyzer && (
              <Button size="sm" onClick={onNavigateToAnalyzer}>
                Ir para Análise de Edital
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </Card>
      ) : resultado.totalExigencias === 0 ? (
        <Card className="py-10">
          <div className="flex flex-col items-center text-center gap-2 px-6">
            <FileWarning className="w-8 h-8 text-warning" />
            <p className="text-sm font-bold text-foreground">
              A análise deste edital não listou documentos de habilitação
            </p>
            <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
              Isso acontece quando o PDF é uma imagem escaneada ou quando o anexo de habilitação não veio junto.
              Reanalise o edital incluindo o anexo de exigências.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Placar */}
          <Card className="py-4">
            <div className="px-4 space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-foreground">{resultado.score}%</span>
                  <span className="text-xs text-muted-foreground">
                    {resultado.cobertas} de {resultado.totalExigencias} exigências cobertas
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {resultado.bloqueantes > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="w-3 h-3" />
                      {resultado.bloqueantes} bloqueio(s)
                    </Badge>
                  )}
                  {resultado.atencao > 0 && (
                    <Badge variant="warning">
                      <Clock className="w-3 h-3" />
                      {resultado.atencao} em atenção
                    </Badge>
                  )}
                  {resultado.bloqueantes === 0 && resultado.atencao === 0 && (
                    <Badge variant="success">
                      <ShieldCheck className="w-3 h-3" />
                      Documentação completa
                    </Badge>
                  )}
                </div>
              </div>

              <Progress value={resultado.score} />

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                {resultado.dataSessao ? (
                  <span>
                    Sessão em <strong className="text-foreground">{resultado.dataSessao.toLocaleString("pt-BR")}</strong>
                    {diasAteSessao !== null && diasAteSessao >= 0 && (
                      <> — faltam {diasAteSessao} dia(s). As validades abaixo já foram projetadas para essa data.</>
                    )}
                    {diasAteSessao !== null && diasAteSessao < 0 && <> — sessão já ocorrida.</>}
                  </span>
                ) : (
                  <span>
                    A análise não trouxe uma data de sessão legível, então as validades foram conferidas apenas
                    contra hoje. Confira no edital se alguma certidão vence antes da disputa.
                  </span>
                )}
              </div>
            </div>
          </Card>

          {bloqueios.length > 0 && (
            <GrupoExigencias
              titulo="Bloqueiam a habilitação"
              descricao="Resolva antes de enviar a documentação — cada um destes desclassifica."
              itens={bloqueios}
              onNavigateToDocs={onNavigateToDocs}
              onNavigateToCreateDoc={onNavigateToCreateDoc}
            />
          )}

          {atencao.length > 0 && (
            <GrupoExigencias
              titulo="Pedem ação, mas não desclassificam sozinhos"
              descricao="Declarações que você emite por disputa e cadastros incompletos."
              itens={atencao}
              onNavigateToDocs={onNavigateToDocs}
              onNavigateToCreateDoc={onNavigateToCreateDoc}
            />
          )}

          {ok.length > 0 && (
            <GrupoExigencias
              titulo="Cobertas"
              descricao="Documento no portfólio, arquivo enviado e válido na data da sessão."
              itens={ok}
              onNavigateToDocs={onNavigateToDocs}
              onNavigateToCreateDoc={onNavigateToCreateDoc}
            />
          )}

          {resultado.alertasPortfolio.length > 0 && (
            <Card className="py-4 bg-muted/40">
              <div className="px-4 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Outras certidões suas que pedem atenção
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Este edital não pediu estes documentos, mas eles vão travar a próxima disputa.
                </p>
                <ul className="space-y-1">
                  {resultado.alertasPortfolio.map((alerta, i) => (
                    <li key={i} className="text-xs text-foreground flex gap-2">
                      <Clock className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                      <span>{alerta}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function GrupoExigencias({
  titulo,
  descricao,
  itens,
  onNavigateToDocs,
  onNavigateToCreateDoc,
}: {
  titulo: string;
  descricao: string;
  itens: ExigenciaChecklist[];
  onNavigateToDocs?: () => void;
  onNavigateToCreateDoc?: () => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wide">
          {titulo} <span className="text-muted-foreground font-medium normal-case">({itens.length})</span>
        </h3>
        <p className="text-[11px] text-muted-foreground">{descricao}</p>
      </div>

      <div className="space-y-2">
        {itens.map((item, i) => {
          const { variante, Icone } = ESTILO_SITUACAO[item.situacao];
          const ehDeclaracao = item.situacao === "a_gerar";

          return (
            <Card key={`${item.exigencia}-${i}`} className="py-3">
              <div className="px-4 flex gap-3">
                <Icone
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    variante === "success"
                      ? "text-success"
                      : variante === "warning"
                        ? "text-warning"
                        : "text-destructive"
                  }`}
                />

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <p className="text-xs font-bold text-foreground leading-relaxed flex-1 min-w-[200px]">
                      {item.exigencia}
                    </p>
                    <Badge variant={variante}>{rotuloSituacao(item.situacao)}</Badge>
                  </div>

                  {item.certificado && (
                    <p className="text-[11px] text-muted-foreground">
                      Atendida por: <strong className="text-foreground">{item.certificado.name}</strong>
                    </p>
                  )}
                  {!item.certificado && item.rotulo && (
                    <p className="text-[11px] text-muted-foreground">
                      Documento reconhecido: <strong className="text-foreground">{item.rotulo}</strong>
                    </p>
                  )}

                  <p className="text-[11px] text-muted-foreground leading-relaxed">{item.detalhe}</p>

                  {item.situacao !== "coberta" && (
                    <div className="pt-0.5">
                      {ehDeclaracao ? (
                        onNavigateToCreateDoc && (
                          <Button variant="outline" size="sm" onClick={onNavigateToCreateDoc}>
                            Gerar documento
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        )
                      ) : (
                        onNavigateToDocs && (
                          <Button variant="outline" size="sm" onClick={onNavigateToDocs}>
                            Abrir Gestão de Certidões
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
