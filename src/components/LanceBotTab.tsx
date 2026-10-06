import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Bot, Check, Copy, Download, KeyRound, Loader2, Monitor,
  Puzzle, RefreshCw, ShieldCheck, Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import {
  PERFIL_PADRAO, gerarToken, lerPerfil, listarItens, listarRobos, listarTokens,
  revogarToken,
  type ItemRoboLance, type PerfilRobo, type RoboLance, type TokenRobo,
} from "../utils/roboLances";

/**
 * Pacote da extensão, gerado no build por scripts/empacotar-extensao.mjs.
 *
 * Não é um arquivo commitado: um .zip parado no repositório envelhece em
 * silêncio, e o resultado disso é o operador instalar uma extensão antiga que
 * conversa com um backend novo — erro que só aparece no meio do pregão.
 */
const ARQUIVO_EXTENSAO = "/extensao-horasis.zip";
const METADADOS_EXTENSAO = "/extensao-horasis.json";

const URL_INSTALADOR_DESKTOP =
  "https://github.com/GDuarte777/An-lise-de-Edital-app/releases/latest/download/HORASIS-LanceBot-Setup.exe";

type Aviso = { tipo: "ok" | "erro"; texto: string } | null;

/**
 * Robô de lances.
 *
 * Esta tela não configura o robô. Ela entrega a extensão e as duas credenciais
 * — e mostra o que as disputas produziram. Modo, faixa de redução e tempo de
 * resposta são ajustados no popup da própria extensão, e o piso de margem na
 * tabela do painel, dentro da sala de disputa.
 *
 * O motivo é onde o operador está: no navegador, com o portal aberto. Mandá-lo
 * a outra tela para mudar o tempo de resposta é mandá-lo sair da disputa.
 */
