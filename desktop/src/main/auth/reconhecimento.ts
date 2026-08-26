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
  if (!s) return false;
  if (s.noSso || s.temSenha) return false;
  if (!s.noPortal) return false;
  if (s.escolhendoPerfil) return false;
  if (s.tamanho < 120) return false;
  return s.temSair || s.temIdentidade;
}
