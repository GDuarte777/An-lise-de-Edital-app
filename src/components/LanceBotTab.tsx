import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Bot, Check, Copy, Download, KeyRound, Loader2, Monitor,
  Plus, Puzzle, RefreshCw, ShieldCheck, Trash2,
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
  APP_ID_EXTENSAO, MODOS_ROBO, excluirItem, excluirRobo, gerarToken,
  listarItens, listarRobos, listarTokens, numeroOuNulo, revogarToken,
  roboVazio, salvarItens, salvarRobo,
  type ItemRoboLance, type ModoRobo, type RoboLance, type TipoDisputa, type TokenRobo,
} from "../utils/roboLances";

const URL_INSTALADOR =
  "https://github.com/GDuarte777/An-lise-de-Edital-app/releases/latest/download/HORASIS-LanceBot-Setup.exe";

type Aviso = { tipo: "ok" | "erro"; texto: string } | null;

/**
 * Robô de lances: onde a disputa é configurada.
 *
 * A extensão do navegador opera a sala do portal, mas não decide nada — ela lê
 * a configuração daqui. Esta tela é, portanto, onde o piso de margem é
 * definido, e é o único lugar onde ele pode ser definido com segurança: o que
 * está no navegador do operador é alterável por quem tem acesso àquela máquina.
 */
