/**
 * Painel de disputa — a tela do produto.
 *
 * Lê `EstadoPainel` de uma `FontePainel` e devolve comandos. Não conhece portal, sessão
 * nem WebSocket: trocar a demonstração pelo cliente STOMP não encosta neste arquivo.
 *
 * Uma decisão de desenho que vale explicar: o "previsto" de cada item é calculado pelo
 * MESMO `decidir()` que vai enviar o lance. Não é estimativa para a tela — é o motor
 * respondendo "se eu tivesse que ofertar agora, seria isto". Se o piso recusa, o
 * operador lê a recusa antes de ligar o robô, não depois.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { paraMicro, paraNumero } from "../../main/bot/decimal.js";
import { decidir, type EstadoItem } from "../../main/bot/estrategias.js";
import {
  EXPLICACAO_MODO,
  NOMES_MODO,
  formatarReal,
  lerMoedaBR,
  type ConfigItem,
  type EstadoPainel,
  type FaseItem,
  type FontePainel,
  type ItemPainel,
  type LinhaClassificacao,
  type ModoDisputa
} from "../../compartilhado/painel.js";
import "./painel.css";

const ABAS: Array<{ id: FaseItem; rotulo: string }> = [
  { id: "aguardando", rotulo: "Aguardando disputa" },
  { id: "em-disputa", rotulo: "Em disputa" },
  { id: "encerrado", rotulo: "Encerrados" }
];

const MODOS = Object.keys(NOMES_MODO) as ModoDisputa[];

/** Roda o motor de verdade para mostrar ao operador o que sairia agora. */
function prever(item: ItemPainel): { texto: string; tom: "ok" | "alerta" | "neutro" } {
  if (item.config.pisoMinimo === null || item.config.pisoMinimo <= 0) {
    return { texto: "Informe o lance mínimo para ver o previsto.", tom: "neutro" };
  }
  const leitura: EstadoItem = {
    numero: item.numero,
    aceitaLance: item.aceitaLance,
    melhorValorGeral: item.melhorValor === null ? null : paraMicro(item.melhorValor),
    nossoMelhorValor: item.meuValor === null ? null : paraMicro(item.meuValor),
    variacaoMinimaMelhorLance: item.variacaoMinima === null ? null : paraMicro(item.variacaoMinima),
    variacaoMinimaFornecedor: null,
    permitirDizima: item.config.permitirDecimais || item.permitirDizima,
    segundosRestantes: item.segundosRestantes
  };
  const d = decidir(leitura, {
    modo: item.config.modo,
    pisoMinimo: item.config.pisoMinimo,
    passo: item.config.passoValor === null ? undefined : { tipo: item.config.passoTipo, valor: item.config.passoValor },
    margemPercentual: item.config.margemPercentual ?? undefined,
    valorFechado: item.config.valorFechado ?? undefined,
    janelaFinal: { ativo: item.config.somenteSegundosFinais, segundos: item.config.segundosJanela }
  });

  if (d.acao === "enviar") {
    return { texto: `Próximo lance: ${formatarReal(paraNumero(d.valor), d.casas)}`, tom: "ok" };
  }
  if (d.acao === "aguardar") return { texto: d.porque, tom: "neutro" };
  return { texto: d.porque, tom: "alerta" };
}

function Cronometro({ texto, segundos }: { texto: string | null; segundos: number | null }) {
  const urgente = segundos !== null && segundos <= 60;
  const critico = segundos !== null && segundos <= 15;
  return (
    <div className={`cron ${urgente ? "urgente" : ""} ${critico ? "critico" : ""}`}>
      <span className="cron-valor">{texto ?? "--:--:--"}</span>
      <span className="cron-rotulo">até o fim dos lances</span>
    </div>
  );
}

