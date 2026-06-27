// Intercepta e captura cabeçalhos de Autorização de requisições ao Compras.gov.br
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    if (details.requestHeaders) {
      let token = null;
      for (let header of details.requestHeaders) {
        if (header.name.toLowerCase() === 'authorization') {
          token = header.value;
          break;
        }
      }
      
      if (token) {
        chrome.storage.local.set({ 
          comprasnetToken: token,
          lastCapturedToken: new Date().toLocaleTimeString('pt-BR')
        }, () => {
          console.log("LanceBot Pro: Token Comprasnet capturado com sucesso!");
        });
      }
    }
  },
  { urls: [
    "https://sala-disputa.comprasnet.gov.br/api/*", 
    "https://*.comprasnet.gov.br/*", 
    "https://*.compras.gov.br/*"
  ] },
  ["requestHeaders", "extraHeaders"]
);

// Captura cookies do domínio Comprasnet de forma nativa e segura
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCookies") {
    if (chrome.cookies) {
      chrome.cookies.getAll({ domain: "comprasnet.gov.br" }, (cookies) => {
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
        sendResponse({ cookies: cookieString });
      });
      return true; // Mantém o canal de mensagem aberto para resposta assíncrona
    } else {
      sendResponse({ cookies: "" });
    }
  }
});
