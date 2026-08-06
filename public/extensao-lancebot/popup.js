document.addEventListener("DOMContentLoaded", () => {
  const tokenStatus = document.getElementById("token-status");
  const instructionText = document.getElementById("instruction-text");
  const panelUrlInput = document.getElementById("panel-url");
  const tokenView = document.getElementById("token-view");
  const cookieView = document.getElementById("cookie-view");
  const btnSync = document.getElementById("btn-sync");

  // Tenta preencher a URL do painel automaticamente a partir da aba ativa ou storage
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const currentUrl = new URL(tabs[0].url);
          if (currentUrl.port === "3000" || currentUrl.hostname.includes("run.app") || currentUrl.hostname.includes("localhost")) {
            const cleanUrl = `${currentUrl.protocol}//${currentUrl.host}`;
            panelUrlInput.value = cleanUrl;
            chrome.storage.local.set({ lancebotPanelUrl: cleanUrl });
          }
        } catch (e) {
          console.error(e);
        }
      }
    });
  }

  // Carrega URL salva no storage se houver
  chrome.storage.local.get(["lancebotPanelUrl", "comprasnetToken", "lastCapturedToken"], (data) => {
    if (data.lancebotPanelUrl) {
      panelUrlInput.value = data.lancebotPanelUrl;
    }

    if (data.comprasnetToken) {
      tokenView.value = data.comprasnetToken;
      tokenStatus.innerText = `CAPTURADO! (${data.lastCapturedToken || "Agora"})`;
      tokenStatus.className = "badge badge-success";
      instructionText.innerHTML = "✓ <strong style='color:#34d399'>Token de sessão pronto!</strong> Clique no botão abaixo para injetar as credenciais diretamente no seu painel.";
    }
  });

  // Requisita cookies ao background script de forma assíncrona
  try {
    chrome.runtime.sendMessage({ action: "getCookies" }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Aviso de Cookies:", chrome.runtime.lastError.message);
        return;
      }
      if (response && response.cookies) {
        cookieView.value = response.cookies;
        chrome.storage.local.set({ comprasnetCookies: response.cookies });
      }
    });
  } catch(e) {
    console.warn("Aviso ao solicitar cookies:", e);
  }

  // Evento de Sincronização direta por API
  btnSync.addEventListener("click", async () => {
    const targetUrl = panelUrlInput.value.trim().replace(/\/$/, "");
    const tokenVal = tokenView.value.trim();
    const cookieVal = cookieView.value.trim();

    if (!targetUrl) {
      alert("Por favor, insira a URL do seu painel do LanceBot.");
      return;
    }
    if (!tokenVal) {
      alert("Nenhum token capturado ainda. Abra o Compras.gov.br na aba ao lado (Sala de Disputa) para capturar em tempo real.");
      return;
    }

    // Salva a URL do painel para o próximo uso
    chrome.storage.local.set({ lancebotPanelUrl: targetUrl });

    btnSync.disabled = true;
    btnSync.style.opacity = "0.7";
    btnSync.innerHTML = "<span>Sincronizando...</span>";

    try {
      // Dispara o POST de injeção direta de sessão
      const response = await fetch(`${targetUrl}/api/session/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: tokenVal,
          cookie: cookieVal
        })
      });

      if (response.ok) {
        const resData = await response.json();
        btnSync.style.background = "linear-gradient(135deg, #059669, #10b981)";
        btnSync.innerHTML = "<span>✓ Sincronizado com Sucesso!</span>";
        setTimeout(() => {
          btnSync.disabled = false;
          btnSync.style.opacity = "1";
          btnSync.style.background = "linear-gradient(135deg, #2563eb, #4f46e5)";
          btnSync.innerHTML = "<span>⚡ Sincronizar com HORASIS</span>";
        }, 3000);
      } else {
        throw new Error(`Servidor respondeu com código ${response.status}`);
      }
    } catch (err) {
      console.error(err);
      alert(`Erro ao sincronizar: ${err.message}. Verifique se a URL do painel está correta e se o app está ativo.`);
      btnSync.disabled = false;
      btnSync.style.opacity = "1";
      btnSync.innerHTML = "<span>⚡ Tentar Novamente</span>";
    }
  });
});
