import { DisputaRow } from "../types";

// ═══════════════════════════════════════════════════════════════════════
// O NÚMERO QUE APARECE NO CARTÃO DO KANBAN
//
// O cartão é estreito: cabe um valor, sem rótulo. Por isso ele mostrava o
// "nosso lance alvo" — e esse alvo, quando a análise não trouxe sugestão, é
// calculado como 90% do estimado (ver `nossoValorAlvo` em DisputasSheetTab).
// Resultado: o usuário lia no cartão um número que a plataforma inventou a
// partir de outro, achando que era o valor do certame.
//
// O cartão mostra o **valor estimado**, que é dado do certame. O alvo e o piso
// são estratégia nossa e continuam na grade e no formulário, onde têm rótulo.
//
// Sem valor estimado o cartão não cai para o alvo: mostra travessão. Trocar um
// valor que não veio da fonte por outro, calculado, é o tipo de preenchimento
// por suposição que esta plataforma não faz.
// ═══════════════════════════════════════════════════════════════════════

export const formatarBRL = (valor: number) =>
  (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Travessão: o campo está vazio na fonte, e vazio é o que se mostra. */
export const SEM_VALOR = "—";

export interface ValorDoCartao {
  /** O que vai impresso no cartão. */
  texto: string;
  /** Tooltip — é o que diz ao usuário QUAL valor ele está lendo. */
  titulo: string;
}

export function valorDoCartao(row: Pick<DisputaRow, "valorEstimadoItem">): ValorDoCartao {
  const estimado = Number(row?.valorEstimadoItem) || 0;

  if (estimado <= 0) {
    return { texto: SEM_VALOR, titulo: "Valor estimado não informado" };
  }

  return { texto: formatarBRL(estimado), titulo: `Valor estimado: ${formatarBRL(estimado)}` };
}
