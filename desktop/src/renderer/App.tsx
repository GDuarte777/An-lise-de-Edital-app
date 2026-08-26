import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiLanceBot, Calibracao, ConferenciaSala, Disputa, Usuario } from "../preload/index.js";

declare global {
  interface Window {
    lancebot: ApiLanceBot;
  }
}

interface Log {
  em: string;
  nivel: string;
  msg: string;
}

const api = () => window.lancebot;

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [avisoInicial, setAvisoInicial] = useState("");

  // A restauração da sessão precisa rodar aqui, e não no Portão: enquanto `carregando`
  // for true o Portão nem é montado, então um efeito lá dentro nunca dispararia e a
  // tela de carregamento ficaria presa para sempre.
  useEffect(() => {
    let vivo = true;

    const concluir = (aviso = "") => {
      if (!vivo) return;
      if (aviso) setAvisoInicial(aviso);
      setCarregando(false);
    };

    // Sem a ponte com o processo principal nada funciona; travar numa tela de
    // carregamento esconderia a causa em vez de mostrá-la.
    if (!window.lancebot) {
      concluir("A ponte com o processo principal não carregou. Reinstale o aplicativo.");
      return;
    }

    // Rede de segurança: nenhuma demora na restauração pode prender a tela inicial.
    const limite = setTimeout(() => concluir(), 8000);

    window.lancebot.plataforma
      .restaurar()
      .then((u) => {
        if (vivo && u) setUsuario(u);
      })
      .catch(() => {
        // Sessão anterior inválida apenas leva à tela de login.
      })
      .finally(() => {
        clearTimeout(limite);
        concluir();
      });

    return () => {
      vivo = false;
      clearTimeout(limite);
    };
  }, []);

  if (carregando) {
    return (
      <div className="gate">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  return usuario ? (
    <Cockpit usuario={usuario} aoSair={() => setUsuario(null)} />
  ) : (
    <Portao aoEntrar={setUsuario} avisoInicial={avisoInicial} />
  );
}

/* ------------------------------------------------------------------ Portão */

function Portao({ aoEntrar, avisoInicial }: { aoEntrar: (u: Usuario) => void; avisoInicial: string }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(avisoInicial);
  const [entrando, setEntrando] = useState(false);

  const entrar = useCallback(async () => {
    setErro("");
    setEntrando(true);
    try {
      aoEntrar(await api().plataforma.entrar(email, senha));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEntrando(false);
    }
  }, [email, senha, aoEntrar]);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="row tight">
          <span className="brand-dot" />
          <h1 className="gate-title">LanceBot</h1>
        </div>
        <p className="muted">Entre com sua conta HORASIS.</p>

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="senha">Senha</label>
          <input
            id="senha"
            className="input"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void entrar()}
          />
        </div>

        {erro && <p className="err">{erro}</p>}

        <button className="btn primary block" onClick={() => void entrar()} disabled={entrando}>
          {entrando ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Cockpit */

function Cockpit({ usuario, aoSair }: { usuario: Usuario; aoSair: () => void }) {
  const [conectado, setConectado] = useState(false);
  const [calib, setCalib] = useState<Calibracao | null>(null);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [selecionada, setSelecionada] = useState<Disputa | null>(null);
  const [erro, setErro] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [observadas, setObservadas] = useState<Array<{ metodo: string; url: string; status: number }> | null>(null);
  const [soEmLances, setSoEmLances] = useState(true);
  const [conferencia, setConferencia] = useState<ConferenciaSala | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [carregandoDisputas, setCarregandoDisputas] = useState(false);

  const [piso, setPiso] = useState("");
  const [decremento, setDecremento] = useState("1");
  const [tipo, setTipo] = useState<"fixo" | "percentual">("fixo");
  const [intervalo, setIntervalo] = useState("1000");
  const [modo, setModo] = useState<"simulacao" | "real">("simulacao");

  const [estadoRobo, setEstadoRobo] = useState("parado");
  const [logs, setLogs] = useState<Log[]>([]);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api()
      .comprasnet.status()
      .then((s) => {
        setConectado(s.autenticado);
        setEvidencia(s.evidencia);
      });
    void api().calibracao.estado().then(setCalib);

    const off = [
      api().robo.aoLog((e) => setLogs((a) => [...a.slice(-399), e as Log])),
      api().robo.aoEstado(setEstadoRobo),
      api().calibracao.aoAtualizar(() => void api().calibracao.estado().then(setCalib))
    ];
    return () => off.forEach((f) => f());
  }, []);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const carregarDisputas = useCallback(async () => {
    setErro("");
    setCarregandoDisputas(true);
    try {
      setDisputas(await api().disputas.listar());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregandoDisputas(false);
    }
  }, []);

  const conectar = useCallback(async () => {
    setErro("");
    try {
      // A janela do portal se fecha sozinha quando o login é reconhecido; esta promessa
      // só resolve depois disso, então já dá para buscar as disputas em seguida.
      const s = await api().comprasnet.entrar();
      setConectado(s.autenticado);
      setEvidencia(s.evidencia);
      if (!s.autenticado) {
        setErro(`Ainda não há sessão do gov.br. ${s.evidencia}`);
      } else {
        void carregarDisputas();
      }
      void api().calibracao.estado().then(setCalib);
    } catch (e) {
      // Sem isto, uma falha ao abrir a janela de login não deixava rastro na tela.
      setErro(`Não foi possível abrir o login do gov.br: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [carregarDisputas]);

  const conferir = useCallback(async () => {
    if (!selecionada) return setErro("Escolha uma disputa na lista ao lado.");
    setErro("");
    setConferindo(true);
    setConferencia(null);
    try {
      const valorEnsaio = Number(String(piso).replace(",", "."));
      setConferencia(
        await api().sala.conferir(
          { pregaoId: selecionada.pregaoId, itemNum: selecionada.itemNum },
          Number.isFinite(valorEnsaio) && valorEnsaio > 0 ? valorEnsaio : undefined
        )
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setConferindo(false);
    }
  }, [selecionada, piso]);

  const iniciar = useCallback(async () => {
    setErro("");
    if (!selecionada) return setErro("Escolha uma disputa na lista ao lado.");
    setLogs([]);
    try {
      await api().robo.iniciar({
        ref: { pregaoId: selecionada.pregaoId, itemNum: selecionada.itemNum },
        valorLimiteMinimo: Number(piso),
        tipoDecremento: tipo,
        valorDecremento: Number(decremento),
        intervaloMs: Number(intervalo),
        modo
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [selecionada, piso, tipo, decremento, intervalo, modo]);

  const rodando = estadoRobo === "rodando";
  const pronto = calib?.pronto ?? false;
  const emLances = disputas.filter((d) => d.emFaseDeLances);
  const visiveis = soEmLances ? emLances : disputas;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          LanceBot
        </div>
        <div className="row tight">
          <EstadoPill estado={estadoRobo} />
          <span className="faint">{usuario.email}</span>
          <button
            className="btn ghost"
            onClick={() => void api().plataforma.sair().then(aoSair)}
          >
            Sair
          </button>
        </div>
      </header>

      <div className="main">
        {/* ---------------- Coluna esquerda ---------------- */}
        <div className="col">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Compras.gov.br</h2>
              <span className={`pill ${conectado ? "ok" : "idle"}`}>
                <span className="dot" />
                {conectado ? "sessão detectada" : "sem sessão"}
              </span>
            </div>

            <p className="muted">
              O login abre a página oficial do gov.br. Sua senha não passa por este aplicativo, e certificado
              digital funciona normalmente. <strong>A janela se fecha sozinha</strong> assim que o aplicativo
              reconhece que você entrou — se quiser continuar navegando por ela, clique em “Manter aberta” no
              aviso que aparece antes do fechamento.
            </p>

            {evidencia && <p className="faint">{evidencia}</p>}

            <div className="row tight">
              <button className="btn" onClick={() => void conectar()}>
                {conectado ? "Reconectar" : "Entrar no gov.br"}
              </button>
              {conectado && (
                <button className="btn" onClick={() => void api().comprasnet.abrirPainel()}>
                  Abrir portal
                </button>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Calibração (opcional)</h2>
              <span className={`pill ${pronto ? "ok" : "idle"}`}>
                <span className="dot" />
                {pronto ? "aprendida" : "não aprendida"}
              </span>
            </div>

            <p className="muted">
              O robô dá lances operando a própria sala de disputa, então <strong>não depende disto</strong>.
              O que o aplicativo aprende observando o portal serve só para ler as disputas mais rápido.
            </p>

            <div className="steps">
              <Passo feito={Boolean(calib?.listaDisputas)} texto="Reconhecer o painel de disputas" />
              <Passo feito={Boolean(calib?.estadoItem)} texto="Ler o valor dos lances de um item" />
              <Passo feito={Boolean(calib?.envioLance)} texto="Identificar o envio de lance" />
            </div>

            <p className="faint">
              {pronto
                ? "O aplicativo reconheceu os endereços que o portal usa."
                : "Navegue pelo portal: o aplicativo aprende sozinho, sem exportar nada. Nada aqui bloqueia a operação do robô."}
            </p>

            <button
              className="btn ghost"
              style={{ alignSelf: "flex-start" }}
              onClick={() =>
                void api()
                  .calibracao.observadas()
                  .then((o) => setObservadas(o))
              }
            >
              {observadas ? `Ver chamadas observadas (${observadas.length})` : "Ver o que o portal expôs"}
            </button>

            {observadas && (
              <div className="log" style={{ maxHeight: 150 }}>
                {observadas.length === 0 ? (
                  <span className="faint">
                    Nada observado ainda. Entre no gov.br e abra a sala de disputa.
                  </span>
                ) : (
                  observadas.slice(0, 40).map((o, i) => (
                    <div className="log-line" key={i}>
                      <span className="log-time">{o.metodo}</span>
                      <span className="log-msg" data-n="sistema">
                        {o.status} · {o.url.replace(/^https:\/\//, "").slice(0, 110)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="card flex">
            <div className="card-head">
              <h2 className="card-title">Suas disputas</h2>
              <button className="btn ghost" onClick={() => void carregarDisputas()} disabled={!conectado || carregandoDisputas}>
                {carregandoDisputas ? "Lendo o portal…" : "Atualizar"}
              </button>
            </div>

            <label className="row tight faint" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={soEmLances} onChange={(e) => setSoEmLances(e.target.checked)} />
              Mostrar só as que estão em fase de lances ({emLances.length} de {disputas.length})
            </label>

            {visiveis.length === 0 ? (
              <div className="empty">
                <p className="muted">
                  {disputas.length === 0 ? "Nenhuma disputa carregada." : "Nenhuma disputa em fase de lances agora."}
                </p>
                <p className="faint">
                  {!conectado
                    ? "Entre no gov.br primeiro."
                    : disputas.length === 0
                      ? "Clique em Atualizar — o aplicativo lê as páginas do fornecedor na sua sessão."
                      : "Desmarque o filtro para ver todas."}
                </p>
              </div>
            ) : (
              <div className="list">
                {visiveis.map((d) => (
                  <div
                    key={`${d.pregaoId}-${d.itemNum}`}
                    className="dispute"
                    data-sel={selecionada?.pregaoId === d.pregaoId && selecionada?.itemNum === d.itemNum}
                    onClick={() => setSelecionada(d)}
                  >
                    <div className="dispute-top">
                      <span className="dispute-id">
                        {d.pregaoId}
                        {d.itemNum && ` · item ${d.itemNum}`}
                      </span>
                      <span className={`pill ${d.emFaseDeLances ? "ok" : "idle"}`}>
                        {d.emFaseDeLances ? "em lances" : d.situacao || "—"}
                      </span>
                    </div>
                    <span className="dispute-desc">{d.descricao}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ---------------- Coluna direita ---------------- */}
        <div className="col">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Configuração da disputa</h2>
              {selecionada && (
                <div className="row tight">
                  <button className="btn ghost" onClick={() => void api().comprasnet.abrirSala(selecionada.pregaoId)}>
                    Abrir sala
                  </button>
                  <button className="btn ghost" onClick={() => void conferir()} disabled={conferindo}>
                    {conferindo ? "Conferindo…" : "Conferir sala"}
                  </button>
                </div>
              )}
            </div>

            {selecionada ? (
              <p className="muted">
                <strong>{selecionada.pregaoId}</strong>
                {selecionada.itemNum && ` · item ${selecionada.itemNum}`} — {selecionada.descricao}
              </p>
            ) : (
              <p className="faint">Escolha uma disputa na lista à esquerda.</p>
            )}

            <div className="grid-2">
              <div className="field">
                <label htmlFor="piso">Piso — menor valor aceito (R$)</label>
                <input id="piso" className="input" value={piso} onChange={(e) => setPiso(e.target.value)} placeholder="0,00" />
              </div>
              <div className="field">
                <label htmlFor="dec">Decremento</label>
                <input id="dec" className="input" value={decremento} onChange={(e) => setDecremento(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="tipo">Tipo de decremento</label>
                <select
                  id="tipo"
                  className="input"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as "fixo" | "percentual")}
                >
                  <option value="fixo">Reais</option>
                  <option value="percentual">Percentual</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="int">Intervalo de leitura (ms)</label>
                <input id="int" className="input" value={intervalo} onChange={(e) => setIntervalo(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>Modo de operação</label>
              <div className="segmented">
                <button data-on={modo === "simulacao"} onClick={() => setModo("simulacao")}>
                  Simulação
                </button>
                <button data-on={modo === "real"} data-live="true" onClick={() => setModo("real")}>
                  Produção
                </button>
              </div>
            </div>

            {modo === "real" && (
              <p className="muted" style={{ color: "var(--warn)" }}>
                Produção envia lances reais em seu nome: o robô digita o valor e clica no botão da própria sala
                de disputa. Ele para sozinho antes de cruzar o piso, e também para se o portal não confirmar
                um envio. Use <strong>Conferir sala</strong> antes de ativar.
              </p>
            )}

            {erro && <p className="err">{erro}</p>}

            {conferencia && <PainelConferencia c={conferencia} />}

            <div className="row spread">
              <div className="row tight">
                <button className="btn primary" onClick={() => void iniciar()} disabled={rodando || !selecionada}>
                  Ativar robô
                </button>
                <button className="btn danger" onClick={() => void api().robo.parar()} disabled={!rodando}>
                  Parar
                </button>
              </div>
              {modo === "real" && !conferencia && (
                <span className="faint">Confira a sala antes de ativar em produção</span>
              )}
            </div>
          </section>

          <section className="card flex">
            <div className="card-head">
              <h2 className="card-title">Log de auditoria</h2>
              {logs.length > 0 && (
                <button className="btn ghost" onClick={() => setLogs([])}>
                  Limpar
                </button>
              )}
            </div>

            <div className="log">
              {logs.length === 0 ? (
                <span className="faint">Sem eventos.</span>
              ) : (
                logs.map((l, i) => (
                  <div className="log-line" key={i}>
                    <span className="log-time">{new Date(l.em).toLocaleTimeString("pt-BR")}</span>
                    <span className="log-msg" data-n={l.nivel}>
                      {l.msg}
                    </span>
                  </div>
                ))
              )}
              <div ref={fim} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Peças */

function PainelConferencia({ c }: { c: ConferenciaSala }) {
  const { diagnostico: d, leitura: l, ensaio } = c;
  const podeOperar = Boolean(d.campoLance && d.botaoEnvio && l.ok);

  return (
    <div className="log" style={{ maxHeight: 260 }}>
      <div className="log-line">
        <span className="log-time">sala</span>
        <span className="log-msg" data-n={podeOperar ? "sucesso" : "alerta"}>
          {podeOperar
            ? "O robô enxerga o item, o campo de lance e o botão de envio."
            : "Faltam controles: o robô ainda não consegue operar este item."}
        </span>
      </div>
      <Linha rotulo="item na tela" valor={d.escopoEncontrado ? "encontrado" : "NÃO encontrado"} />
      <Linha rotulo="campo de lance" valor={d.campoLance ?? "NÃO encontrado"} />
      <Linha rotulo="botão de envio" valor={d.botaoEnvio ?? "NÃO encontrado"} />
      <Linha
        rotulo="menor lance lido"
        valor={l.menorLance === null ? (l.motivo ?? "não lido") : `R$ ${l.menorLance.toFixed(2)}`}
      />
      <Linha
        rotulo="nosso lance"
        valor={l.nossoLance === null ? "o portal não mostra" : `R$ ${l.nossoLance.toFixed(2)}`}
      />
      <Linha rotulo="item aberto" valor={l.aberto ? "sim" : "não — não aceita lances"} />
      {ensaio && <Linha rotulo="ensaio de digitação" valor={ensaio.mensagem} />}
      <Linha rotulo="trecho lido" valor={d.textoEscopo.slice(0, 220) || "—"} />
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="log-line">
      <span className="log-time">{rotulo}</span>
      <span className="log-msg" data-n="sistema">
        {valor}
      </span>
    </div>
  );
}

function Passo({ feito, texto }: { feito: boolean; texto: string }) {
  return (
    <div className="step" data-done={feito}>
      <span className="step-mark">{feito ? "✓" : ""}</span>
      <span className="step-text">{texto}</span>
    </div>
  );
}

function EstadoPill({ estado }: { estado: string }) {
  const mapa: Record<string, { classe: string; texto: string }> = {
    rodando: { classe: "ok", texto: "operando" },
    "pausado-por-margem": { classe: "warn", texto: "pausado — margem" },
    erro: { classe: "danger", texto: "erro" },
    parado: { classe: "idle", texto: "parado" }
  };
  const { classe, texto } = mapa[estado] ?? mapa.parado;
  return (
    <span className={`pill ${classe}`}>
      <span className="dot" />
      {texto}
    </span>
  );
}
