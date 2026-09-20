import { Certificate } from "../types";

// ═══════════════════════════════════════════════════════════════════════
// REGRAS DA GESTÃO DE CERTIDÕES
//
// Ficam fora do componente por um motivo concreto: a decisão "esta certidão
// pode ser baixada?" estava escrita duas vezes na tela (na lista em cartões e
// na tabela), como `cert.fileBase64 && <Botão/>`. Quando a condição era falsa,
// as duas simplesmente não mostravam nada — nem botão, nem explicação — e o
// usuário via umas certidões com opção de baixar e outras sem, sem saber por
// quê. Regra duplicada em dois lugares é regra que diverge; aqui ela existe
// uma vez só e tem teste.
// ═══════════════════════════════════════════════════════════════════════

/**
 * O que a interface pode oferecer para o arquivo de uma certidão.
 *
 * `sem_conteudo` é o caso que estava invisível: a certidão foi marcada como
 * enviada, mas o conteúdo do arquivo não está guardado. Acontece com tudo que
 * foi anexado antes de a plataforma passar a armazenar o arquivo (as colunas
 * file_base64/file_mime_type são posteriores), e também quando a gravação do
 * conteúdo falhou. O registro existe, o arquivo não.
 */
export type EstadoArquivo = "sem_arquivo" | "baixavel" | "sem_conteudo";

export function estadoArquivoCertidao(cert: Pick<Certificate, "fileUploaded" | "fileBase64">): EstadoArquivo {
  // Conteúdo guardado vale mais que a marca de "enviado": uma certidão com
  // arquivo é baixável mesmo que a flag não tenha sido atualizada.
  if (cert?.fileBase64) return "baixavel";
  if (cert?.fileUploaded) return "sem_conteudo";
  return "sem_arquivo";
}

/** Frase que explica ao usuário por que não há o que baixar. */
export function explicacaoArquivoIndisponivel(cert: Pick<Certificate, "fileName">): string {
  const nome = cert?.fileName ? `"${cert.fileName}" ` : "";
  return (
    `O arquivo ${nome}foi registrado, mas o conteúdo não está guardado na plataforma — ` +
    "isso acontece com anexos enviados antes de a plataforma passar a armazenar o documento. " +
    "Reenvie o arquivo para poder baixá-lo quando precisar."
  );
}

// ─────────────────────────── validação do formulário ───────────────────────────

export interface DadosFormularioCertidao {
  name: string;
  emissionDate: string;
  expirationDate: string;
  notes?: string;
}

/** Erros por campo; objeto vazio significa formulário válido. */
export type ErrosFormularioCertidao = Partial<Record<"name" | "emissionDate" | "expirationDate", string>>;

/** Interpreta "AAAA-MM-DD" como dia local, sem o deslocamento de fuso do parser nativo. */
function parseDataLocal(valor: string): Date | null {
  const m = String(valor || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Valida o formulário de criação/edição.
 *
 * Só recusa o que é inequivocamente errado. Data de vencimento no passado, por
 * exemplo, NÃO é erro: cadastrar uma certidão vencida para depois renová-la é
 * exatamente o que o usuário precisa fazer, e bloquear isso o obrigaria a
 * mentir a data para conseguir salvar.
 */
export function validarFormularioCertidao(dados: DadosFormularioCertidao): ErrosFormularioCertidao {
  const erros: ErrosFormularioCertidao = {};

  if (!dados.name || !dados.name.trim()) {
    erros.name = "Informe o nome da certidão.";
  }

  const emissao = parseDataLocal(dados.emissionDate);
  const vencimento = parseDataLocal(dados.expirationDate);

  if (dados.emissionDate && !emissao) erros.emissionDate = "Data de emissão inválida.";
  if (dados.expirationDate && !vencimento) erros.expirationDate = "Data de vencimento inválida.";

  // A ordem entre as duas datas é a única regra cruzada que sempre vale.
  if (emissao && vencimento && vencimento.getTime() < emissao.getTime()) {
    erros.expirationDate = "O vencimento não pode ser anterior à emissão.";
  }

  return erros;
}

export function formularioCertidaoValido(dados: DadosFormularioCertidao): boolean {
  return Object.keys(validarFormularioCertidao(dados)).length === 0;
}

// ─────────────────────────── prévia do vencimento ───────────────────────────

export interface PreviaVencimento {
  tom: "neutro" | "valido" | "atencao" | "vencido";
  texto: string;
  dias: number | null;
}

/**
 * Traduz a data digitada em uma frase, enquanto o usuário preenche.
 *
 * A tela mostrava a data crua e o veredito só aparecia depois de salvar. Quem
 * digita "30/09" não calcula de cabeça que faltam 10 dias — e o prazo é o
 * único dado que realmente importa numa certidão.
 *
 * @param hoje injetável para manter os testes estáveis.
 */
export function previaVencimento(expirationDate: string, hoje: Date = new Date()): PreviaVencimento {
  const vencimento = parseDataLocal(expirationDate);
  if (!vencimento) {
    return { tom: "neutro", texto: "Sem data de vencimento — a certidão não entra no controle de prazos.", dias: null };
  }

  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.ceil((vencimento.getTime() - inicioHoje.getTime()) / 86400000);
  const formatada = vencimento.toLocaleDateString("pt-BR");

  if (dias < 0) {
    return { tom: "vencido", texto: `Vencida desde ${formatada} (${Math.abs(dias)} dia(s)).`, dias };
  }
  if (dias === 0) {
    return { tom: "atencao", texto: `Vence hoje (${formatada}).`, dias };
  }
  if (dias <= 15) {
    return { tom: "atencao", texto: `Vence em ${dias} dia(s), em ${formatada}.`, dias };
  }
  return { tom: "valido", texto: `Válida por mais ${dias} dia(s), até ${formatada}.`, dias };
}
