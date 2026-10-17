import { useCallback, useEffect, useRef, useState } from "react";
import Painel from "./painel/Painel.js";
import { criarDemonstracao } from "./painel/demonstracao.js";
import { criarFonteIpc } from "./painel/fonte-ipc.js";
import type { FontePainel } from "../compartilhado/painel.js";
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

function primeiraMaiuscula(texto: string): string {
  return texto ? texto[0].toUpperCase() + texto.slice(1) : texto;
}

/* ----------------------------------------------------------------- Cockpit */

function Cockpit({ usuario, aoSair }: { usuario: Usuario; aoSair: () => void }) {
  // O painel de disputa é a tela de operação do robô; o cockpit abaixo continua sendo o
  // diagnóstico de sessão e calibração. A fonte real vem do processo principal, que lê a
  // sala aberta e decide com o motor novo; a demonstração fica como ensaio, rotulada.
  const [fontePainel, setFontePainel] = useState<FontePainel | null>(null);
  const [abrindoPainel, setAbrindoPainel] = useState(false);
  const [etapaAcesso, setEtapaAcesso] = useState<"abrindo" | "login" | "concluindo" | null>(null);
  const [disputaDireta, setDisputaDireta] = useState("");
  const [aviso, setAviso] = useState<{ titulo: string; texto: string; escolhas?: Disputa[] } | null>(null);

  /** Detalhe técnico vai para o log de auditoria, não para o aviso do operador. */
  const anotar = useCallback((nivel: Log["nivel"], msg: string) => {
    setLogs((a) => [...a.slice(-399), { em: new Date().toISOString(), nivel, msg }]);
  }, []);
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

  const [diag, setDiag] = useState<{
    status: { autenticado: boolean; cookiesEncontrados: number; evidencia: string };
    api: { status: number; ok: boolean; erro?: string };
    tentativasDeToken?: Array<{ rota: string; metodo: string; status: number }>;
    chamadasDoPortal?: Array<{ metodo: string; host: string; caminho: string; comAutorizacao: boolean }>;
    sessaoPortal?: {
      temToken: boolean;
      idadeTokenS: number | null;
      temCaptcha: boolean;
      idadeCaptchaS: number | null;
      hostApi: string | null;
      observadas: number;
    };
    tentativas: Array<{ url: string; urlFinal: string; autenticado: boolean; motivo: string | null;
      sondagem: null | { noSso: boolean; noPortal: boolean; temSenha: boolean; temSair: boolean;
        temIdentidade: boolean; escolhendoPerfil: boolean; tamanho: number } }>;
    enderecosAprendidos: Record<string, string | undefined>;
    dominiosDeCookie: string[];
  } | null>(null);
  const [diagnosticando, setDiagnosticando] = useState(false);

  const [guardiao, setGuardiao] = useState<{
    ativo: boolean; autenticado: boolean; renovacoes: number; retokensObservados: number;
    ultimaRenovacaoEm: string | null; proximaRenovacaoEm: string | null; motivo: string;
  } | null>(null);

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
    void api().sessao.guardiao().then(setGuardiao);

    const off = [
      api().sessao.aoMudar(setGuardiao),
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
    setEtapaAcesso("abrindo");
    try {
      // A janela do portal se fecha sozinha quando o login é reconhecido; esta promessa
      // só resolve depois disso, então já dá para buscar as disputas em seguida.
      const s = await api().comprasnet.entrar();
      setConectado(s.autenticado);
      setEvidencia(s.evidencia);
      // Lista as disputas de qualquer jeito: é o que o operador quer ver depois de
      // entrar, e a própria listagem diz o que falta quando falta. Condicionar isso a
      // um "autenticado" que chega segundos atrasado só produzia tela vazia.
      // Entrou: o robô olha se há disputa acontecendo agora e diz em uma frase.
      const lista = await api()
        .disputas.listar()
        .catch((e: unknown) => {
          anotar("alerta", `Disputas: ${e instanceof Error ? e.message : String(e)}`);
          return [] as Disputa[];
        });
      setDisputas(lista);
      const vivas = lista.filter((d) => d.emFaseDeLances);
      if (vivas.length > 0) {
        setSelecionada(vivas[0]);
        anotar("sucesso", `${vivas.length} disputa(s) em fase de lances agora.`);
      } else {
        setAviso({
          titulo: "Nenhuma disputa ao vivo",
          texto: "Nenhuma disputa sua está em fase de lances agora."
        });
      }
      if (!s.autenticado) setErro(`Ainda não há sessão do gov.br. ${s.evidencia}`);
      void api().calibracao.estado().then(setCalib);
    } catch (e) {
      // Sem isto, uma falha ao abrir a janela de login não deixava rastro na tela.
      setErro(`Não foi possível abrir o login do gov.br: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEtapaAcesso(null);
    }
  }, [carregarDisputas, anotar]);

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

  /**
   * Abre o painel sobre a disputa de verdade. A sala selecionada é a referência; sem
   * seleção, abre a sala que o portal mostrar — é o mesmo caminho do "Abrir sala".
   */
  /**
   * Abre o painel sobre uma disputa ao vivo.
   *
   * A ordem importa e foi aprendida na mão do operador: primeiro descobre QUAL disputa,
   * só depois abre a sala. Abrir a sala sem compra produzia a URL com `?compra=` vazio,
   * que o portal responde com "Acesso não autorizado" — e o operador ficava preso numa
   * janela pedindo login de novo.
   */
  const abrirPainelComDisputa = useCallback(async (alvo: Disputa) => {
    setAviso(null);
    setErro("");
    setAbrindoPainel(true);
    try {
      setFontePainel(await criarFonteIpc(alvo.pregaoId));
    } catch (e) {
      anotar("alerta", `Painel: ${e instanceof Error ? e.message : String(e)}`);
      setAviso({
        titulo: "Não consegui abrir o painel",
        texto: "A sala da disputa não abriu. Confira se você está conectado ao Compras.gov.br."
      });
    } finally {
      setAbrindoPainel(false);
    }
  }, [anotar]);

  /**
   * Abre o painel na disputa que o operador informou — número ou endereço colado.
   *
   * É o caminho que não depende de nada meu: nem da lista de disputas, nem do
   * reconhecimento de sessão. A sala abre, o robô lê o que está na tela e opera.
   */
  const abrirPainelDireto = useCallback(async () => {
    const alvo = disputaDireta.trim();
    if (!alvo) return;
    setErro("");
    setAbrindoPainel(true);
    try {
      setFontePainel(await criarFonteIpc(alvo));
    } catch (e) {
      anotar("alerta", `Painel direto: ${e instanceof Error ? e.message : String(e)}`);
      setAviso({
        titulo: "Não consegui abrir essa disputa",
        texto: "Confira o número da compra ou o endereço da sala e tente de novo."
      });
    } finally {
      setAbrindoPainel(false);
    }
  }, [disputaDireta, anotar]);

  const abrirPainelDeDisputa = useCallback(async () => {
    if (selecionada) return void abrirPainelComDisputa(selecionada);

    setErro("");
    setAbrindoPainel(true);
    try {
      const lista = await api().disputas.listar();
      setDisputas(lista);
      const vivas = lista.filter((d) => d.emFaseDeLances);

      if (vivas.length === 0) {
        // Texto curto, de produto. O detalhe técnico vai para o log de auditoria, que é
        // onde ele serve — no aviso ele só assusta quem está tentando trabalhar.
        anotar("sistema", `Painel: nenhuma disputa em fase de lances (${lista.length} na lista).`);
        setAviso({
          titulo: "Nenhuma disputa ao vivo",
          texto: "Nenhuma disputa sua está em fase de lances agora."
        });
        return;
      }
      if (vivas.length === 1) return void abrirPainelComDisputa(vivas[0]);

      setAviso({
        titulo: "Escolha a disputa",
        texto: `Há ${vivas.length} disputas suas em fase de lances agora. Em qual o robô deve operar?`,
        escolhas: vivas
      });
    } catch (e) {
      // O motivo técnico (sem token, sem captcha, sessão expirada) é registrado no log;
      // o operador vê uma frase.
      const detalhe = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(e);
      anotar("alerta", `Painel: ${detalhe}`);
      setAviso({
        titulo: "Nenhuma disputa ao vivo",
        texto: "Nenhuma disputa sua está em fase de lances agora."
      });
    } finally {
      setAbrindoPainel(false);
    }
  }, [selecionada, abrirPainelComDisputa, anotar]);

  // Enquanto o acesso ao gov.br acontece, a janela do portal fica oculta nos passos que
  // não são do operador. Esta etapa é o que a tela mostra no lugar.
  useEffect(() => {
    return api().comprasnet.aoProgresso((etapa) => setEtapaAcesso(etapa));
  }, []);

  // O painel pode parar sozinho — sala fechada pelo operador é o caso normal. Quando
  // isso acontece a tela volta para o cockpit e diz o motivo, em vez de congelar.
  useEffect(() => {
    return api().painel.aoEncerrar((motivo) => {
      setFontePainel(null);
      setAviso({ titulo: "O painel foi fechado", texto: primeiraMaiuscula(motivo) + "." });
    });
  }, []);

  const rodando = estadoRobo === "rodando";
  const pronto = calib?.pronto ?? false;
  const emLances = disputas.filter((d) => d.emFaseDeLances);
  const visiveis = soEmLances ? emLances : disputas;

  if (fontePainel) {
    return (
      <Painel
        fonte={fontePainel}
        aoVoltar={() => {
          fontePainel.encerrar();
          setFontePainel(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      {etapaAcesso && (
        <div className="modal-fundo">
          <div className="carregando">
            <div className="carregando-anel" />
            <h3 className="modal-titulo">
              {etapaAcesso === "concluindo" ? "Procurando disputas" : "Entre com seu CPF e senha"}
            </h3>
            <p className="muted" style={{ fontSize: 13, textAlign: "center", margin: 0 }}>
              {etapaAcesso === "concluindo"
                ? "Confirmando sua sessão e vendo se há disputa acontecendo agora."
                : "A janela do gov.br está aberta. Assim que você entrar, ela fecha sozinha."}
            </p>
          </div>
        </div>
      )}
      {aviso && (
        <div className="modal-fundo" onClick={() => setAviso(null)}>
          <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="modal-titulo">{aviso.titulo}</h3>
            <p className="muted" style={{ fontSize: 13 }}>{aviso.texto}</p>
            {aviso.escolhas && (
              <div className="list" style={{ maxHeight: 260 }}>
                {aviso.escolhas.map((d) => (
                  <button
                    key={`${d.pregaoId}-${d.itemNum}`}
                    className="dispute"
                    style={{ textAlign: "left" }}
                    onClick={() => void abrirPainelComDisputa(d)}
                  >
                    <div className="dispute-id">
                      {d.pregaoId}
                      {d.itemNum ? ` · item ${d.itemNum}` : ""}
                    </div>
                    <div className="dispute-desc">{d.descricao || d.situacao}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setAviso(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          LanceBot
        </div>
        <div className="row tight">
          <button
            className="btn primary"
            disabled={abrindoPainel}
            onClick={() => void abrirPainelDeDisputa()}
          >
            {abrindoPainel ? "Abrindo a sala…" : "Abrir painel de disputa"}
          </button>
          <button
            className="btn ghost"
            title="Ensaio com dados fictícios, para conhecer a tela sem disputa aberta."
            onClick={() => setFontePainel(criarDemonstracao())}
          >
            Ensaio
          </button>
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

            {!conectado && (
              <div className="row tight" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  disabled={diagnosticando}
                  onClick={() => {
                    setDiagnosticando(true);
                    void api().comprasnet.diagnostico()
                      .then((d) => { setDiag(d); setConectado(d.status.autenticado); setEvidencia(d.status.evidencia); })
                      .finally(() => setDiagnosticando(false));
                  }}
                >
                  {diagnosticando ? "Verificando…" : "Por que não reconheceu?"}
                </button>
              </div>
            )}

            {diag && (
              <div className="faint" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
                <div>
                  Pergunta ao portal (“quem está logado?”):{" "}
                  <b>{diag.api.ok ? "respondeu OK" : diag.api.status ? `HTTP ${diag.api.status}` : (diag.api.erro ?? "sem resposta")}</b>
                </div>
                <div>Cookies do portal encontrados: <b>{diag.status.cookiesEncontrados}</b></div>
                {/* A sessão do portal novo mora num token, não em cookie. É este o número
                    que diz se o aplicativo consegue falar com a API — e por isso ele vem
                    antes do resto do diagnóstico. */}
                <div>
                  Token da sessão (é ele que vale, não o cookie):{" "}
                  <b>
                    {diag.sessaoPortal?.temToken
                      ? `colhido há ${diag.sessaoPortal.idadeTokenS ?? 0}s`
                      : "ainda não apareceu — abra uma página do portal pelo aplicativo"}
                  </b>
                </div>
                <div>
                  Captcha recente (só as leituras precisam):{" "}
                  <b>
                    {diag.sessaoPortal?.temCaptcha
                      ? `sim, há ${diag.sessaoPortal.idadeCaptchaS ?? 0}s`
                      : "nenhum"}
                  </b>
                  {diag.sessaoPortal?.hostApi ? ` · API em ${diag.sessaoPortal.hostApi}` : ""}
                </div>
                <div>Endereço aprendido: <b>{diag.enderecosAprendidos.portal ?? "nenhum ainda"}</b></div>
                {diag.tentativasDeToken && diag.tentativasDeToken.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    Rotas tentadas para pegar o token:
                    {diag.tentativasDeToken.map((t, i) => (
                      <div key={i} style={{ paddingLeft: 8, opacity: 0.8 }}>
                        {t.metodo} {t.rota} → {t.status === 0 ? "sem resposta" : `HTTP ${t.status}`}
                      </div>
                    ))}
                  </div>
                )}
                {diag.chamadasDoPortal && diag.chamadasDoPortal.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    O que a página do portal chamou ({diag.chamadasDoPortal.length}):
                    {diag.chamadasDoPortal.slice(-12).map((c, i) => (
                      <div key={i} style={{ paddingLeft: 8, opacity: 0.8, wordBreak: "break-all" }}>
                        {c.metodo} {c.caminho}
                        {c.comAutorizacao ? " · com credencial" : ""}
                      </div>
                    ))}
                  </div>
                )}
                {diag.tentativas.map((t, i) => (
                  <div key={i} style={{ marginTop: 8, paddingLeft: 8, borderLeft: "2px solid #2b3444" }}>
                    <div style={{ wordBreak: "break-all" }}>{t.urlFinal || t.url}</div>
                    <div>{t.autenticado ? "✅ sessão reconhecida aqui" : `❌ ${t.motivo ?? "não reconhecida"}`}</div>
                    {t.sondagem && (
                      <div style={{ opacity: 0.75 }}>
                        no portal: {String(t.sondagem.noPortal)} · tem “Sair”: {String(t.sondagem.temSair)} ·
                        {" "}tem CPF/CNPJ: {String(t.sondagem.temIdentidade)} · campo de senha: {String(t.sondagem.temSenha)} ·
                        {" "}escolhendo perfil: {String(t.sondagem.escolhendoPerfil)} · texto: {t.sondagem.tamanho} car.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="card-head" style={{ marginTop: 18 }}>
              <h3 className="card-title" style={{ fontSize: 15 }}>Sessão mantida viva</h3>
              <span className={`pill ${guardiao?.ativo && guardiao.autenticado ? "ok" : "idle"}`}>
                <span className="dot" />
                {guardiao?.ativo ? (guardiao.autenticado ? "segurando" : "sessão caiu") : "solta"}
              </span>
            </div>

            <p className="muted">
              A sessão do gov.br cai em poucos minutos quando ninguém mexe na página — é por isso que no
              navegador você precisa atualizar o tempo todo. Aqui <strong>o aplicativo mantém a sessão de pé
              sozinho</strong>, numa janela oculta, sem tocar na sala onde o robô está operando. É o que
              permite deixá-lo ligado e sair de perto.
            </p>

            {guardiao && (
              <p className="faint">
                {guardiao.motivo}
                {guardiao.renovacoes > 0 && ` · ${guardiao.renovacoes} renovação(ões)`}
                {guardiao.retokensObservados > 0 && ` · ${guardiao.retokensObservados} token(s) renovado(s) pelo portal`}
              </p>
            )}

            <div className="row tight">
              <button
                className="btn"
                disabled={!conectado}
                onClick={() =>
                  void (guardiao?.ativo ? api().sessao.soltar() : api().sessao.manterViva()).then(setGuardiao)
                }
              >
                {guardiao?.ativo ? "Parar de manter a sessão" : "Manter a sessão viva"}
              </button>
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

            {/* Caminho direto: quando o aplicativo não consegue listar as disputas, o
                operador informa a disputa e o robô opera do mesmo jeito. Isto não
                depende de sessão reconhecida nem de leitura de lista. */}
            <div className="field">
              <label htmlFor="disputa-direta">Abrir direto: nº da compra ou endereço da sala</label>
              <div className="row tight">
                <input
                  id="disputa-direta"
                  className="input"
                  placeholder="90012/2026  ou  https://cnetmobile…/disputa?compra=…"
                  value={disputaDireta}
                  onChange={(e) => setDisputaDireta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && disputaDireta.trim()) void abrirPainelDireto();
                  }}
                />
                <button
                  className="btn"
                  disabled={!disputaDireta.trim() || abrindoPainel}
                  onClick={() => void abrirPainelDireto()}
                >
                  Abrir
                </button>
              </div>
            </div>

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
