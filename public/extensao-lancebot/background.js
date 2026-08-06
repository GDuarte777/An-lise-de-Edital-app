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
        chrome.storage.local.get(["lancebotPanelUrl", "comprasnetToken"], (stored) => {
          chrome.storage.local.set({ 
            comprasnetToken: token,
            lastCapturedToken: new Date().toLocaleTimeString('pt-BR')
          }, () => {
            console.log("HORASIS LanceBot Pro: Token Comprasnet capturado com sucesso!");
          });

          // Tenta auto-sincronização caso a URL do painel já esteja registrada
          if (stored.lancebotPanelUrl && stored.comprasnetToken !== token) {
            fetch(`${stored.lancebotPanelUrl.replace(/\/$/, '')}/api/session/update`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: token })
            }).then(r => r.json()).then(data => {
              console.log("HORASIS LanceBot Pro: Auto-sincronização em tempo real realizada!", data);
            }).catch(err => {
              console.warn("HORASIS LanceBot Pro: Tentativa de auto-sincronização:", err.message);
            });
          }
        });
      }
    }
  },
  { urls: [
    "https://sala-disputa.comprasnet.gov.br/*", 
    "https://*.comprasnet.gov.br/*", 
    "https://*.compras.gov.br/*"
  ] },
  ["requestHeaders", "extraHeaders"]
);

// Captura cookies dos domínios Comprasnet e Compras.gov.br
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCookies") {
    if (chrome.cookies) {
      Promise.all([
        new Promise(resolve => chrome.cookies.getAll({ domain: "comprasnet.gov.br" }, resolve)),
        new Promise(resolve => chrome.cookies.getAll({ domain: "compras.gov.br" }, resolve))
      ]).then(([c1, c2]) => {
        const allCookies = [...(c1 || []), ...(c2 || [])];
        const cookieMap = new Map();
        allCookies.forEach(c => cookieMap.set(c.name, c.value));
        const cookieString = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
        sendResponse({ cookies: cookieString });
      }).catch(err => {
        sendResponse({ cookies: "", error: err.message });
      });
      return true; // Canal assíncrono mantido aberto
    } else {
      sendResponse({ cookies: "" });
    }
  }
});