function CampoMoeda({
  rotulo,
  valor,
  casas,
  aoConfirmar,
  dica
}: {
  rotulo: string;
  valor: number | null;
  casas: number;
  aoConfirmar: (n: number | null) => void;
  dica?: string;
}) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const mostrado =
    rascunho !== null ? rascunho : valor === null ? "" : valor.toFixed(casas).replace(".", ",");
  const invalido = rascunho !== null && rascunho.trim() !== "" && lerMoedaBR(rascunho) === null;

  return (
    <label className="campo">
      <span className="campo-rotulo">
        {rotulo}
        {dica && <i className="dica" title={dica}>?</i>}
      </span>
      <input
        className={`campo-entrada ${invalido ? "invalido" : ""}`}
        inputMode="decimal"
        value={mostrado}
        placeholder="0,00"
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => {
          if (rascunho === null) return;
          const n = rascunho.trim() === "" ? null : lerMoedaBR(rascunho);
          if (rascunho.trim() !== "" && n === null) return; // mantém o texto para ele corrigir
          aoConfirmar(n);
          setRascunho(null);
        }}
      />
      {invalido && <span className="campo-erro">Valor não reconhecido.</span>}
    </label>
  );
}

function CartaoItem({
  item,
  aoConfigurar,
  aoArmar,
  aoDesarmar,
  aoPedirClassificacao
}: {
  item: ItemPainel;
  aoConfigurar: (m: Partial<ConfigItem>) => void;
  aoArmar: () => void;
  aoDesarmar: () => void;
  aoPedirClassificacao: () => void;
}) {
  const casas = item.config.permitirDecimais || item.permitirDizima ? 4 : 2;
  const previsto = useMemo(() => prever(item), [item]);
  const lidero = item.minhaPosicao === 1;

  return (
    <article className={`item ${item.armado ? "armado" : ""}`}>
      <header className="item-topo">
        <span className="item-num">{item.numero}</span>
        <h3 className="item-desc" title={item.descricao}>
          {item.descricao}
        </h3>
        {item.minhaPosicao !== null && (
          <span className={`selo ${lidero ? "selo-ok" : ""}`}>{lidero ? "1º lugar" : `${item.minhaPosicao}º`}</span>
        )}
        {item.armado && <span className="selo selo-ativo">ao vivo</span>}
      </header>

      <div className="metricas">
        <div className="metrica">
          <span className="metrica-rotulo">Melhor lance</span>
          <strong className="metrica-valor">{formatarReal(item.melhorValor, casas)}</strong>
        </div>
        <div className="metrica">
          <span className="metrica-rotulo">Meu lance</span>
          <strong className={`metrica-valor ${lidero ? "destaque" : ""}`}>{formatarReal(item.meuValor, casas)}</strong>
        </div>
        <div className="metrica">
          <span className="metrica-rotulo">Participantes</span>
          <strong className="metrica-valor">{item.participantes ?? "—"}</strong>
        </div>
        <div className="metrica">
          <span className="metrica-rotulo">Variação mín.</span>
          <strong className="metrica-valor">{formatarReal(item.variacaoMinima, casas)}</strong>
        </div>
      </div>

      {item.fase === "em-disputa" ? (
        <>
          <div className="config">
            <CampoMoeda
              rotulo="Lance mínimo (R$)"
              valor={item.config.pisoMinimo}
              casas={casas}
              dica="O robô nunca oferta abaixo deste valor."
              aoConfirmar={(n) => aoConfigurar({ pisoMinimo: n })}
            />
            <CampoMoeda
              rotulo="Intervalo mínimo"
              valor={item.config.passoValor}
              casas={item.config.passoTipo === "percentual" ? 2 : casas}
              dica="Quanto o robô desce por lance."
              aoConfirmar={(n) => aoConfigurar({ passoValor: n })}
            />
            <label className="campo estreito">
              <span className="campo-rotulo">Tipo</span>
              <select
                className="campo-entrada"
                value={item.config.passoTipo}
                onChange={(e) => aoConfigurar({ passoTipo: e.target.value as "fixo" | "percentual" })}
              >
                <option value="fixo">R$</option>
                <option value="percentual">%</option>
              </select>
            </label>
            <label className="campo largo">
              <span className="campo-rotulo">Modo de disputa</span>
              <select
                className="campo-entrada"
                value={item.config.modo}
                onChange={(e) => aoConfigurar({ modo: e.target.value as ModoDisputa })}
              >
                {MODOS.map((m) => (
                  <option key={m} value={m}>
                    {NOMES_MODO[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="explica">{EXPLICACAO_MODO[item.config.modo]}</p>

          {item.config.modo === "margem" && (
            <div className="config">
              <CampoMoeda
                rotulo="Margem (%)"
                valor={item.config.margemPercentual}
                casas={2}
                dica="Fica dentro desta faixa acima do melhor valor."
                aoConfirmar={(n) => aoConfigurar({ margemPercentual: n })}
              />
            </div>
          )}
          {item.config.modo === "fechado" && (
            <div className="config">
              <CampoMoeda
                rotulo="Valor do lance fechado"
                valor={item.config.valorFechado}
                casas={casas}
                aoConfirmar={(n) => aoConfigurar({ valorFechado: n })}
              />
            </div>
          )}

          <div className="opcoes">
            <label className="opcao">
              <input
                type="checkbox"
                checked={item.config.permitirDecimais}
                onChange={(e) => aoConfigurar({ permitirDecimais: e.target.checked })}
              />
              <span>
                Permitir lances em casas decimais
                <i className="sub">briga nos centavos até o seu piso</i>
              </span>
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={item.config.somenteSegundosFinais}
                onChange={(e) => aoConfigurar({ somenteSegundosFinais: e.target.checked })}
              />
              <span>
                Disputar apenas nos segundos finais
                <i className="sub">sem tempo legível, não oferta</i>
              </span>
            </label>
            {item.config.somenteSegundosFinais && (
              <label className="opcao-num">
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={item.config.segundosJanela}
                  onChange={(e) => aoConfigurar({ segundosJanela: Number(e.target.value) || 30 })}
                />
                <span>segundos finais</span>
              </label>
            )}
          </div>

          <div className={`previsto ${previsto.tom}`}>{previsto.texto}</div>
          {item.ultimaRecusa && <div className="previsto alerta">{item.ultimaRecusa}</div>}

          <footer className="item-acoes">
            {item.armado ? (
              <button className="bt bt-parar" onClick={aoDesarmar}>
                Desligar robô
              </button>
            ) : (
              <button className="bt bt-ligar" onClick={aoArmar}>
                Ligar robô neste item
              </button>
            )}
            <button className="bt bt-fantasma" onClick={aoPedirClassificacao}>
              Classificação
            </button>
          </footer>
        </>
      ) : (
        <p className="explica">
          {item.fase === "aguardando"
            ? "Item ainda não entrou em disputa. A configuração abre quando a fase de lances começar."
            : "Disputa encerrada para este item."}
        </p>
      )}
    </article>
  );
}

function Classificacao({
  numero,
  linhas,
  aoFechar
}: {
  numero: string;
  linhas: LinhaClassificacao[] | null;
  aoFechar: () => void;
}) {
  return (
    <div className="modal-fundo" onClick={aoFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-topo">
          <h3>Classificação — item {numero}</h3>
          <button className="bt bt-fantasma" onClick={aoFechar}>
            Fechar
          </button>
        </header>
        {linhas === null ? (
          <p className="explica">Carregando…</p>
        ) : linhas.length === 0 ? (
          <p className="explica">Nenhum lance registrado neste item ainda.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>#</th>
                <th>Fornecedor</th>
                <th className="dir">Valor</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={`${l.fornecedor}-${i}`} className={l.eu ? "eu" : ""}>
                  <td>{l.posicao}º</td>
                  <td>{l.fornecedor}</td>
                  <td className="dir">{formatarReal(l.valor, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="nota">
          É a ordem pelos lances que o portal mostra nesta tela — não é a classificação oficial do pregoeiro.
        </p>
      </div>
    </div>
  );
}

export default function Painel({ fonte, aoVoltar }: { fonte: FontePainel; aoVoltar?: () => void }) {
  const [estado, setEstado] = useState<EstadoPainel>(() => fonte.estadoAtual());
  const [aba, setAba] = useState<FaseItem>("em-disputa");
  const [classificacaoDe, setClassificacaoDe] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<LinhaClassificacao[] | null>(null);
  const fimChat = useRef<HTMLDivElement | null>(null);

  useEffect(() => fonte.assinar(setEstado), [fonte]);

  useEffect(() => {
    fimChat.current?.scrollIntoView({ block: "end" });
  }, [estado.chat.length]);

  useEffect(() => {
    if (classificacaoDe === null) return;
    setLinhas(null);
    let vivo = true;
    void fonte.comandos.classificacao(classificacaoDe).then((l) => vivo && setLinhas(l));
    return () => {
      vivo = false;
    };
  }, [classificacaoDe, fonte]);

  const contagem = useMemo(() => {
    const c: Record<FaseItem, number> = { aguardando: 0, "em-disputa": 0, encerrado: 0 };
    for (const i of estado.itens) c[i.fase]++;
    return c;
  }, [estado.itens]);

  const daAba = estado.itens.filter((i) => i.fase === aba);
  const { disputa } = estado;

  return (
    <div className="painel">
      <header className="painel-topo">
        <div className="identidade">
          <div className="linha-marca">
            <span className="ponto" />
            <strong>HORASIS LanceBot</strong>
            {disputa.origem === "demonstracao" && <span className="selo selo-demo">demonstração</span>}
            <span className={`selo selo-conexao ${disputa.conexao}`}>
              {disputa.conexao === "ligada" ? "portal conectado" : disputa.conexao === "instavel" ? "conexão instável" : "conexão caiu"}
            </span>
          </div>
          <h2 className="disputa-titulo">{disputa.identificada ? disputa.titulo : "Nenhuma disputa identificada"}</h2>
          <p className="disputa-org">
            {[disputa.uasg && `UASG ${disputa.uasg}`, disputa.orgao].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Cronometro texto={disputa.tempoRestante} segundos={disputa.segundosRestantes} />
        {aoVoltar && (
          <button className="bt bt-fantasma" onClick={aoVoltar}>
            Voltar
          </button>
        )}
      </header>

      <nav className="abas">
        {ABAS.map((a) => (
          <button
            key={a.id}
            className={`aba ${aba === a.id ? "ativa" : ""}`}
            onClick={() => setAba(a.id)}
          >
            {a.rotulo}
            <span className="aba-contagem">{contagem[a.id]}</span>
          </button>
        ))}
      </nav>

      <div className="painel-corpo">
        <main className="coluna-itens">
          {daAba.length === 0 ? (
            <p className="vazio">Nenhum item nesta fase.</p>
          ) : (
            daAba.map((i) => (
              <CartaoItem
                key={i.numero}
                item={i}
                aoConfigurar={(m) => fonte.comandos.configurar(i.numero, m)}
                aoArmar={() => fonte.comandos.armar(i.numero)}
                aoDesarmar={() => fonte.comandos.desarmar(i.numero)}
                aoPedirClassificacao={() => setClassificacaoDe(i.numero)}
              />
            ))
          )}
        </main>

        <aside className="coluna-lado">
          <section className="caixa">
            <h4 className="caixa-titulo">Chat da disputa</h4>
            <div className="chat">
              {estado.chat.length === 0 ? (
                <p className="vazio">Nada no chat ainda.</p>
              ) : (
                estado.chat.map((m, i) => (
                  <div key={i} className={`msg ${m.doPregoeiro ? "do-pregoeiro" : ""}`}>
                    <span className="msg-quem">{m.autor}</span>
                    <span className="msg-hora">{new Date(m.em).toLocaleTimeString("pt-BR")}</span>
                    <p className="msg-texto">{m.texto}</p>
                  </div>
                ))
              )}
              <div ref={fimChat} />
            </div>
          </section>

          <section className="caixa">
            <h4 className="caixa-titulo">Registro</h4>
            <div className="log">
              {estado.log.slice(-60).reverse().map((l, i) => (
                <div key={i} className={`log-linha ${l.nivel}`}>
                  <span className="log-hora">{new Date(l.em).toLocaleTimeString("pt-BR")}</span>
                  <span className="log-msg">{l.msg}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {classificacaoDe !== null && (
        <Classificacao numero={classificacaoDe} linhas={linhas} aoFechar={() => setClassificacaoDe(null)} />
      )}
    </div>
  );
}
