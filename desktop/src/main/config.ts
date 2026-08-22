/**
 * Credenciais da plataforma HORASIS.
 *
 * A chave é a `publishable` do Supabase — o mesmo par que o aplicativo web já embute
 * no bundle do navegador. Ela é feita para ficar visível no cliente; quem protege os
 * dados é o RLS das tabelas, não o segredo da chave. Por isso ela mora aqui em vez de
 * exigir configuração de secret para cada build.
 *
 * Um build pode sobrescrever ambas via variável de ambiente, útil para apontar o
 * aplicativo a um projeto Supabase de teste.
 */

const PADRAO_URL = "https://cghlfhndoqohmrrvppjj.supabase.co";
const PADRAO_CHAVE = "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

export const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").trim() || PADRAO_URL;
export const SUPABASE_ANON_KEY = (process.env.VITE_SUPABASE_ANON_KEY || "").trim() || PADRAO_CHAVE;
