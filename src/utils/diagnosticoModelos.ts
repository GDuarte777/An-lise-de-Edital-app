// ═══════════════════════════════════════════════════════════════════════
// O QUE A CHAVE DO USUÁRIO REALMENTE SERVE
//
// A aba "IA & Modelos" oferecia uma lista de modelos escrita à mão. Isso tirou
// a IA do ar três vezes: o Google aposenta um nome, a lista continua
// oferecendo, e escolher o nome morto faz a API responder 503 "sobrecarregado"
// — não 404. A indisponibilidade permanente se disfarça de pico passageiro, e
// a plataforma insiste nela até estourar o tempo.
//
// A correção é a lista vir de `/api/ai-status`, que pergunta ao próprio Google
// (ListModels) quais modelos a chave serve. Aqui fica só a parte sem rede:
// montar as opções do seletor e traduzir a resposta em uma frase. Módulo puro
// porque é o que esta suíte consegue testar — ver CLAUDE.md.
// ═══════════════════════════════════════════════════════════════════════

/** Limites do plano gratuito, que é a informação que de fato decide a escolha. */
const LIMITES: Array<{ casa: RegExp; nota: string }> = [
  { casa: /flash-lite/, nota: "leve e com folga — 15 req/min, 500/dia" },
  { casa: /flash/, nota: "equilibrado — 5 req/min, 20/dia" },
  { casa: /pro/, nota: "raciocínio avançado, mais lento" },
];

/** Lista usada enquanto o diagnóstico não rodou — ou quando ele não conseguiu responder. */
export const MODELOS_PADRAO = [
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

export interface OpcaoDeModelo {
  valor: string;
  rotulo: string;
}

export interface RespostaAiStatus {
  configured?: boolean;
  provider?: string;
  model?: string;
  modeloServidoPelaChave?: boolean | null;
  modelosDisponiveis?: string[] | null;
  cadeiaQueSeraUsada?: string[];
  message?: string;
  error?: string;
}

function nota(nome: string): string {
  const n = nome.toLowerCase();
  const achado = LIMITES.find((l) => l.casa.test(n));
  return achado ? achado.nota : "";
}

/**
 * Opções do seletor de modelo.
 *
 * Quando o diagnóstico trouxe a lista real, é ela que vale — sem nome morto.
 * Quando não trouxe (`null`), vale a lista padrão: é melhor oferecer algo do
 * que travar a tela. O modelo atualmente escolhido entra sempre, mesmo fora da
 * lista: sem isso o `<select>` perderia o valor gravado e trocaria a escolha do
 * usuário sem ele pedir.
 */
export function opcoesDeModelo(
  disponiveis: string[] | null | undefined,
  selecionado: string
): OpcaoDeModelo[] {
  const base = disponiveis && disponiveis.length > 0 ? disponiveis : MODELOS_PADRAO;
  const fora = selecionado && !base.includes(selecionado);

  const opcoes = base.map((valor) => {
    const n = nota(valor);
    return { valor, rotulo: n ? `${valor} (${n})` : valor };
  });

  if (fora) {
    const aviso = disponiveis && disponiveis.length > 0
      ? "sua chave NÃO serve este modelo"
      : "gravado nas suas configurações";
    opcoes.unshift({ valor: selecionado, rotulo: `${selecionado} (${aviso})` });
  }

  return opcoes;
}

export interface ResumoDiagnostico {
  nivel: "ok" | "aviso" | "erro";
  texto: string;
  /** Linhas extras, para a tela listar sem precisar formatar nada. */
  detalhes: string[];
}

/** Traduz a resposta de /api/ai-status em algo que a tela mostra direto. */
export function resumoDoDiagnostico(resposta: RespostaAiStatus | null | undefined): ResumoDiagnostico {
  if (!resposta) {
    return { nivel: "erro", texto: "Não foi possível falar com o servidor.", detalhes: [] };
  }
  if (resposta.error) {
    return { nivel: "erro", texto: resposta.error, detalhes: [] };
  }
  if (!resposta.configured) {
    return {
      nivel: "erro",
      texto: resposta.message || "Nenhuma chave de API configurada.",
      detalhes: [],
    };
  }

  const disponiveis = resposta.modelosDisponiveis;
  const cadeia = resposta.cadeiaQueSeraUsada || [];
  const detalhes: string[] = [];

  if (cadeia.length > 0) {
    detalhes.push(`Ordem de tentativa: ${cadeia.join(" → ")}`);
  }
  if (disponiveis && disponiveis.length > 0) {
    detalhes.push(`${disponiveis.length} modelos servidos por esta chave: ${disponiveis.join(", ")}`);
  }

  // `null` é diferente de lista vazia: significa que não deu para perguntar ao
  // Google (rede, cota, chave recusada). Dizer "nenhum modelo" nesse caso seria
  // inventar uma conclusão que o dado não sustenta.
  if (disponiveis == null) {
    return {
      nivel: "aviso",
      texto:
        `Chave de ${resposta.provider || "IA"} encontrada, mas não deu para perguntar ao provedor ` +
        `quais modelos ela serve. Pode ser rede, cota do minuto ou chave recusada — teste a IA e veja a mensagem.`,
      detalhes,
    };
  }

  if (resposta.modeloServidoPelaChave === false) {
    return {
      nivel: "aviso",
      texto:
        `Sua chave NÃO serve o modelo "${resposta.model}". ` +
        (cadeia.length > 0
          ? `A plataforma vai usar ${cadeia[0]} no lugar — escolha um da lista abaixo para deixar explícito.`
          : `E nenhum modelo alternativo foi encontrado nesta chave.`),
      detalhes,
    };
  }

  return {
    nivel: "ok",
    texto: `Chave válida e servindo "${resposta.model}".`,
    detalhes,
  };
}
