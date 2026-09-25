// background.js — service worker (MV3). Mantém a lista de abas com captura
// ativa e reenvia o comando de "ligar" toda vez que a aba navega para uma
// nova página (o content script é reinjetado do zero a cada navegação).

const CHAVE_ABAS_ATIVAS = "abas_ativas";

async function obterAbasAtivas() {
  const resultado = await chrome.storage.local.get(CHAVE_ABAS_ATIVAS);
  return new Set(resultado[CHAVE_ABAS_ATIVAS] || []);
}

async function salvarAbasAtivas(conjunto) {
  await chrome.storage.local.set({
    [CHAVE_ABAS_ATIVAS]: Array.from(conjunto),
  });
}

async function enviarParaConteudo(tabId, mensagem) {
  try {
    return await chrome.tabs.sendMessage(tabId, mensagem);
  } catch (erro) {
    // A página pode não ter o content script (ex.: chrome://, páginas
    // internas do navegador) — não há o que fazer nesses casos.
    return null;
  }
}

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  if (!mensagem || typeof mensagem.tipo !== "string") return;

  if (mensagem.tipo === "alternar-captura") {
    (async () => {
      const abas = await obterAbasAtivas();
      if (mensagem.ativo) {
        abas.add(mensagem.tabId);
      } else {
        abas.delete(mensagem.tabId);
      }
      await salvarAbasAtivas(abas);
      await enviarParaConteudo(mensagem.tabId, {
        tipo: "definir-ativo",
        ativo: mensagem.ativo,
        tabId: mensagem.tabId,
      });
      responder({ ok: true });
    })();
    return true;
  }

  if (mensagem.tipo === "limpar-captura") {
    (async () => {
      await chrome.storage.local.remove(`captura_${mensagem.tabId}`);
      const abas = await obterAbasAtivas();
      abas.delete(mensagem.tabId);
      await salvarAbasAtivas(abas);
      responder({ ok: true });
    })();
    return true;
  }
});

// Quando uma aba termina de carregar uma nova página, se ela estava marcada
// como "ativa", religa a captura automaticamente (o content script antigo
// morreu junto com a navegação).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const abas = await obterAbasAtivas();
  if (abas.has(tabId)) {
    await enviarParaConteudo(tabId, {
      tipo: "definir-ativo",
      ativo: true,
      tabId,
    });
  }
});

// Limpeza ao fechar a aba.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const abas = await obterAbasAtivas();
  if (abas.delete(tabId)) {
    await salvarAbasAtivas(abas);
  }
  await chrome.storage.local.remove(`captura_${tabId}`);
});