export default function LanceBotTab(_props: { activeEdital?: any }) {
  const [robos, setRobos] = useState<RoboLance[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemRoboLance[]>([]);
  const [perfil, setPerfil] = useState<PerfilRobo>(PERFIL_PADRAO);
  const [tokens, setTokens] = useState<TokenRobo[]>([]);
  const [tokenNovo, setTokenNovo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<Aviso>(null);

  const carregarRobos = useCallback(async () => {
    try {
      setRobos(await listarRobos());
    } catch (erro: any) {
      setAviso({ tipo: "erro", texto: erro?.message || "Não foi possível carregar as disputas." });
    }
  }, []);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      await carregarRobos();
      // Perfil e tokens dependem da Edge Function. Se ela estiver fora do ar,
      // o download da extensão e a lista de disputas ainda valem a tela.
      try {
        setPerfil(await lerPerfil());
      } catch { /* o App ID aparece vazio, com aviso próprio */ }
      try {
        setTokens(await listarTokens());
      } catch { /* a geração de token tem o seu próprio erro */ }
      setCarregando(false);
    })();
  }, [carregarRobos]);

  useEffect(() => {
    if (!selecionado) {
      setItens([]);
      return;
    }
    listarItens(selecionado)
      .then(setItens)
      .catch((erro) => setAviso({ tipo: "erro", texto: erro?.message || "Não foi possível carregar os itens." }));
  }, [selecionado]);

  async function criarToken(): Promise<string> {
    try {
      const token = await gerarToken("Extensão do navegador", 90);
      setTokenNovo(token);
      setTokens(await listarTokens());
      setAviso(null);
      return token;
    } catch (erro: any) {
      setAviso({ tipo: "erro", texto: erro?.message || "Não foi possível gerar o token." });
      return "";
    }
  }

  async function revogar(id: string) {
    try {
      await revogarToken(id);
      setTokens(await listarTokens());
    } catch (erro: any) {
      setAviso({ tipo: "erro", texto: erro?.message || "Não foi possível revogar o token." });
    }
  }

  const roboAberto = robos.find((r) => r.id === selecionado) || null;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-foreground">Robô de Lances</h2>
          <p className="text-xs text-muted-foreground">
            Instale a extensão, cole as duas credenciais e abra a sala de disputa. O robô nasce sozinho.
          </p>
        </div>
      </div>

      {aviso && (
        <div
          className={
            "rounded-xl border p-3 text-xs " +
            (aviso.tipo === "ok"
              ? "border-success/40 bg-success/10 text-success"
              : "border-destructive/40 bg-destructive/10 text-destructive")
          }
        >
          {aviso.texto}
        </div>
      )}

      <BaixarExtensao />

      <ConectarRobo
        appId={perfil.app_id}
        tokens={tokens}
        tokenNovo={tokenNovo}
        aoGerar={criarToken}
        aoRevogar={revogar}
        aoDescartarToken={() => setTokenNovo("")}
      />

      <Card className="py-5">
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-foreground uppercase tracking-wide">Disputas</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Cada compra que a extensão abriu aparece aqui, com o que foi configurado no painel.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={carregarRobos}>
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </Button>
          </div>

          {carregando ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
            </p>
          ) : robos.length === 0 ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Nenhuma disputa ainda. Instale a extensão, cole o App ID e o Token acima e abra a sala de disputa de um
              pregão — ela aparece aqui sozinha.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {robos.map((robo) => (
                <button
                  key={robo.id}
                  onClick={() => setSelecionado(robo.id === selecionado ? null : robo.id)}
                  className={
                    "text-left rounded-lg border px-3 py-2 transition-colors " +
                    (selecionado === robo.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60")
                  }
                >
                  <span className="block text-xs font-bold text-foreground">{robo.title}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {robo.uasg ? `UASG ${robo.uasg} · ` : ""}compra {robo.purchase_id || "—"}
                  </span>
                  <Badge variant="secondary" className="mt-1 text-[9px]">{robo.mode}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {roboAberto && <ResumoDaDisputa robo={roboAberto} itens={itens} />}

      <Card className="py-5">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">Aplicativo para Windows</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Existe também um aplicativo de desktop, hoje em calibração: ele opera em modo simulação, que serve para
            validar a estratégia de margem, mas ainda não envia lances reais. Para disputar de verdade, use a
            extensão.
          </p>
          <Button asChild size="sm" variant="outline" className="w-fit">
            <a href={URL_INSTALADOR_DESKTOP}>
              <Download className="w-3.5 h-3.5" />
              Baixar instalador
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Baixar a extensão ─────────────────────────────────────────────────

interface PacoteExtensao {
  versao: string;
  bytes: number;
}

function BaixarExtensao() {
  const [pacote, setPacote] = useState<PacoteExtensao | null>(null);

  useEffect(() => {
    // Em `npm run dev` o pacote não existe (ele é gerado no build). O botão
    // continua na tela: o que falta é só a etiqueta de versão.
    fetch(METADADOS_EXTENSAO)
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => dados?.versao && setPacote(dados))
      .catch(() => {});
  }, []);

  return (
    <Card className="py-5 border-primary/30">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Puzzle className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">Extensão do navegador</span>
          {pacote && (
            <Badge variant="secondary" className="text-[9px]">
              v{pacote.versao} · {(pacote.bytes / 1024).toFixed(0)} KB
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          É ela que opera a sala de disputa do Comprasnet e do Licitanet. Toda a configuração do robô — modo, faixa
          de redução, tempo de resposta e o piso de margem de cada item — é feita dentro dela, onde você já está
          durante o pregão.
        </p>

        <Button asChild>
          <a href={ARQUIVO_EXTENSAO} download>
            <Download className="w-4 h-4" />
            Baixar extensão
          </a>
        </Button>

        <ol className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5 list-decimal pl-4">
          <li>Descompacte o arquivo numa pasta que você não vá apagar — o Chrome carrega a extensão de lá.</li>
          <li>
            Abra <code className="bg-muted px-1 py-0.5 rounded">chrome://extensions</code> e ligue o
            {" "}<b>Modo do desenvolvedor</b>, no canto superior direito.
          </li>
          <li>Clique em <b>Carregar sem compactação</b> e aponte para a pasta descompactada.</li>
          <li>Clique no ícone do HORASIS na barra e cole o App ID e o Token abaixo.</li>
        </ol>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          A instalação é em modo desenvolvedor porque a extensão não está publicada na Chrome Web Store. O Chrome
          avisa sobre isso a cada abertura — é esperado, e não indica problema com o arquivo.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Conectar a extensão ───────────────────────────────────────────────

function ConectarRobo({
  appId, tokens, tokenNovo, aoGerar, aoRevogar, aoDescartarToken,
}: {
  appId: string;
  tokens: TokenRobo[];
  tokenNovo: string;
  aoGerar: () => Promise<string>;
  aoRevogar: (id: string) => void;
  aoDescartarToken: () => void;
}) {
  const ativos = useMemo(() => tokens.filter((t) => !t.revogado), [tokens]);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  /**
   * Gera o token e já o deixa na área de transferência.
   *
   * São duas ações num clique de propósito: o valor em claro existe uma única
   * vez, e o caminho "gerei, agora copio" é onde alguém fecha a tela com o
   * token na mão sem ter copiado — e aí só resta gerar outro.
   *
   * A cópia pode falhar (permissão negada, documento sem foco). Quando falha,
   * o valor continua visível com o botão de copiar ao lado, e o texto abaixo
   * dele muda para não afirmar uma cópia que não aconteceu.
   */
  async function gerarECopiar() {
    setGerando(true);
    setCopiado(false);
    const token = await aoGerar();
    if (token) {
      try {
        await navigator.clipboard.writeText(token);
        setCopiado(true);
      } catch {
        // Fica visível na tela com o botão de copiar; nada a avisar.
      }
    }
    setGerando(false);
  }

  return (
    <Card className="bg-muted/40 py-5">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">Suas credenciais</span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Cole as duas no popup da extensão. Elas são suas: o App ID identifica a sua conta e o Token autentica.
        </p>

        {appId ? (
          <CampoCopiavel rotulo="App ID" valor={appId} />
        ) : (
          <div className="space-y-1.5">
            <Label className="text-[11px]">App ID</Label>
            <p className="text-[11px] text-destructive leading-relaxed">
              Seu App ID ainda não foi gerado. Ele nasce na primeira leitura do perfil — recarregue a página. Se
              continuar vazio, o backend não está respondendo e a extensão não tem como conectar.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-[11px]">Token de acesso</Label>
          {tokenNovo ? (
            <>
              <CampoCopiavel rotulo="" valor={tokenNovo} destaque />
              <p className="text-[11px] text-warning leading-relaxed">
                {copiado
                  ? "Token copiado para a área de transferência — cole no campo Token do popup da extensão. "
                  : "Copie o valor acima e cole no campo Token do popup da extensão. "}
                O servidor guarda apenas um hash dele: este valor não aparece de novo em lugar nenhum, e quem o
                perder gera outro.
              </p>
              <Button size="sm" variant="ghost" onClick={aoDescartarToken}>Já copiei</Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={gerando} onClick={gerarECopiar}>
                {gerando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                Gerar e copiar token
              </Button>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                O token vai direto para a área de transferência, pronto para colar no popup da extensão.
              </p>
            </>
          )}
        </div>

        {ativos.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Tokens ativos</span>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Só os primeiros caracteres aparecem: o valor completo é guardado como hash e não pode ser copiado de
              volta. Perdeu o token de uma máquina? Gere outro — este continua valendo onde já está colado, até você
              revogá-lo.
            </p>
            {ativos.map((token) => (
              <div key={token.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <code className="bg-background border border-border rounded px-1.5 py-0.5">{token.prefixo}…</code>
                <span className="flex-1 truncate">
                  {token.nome}
                  {token.ultimo_uso_em
                    ? ` · usado em ${new Date(token.ultimo_uso_em).toLocaleDateString("pt-BR")}`
                    : " · nunca usado"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => aoRevogar(token.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <Cartao
            icone={<ShieldCheck className="w-4 h-4 text-primary" />}
            titulo="Sua senha não passa por aqui"
            texto="A extensão trabalha dentro da sua sessão já aberta no portal. A plataforma nunca vê sua senha gov.br, e certificado A1 ou A3 continua funcionando."
          />
          <Cartao
            icone={<Monitor className="w-4 h-4 text-primary" />}
            titulo="O piso fica no servidor"
            texto="O limite mínimo é conferido aqui, não no navegador. O que roda na máquina do operador é alterável por quem tem acesso a ela; o piso de margem, não."
          />
          <Cartao
            icone={<AlertTriangle className="w-4 h-4 text-primary" />}
            titulo="Item sem piso não recebe lance"
            texto="O item continua visível e monitorado, mas nenhum lance sai sozinho nele. Sem piso não há como o robô saber onde parar."
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CampoCopiavel({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="space-y-1.5">
      {rotulo && <Label className="text-[11px]">{rotulo}</Label>}
      <div className="flex gap-2">
        <Input
          readOnly
          value={valor}
          onFocus={(e) => e.currentTarget.select()}
          className={"font-mono text-[11px] " + (destaque ? "border-warning" : "")}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(valor);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            } catch {
              // Área de transferência bloqueada: o campo é selecionável, então
              // o Ctrl+C continua disponível e não há o que avisar.
            }
          }}
        >
          {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Resumo de uma disputa (somente leitura) ───────────────────────────

function ResumoDaDisputa({ robo, itens }: { robo: RoboLance; itens: ItemRoboLance[] }) {
  const semPiso = itens.filter((i) => i.valor_minimo === null);
  const moeda = (v: number | null) =>
    v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <Card className="py-5">
      <CardContent className="space-y-4">
        <div className="min-w-0">
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">{robo.title}</span>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {robo.orgao || "Órgão não informado pelo portal"}
            {robo.link_sistema_origem && (
              <>
                {" · "}
                <a href={robo.link_sistema_origem} target="_blank" rel="noopener noreferrer" className="underline">
                  edital no PNCP
                </a>
              </>
            )}
          </p>
        </div>

        {itens.length === 0 ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Nenhum item configurado nesta disputa. Os itens aparecem aqui conforme você digita o piso na tabela do
            painel, durante o pregão — quem lista os itens é o portal, em tempo real.
          </p>
        ) : (
          <>
            {semPiso.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning leading-relaxed">
                {semPiso.length} item(ns) sem piso de margem. Eles continuam monitorados, mas o robô não dá lance
                automático neles: sem piso não há como saber quando parar, e zero não serve de padrão porque zero é um
                piso válido.
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-28 text-right">Mínimo</TableHead>
                    <TableHead className="w-28 text-right">Lance manual</TableHead>
                    <TableHead className="w-24 text-right">Desconto</TableHead>
                    <TableHead className="w-20 text-right">Var. %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((item) => (
                    <TableRow key={item.numero_item}>
                      <TableCell className="font-mono text-xs">{item.numero_item}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
                        {item.descricao || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{moeda(item.valor_minimo)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{moeda(item.lance_manual)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{moeda(item.desconto)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {item.variacao === null ? "—" : `${item.variacao}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Esta tela é só leitura. Para mudar o piso de um item, use a tabela do painel na sala de disputa — é lá que
          o valor vale no instante do lance.
        </p>
      </CardContent>
    </Card>
  );
}

function Cartao({ icone, titulo, texto }: { icone: React.ReactNode; titulo: string; texto: string }) {
  return (
    <Card className="py-3.5">
      <CardContent className="space-y-1.5 px-3.5">
        <div className="flex items-center gap-2">
          {icone}
          <span className="text-[11px] font-bold text-foreground">{titulo}</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{texto}</p>
      </CardContent>
    </Card>
  );
}
