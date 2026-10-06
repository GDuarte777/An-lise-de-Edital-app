// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Robô de Lances · popup
//
// A tela de configuração. Ela não fala com o backend: entrega os dados ao
// Service Worker, que é quem grava e quem conhece o endereço da plataforma.
// ═══════════════════════════════════════════════════════════════════════

const HOST_COMPRASNET = 'cnetmobile.estaleiro.serpro.gov.br';
const HOST_LICITANET = 'portal.licitanet.com.br';

const elemento = (id) => document.getElementById(id);

function mostrarStatus(tipo, texto) {
  const alvo = elemento('status');
  alvo.style.display = 'block';
  alvo.className = 'status ' + tipo;
  alvo.textContent = texto;
}

function abaAtiva() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (abas) => resolve(abas && abas[0] ? abas[0] : null));
  });
}

/** Pergunta ao motor já injetado se ele está vivo nesta aba. */
function pingarMotor(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'horasis_dispute_status', open: true }, (resposta) => {
      resolve(chrome.runtime.lastError ? null : resposta);
    });
  });
}

/** Arquivo do motor correspondente ao portal aberto na aba. */
function motorDoPortal(url) {
  let host = '';
  try {
    host = new URL(url || '').hostname;
  } catch {
    return null;
  }
  if (host === HOST_COMPRASNET) return 'dispute.js';
  if (host === HOST_LICITANET) return 'licitanet-dispute.js';
  return null;
}

// ─── Salvar configuração ───────────────────────────────────────────────
elemento('save').addEventListener('click', async () => {
  const appId = elemento('appId').value.trim();
  const token = elemento('token').value.trim();
  const apiBase = elemento('apiBase').value.trim();

  if (!appId || !token) {
    mostrarStatus('err', 'Preencha App ID e Token.');
    return;
  }

  const aba = await abaAtiva();

  mostrarStatus('ok', 'Salvando…');

  chrome.runtime.sendMessage(
    { action: 'horasis_save_config', appId, token, apiBase },
    (resposta) => {
      if (chrome.runtime.lastError) {
        mostrarStatus('err', 'Erro: ' + chrome.runtime.lastError.message);
        return;
      }
      if (!resposta || !resposta.success) {
        mostrarStatus('err', 'Falha ao salvar: ' + ((resposta && resposta.error) || 'erro desconhecido'));
        return;
      }

      const motor = motorDoPortal(aba && aba.url);
      if (!motor) {
        mostrarStatus('ok', 'Configuração salva. Abra a sala de disputa do Comprasnet ou do Licitanet para o painel aparecer.');
        return;
      }

      mostrarStatus('ok', 'Configuração salva. Ativando o motor nesta aba…');
      ativarMotor(aba.id, motor, true);
    }
  );
});

// ─── Abrir o painel da disputa ─────────────────────────────────────────
// Não basta mandar abrir: o motor pode nunca ter sido injetado nesta aba (ela
// já estava aberta quando a extensão foi instalada). Por isso primeiro se
// confirma que ele responde, e só então se injeta.
elemento('openDispute').addEventListener('click', async () => {
  const aba = await abaAtiva();
  const motor = motorDoPortal(aba && aba.url);
  if (!motor) {
    mostrarStatus('err', 'Abra a aba da disputa (Comprasnet ou Licitanet) antes de usar este botão.');
    return;
  }
  mostrarStatus('ok', 'Verificando o painel nesta aba…');
  ativarMotor(aba.id, motor, false);
});

async function ativarMotor(tabId, arquivo, fecharAoFim) {
  let resposta = await pingarMotor(tabId);
  if (!resposta) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [arquivo] });
    } catch (erro) {
      mostrarStatus('err', 'Falha ao iniciar o motor: ' + (erro.message || String(erro)));
      return;
    }
    // O motor monta o painel depois de ler a página; perguntar uma única vez
    // devolveria "não iniciou" para um motor que estava apenas carregando.
    for (let tentativa = 0; tentativa < 6 && !(resposta && resposta.ok); tentativa++) {
      await new Promise((r) => setTimeout(r, 500));
      resposta = await pingarMotor(tabId);
    }
  }

  if (resposta && resposta.ok) {
    mostrarStatus('ok', 'Painel ativo nesta compra. Feche este menu para vê-lo.');
    if (fecharAoFim) setTimeout(() => window.close(), 700);
  } else {
    mostrarStatus('err', 'O motor não iniciou. Recarregue a página (F5) e tente novamente.');
  }
}

// ─── Carregar o que já está salvo ──────────────────────────────────────
// Só credenciais: o robô de cada compra é criado pelo backend a partir do
// código da compra que o motor lê da própria URL da sala de disputa.
(async () => {
  const dados = await chrome.storage.local.get(['hz_app_id', 'hz_token', 'hz_api_base']);
  if (dados.hz_app_id) elemento('appId').value = dados.hz_app_id;
  if (dados.hz_token) elemento('token').value = dados.hz_token;
  if (dados.hz_api_base) elemento('apiBase').value = dados.hz_api_base;
})();
