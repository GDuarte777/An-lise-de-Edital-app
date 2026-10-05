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
  const base = String(apiBase || API_BASE_PADRAO).replace(/\/+$/, '');
  return base + '/api/apps/' + encodeURIComponent(appId) + '/functions/bidAssistant';
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    // ─── Salvar configuração (App ID, Token, ID do robô) ────────────────
    if (request.action === 'horasis_save_config') {
      const { appId, token, botId, purchaseId, apiBase } = request;
      if (!appId || !token) {
        sendResponse({ success: false, error: 'App ID e Token são obrigatórios.' });
        return false;
      }
      // O código da compra vem da URL da sala de disputa. Um valor fora do
      // formato significa que o popup foi usado na aba errada: gravar esse
      // vínculo faria o robô de uma compra responder por outra.
      if (purchaseId && !/^[0-9]{10,}$/.test(String(purchaseId))) {
        sendResponse({ success: false, error: 'Código da compra inválido. Abra a sala da disputa e tente novamente.' });
        return false;
      }
      chrome.storage.local.get(['hz_bot_by_compra'], (stored) => {
        const mapa = { ...(stored.hz_bot_by_compra || {}) };
        const update = { hz_app_id: appId, hz_token: token };
        if (apiBase) update.hz_api_base = String(apiBase).replace(/\/+$/, '');
        // Salvar só as credenciais não pode apagar o vínculo robô↔compra já
        // gravado: quem abre o popup para atualizar o token continua com os
        // robôs das outras abas intactos.
        if (purchaseId && botId) {
          mapa[String(purchaseId)] = String(botId).trim();
          update['hz_bot_compra_' + purchaseId] = String(botId).trim();
          update.hz_bot_by_compra = mapa;
        } else if (!purchaseId && botId) {
          update.hz_bot_id = botId;
        }
        chrome.storage.local.set(update, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ success: true, message: 'Configuração salva com sucesso.' });
        });
      });
      return true; // canal aberto para a resposta assíncrona do storage
    }

    // ─── Chamada ao assistente de lances ────────────────────────────────
    // O motor manda apenas `payload`: as credenciais e o endereço saem do
    // storage aqui dentro, então um content script comprometido pela página
    // do portal não teria como ler o token da conta.
    if (request.action === 'horasis_bid_assistant') {
      chrome.storage.local.get(['hz_api_base', 'hz_app_id', 'hz_token'], (cfg) => {
        const appId = cfg.hz_app_id;
        const token = cfg.hz_token;
        if (!appId || !token) {
          sendResponse({ ok: false, error: 'Extensão sem credenciais — abra o popup do HORASIS e salve App ID e Token.' });
          return;
        }
        const apiUrl = urlDoAssistente(cfg.hz_api_base, appId);

        // O Service Worker do Manifest V3 pode ser encerrado pelo Chrome no
        // meio de um fetch — com a página do portal em atividade alta isso
        // acontece e aparece como "Failed to fetch" sem causa visível. Três
        // tentativas com espera crescente cobrem essa reciclagem; o que falha
        // depois disso é falha de verdade e precisa chegar à tela.
        const tentar = (tentativa) => {
          fetch(apiUrl, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            headers: {
              'Authorization': 'Bearer ' + token,
              'apikey': CHAVE_PUBLICAVEL_PADRAO,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(request.payload || {})
          })
            .then((r) => r.text().then((texto) => {
              let dados;
              try {
                dados = JSON.parse(texto);
              } catch (e) {
                dados = { error: 'Resposta inválida do servidor: ' + texto.substring(0, 200) };
              }
              if (!r.ok) sendResponse({ ok: false, error: dados.error || ('HTTP ' + r.status) });
              else sendResponse({ ok: true, data: dados });
            }))
            .catch((err) => {
              if (tentativa < 2) setTimeout(() => tentar(tentativa + 1), 700 * (tentativa + 1));
              else sendResponse({ ok: false, error: err.message });
            });
        };
        tentar(0);
      });
      return true; // mantém o canal aberto para o fetch assíncrono
    }

    // Ação não reconhecida — devolver false libera o canal em vez de travá-lo.
    return false;
  } catch (e) {
    sendResponse({ success: false, ok: false, error: e.message });
    return false;
  }
});
