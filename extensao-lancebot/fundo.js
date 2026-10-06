/**
 * Service worker da extensão — quem fala com a plataforma HORASIS.
 *
 * Por que o login não pode sair do content script: no Manifest V3 um `fetch` para outro
 * domínio, feito de dentro da página, obedece ao CORS e ao CSP DAQUELA página. O
 * `host_permissions` não muda isso — no MV2 mudava, no MV3 não. A página do Comprasnet
 * restringe `connect-src`, então a chamada ao Supabase morria antes de sair, e o painel
 * só via "erro". Aqui, no service worker, a requisição tem os privilégios da extensão.
 *
 * A SENHA passa por aqui e não é guardada em lugar nenhum: vai na requisição e é
 * descartada. O que fica em `chrome.storage.local` é o token devolvido pelo Supabase.
 */
const URL_BASE = "https://cghlfhndoqohmrrvppjj.supabase.co";
const CHAVE_PUB = "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";
const CHAVE_SESSAO = "horasis.sessao";

const guardar = (v) => chrome.storage.local.set({ [CHAVE_SESSAO]: v });
const lido = () => chrome.storage.local.get(CHAVE_SESSAO).then((x) => (x && x[CHAVE_SESSAO]) || null);
const apagar = () => chrome.storage.local.remove(CHAVE_SESSAO);

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

const daResposta = (email, d) => ({
  email: (d.user && d.user.email) || email,
  token: d.access_token,
  renovacao: d.refresh_token || "",
  expiraEm: Date.now() + (Number(d.expires_in) || 3600) * 1000
});

async function entrar(email, senha) {
  const e = String(email || "").trim();
  if (!e || !senha) return { ok: false, erro: "Informe e-mail e senha da sua conta HORASIS." };

  let r;
  try {
    r = await pedir("/token?grant_type=password", { email: e, password: String(senha) });
  } catch (erro) {
    // Falha de rede é dita como falha de rede. Chamar isso de "senha errada" mandaria o
    // operador tentar de novo a coisa certa, para sempre.
    return { ok: false, erro: `Não consegui falar com a plataforma: ${erro && erro.message ? erro.message : "sem resposta"}.` };
  }

  if (!r.ok || !r.dados || !r.dados.access_token) {
    const msg = (r.dados && (r.dados.error_description || r.dados.msg || r.dados.message || r.dados.error)) || "";
    if (r.status === 400 && /invalid.*(login|grant|credential)/i.test(msg)) {
      return { ok: false, erro: "E-mail ou senha incorretos." };
    }
    // Mostra o que o servidor de fato respondeu — sem isso o operador fica no escuro.
    return { ok: false, erro: msg ? `${msg} (HTTP ${r.status})` : `A plataforma recusou o login (HTTP ${r.status}).` };
  }

  const sessao = daResposta(e, r.dados);
  await guardar(sessao);
  return { ok: true, sessao };
}

async function renovar(s) {
  if (!s || !s.renovacao) return null;
  let r;
  try { r = await pedir("/token?grant_type=refresh_token", { refresh_token: s.renovacao }); }
  catch (e) { return null; }
  if (!r.ok || !r.dados || !r.dados.access_token) return null;
  const nova = daResposta(s.email, r.dados);
  nova.renovacao = r.dados.refresh_token || s.renovacao;
  await guardar(nova);
  return nova;
}

/**
 * A sessão que vale agora, ou `null`. Renova sozinha faltando cinco minutos — para não
 * cair no meio de uma disputa. Sessão vencida NÃO conta como válida.
 */
async function sessaoAtual() {
  const s = await lido();
  if (!s || !s.token) return null;
  if (s.expiraEm && s.expiraEm - Date.now() < 5 * 60 * 1000) {
    const nova = await renovar(s);
    if (nova) return nova;
    if (s.expiraEm <= Date.now()) { await apagar(); return null; }
  }
  return s;
}

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (!msg || msg.alvo !== "horasis") return false;
  const acoes = {
    entrar: () => entrar(msg.email, msg.senha),
    sessao: () => sessaoAtual().then((s) => ({ ok: Boolean(s), sessao: s })),
    sair: () => apagar().then(() => ({ ok: true }))
  };
  const f = acoes[msg.acao];
  if (!f) return false;
  f().then(responder).catch((e) => responder({ ok: false, erro: String((e && e.message) || e) }));
  return true;   // resposta assíncrona
});
