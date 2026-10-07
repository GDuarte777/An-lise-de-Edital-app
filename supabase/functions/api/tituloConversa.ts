// ═══════════════════════════════════════════════════════════════════════
// TÍTULO DE CONVERSA, SEM GASTAR IA
//
// A rota /api/chat/title disparava uma cadeia de IA inteira, em paralelo com a
// mensagem que o usuário estava esperando. O limite que aperta no plano
// gratuito do Gemini é o de requisições POR MINUTO — 5 no Flash — então o
// rótulo da conversa consumia metade do orçamento do minuto para produzir três
// palavras que ninguém pediu, e ainda ajudava a provocar o 429 que atrasava a
// resposta de verdade.
//
// A primeira pergunta do usuário já diz do que a conversa trata.
// ═══════════════════════════════════════════════════════════════════════

/** Deriva um título de conversa a partir da primeira pergunta, sem IA. */
export function titularConversa(mensagem: string): string {
  const limpo = String(mensagem || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}]+/u, "")
    .trim();

  if (!limpo) return "Nova Conversa";

  // Saudação sozinha não descreve conversa nenhuma. A comparação é feita sobre o
  // texto já sem pontuação: "Olá, tudo bem?" tem vírgula e interrogação no meio,
  // e um \b depois de letra acentuada não é fronteira de palavra em JavaScript —
  // a checagem ingênua deixava passar justamente a saudação mais comum.
  const semPontuacao = limpo.replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const SAUDACOES = /^(ol[áa]|oi|bom dia|boa tarde|boa noite|tudo bem|tudo bom|e a[íi]|hey|opa)( |$)/;
  if (SAUDACOES.test(semPontuacao) && semPontuacao.length <= 30) {
    return "Conversa Rápida";
  }

  // Palavras curtas de ligação não entram no rótulo.
  const vazias = new Set(["de","da","do","das","dos","e","o","a","os","as","um","uma","para","por","com","em","no","na","que","qual","quais","me","meu","minha","se","sobre"]);
  const palavras = limpo.split(" ").filter((p) => p.length > 0);
  const escolhidas: string[] = [];
  for (const p of palavras) {
    // "/" e "." ficam: número de processo ("90012/2026") e versão de norma
    // ("14.133") são exatamente o que identifica a conversa para quem trabalha
    // com licitação — removê-los transformava 90012/2026 em 900122026.
    const base = p.toLowerCase().replace(/[^\p{L}\p{N}/.\-]/gu, "");
    if (!base) continue;
    if (escolhidas.length > 0 && vazias.has(base)) continue;
    escolhidas.push(base.charAt(0).toUpperCase() + base.slice(1));
    if (escolhidas.length >= 4) break;
  }

  const titulo = escolhidas.join(" ").slice(0, 50).trim();
  return titulo || "Nova Conversa";
}
