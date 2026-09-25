// content.js — roda dentro da página e é responsável por capturar o HTML
// atual sempre que a captura estiver ativa, guardando o resultado no
// chrome.storage.local para que o popup possa ler o tamanho e baixar.

(() => {
  // Evita registrar tudo de novo se o background injetar este script mais
  // de uma vez na mesma página (ex.: reforço manual via scripting.executeScript
  // além da injeção automática declarada no manifest).
  if (window.__capturaCodigoInjetado) return;
  window.__capturaCodigoInjetado = true;

  const CHAVE_PREFIXO = "captura_";
  let ativo = false;
  let observer = null;
  let temporizador = null;

  function chaveEstado(tabId) {
    return `${CHAVE_PREFIXO}${tabId}`;
  }

  function capturarAgora(tabId) {
    const html = document.documentElement.outerHTML;
    const tamanhoBytes = new Blob([html]).size;

    const estado = {
      ativo: true,
      html,
      tamanhoBytes,
      url: location.href,
      titulo: document.title || location.hostname,
      atualizadoEm: Date.now(),
    };

    chrome.storage.local.set({ [chaveEstado(tabId)]: estado });
  }

  function agendarCaptura(tabId) {
    // Debounce: evita recapturar a cada micro-mutação do DOM.
    clearTimeout(temporizador);
    temporizador = setTimeout(() => capturarAgora(tabId), 400);
  }

  function iniciarObservacao(tabId) {
    pararObservacao();
    capturarAgora(tabId);
    observer = new MutationObserver(() => agendarCaptura(tabId));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  }

  function pararObservacao() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(temporizador);
  }

  async function marcarInativo(tabId) {
    const chave = chaveEstado(tabId);
    const resultado = await chrome.storage.local.get(chave);
    const estadoAtual = resultado[chave];
    if (estadoAtual) {
      await chrome.storage.local.set({
        [chave]: { ...estadoAtual, ativo: false },
      });
    }
  }

  chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
    if (!mensagem || typeof mensagem.tipo !== "string") return;

    if (mensagem.tipo === "definir-ativo") {
      const tabId = mensagem.tabId;
      ativo = mensagem.ativo;
      if (ativo) {
        iniciarObservacao(tabId);
      } else {
        pararObservacao();
        marcarInativo(tabId);
      }
      responder({ ok: true });
    }

    if (mensagem.tipo === "recapturar-agora") {
      if (ativo) capturarAgora(mensagem.tabId);
      responder({ ok: true });
    }

    return true;
  });
})();
