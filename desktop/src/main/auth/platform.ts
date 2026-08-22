import { safeStorage } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Login na plataforma HORASIS (Supabase), que libera o uso do aplicativo e dá acesso
 * às configurações do operador.
 *
 * Diferente do Compras.gov.br, aqui a credencial é da própria plataforma, então o app
 * pode tratá-la — mas o refresh token só vai para disco cifrado pelo SO
 * (DPAPI no Windows, Keychain no macOS, libsecret no Linux). Se a cifra não estiver
 * disponível, nada é gravado: a sessão dura o tempo do processo.
 */

export interface UsuarioPlataforma {
  id: string;
  email: string;
}

export class AutenticacaoPlataforma {
  private cliente: SupabaseClient | null = null;
  private usuario: UsuarioPlataforma | null = null;

  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseAnonKey: string,
    private readonly caminhoSessao: string
  ) {}

  private obterCliente(): SupabaseClient {
    if (!this.supabaseUrl || !this.supabaseAnonKey) {
      throw new Error(
        "Plataforma não configurada: defini VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no build do aplicativo."
      );
    }
    if (!this.cliente) {
      this.cliente = createClient(this.supabaseUrl, this.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: true }
      });
    }
    return this.cliente;
  }

  get usuarioAtual(): UsuarioPlataforma | null {
    return this.usuario;
  }

  async entrar(email: string, senha: string): Promise<UsuarioPlataforma> {
    const { data, error } = await this.obterCliente().auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error(`Não foi possível entrar na plataforma: ${error.message}`);
    if (!data.user || !data.session) throw new Error("A plataforma não retornou uma sessão válida.");

    this.usuario = { id: data.user.id, email: data.user.email ?? email };
    await this.guardarSessao(data.session.refresh_token);
    return this.usuario;
  }

  /** Tenta restaurar a sessão anterior. Retorna null quando não há sessão utilizável. */
  async restaurarSessao(): Promise<UsuarioPlataforma | null> {
    const refreshToken = await this.lerSessao();
    if (!refreshToken) return null;

    const { data, error } = await this.obterCliente().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.user || !data.session) {
      await this.descartarSessao();
      return null;
    }

    this.usuario = { id: data.user.id, email: data.user.email ?? "" };
    await this.guardarSessao(data.session.refresh_token);
    return this.usuario;
  }

  async sair(): Promise<void> {
    try {
      await this.obterCliente().auth.signOut();
    } catch {
      // Sessão remota já pode ter expirado; o que importa é limpar o lado local.
    }
    this.usuario = null;
    await this.descartarSessao();
  }

  private async guardarSessao(refreshToken: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[auth] Cifra do sistema indisponível — a sessão não será mantida entre execuções.");
      return;
    }
    const cifrado = safeStorage.encryptString(refreshToken);
    await mkdir(dirname(this.caminhoSessao), { recursive: true });
    await writeFile(this.caminhoSessao, cifrado);
  }

  private async lerSessao(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const cifrado = await readFile(this.caminhoSessao);
      return safeStorage.decryptString(cifrado);
    } catch {
      return null;
    }
  }

  private async descartarSessao(): Promise<void> {
    try {
      await writeFile(this.caminhoSessao, Buffer.alloc(0));
    } catch {
      // Arquivo pode não existir — nada a fazer.
    }
  }
}

export function caminhoPadraoSessao(userDataDir: string): string {
  return join(userDataDir, "sessao-plataforma.bin");
}
