// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Robô de Lances · Service Worker (Manifest V3)
//
// Este arquivo é o único ponto da extensão que conhece o endereço do backend.
// Os motores de disputa (dispute.js e licitanet-dispute.js) mandam apenas o
// corpo da chamada; quem monta a URL, acrescenta as credenciais e trata a
// repetição em caso de falha é este worker.
//
// O motivo é prático: um content script roda na origem do portal e está
// sujeito ao CSP e ao CORS da página do governo. O Service Worker roda na
// origem da própria extensão, onde `host_permissions` vale — então a chamada
// ao backend sai daqui e nunca da página.
//
// Todos os listeners ficam no topo do arquivo, fora de qualquer função async.
// É isso que faz o Chrome acordar o worker instantaneamente quando chega uma
// mensagem: um listener registrado dentro de uma promessa chega tarde demais e
// a mensagem se perde.
// ═══════════════════════════════════════════════════════════════════════

// Endereço padrão do backend da plataforma. Fica sobrescrevível em
// chrome.storage (hz_api_base) para apontar a extensão a um ambiente local
// (`supabase functions serve`) ou a um projeto de teste sem reempacotar nada.
const API_BASE_PADRAO = 'https://cghlfhndoqohmrrvppjj.supabase.co/functions/v1';

// Chave publicável do projeto. O gateway das Edge Functions do Supabase exige
// o cabeçalho `apikey` em toda chamada: sem ele a resposta é 401 antes mesmo
// de a função existir, e o corpo dessa resposta não é o JSON que o motor
// espera — o que apareceria na tela como "resposta inválida do servidor".
const CHAVE_PUBLICAVEL_PADRAO = 'sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o';

/** Monta a URL do assistente de lances para um App ID. */
function urlDoAssistente(apiBase, appId) {
  return urlDaApi(apiBase, '/api/apps/' + encodeURIComponent(appId) + '/functions/bidAssistant');
}

function urlDaApi(apiBase, caminho) {
  return String(apiBase || API_BASE_PADRAO).replace(/\/+$/, '') + caminho;
}

/**
 * Chamada autenticada ao backend, com as credenciais lidas do storage.
 *
 * Três tentativas com espera crescente: o Service Worker do Manifest V3 pode
 * ser encerrado pelo Chrome no meio de um fetch — com a página do portal em
 * atividade alta isso acontece e aparece como "Failed to fetch" sem causa
 * visível. O que falha depois disso é falha de verdade e precisa chegar à tela.
 */
function chamarBackend(caminhoOuUrl, metodo, corpo, responder) {
  chrome.storage.local.get(['hz_api_base', 'hz_app_id', 'hz_token'], (cfg) => {
    if (!cfg.hz_app_id || !cfg.hz_token) {
      responder({ ok: false, error: 'Extensão sem credenciais — cole o App ID e o Token acima e salve.' });
      return;
    }
    const url = typeof caminhoOuUrl === 'function'
      ? caminhoOuUrl(cfg.hz_api_base, cfg.hz_app_id)
      : urlDaApi(cfg.hz_api_base, caminhoOuUrl);

    const tentar = (tentativa) => {
      fetch(url, {
        method: metodo,
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Authorization': 'Bearer ' + cfg.hz_token,
          'apikey': CHAVE_PUBLICAVEL_PADRAO,
          'Content-Type': 'application/json'
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
      })
        .then((r) => r.text().then((texto) => {
          let dados;
          try {
            dados = JSON.parse(texto);
          } catch (e) {
            dados = { error: 'Resposta inválida do servidor: ' + texto.substring(0, 200) };
          }
          if (!r.ok) responder({ ok: false, error: dados.error || ('HTTP ' + r.status) });
          else responder({ ok: true, data: dados });
        }))
        .catch((err) => {
          if (tentativa < 2) setTimeout(() => tentar(tentativa + 1), 700 * (tentativa + 1));
          else responder({ ok: false, error: err.message });
        });
    };
    tentar(0);
  });
}

// Ao instalar ou atualizar, injeta o motor nas abas de disputa já abertas.
// Sem isso, quem já estava com a sala da disputa aberta precisaria recarregar
// a página para a extensão existir ali — justamente no pior momento possível.
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: ['https://cnetmobile.estaleiro.serpro.gov.br/*'] }, (tabs) => {
    if (!tabs) return;
    tabs.forEach((tab) => {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dispute.js'] }).catch(() => {});
    });
  });
  chrome.tabs.query({ url: ['https://portal.licitanet.com.br/*'] }, (tabs) => {
    if (!tabs) return;
    tabs.forEach((tab) => {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['licitanet-dispute.js'] }).catch(() => {});
    });
  });
});

// Clicar no ícone abre o painel lateral, não uma janelinha.
//
// O popup de ação do Chrome fecha sozinho ao perder o foco, e não há API que
// mude isso: qualquer clique na página do portal o fazia sumir no meio de uma
// configuração. O painel lateral fica aberto até o operador fechá-lo no ✕, e
// ainda convive lado a lado com a sala de disputa em vez de cobri-la.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    // ─── Salvar credenciais (App ID e Token) ────────────────────────────
    // Não há mais nada a guardar por compra: o robô de cada licitação é criado
    // pelo backend a partir do código que o motor lê da URL da sala de
    // disputa. Uma credencial vale para todas as abas, e abrir o popup para
    // trocar o token não mexe em disputa nenhuma em andamento.
    if (request.action === 'horasis_save_config') {
      const { appId, token, apiBase } = request;
      if (!appId || !token) {
        sendResponse({ success: false, error: 'App ID e Token são obrigatórios.' });
        return false;
      }
      const update = { hz_app_id: appId, hz_token: token };
      if (apiBase) update.hz_api_base = String(apiBase).replace(/\/+$/, '');
      chrome.storage.local.set(update, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ success: true, message: 'Configuração salva com sucesso.' });
      });
      return true; // canal aberto para a resposta assíncrona do storage
    }

    // ─── Chamada ao assistente de lances ────────────────────────────────
    // O motor manda apenas `payload`: as credenciais e o endereço saem do
    // storage aqui dentro, então um content script comprometido pela página
    // do portal não teria como ler o token da conta.
    if (request.action === 'horasis_bid_assistant') {
      chamarBackend(urlDoAssistente, 'POST', request.payload || {}, sendResponse);
      return true; // mantém o canal aberto para o fetch assíncrono
    }

    // ─── Configuração do robô ───────────────────────────────────────────
    // Ela é editada aqui, no popup, e não numa tela da plataforma: quem opera
    // o pregão está no navegador, com o portal aberto, e mandá-lo a outro
    // lugar para mudar o tempo de resposta é mandá-lo sair da disputa.
    if (request.action === 'horasis_perfil_ler') {
      chamarBackend('/api/robos/perfil', 'GET', undefined, sendResponse);
      return true;
    }

    if (request.action === 'horasis_perfil_salvar') {
      chamarBackend('/api/robos/perfil', 'POST', request.perfil || {}, sendResponse);
      return true;
    }

    // Ação não reconhecida — devolver false libera o canal em vez de travá-lo.
    return false;
  } catch (e) {
    sendResponse({ success: false, ok: false, error: e.message });
    return false;
  }
});
