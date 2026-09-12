/**
 * Regra que decide se uma tela do portal representa um usuário autenticado.
 *
 * Mora sozinha, sem importar Electron, por dois motivos: é o ponto que este projeto já
 * publicou quebrado duas vezes — uma fechando a janela no meio do login, outra
 * declarando sessão que nunca existiu — e um módulo puro pode ser testado sem subir
 * aplicativo nenhum.
 */

export interface Sondagem {
  url: string;
  /** A página ainda está no SSO do gov.br (login, autorização, 2FA). */
  noSso: boolean;
  /** O host é do Compras.gov.br / Comprasnet, e não de um site qualquer. */
  noPortal: boolean;
  temSenha: boolean;
  temSair: boolean;
  temIdentidade: boolean;
  /** Tela intermediária de escolha de perfil: o login ainda não terminou aqui. */
  escolhendoPerfil: boolean;
  /** Tamanho do texto renderizado — separa SPA em branco de página pronta. */
  tamanho: number;
  /** O operador pediu para a janela não ser fechada. */
  manterAberta: boolean;
}

/**
 * Cookie não serve para responder isto: o portal cria cookie httpOnly na primeira
 * visita. A tela renderizada é o sinal honesto — quem está logado tem identidade ou
 * opção de sair, está num host do portal, e não tem campo de senha na frente.
 */
export function autenticadoPor(s: Sondagem | null): boolean {
  return porQueNao(s) === null;
}

/**
 * Por que esta tela NÃO conta como logada — ou `null` se conta.
 *
 * Existe para a interface poder mostrar ao operador o que o aplicativo enxergou. Sem
 * isso, "sem sessão" é uma parede: ele vê o próprio nome e CNPJ na tela e o programa
 * discorda, sem dizer em quê. Duas rodadas de correção foram gastas adivinhando isso.
 */
export function porQueNao(s: Sondagem | null): string | null {
  if (!s) return "O portal não respondeu à verificação.";
  if (s.noSso) return "A página ainda está no login do gov.br (sso.acesso.gov.br).";
  if (s.temSenha) return "A página tem campo de senha — é tela de login, não de usuário logado.";
  if (!s.noPortal) return `O endereço aberto não é do portal: ${s.url.slice(0, 90)}`;
  if (s.tamanho < 120) return "A página abriu praticamente vazia (SPA ainda carregando ou erro).";

  // A tela de escolha de perfil vem ANTES de o login terminar, então ela barra.
  //
  // Já pensei em afrouxar isto (aceitar quando houver CNPJ e "Sair" na tela), suspeitando
  // que a palavra "perfil" no menu do portal logado estivesse barrando sessão boa. Não
  // afrouxei: é hipótese, e afrouxar uma trava que existe para não declarar sessão
  // inexistente com base em suspeita é como este projeto já se quebrou antes. O
  // diagnóstico da interface mostra este campo ao operador — se for isto, aparece na
  // tela dele, e aí a correção vem com prova.
  if (s.escolhendoPerfil) {
    return "A página está pedindo escolha de perfil — o login ainda não terminou.";
  }

  if (!s.temSair && !s.temIdentidade) {
    return "A página abriu, mas não tem opção de sair nem identificação (CPF/CNPJ) visível.";
  }
  return null;
}
