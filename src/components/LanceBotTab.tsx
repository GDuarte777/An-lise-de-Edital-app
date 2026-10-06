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
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import {
  MODOS_ROBO, PERFIL_PADRAO, gerarToken, lerPerfil,
  listarItens, listarRobos, listarTokens, numeroOuNulo, revogarToken,
  salvarItens, salvarPerfil,
  type ItemRoboLance, type ModoRobo, type PerfilRobo, type RoboLance,
  type TipoDisputa, type TokenRobo,
} from "../utils/roboLances";

const URL_INSTALADOR =
  "https://github.com/GDuarte777/An-lise-de-Edital-app/releases/latest/download/HORASIS-LanceBot-Setup.exe";

type Aviso = { tipo: "ok" | "erro"; texto: string } | null;

/**
 * Robô de lances.
 *
 * Não se cadastra robô aqui, e isso é a decisão central da tela: o robô nasce
 * quando a extensão abre a sala de disputa. Um pregão que aparece de manhã
 * para disputar à tarde não tem tempo de cadastro prévio, e quem esquecia
 * chegava na sala sem robô.
 *
 * O que fica aqui é o antes e o depois. Antes: o perfil padrão que todo robô
 * novo herda. Depois: o que cada disputa produziu, com os pisos de margem
 * abertos para ajuste — os mesmos que o operador digita na tabela do painel,
 * durante o pregão.
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
      // a lista de disputas ainda vale a tela: falhar tudo junto esconderia o
      // que continua funcionando.
      try {
        setPerfil(await lerPerfil());
      } catch { /* mantém o padrão */ }
      try {
        setTokens(await listarTokens());
      } catch { /* a conexão continua configurável */ }
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

  async function guardarPerfil(novo: PerfilRobo) {
    setPerfil(novo);
    try {
      setPerfil(await salvarPerfil(novo));
      setAviso({ tipo: "ok", texto: "Perfil salvo. Vale para as próximas disputas; quem já está em sala não muda." });
    } catch (erro: any) {
      setAviso({ tipo: "erro", texto: erro?.message || "Não foi possível salvar o perfil." });
    }
  }

  async function criarToken() {
    try {
      const token = await gerarToken("Extensão do navegador", 90);
      setTokenNovo(token);
      setTokens(await listarTokens());
      setAviso(null);
    } catch (erro: any) {
      setAviso({ tipo: "erro", texto: erro?.message || "Não foi possível gerar o token." });
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
            Abra a sala de disputa e o robô daquela compra nasce sozinho. Não há nada para cadastrar antes.
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

      <ConectarRobo
        appId={perfil.app_id}
        tokens={tokens}
        tokenNovo={tokenNovo}
        aoGerar={criarToken}
        aoRevogar={revogar}
        aoDescartarToken={() => setTokenNovo("")}
      />

      <PerfilPadrao perfil={perfil} aoSalvar={guardarPerfil} />

      <Card className="py-5">
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-foreground uppercase tracking-wide">Disputas</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Cada compra que a extensão abriu aparece aqui.
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
              pregão — ela aparece aqui sozinha, com o que o portal informou.
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

      {roboAberto && (
        <PisosDaDisputa
          robo={roboAberto}
          itens={itens}
          aoMudar={setItens}
          aoSalvar={async () => {
            const r = await salvarItens(roboAberto.id, itens);
            setAviso({ tipo: r.sucesso ? "ok" : "erro", texto: r.mensagem });
          }}
        />
      )}

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
            <a href={URL_INSTALADOR}>
              <Download className="w-3.5 h-3.5" />
              Baixar instalador
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Conectar a extensão ───────────────────────────────────────────────

function ConectarRobo({
  appId, tokens, tokenNovo, aoGerar, aoRevogar, aoDescartarToken,
}: {
  appId: string;
  tokens: TokenRobo[];
  tokenNovo: string;
  aoGerar: () => void;
  aoRevogar: (id: string) => void;
  aoDescartarToken: () => void;
}) {
  const ativos = useMemo(() => tokens.filter((t) => !t.revogado), [tokens]);

  return (
    <Card className="bg-muted/40 py-5">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Puzzle className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">Conectar robô</span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Instale a extensão HORASIS no Chrome, clique no ícone dela e cole os dois valores abaixo. Eles são seus:
          o App ID identifica a sua conta e o Token autentica. É a única configuração — a partir daí, qualquer sala
          de disputa que você abrir já sobe com o painel.
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
                Copie agora. O servidor guarda apenas um hash deste token — ele não aparece de novo em lugar nenhum,
                e quem o perder gera outro.
              </p>
              <Button size="sm" variant="ghost" onClick={aoDescartarToken}>Já copiei</Button>
            </>
          ) : (
            <Button size="sm" onClick={aoGerar}>
              <KeyRound className="w-3.5 h-3.5" />
              Gerar token
            </Button>
          )}
        </div>

        {ativos.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Tokens ativos</span>
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

// ─── Perfil padrão ─────────────────────────────────────────────────────

function PerfilPadrao({ perfil, aoSalvar }: { perfil: PerfilRobo; aoSalvar: (p: PerfilRobo) => void }) {
  const [rascunho, setRascunho] = useState(perfil);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setRascunho(perfil), [perfil]);

  const mudar = (campo: keyof PerfilRobo, valor: any) => setRascunho({ ...rascunho, [campo]: valor });
  const descricaoDoModo = MODOS_ROBO.find((m) => m.valor === rascunho.mode)?.descricao || "";

  return (
    <Card className="py-5">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">Perfil padrão</span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Todo robô novo nasce com isto. Mudar aqui não altera disputa em andamento.
            </p>
          </div>
          <Button
            size="sm"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              await aoSalvar(rascunho);
              setSalvando(false);
            }}
          >
            {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Salvar
          </Button>
        </div>

        <Campo rotulo="Modo" dica={descricaoDoModo}>
          <Select value={rascunho.mode} onValueChange={(v) => mudar("mode", v as ModoRobo)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODOS_ROBO.map((modo) => (
                <SelectItem key={modo.valor} value={modo.valor}>{modo.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Campo rotulo="Redução mínima (%)">
            <Input
              value={rascunho.min_reduction ?? ""}
              placeholder="1"
              onChange={(e) => mudar("min_reduction", numeroOuNulo(e.target.value))}
            />
          </Campo>
          <Campo rotulo="Redução máxima (%)" dica="Só é usada no modo Estratégico, que sorteia dentro da faixa.">
            <Input
              value={rascunho.max_reduction ?? ""}
              placeholder="5"
              onChange={(e) => mudar("max_reduction", numeroOuNulo(e.target.value))}
            />
          </Campo>
          <Campo rotulo="Tempo de resposta (s)">
            <Input
              type="number"
              min={1}
              value={rascunho.response_time}
              onChange={(e) => mudar("response_time", Number(e.target.value) || 3)}
            />
          </Campo>
        </div>

        <Campo rotulo="CNPJ do fornecedor" dica="Usado para detectar menções à sua empresa no chat do pregoeiro.">
          <Input
            value={rascunho.fornecedor_cnpj || ""}
            placeholder="00.000.000/0001-00"
            onChange={(e) => mudar("fornecedor_cnpj", e.target.value || null)}
          />
        </Campo>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <Opcao
            rotulo="Disputar item a item"
            texto="Ligado, o robô só atua nos itens que tiverem configuração própria. Desligado, ele acompanha tudo que o portal mostrar — e continua sem dar lance em item sem piso."
            marcado={rascunho.dispute_type === "por_item"}
            aoMudar={(v) => mudar("dispute_type", (v ? "por_item" : "global") as TipoDisputa)}
          />
          {rascunho.dispute_type === "por_item" && (
            <Opcao
              rotulo="Exigir seleção explícita"
              texto="Ligado, um item só entra em disputa se estiver marcado para participar E tiver piso. É a configuração mais conservadora."
              marcado={rascunho.item_selection_enabled}
              aoMudar={(v) => mudar("item_selection_enabled", v)}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Pisos de uma disputa ──────────────────────────────────────────────

function PisosDaDisputa({
  robo, itens, aoMudar, aoSalvar,
}: {
  robo: RoboLance;
  itens: ItemRoboLance[];
  aoMudar: (itens: ItemRoboLance[]) => void;
  aoSalvar: () => void;
}) {
  function mudarItem(numero: number, campo: keyof ItemRoboLance, valor: any) {
    aoMudar(itens.map((item) => (item.numero_item === numero ? { ...item, [campo]: valor } : item)));
  }

  const semPiso = itens.filter((i) => i.valor_minimo === null);

  return (
    <Card className="py-5">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
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
          <Button size="sm" onClick={aoSalvar}>
            <Check className="w-3.5 h-3.5" />
            Salvar
          </Button>
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
                    <TableHead className="w-20">Participar</TableHead>
                    <TableHead className="w-28">Mínimo R$</TableHead>
                    <TableHead className="w-28">Lance manual</TableHead>
                    <TableHead className="w-24">Desc. R$</TableHead>
                    <TableHead className="w-20">Var. %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((item) => (
                    <TableRow key={item.numero_item}>
                      <TableCell className="font-mono text-xs">{item.numero_item}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">
                        {item.descricao || "—"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={item.participar}
                          onCheckedChange={(v) => mudarItem(item.numero_item, "participar", v)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs text-right"
                          value={item.valor_minimo ?? ""}
                          onChange={(e) => mudarItem(item.numero_item, "valor_minimo", numeroOuNulo(e.target.value))}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs text-right"
                          value={item.lance_manual ?? ""}
                          onChange={(e) => mudarItem(item.numero_item, "lance_manual", numeroOuNulo(e.target.value))}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs text-right"
                          value={item.desconto ?? ""}
                          onChange={(e) => mudarItem(item.numero_item, "desconto", numeroOuNulo(e.target.value))}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs text-right"
                          value={item.variacao ?? ""}
                          onChange={(e) => mudarItem(item.numero_item, "variacao", numeroOuNulo(e.target.value))}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <b>Mínimo</b> é o piso: abaixo dele o robô para. <b>Lance manual</b> envia esse valor exato, ignorando o
          cálculo — mas continua respeitando o piso. <b>Desconto</b> e <b>variação</b> definem quanto baixar por
          lance (reais ou percentual) e vencem a faixa de redução do perfil.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Peças de interface ────────────────────────────────────────────────

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">{rotulo}</Label>
      {children}
      {dica && <p className="text-[10px] text-muted-foreground leading-relaxed">{dica}</p>}
    </div>
  );
}

function Opcao({
  rotulo, texto, marcado, aoMudar,
}: {
  rotulo: string;
  texto: string;
  marcado: boolean;
  aoMudar: (valor: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch checked={marcado} onCheckedChange={aoMudar} className="mt-0.5" />
      <div className="space-y-0.5">
        <span className="block text-xs font-bold text-foreground">{rotulo}</span>
        <span className="block text-[11px] text-muted-foreground leading-relaxed">{texto}</span>
      </div>
    </div>
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
