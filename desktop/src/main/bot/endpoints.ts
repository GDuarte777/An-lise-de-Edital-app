/**
 * Mapa de rotas do Compras.gov.br.
 *
 * Este arquivo substitui o "descobridor" que aprendia endpoints espiando a sala de
 * disputa. Não é mais necessário adivinhar: as rotas abaixo estão identificadas. O que
 * cada constante vale está marcado:
 *
 *   [confirmado]  visto em captura nossa de disputa real ou na análise do SIGA 0.7.4;
 *   [inferido]    deduzido do padrão das demais rotas — tratar como suspeito até a
 *                 primeira disputa de verdade.
 *
 * Nada aqui monta requisição. Só diz onde as coisas ficam.
 */

export type Ambiente = "producao" | "treinamento";

/** [confirmado] O portal de disputa é servido pelo SERPRO, não pelo comprasnet.gov.br. */
export const HOSTS: Record<Ambiente, string> = {
  producao: "https://cnetmobile.estaleiro.serpro.gov.br",
  treinamento: "https://tre-cnetmobile.estaleiro.serpro.gov.br"
};

/**
 * [confirmado] WebSocket STOMP da disputa.
 *
 * É a diferença de arquitetura que importa: o estado da disputa chega empurrado pelo
 * portal, em vez de ser perguntado em laço. Menos latência para nós e muito menos carga
 * para o portal — os dois lados ganham.
 */
export const WEBSOCKET = {
  caminho: "/comprasnet-websocket/socket/websocket",
  subprotocolos: ["v10.stomp", "v11.stomp", "v12.stomp"],
  versaoProtocolo: 13
} as const;

/** Sessão e identidade do fornecedor. */
export const SESSAO = {
  /** [confirmado] Responde 200 com a sessão viva; 401/403 quando caiu. Sem captcha. */
  usuario: "/comprasnet-usuario/v1/usuario",
  /** [confirmado] Renova o token antes de ele vencer. */
  renovarToken: "/comprasnet-usuario/v1/sessao/fornecedor/retoken"
} as const;

/**
 * Leituras da disputa.
 *
 * `exigeCaptcha: true` quer dizer que o portal só responde com um token de hCaptcha na
 * query. Esse é o ponto que define o desenho do produto — ver `captcha.ts`.
 */
export interface RotaLeitura {
  caminho: string;
  exigeCaptcha: boolean;
  confianca: "confirmado" | "inferido";
}

export const LEITURAS: Record<string, RotaLeitura> = {
  comprasEmDisputa: {
    caminho: "/comprasnet-disputa/v1/compras/em-disputa",
    exigeCaptcha: true,
    confianca: "confirmado"
  },
  itensAguardandoDisputa: {
    caminho: "/comprasnet-disputa/v1/compras/{compra}/itens/aguardando-disputa",
    exigeCaptcha: true,
    confianca: "confirmado"
  },
  itensDisputaEncerrada: {
    caminho: "/comprasnet-disputa/v1/compras/{compra}/itens/disputa-encerrada",
    exigeCaptcha: true,
    confianca: "confirmado"
  },
  lancesPorParticipante: {
    caminho: "/comprasnet-disputa/v1/compras/{compra}/itens/{item}/lances/por-participante",
    exigeCaptcha: true,
    confianca: "confirmado"
  },
  participacoes: {
    caminho: "/comprasnet-disputa/v1/compras/participacoes",
    exigeCaptcha: true,
    confianca: "confirmado"
  },
  emSelecaoFornecedores: {
    caminho: "/comprasnet-disputa/v1/compras/em-selecao-fornecedores",
    exigeCaptcha: true,
    confianca: "confirmado"
  },
  chat: {
    caminho: "/comprasnet-mensagem/v2/chat/{compra}",
    exigeCaptcha: true,
    confianca: "confirmado"
  },
  itensEmDisputa: {
    caminho: "/comprasnet-disputa/v1/compras/{compra}/itens/em-disputa",
    exigeCaptcha: true,
    confianca: "inferido"
  }
};

/**
 * [confirmado] Envio do lance.
 *
 * Detalhe que muda o projeto inteiro: este POST é autenticado por sessão/token e **não**
 * leva captcha. Quem é barrado por captcha é o laço de leitura. Ou seja: com o WebSocket
 * entregando o estado, a dependência de captcha cai para quase nada.
 */
export const ENVIO_LANCE = {
  metodo: "POST" as const,
  caminho: "/comprasnet-disputa/v1/compras/{compra}/itens/{item}/lances",
  /** Corpo: { valorInformado: "550.99", faseItem: <fase do item> }. */
  campos: { valor: "valorInformado", fase: "faseItem" },
  confianca: "confirmado" as const
};

/** Troca `{compra}` e `{item}` sem deixar passar valor vazio. */
export function montar(
  ambiente: Ambiente,
  caminho: string,
  params: { compra?: string; item?: string } = {}
): string {
  let resultado = caminho;
  for (const [chave, valor] of Object.entries(params)) {
    const marca = `{${chave}}`;
    if (!resultado.includes(marca)) continue;
    if (valor === undefined || valor === "") {
      throw new Error(`A rota ${caminho} exige "${chave}", e ele veio vazio.`);
    }
    resultado = resultado.split(marca).join(encodeURIComponent(valor));
  }
  const faltando = resultado.match(/\{(\w+)\}/);
  if (faltando) throw new Error(`A rota ${caminho} ficou com "${faltando[0]}" sem valor.`);
  return `${HOSTS[ambiente]}${resultado}`;
}
