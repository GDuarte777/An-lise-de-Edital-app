/**
 * Login da plataforma HORASIS — a porta da extensão.
 *
 * A extensão só opera para quem tem conta na plataforma. A autenticação é a mesma do
 * aplicativo web (Supabase), feita direto contra a API de auth com a chave publishable —
 * a mesma que o site já embute no bundle do navegador. Ela é feita para ficar visível no
 * cliente; quem protege os dados é o RLS das tabelas, não o segredo da chave.
 *
 * A SENHA não é guardada em lugar nenhum: vai na requisição de login e é descartada. O
 * que fica em `chrome.storage.local` é o token devolvido pelo Supabase, e ele é apagado
 * ao sair.
 */
(() => {
  const URL_BASE = "https://cghlfhndoqohmrrvppjj.supabase.co";
  const CHAVE_PUB = "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";
  const CHAVE_SESSAO = "horasis.sessao";

  const guardar = (v) =>
    new Promise((r) => { try { chrome.storage.local.set({ [CHAVE_SESSAO]: v }, r); } catch (e) { r(); } });

  const lido = () =>
    new Promise((r) => {
      try { chrome.storage.local.get(CHAVE_SESSAO, (x) => r((x && x[CHAVE_SESSAO]) || null)); }
      catch (e) { r(null); }
    });

  async function pedir(caminho, corpo) {
    const res = await fetch(`${URL_BASE}/auth/v1${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CHAVE_PUB, Authorization: `Bearer ${CHAVE_PUB}` },
      body: JSON.stringify(corpo)
    });
    let dados = null;
    try { dados = await res.json(); } catch (e) { /* resposta sem json */ }
    return { status: res.status, ok: res.ok, dados };
  }

  /** Entrar com e-mail e senha da plataforma. */
  async function entrar(email, senha) {
    if (!email || !senha) return { ok: false, erro: "Informe e-mail e senha da sua conta HORASIS." };
    let r;
    try {
      r = await pedir("/token?grant_type=password", { email: String(email).trim(), password: String(senha) });
    } catch (e) {
      return { ok: false, erro: "Não consegui falar com a plataforma. Confira sua internet." };
    }

    if (!r.ok || !r.dados || !r.dados.access_token) {
      const msg = (r.dados && (r.dados.error_description || r.dados.msg || r.dados.message)) || "";
      return {
        ok: false,
        erro: r.status === 400 ? "E-mail ou senha incorretos." : (msg || `A plataforma recusou o login (HTTP ${r.status}).`)
      };
    }

    const sessao = {
      email: (r.dados.user && r.dados.user.email) || String(email).trim(),
      token: r.dados.access_token,
      renovacao: r.dados.refresh_token || "",
      expiraEm: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000
    };
    await guardar(sessao);
    return { ok: true, sessao };
  }

  /** Renova o token quando está perto de vencer, para não cair no meio de uma disputa. */
  async function renovar(sessao) {
    if (!sessao || !sessao.renovacao) return null;
    let r;
    try { r = await pedir("/token?grant_type=refresh_token", { refresh_token: sessao.renovacao }); }
    catch (e) { return null; }
    if (!r.ok || !r.dados || !r.dados.access_token) return null;

    const nova = {
      email: sessao.email,
      token: r.dados.access_token,
      renovacao: r.dados.refresh_token || sessao.renovacao,
      expiraEm: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000
    };
    await guardar(nova);
    return nova;
  }

  /**
   * A sessão que vale agora, ou `null`.
   *
   * Renova sozinha quando falta menos de cinco minutos. Uma sessão vencida NÃO conta
   * como válida: a extensão é para quem tem conta, e "venceu enquanto eu operava" não
   * pode virar acesso aberto.
   */
  async function sessaoAtual() {
    let s = await lido();
    if (!s || !s.token) return null;
    if (s.expiraEm && s.expiraEm - Date.now() < 5 * 60 * 1000) {
      const nova = await renovar(s);
      if (nova) return nova;
      if (s.expiraEm <= Date.now()) { await sair(); return null; }
    }
    return s;
  }

  async function sair() {
    try { await new Promise((r) => chrome.storage.local.remove(CHAVE_SESSAO, r)); } catch (e) { /* fora da extensão */ }
  }

  const api = { entrar, sair, sessaoAtual, renovar, CHAVE_SESSAO, URL_BASE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : globalThis).__horasisAuth = api;
})();