export default function LanceBotTab({ activeEdital }: { activeEdital?: any }) {
  const [robos, setRobos] = useState<RoboLance[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<RoboLance | null>(null);
  const [itens, setItens] = useState<ItemRoboLance[]>([]);
  const [tokens, setTokens] = useState<TokenRobo[]>([]);
  const [tokenNovo, setTokenNovo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  const carregarRobos = useCallback(async () => {
    try {
      const lista = await listarRobos();
      setRobos(lista);
      return lista;
    } catch (erro: any) {
      setAviso({ tipo: "erro", texto: erro?.message || "Não foi possível carregar os robôs." });
      return [];
    }
  }, []);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      await carregarRobos();
      try {
        setTokens(await listarTokens());
      } catch {
        // Sem token listado a tela continua útil: dá para cadastrar o robô e
        // gerar a credencial depois. Travar aqui seria esconder o resto.
      }
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

  function abrirRobo(robo: RoboLance) {
    setSelecionado(robo.id);
    setRascunho({ ...robo });
    setAviso(null);
  }

  function novoRobo() {
    const base = roboVazio();
    // O edital aberto na tela é quase sempre o motivo de estar aqui: trazer o
    // número e o órgão poupa uma redigitação e, mais importante, evita o erro
    // de digitar o número de outra compra.
    if (activeEdital) {
      base.title = activeEdital.numeroPregao || activeEdital.numero || "Novo robô";
      base.numero_compra = activeEdital.numeroPregao || activeEdital.numero || null;
      base.uasg = activeEdital.uasg || null;
      base.orgao = activeEdital.orgao || null;
    }
    setSelecionado(null);
    setRascunho(base);
    setItens([]);
    setAviso(null);
  }

  async function guardar() {
    if (!rascunho) return;
    setSalvando(true);
    const resultado = await salvarRobo(rascunho);
    if (resultado.sucesso) {
      const lista = await carregarRobos();
      const salvo = lista.find((r) => r.id === rascunho.id.trim());
      if (salvo) abrirRobo(salvo);
      if (itens.length) await salvarItens(rascunho.id.trim(), itens);
    }
    setAviso({ tipo: resultado.sucesso ? "ok" : "erro", texto: resultado.mensagem });
    setSalvando(false);
  }

  async function remover(id: string) {
    if (!window.confirm(`Excluir o robô "${id}"? Os itens e o histórico de lances vão junto.`)) return;
    const ok = await excluirRobo(id);
    if (!ok) {
      setAviso({ tipo: "erro", texto: "Não foi possível excluir o robô." });
      return;
    }
    setSelecionado(null);
    setRascunho(null);
    await carregarRobos();
    setAviso({ tipo: "ok", texto: "Robô excluído." });
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

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-foreground">Robô de Lances</h2>
          <p className="text-xs text-muted-foreground">
            A extensão opera a sala de disputa; o que ela pode fazer é decidido aqui.
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
        tokens={tokens}
        tokenNovo={tokenNovo}
        aoGerar={criarToken}
        aoRevogar={revogar}
        aoDescartarToken={() => setTokenNovo("")}
      />

      <Card className="py-5">
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">Seus robôs</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => carregarRobos()}>
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar
              </Button>
              <Button size="sm" onClick={novoRobo}>
                <Plus className="w-3.5 h-3.5" />
                Novo robô
              </Button>
            </div>
          </div>

          {carregando ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
            </p>
          ) : robos.length === 0 ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Nenhum robô cadastrado. Crie um para cada compra que você vai disputar — o <b>ID do robô</b> é o que
              você cola no popup da extensão, na aba daquela compra.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {robos.map((robo) => (
                <button
                  key={robo.id}
                  onClick={() => abrirRobo(robo)}
                  className={
                    "text-left rounded-lg border px-3 py-2 transition-colors " +
                    (selecionado === robo.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60")
                  }
                >
                  <span className="block text-xs font-bold text-foreground">{robo.title}</span>
                  <span className="block text-[10px] text-muted-foreground font-mono">{robo.id}</span>
                  <Badge variant="secondary" className="mt-1 text-[9px]">{robo.mode}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {rascunho && (
        <>
          <EditorRobo
            robo={rascunho}
            novo={!selecionado}
            salvando={salvando}
            aoMudar={setRascunho}
            aoSalvar={guardar}
            aoExcluir={selecionado ? () => remover(selecionado) : undefined}
          />
          <EditorItens
            robo={rascunho}
            itens={itens}
            aoMudar={setItens}
            aoSalvar={async () => {
              if (!selecionado) {
                setAviso({ tipo: "erro", texto: "Salve o robô antes de salvar os itens." });
                return;
              }
              const r = await salvarItens(selecionado, itens);
              setAviso({ tipo: r.sucesso ? "ok" : "erro", texto: r.mensagem });
            }}
            aoExcluirItem={async (numero) => {
              if (selecionado) await excluirItem(selecionado, numero);
              setItens((atual) => atual.filter((i) => i.numero_item !== numero));
            }}
          />
        </>
      )}

      <Card className="py-5">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">
              Aplicativo para Windows
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Existe também um aplicativo de desktop, hoje em calibração: ele opera em modo simulação, que serve para
            validar a estratégia de margem, mas ainda não envia lances reais. Para disputar de verdade, use a
            extensão acima.
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
  tokens, tokenNovo, aoGerar, aoRevogar, aoDescartarToken,
}: {
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
          Instale a extensão HORASIS no Chrome, clique no ícone dela e cole os dois valores abaixo.
        </p>

        <CampoCopiavel rotulo="App ID" valor={APP_ID_EXTENSAO} />

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
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
              Tokens ativos
            </span>
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
            titulo="Uma aba por compra"
            texto="Para duas disputas ao mesmo tempo, abra cada compra em uma aba e cole o ID do robô correspondente no popup daquela aba."
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

// ─── Editor do robô ────────────────────────────────────────────────────

function EditorRobo({
  robo, novo, salvando, aoMudar, aoSalvar, aoExcluir,
}: {
  robo: RoboLance;
  novo: boolean;
  salvando: boolean;
  aoMudar: (r: RoboLance) => void;
  aoSalvar: () => void;
  aoExcluir?: () => void;
}) {
  const mudar = (campo: keyof RoboLance, valor: any) => aoMudar({ ...robo, [campo]: valor });
  const descricaoDoModo = MODOS_ROBO.find((m) => m.valor === robo.mode)?.descricao || "";

  return (
    <Card className="py-5">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">
            {novo ? "Novo robô" : `Robô ${robo.id}`}
          </span>
          <div className="flex gap-2">
            {aoExcluir && (
              <Button size="sm" variant="ghost" onClick={aoExcluir}>
                <Trash2 className="w-3.5 h-3.5" />
                Excluir
              </Button>
            )}
            <Button size="sm" onClick={aoSalvar} disabled={salvando}>
              {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Salvar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Campo rotulo="ID do robô" dica="É este valor que você cola no popup da extensão.">
            <Input
              value={robo.id}
              disabled={!novo}
              placeholder="pregao-90012-2026"
              onChange={(e) => mudar("id", e.target.value.replace(/\s+/g, "-").toLowerCase())}
            />
          </Campo>
          <Campo rotulo="Nome">
            <Input value={robo.title} placeholder="Pregão 90012/2026 — Saúde" onChange={(e) => mudar("title", e.target.value)} />
          </Campo>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Campo
            rotulo="UASG"
            dica="Conferida contra o portal antes de cada lance: é o que impede o robô de uma compra responder por outra."
          >
            <Input value={robo.uasg || ""} placeholder="153031" onChange={(e) => mudar("uasg", e.target.value || null)} />
          </Campo>
          <Campo rotulo="Número da compra" dica="Também conferido contra o portal.">
            <Input
              value={robo.numero_compra || ""}
              placeholder="900122026"
              onChange={(e) => mudar("numero_compra", e.target.value || null)}
            />
          </Campo>
        </div>

        <Campo rotulo="Modo" dica={descricaoDoModo}>
          <Select value={robo.mode} onValueChange={(v) => mudar("mode", v as ModoRobo)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODOS_ROBO.map((modo) => (
                <SelectItem key={modo.valor} value={modo.valor}>{modo.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Campo rotulo="Valor inicial (R$)">
            <Input
              value={robo.initial_value ?? ""}
              placeholder="184500,00"
              onChange={(e) => mudar("initial_value", numeroOuNulo(e.target.value))}
            />
          </Campo>
          <Campo rotulo="Piso global (R$)" dica="Usado só nos itens sem piso próprio. Em branco, cada item precisa do seu.">
            <Input
              value={robo.minimum_value ?? ""}
              placeholder="129200,00"
              onChange={(e) => mudar("minimum_value", numeroOuNulo(e.target.value))}
            />
          </Campo>
          <Campo rotulo="Tempo de resposta (s)">
            <Input
              type="number"
              min={1}
              value={robo.response_time}
              onChange={(e) => mudar("response_time", Number(e.target.value) || 3)}
            />
          </Campo>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Campo rotulo="Redução mínima (%)">
            <Input
              value={robo.min_reduction ?? ""}
              placeholder="1"
              onChange={(e) => mudar("min_reduction", numeroOuNulo(e.target.value))}
            />
          </Campo>
          <Campo rotulo="Redução máxima (%)" dica="Só é usada no modo Estratégico, que sorteia dentro da faixa.">
            <Input
              value={robo.max_reduction ?? ""}
              placeholder="5"
              onChange={(e) => mudar("max_reduction", numeroOuNulo(e.target.value))}
            />
          </Campo>
          <Campo rotulo="CNPJ do fornecedor" dica="Usado para detectar menções à sua empresa no chat do pregoeiro.">
            <Input
              value={robo.fornecedor_cnpj || ""}
              placeholder="00.000.000/0001-00"
              onChange={(e) => mudar("fornecedor_cnpj", e.target.value || null)}
            />
          </Campo>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <Opcao
            rotulo="Disputar item a item"
            texto="Ligado, o robô só atua nos itens cadastrados abaixo. Desligado, ele disputa tudo que o portal mostrar."
            marcado={robo.dispute_type === "por_item"}
            aoMudar={(v) => mudar("dispute_type", (v ? "por_item" : "global") as TipoDisputa)}
          />
          {robo.dispute_type === "por_item" && (
            <Opcao
              rotulo="Exigir seleção explícita"
              texto="Ligado, só entram em disputa os itens marcados em “Participar” E com piso preenchido. É a configuração mais segura."
              marcado={robo.item_selection_enabled}
              aoMudar={(v) => mudar("item_selection_enabled", v)}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Editor de itens ───────────────────────────────────────────────────

function EditorItens({
  robo, itens, aoMudar, aoSalvar, aoExcluirItem,
}: {
  robo: RoboLance;
  itens: ItemRoboLance[];
  aoMudar: (itens: ItemRoboLance[]) => void;
  aoSalvar: () => void;
  aoExcluirItem: (numero: number) => void;
}) {
  function mudarItem(numero: number, campo: keyof ItemRoboLance, valor: any) {
    aoMudar(itens.map((item) => (item.numero_item === numero ? { ...item, [campo]: valor } : item)));
  }

  function adicionar() {
    const proximo = itens.reduce((maior, item) => Math.max(maior, item.numero_item), 0) + 1;
    aoMudar([
      ...itens,
      {
        robo_id: robo.id,
        numero_item: proximo,
        descricao: "",
        quantidade: null,
        unidade_medida: null,
        valor_unitario_estimado: null,
        valor_total: null,
        participar: false,
        valor_minimo: null,
        lance_manual: null,
        desconto: null,
        variacao: null,
      },
    ]);
  }

  const semPiso = itens.filter((i) => i.participar && i.valor_minimo === null && robo.minimum_value === null);

  return (
    <Card className="py-5">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-foreground uppercase tracking-wide">Itens</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={adicionar}>
              <Plus className="w-3.5 h-3.5" />
              Adicionar item
            </Button>
            <Button size="sm" onClick={aoSalvar}>
              <Check className="w-3.5 h-3.5" />
              Salvar itens
            </Button>
          </div>
        </div>

        {semPiso.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning leading-relaxed">
            {semPiso.length} item(ns) marcado(s) para participar sem piso de margem — nem no item, nem no robô. O
            robô não dá lance automático neles: sem piso não há como saber quando parar, e zero não serve de padrão
            porque zero é um piso válido.
          </div>
        )}

        {itens.length === 0 ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Nenhum item cadastrado. Em disputa global isso basta — o robô acompanha o que o portal mostrar. Para
            disputar item a item, cadastre aqui cada item com o seu piso.
          </p>
        ) : (
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
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((item) => (
                  <TableRow key={item.numero_item}>
                    <TableCell className="font-mono text-xs">{item.numero_item}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-xs"
                        value={item.descricao || ""}
                        onChange={(e) => mudarItem(item.numero_item, "descricao", e.target.value)}
                      />
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
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => aoExcluirItem(item.numero_item)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <b>Mínimo</b> é o piso: abaixo dele o robô para. <b>Lance manual</b> envia esse valor exato, ignorando o
          cálculo — mas continua respeitando o piso. <b>Desconto</b> e <b>variação</b> definem quanto baixar por
          lance (reais ou percentual) e vencem a faixa de redução do robô.
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
