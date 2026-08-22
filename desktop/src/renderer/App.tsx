import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiLanceBot } from "../preload/index.js";

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

const CORES: Record<string, string> = {
  sistema: "#94a3b8",
  concorrente: "#fbbf24",
  proprio: "#60a5fa",
  alerta: "#f87171",
  sucesso: "#4ade80"
};

export default function App() {
  const [usuario, setUsuario] = useState<{ email: string } | null>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  const [cnAutenticado, setCnAutenticado] = useState(false);
  const [gravando, setGravando] = useState(false);

  const [pregaoId, setPregaoId] = useState("");
  const [itemNum, setItemNum] = useState("");
  const [piso, setPiso] = useState("");
  const [decremento, setDecremento] = useState("1");
  const [tipoDecremento, setTipoDecremento] = useState<"fixo" | "percentual">("fixo");
  const [intervalo, setIntervalo] = useState("1000");
  const [modo, setModo] = useState<"simulacao" | "real">("simulacao");

  const [estadoRobo, setEstadoRobo] = useState("parado");
  const [logs, setLogs] = useState<Log[]>([]);
  const fimLogs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.lancebot.plataforma
      .restaurar()
      .then((u) => u && setUsuario({ email: u.email }))
      .finally(() => setCarregando(false));

    void window.lancebot.comprasnet.status().then((s) => setCnAutenticado(s.autenticado));

    const offLog = window.lancebot.robo.aoLog((e) => setLogs((atual) => [...atual.slice(-499), e as Log]));
    const offEstado = window.lancebot.robo.aoEstado(setEstadoRobo);
    return () => {
      offLog();
      offEstado();
    };
  }, []);

  useEffect(() => {
    fimLogs.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const entrarPlataforma = useCallback(async () => {
    setErro("");
    try {
      const u = await window.lancebot.plataforma.entrar(email, senha);
      setUsuario({ email: u.email });
      setSenha("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [email, senha]);

  const entrarComprasnet = useCallback(async () => {
    const s = await window.lancebot.comprasnet.entrar();
    setCnAutenticado(s.autenticado);
  }, []);

  const alternarCaptura = useCallback(async () => {
    if (gravando) {
      const r = await window.lancebot.captura.parar();
      setGravando(false);
      alert(`Captura encerrada. ${r.total} requisições registradas. Use "Exportar" para salvar.`);
    } else {
      await window.lancebot.captura.iniciar();
      setGravando(true);
      await window.lancebot.comprasnet.abrirSala();
    }
  }, [gravando]);

  const exportarCaptura = useCallback(async () => {
    try {
      const r = await window.lancebot.captura.exportar();
      if (r.exportado) alert(`Exportado: ${r.caminho}\n${r.chamadas} chamadas de API registradas.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const iniciarRobo = useCallback(async () => {
    setErro("");
    setLogs([]);
    try {
      await window.lancebot.robo.iniciar({
        ref: { pregaoId, itemNum },
        valorLimiteMinimo: Number(piso),
        tipoDecremento,
        valorDecremento: Number(decremento),
        intervaloMs: Number(intervalo),
        modo
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [pregaoId, itemNum, piso, tipoDecremento, decremento, intervalo, modo]);

  if (carregando) return <div style={s.centro}>Carregando…</div>;

  if (!usuario) {
    return (
      <div style={s.centro}>
        <div style={s.cartao}>
          <h1 style={s.titulo}>HORASIS LanceBot</h1>
          <p style={s.sub}>Entre com sua conta da plataforma.</p>
          <input style={s.input} placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            style={s.input}
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void entrarPlataforma()}
          />
          {erro && <p style={s.erro}>{erro}</p>}
          <button style={s.botaoPrimario} onClick={() => void entrarPlataforma()}>
            Entrar
          </button>
        </div>
      </div>
    );
  }

  const rodando = estadoRobo === "rodando";

  return (
    <div style={s.pagina}>
      <header style={s.cabecalho}>
        <strong>HORASIS LanceBot</strong>
        <span style={s.sub}>{usuario.email}</span>
      </header>

      <section style={s.painel}>
        <h2 style={s.h2}>Conexões</h2>
        <div style={s.linha}>
          <span>Compras.gov.br:</span>
          <strong style={{ color: cnAutenticado ? "#4ade80" : "#f87171" }}>
            {cnAutenticado ? "sessão ativa" : "sem sessão"}
          </strong>
          <button style={s.botao} onClick={() => void entrarComprasnet()}>
            {cnAutenticado ? "Entrar novamente" : "Entrar no Compras.gov.br"}
          </button>
        </div>
        <p style={s.nota}>
          O login acontece na página oficial do gov.br, numa janela do navegador. Este aplicativo não vê nem
          guarda sua senha, e certificado digital funciona normalmente.
        </p>
      </section>

      <section style={s.painel}>
        <h2 style={s.h2}>Modo Captura</h2>
        <p style={s.nota}>
          A integração com o portal ainda não foi calibrada. Rode a captura durante um pregão real, exporte o
          arquivo e use-o para preencher o mapeamento da API.
        </p>
        <div style={s.linha}>
          <button style={s.botao} onClick={() => void alternarCaptura()}>
            {gravando ? "Parar captura" : "Iniciar captura + abrir sala"}
          </button>
          <button style={s.botao} onClick={() => void exportarCaptura()}>
            Exportar
          </button>
        </div>
      </section>

      <section style={s.painel}>
        <h2 style={s.h2}>Disputa</h2>
        <div style={s.grade}>
          <label style={s.rotulo}>
            Pregão
            <input style={s.input} value={pregaoId} onChange={(e) => setPregaoId(e.target.value)} />
          </label>
          <label style={s.rotulo}>
            Item
            <input style={s.input} value={itemNum} onChange={(e) => setItemNum(e.target.value)} />
          </label>
          <label style={s.rotulo}>
            Piso (R$)
            <input style={s.input} value={piso} onChange={(e) => setPiso(e.target.value)} />
          </label>
          <label style={s.rotulo}>
            Decremento
            <input style={s.input} value={decremento} onChange={(e) => setDecremento(e.target.value)} />
          </label>
          <label style={s.rotulo}>
            Tipo
            <select style={s.input} value={tipoDecremento} onChange={(e) => setTipoDecremento(e.target.value as "fixo" | "percentual")}>
              <option value="fixo">Fixo (R$)</option>
              <option value="percentual">Percentual (%)</option>
            </select>
          </label>
          <label style={s.rotulo}>
            Intervalo (ms)
            <input style={s.input} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} />
          </label>
        </div>

        <div style={{ ...s.linha, marginTop: 12 }}>
          <label style={s.linha}>
            <input type="radio" checked={modo === "simulacao"} onChange={() => setModo("simulacao")} />
            Simulação
          </label>
          <label style={s.linha}>
            <input type="radio" checked={modo === "real"} onChange={() => setModo("real")} />
            Produção (lances reais)
          </label>
        </div>

        {modo === "real" && (
          <p style={{ ...s.nota, color: "#fbbf24" }}>
            Modo produção envia lances de verdade, em seu nome. O robô para sozinho se o próximo lance ficaria
            abaixo do piso informado.
          </p>
        )}

        {erro && <p style={s.erro}>{erro}</p>}

        <div style={{ ...s.linha, marginTop: 12 }}>
          <button style={s.botaoPrimario} onClick={() => void iniciarRobo()} disabled={rodando}>
            Iniciar
          </button>
          <button style={s.botao} onClick={() => void window.lancebot.robo.parar()} disabled={!rodando}>
            Parar
          </button>
          <span style={s.sub}>Estado: {estadoRobo}</span>
        </div>
      </section>

      <section style={{ ...s.painel, flex: 1, minHeight: 220 }}>
        <h2 style={s.h2}>Log de auditoria</h2>
        <div style={s.log}>
          {logs.length === 0 && <span style={s.sub}>Sem eventos.</span>}
          {logs.map((l, i) => (
            <div key={i} style={{ color: CORES[l.nivel] ?? "#e2e8f0" }}>
              <span style={s.sub}>{new Date(l.em).toLocaleTimeString("pt-BR")} </span>
              {l.msg}
            </div>
          ))}
          <div ref={fimLogs} />
        </div>
      </section>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  centro: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f172a", color: "#e2e8f0" },
  pagina: { display: "flex", flexDirection: "column", gap: 12, padding: 16, background: "#0f172a", color: "#e2e8f0", minHeight: "100vh", fontFamily: "system-ui, sans-serif", fontSize: 14 },
  cabecalho: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: "1px solid #1e293b" },
  cartao: { background: "#1e293b", padding: 28, borderRadius: 12, width: 340, display: "flex", flexDirection: "column", gap: 10 },
  painel: { background: "#1e293b", padding: 16, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 },
  titulo: { margin: 0, fontSize: 20 },
  h2: { margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6, color: "#94a3b8" },
  sub: { color: "#94a3b8", fontSize: 12 },
  nota: { color: "#94a3b8", fontSize: 12, margin: 0, lineHeight: 1.5 },
  erro: { color: "#f87171", fontSize: 12, margin: 0 },
  input: { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "8px 10px", color: "#e2e8f0", fontSize: 13, width: "100%", boxSizing: "border-box" },
  rotulo: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#94a3b8" },
  grade: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 },
  linha: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  botao: { background: "#334155", border: "none", borderRadius: 6, padding: "8px 14px", color: "#e2e8f0", cursor: "pointer", fontSize: 13 },
  botaoPrimario: { background: "#f97316", border: "none", borderRadius: 6, padding: "8px 18px", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13 },
  log: { background: "#0f172a", borderRadius: 6, padding: 10, overflowY: "auto", maxHeight: 260, fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.6 }
};
