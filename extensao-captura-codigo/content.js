// content.js — roda dentro da página e é responsável por capturar o HTML
// atual sempre que a captura estiver ativa. Não grava nada localmente: só
// manda o resultado para o background, que é quem mantém o acervo
// acumulado (global, entre todas as abas e sites) em chrome.storage.local.

(() => {
  // Evita registrar tudo de novo se o background injetar este script mais
  // de uma vez na mesma página (ex.: reforço manual via scripting.executeScript
  // além da injeção automática declarada no manifest).
  if (window.__capturaCodigoInjetado) return;
  window.__capturaCodigoInjetado = true;

  let ativo = false;
  let observer = null;
  let temporizador = null;

  function capturarAgora(tabId) {
    const html = document.documentElement.outerHTML;
    const tamanhoBytes = new Blob([html]).size;

    chrome.runtime.sendMessage({
      tipo: "atualizar-captura",
      tabId,
      url: location.href,
      titulo: document.title || location.hostname,
      html,
      tamanhoBytes,
    });
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

  chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
    if (!mensagem || typeof mensagem.tipo !== "string") return;

    if (mensagem.tipo === "definir-ativo") {
      ativo = mensagem.ativo;
      if (ativo) {
        iniciarObservacao(mensagem.tabId);
      } else {
        pararObservacao();
      }
      responder({ ok: true });
    }

    return true;
  });
})();
