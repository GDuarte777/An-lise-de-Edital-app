import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiLanceBot, Calibracao, Disputa, Usuario } from "../preload/index.js";

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

  const [piso, setPiso] = useState("");
  const [decremento, setDecremento] = useState("1");
  const [tipo, setTipo] = useState<"fixo" | "percentual">("fixo");
  const [intervalo, setIntervalo] = useState("1000");
  const [modo, setModo] = useState<"simulacao" | "real">("simulacao");

  const [estadoRobo, setEstadoRobo] = useState("parado");
  const [logs, setLogs] = useState<Log[]>([]);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api().comprasnet.status().then((s) => setConectado(s.autenticado));
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

  const conectar = useCallback(async () => {
    setErro("");
    const s = await api().comprasnet.entrar();
    setConectado(s.autenticado);
    void api().calibracao.estado().then(setCalib);
  }, []);

  const carregarDisputas = useCallback(async () => {
    setErro("");
    try {
      setDisputas(await api().disputas.listar());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
                {conectado ? "conectado" : "desconectado"}
              </span>
            </div>

            <p className="muted">
              O login abre a página oficial do gov.br. Sua senha não passa por este aplicativo, e certificado
              digital funciona normalmente.
            </p>

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
              <h2 className="card-title">Calibração</h2>
              <span className={`pill ${pronto ? "ok" : "warn"}`}>
                <span className="dot" />
                {pronto ? "pronta" : "em andamento"}
              </span>
            </div>

            <div className="steps">
              <Passo feito={Boolean(calib?.listaDisputas)} texto="Reconhecer o painel de disputas" />
              <Passo feito={Boolean(calib?.estadoItem)} texto="Ler o valor dos lances de um item" />
              <Passo feito={Boolean(calib?.envioLance)} texto="Identificar o envio de lance" />
            </div>

            <p className="faint">
              {pronto
                ? "O aplicativo aprendeu o necessário para operar em produção."
                : "Navegue pelo portal e abra a sala de disputa: o aplicativo aprende sozinho, sem exportar nada. O envio de lance é reconhecido quando você manda um lance manualmente uma vez."}
            </p>
          </section>

          <section className="card flex">
            <div className="card-head">
              <h2 className="card-title">Suas disputas</h2>
              <button className="btn ghost" onClick={() => void carregarDisputas()} disabled={!conectado}>
                Atualizar
              </button>
            </div>

            {disputas.length === 0 ? (
              <div className="empty">
                <p className="muted">Nenhuma disputa carregada.</p>
                <p className="faint">
                  {conectado ? "Clique em Atualizar." : "Entre no gov.br primeiro."}
                </p>
              </div>
            ) : (
              <div className="list">
                {disputas.map((d) => (
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
                <button className="btn ghost" onClick={() => void api().comprasnet.abrirSala(selecionada.pregaoId)}>
                  Abrir sala
                </button>
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
                Produção envia lances reais em seu nome. O robô para sozinho antes de cruzar o piso.
              </p>
            )}

            {erro && <p className="err">{erro}</p>}

            <div className="row spread">
              <div className="row tight">
                <button className="btn primary" onClick={() => void iniciar()} disabled={rodando || !selecionada}>
                  Ativar robô
                </button>
                <button className="btn danger" onClick={() => void api().robo.parar()} disabled={!rodando}>
                  Parar
                </button>
              </div>
              {modo === "real" && !pronto && <span className="faint">Calibração ainda incompleta</span>}
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
