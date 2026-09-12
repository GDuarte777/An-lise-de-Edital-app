/**
 * Login da plataforma HORASIS, lado da página.
 *
 * Só conversa: quem fala com o Supabase é o service worker (`fundo.js`). No Manifest V3
 * um `fetch` cross-origin feito daqui obedece ao CSP da página do Comprasnet, e morre
 * antes de sair — foi exatamente por isso que o login falhava.
 *
 * A senha atravessa por mensagem e não é guardada em lugar nenhum.
 */
(() => {
  const CHAVE_SESSAO = "horasis.sessao";

  const falarComFundo = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ alvo: "horasis", ...msg }, (r) => {
          const e = chrome.runtime.lastError;
          if (e) return resolve({ ok: false, erro: `A extensão não respondeu: ${e.message}. Recarregue a página.` });
          resolve(r || { ok: false, erro: "A extensão não respondeu." });
        });
      } catch (e) {
        resolve({ ok: false, erro: `A extensão não respondeu: ${(e && e.message) || e}` });
      }
    });

  const temFundo = () => {
    try { return Boolean(chrome && chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.id); }
    catch (e) { return false; }
  };

  async function entrar(email, senha) {
    if (!email || !senha) return { ok: false, erro: "Informe e-mail e senha da sua conta HORASIS." };
    if (!temFundo()) return { ok: false, erro: "A extensão não está ativa nesta aba. Recarregue a página." };
    const r = await falarComFundo({ acao: "entrar", email, senha });
    return r.ok ? { ok: true, sessao: r.sessao } : { ok: false, erro: r.erro || "Não foi possível entrar." };
  }

  async function sessaoAtual() {
    if (!temFundo()) return null;
    const r = await falarComFundo({ acao: "sessao" });
    return r && r.ok && r.sessao ? r.sessao : null;
  }

  async function sair() {
    if (temFundo()) await falarComFundo({ acao: "sair" });
  }

  const api = { entrar, sair, sessaoAtual, CHAVE_SESSAO };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : globalThis).__horasisAuth = api;
})();
