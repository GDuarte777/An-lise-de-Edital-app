// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Robô de Lances · popup
//
// A tela de configuração. Ela não fala com o backend: entrega os dados ao
// Service Worker, que é quem grava e quem conhece o endereço da plataforma.
// ═══════════════════════════════════════════════════════════════════════

const HOST_COMPRASNET = 'cnetmobile.estaleiro.serpro.gov.br';
const HOST_LICITANET = 'portal.licitanet.com.br';

const elemento = (id) => document.getElementById(id);

function mostrarStatus(tipo, texto, id = 'status') {
  const alvo = elemento(id);
  alvo.style.display = 'block';
  alvo.className = 'status ' + tipo;
  alvo.textContent = texto;
}

const DICAS_MODO = {
  'Manual Assistido': 'Calcula e mostra o próximo lance, mas nunca envia sozinho. É você quem clica.',
  'Automático': 'Cobre o concorrente sozinho, respeitando o tempo de resposta e o piso de margem.',
  'Estratégico': 'Automático, mas varia o intervalo e a redução dentro da faixa. Uma sequência de lances idênticos é a assinatura mais óbvia de robô.',
};

/**
 * Converte o que foi digitado em número, ou em null.
 *
 * Campo em branco nunca vira zero: para o backend, null significa "não
 * configurado" e zero é um valor válido — a diferença decide se o robô para
 * ou continua baixando.
 */
function numeroOuNulo(texto) {
  const limpo = String(texto || '').trim().replace(',', '.');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

function conversar(mensagem) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(mensagem, (resposta) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(resposta || { ok: false, error: 'Sem resposta do serviço da extensão.' });
    });
  });
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

      // Com credenciais válidas, a configuração do robô passa a ser editável.
      carregarPerfil();

      const motor = motorDoPortal(aba && aba.url);
      if (!motor) {
        mostrarStatus('ok', 'Credenciais salvas. Abra a sala de disputa do Comprasnet ou do Licitanet para o painel aparecer.');
        return;
      }

      mostrarStatus('ok', 'Credenciais salvas. Ativando o motor nesta aba…');
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

// ─── Configuração do robô ──────────────────────────────────────────────
// Ela é editada aqui, e não numa tela da plataforma: quem opera o pregão está
// no navegador, com o portal aberto, e mandá-lo a outro lugar para mudar o
// tempo de resposta é mandá-lo sair da disputa.

function mostrarDicaDoModo() {
  elemento('modoDica').textContent = DICAS_MODO[elemento('modo').value] || '';
}

elemento('modo').addEventListener('change', mostrarDicaDoModo);

async function carregarPerfil() {
  const resposta = await conversar({ action: 'horasis_perfil_ler' });
  if (!resposta.ok) {
    // Sem credenciais ainda, ou backend fora do ar. A seção fica escondida em
    // vez de mostrar campos vazios que não salvariam.
    elemento('secaoRobo').hidden = true;
    return;
  }
  const perfil = (resposta.data && resposta.data.perfil) || {};
  elemento('modo').value = perfil.mode || 'Manual Assistido';
  elemento('reducaoMin').value = perfil.min_reduction ?? '';
  elemento('reducaoMax').value = perfil.max_reduction ?? '';
  elemento('tempoResposta').value = perfil.response_time ?? '';
  elemento('cnpj').value = perfil.fornecedor_cnpj || '';
  mostrarDicaDoModo();
  elemento('secaoRobo').hidden = false;
}

elemento('salvarRobo').addEventListener('click', async () => {
  mostrarStatus('ok', 'Salvando…', 'statusRobo');
  const resposta = await conversar({
    action: 'horasis_perfil_salvar',
    perfil: {
      mode: elemento('modo').value,
      min_reduction: numeroOuNulo(elemento('reducaoMin').value),
      max_reduction: numeroOuNulo(elemento('reducaoMax').value),
      response_time: numeroOuNulo(elemento('tempoResposta').value) || 3,
      fornecedor_cnpj: elemento('cnpj').value.trim() || null,
    },
  });
  if (!resposta.ok) {
    mostrarStatus('err', resposta.error || 'Não foi possível salvar.', 'statusRobo');
    return;
  }
  // Vale para as disputas abertas a partir de agora. Mexer na estratégia de
  // uma sala já em andamento, de outra tela, seria a pior hora possível para
  // uma surpresa.
  mostrarStatus('ok', 'Configuração salva — vale para as próximas disputas.', 'statusRobo');
});

// ─── Carregar o que já está salvo ──────────────────────────────────────
// Só credenciais: o robô de cada compra é criado pelo backend a partir do
// código da compra que o motor lê da própria URL da sala de disputa.
(async () => {
  const dados = await chrome.storage.local.get(['hz_app_id', 'hz_token', 'hz_api_base']);
  if (dados.hz_app_id) elemento('appId').value = dados.hz_app_id;
  if (dados.hz_token) elemento('token').value = dados.hz_token;
  if (dados.hz_api_base) elemento('apiBase').value = dados.hz_api_base;
  if (dados.hz_app_id && dados.hz_token) carregarPerfil();
})();
