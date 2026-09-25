// background.js — service worker (MV3).
//
// Mantém dois pedaços de estado em chrome.storage.local:
//   - "abas_ativas": quais abas têm o interruptor ligado agora.
//   - "capturas": o ACERVO ACUMULADO, global e APPEND-ONLY. Cada captura
//     nova é ADICIONADA à lista; nada é substituído nem apagado ao trocar
//     de aba, navegar entre páginas ou fechar a aba. A única forma de
//     esvaziar é o botão "Limpar tudo".

const CHAVE_ABAS_ATIVAS = "abas_ativas";
const CHAVE_CAPTURAS = "capturas";

// Abre o painel lateral ao clicar no ícone da extensão. Diferente do popup,
// o painel lateral fica aberto enquanto você navega e troca de abas — só
// fecha quando você mandar fechar (ou minimizar a janela).
chrome.sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  .catch(() => {});

async function obterAbasAtivas() {
  const resultado = await chrome.storage.local.get(CHAVE_ABAS_ATIVAS);
  return new Set(resultado[CHAVE_ABAS_ATIVAS] || []);
}

async function salvarAbasAtivas(conjunto) {
  await chrome.storage.local.set({
    [CHAVE_ABAS_ATIVAS]: Array.from(conjunto),
  });
}

// As chamadas a chrome.storage são assíncronas (get → modifica → set). Se
// duas abas capturarem quase ao mesmo tempo, um "get" pode ler um valor
// desatualizado antes do "set" da outra. Serializamos todas as escritas no
// acervo numa fila simples para que cada atualização parta sempre do estado
// mais recente — assim nenhuma captura é perdida.
let filaDeEscrita = Promise.resolve();
function enfileirarEscrita(tarefa) {
  filaDeEscrita = filaDeEscrita.then(tarefa, tarefa);
  return filaDeEscrita;
}

async function registrarCaptura({ url, titulo, html, tamanhoBytes }) {
  return enfileirarEscrita(async () => {
    const resultado = await chrome.storage.local.get(CHAVE_CAPTURAS);
    const capturas = resultado[CHAVE_CAPTURAS] || [];

    // Deduplicação leve: se a captura for idêntica à ÚLTIMA captura da mesma
    // URL, não adiciona de novo (evita o MutationObserver empilhar cópias
    // iguais). Qualquer mudança real de conteúdo vira um novo registro.
    for (let i = capturas.length - 1; i >= 0; i--) {
      if (capturas[i].url === url) {
        if (capturas[i].html === html) return;
        break;
      }
    }

    capturas.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      titulo,
      html,
      tamanhoBytes,
      capturadoEm: Date.now(),
    });

    await chrome.storage.local.set({ [CHAVE_CAPTURAS]: capturas });
  });
}

async function injetarContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  } catch (erro) {
    // Páginas internas do navegador (chrome://, a loja de extensões, etc.)
    // bloqueiam a injeção — não há o que fazer nesses casos.
    return false;
  }
}

async function enviarParaConteudo(tabId, mensagem) {
  try {
    return await chrome.tabs.sendMessage(tabId, mensagem);
  } catch (erro) {
    // O content script provavelmente ainda não foi injetado nesta aba —
    // isso acontece quando a aba já estava aberta antes de a extensão ser
    // instalada/recarregada. Injeta agora "na marra" e tenta de novo.
    const injetado = await injetarContentScript(tabId);
    if (!injetado) return null;
    try {
      return await chrome.tabs.sendMessage(tabId, mensagem);
    } catch (erroFinal) {
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  if (!mensagem || typeof mensagem.tipo !== "string") return;

  if (mensagem.tipo === "atualizar-captura") {
    // Vem do content script: acrescenta a captura ao acervo global.
    registrarCaptura(mensagem);
    return false;
  }

  if (mensagem.tipo === "alternar-captura") {
    (async () => {
      const abas = await obterAbasAtivas();
      if (mensagem.ativo) {
        abas.add(mensagem.tabId);
      } else {
        abas.delete(mensagem.tabId);
      }
      await salvarAbasAtivas(abas);

      if (!mensagem.ativo) {
        await enviarParaConteudo(mensagem.tabId, {
          tipo: "definir-ativo",
          ativo: false,
          tabId: mensagem.tabId,
        });
        responder({ ok: true });
        return;
      }

      const resposta = await enviarParaConteudo(mensagem.tabId, {
        tipo: "definir-ativo",
        ativo: true,
        tabId: mensagem.tabId,
      });

      if (!resposta) {
        abas.delete(mensagem.tabId);
        await salvarAbasAtivas(abas);
        responder({
          ok: false,
          erro:
            "Não foi possível iniciar a captura nesta página. Recarregue a aba e tente de novo.",
        });
        return;
      }

      responder({ ok: true });
    })();
    return true;
  }

  if (mensagem.tipo === "limpar-tudo") {
    (async () => {
      await enfileirarEscrita(async () => {
        await chrome.storage.local.remove(CHAVE_CAPTURAS);
      });
      responder({ ok: true });
    })();
    return true;
  }
});

// Quando uma aba termina de carregar uma nova página, se ela estava marcada
// como "ativa", religa a captura automaticamente (o content script antigo
// morreu junto com a navegação). O acervo acumulado não é afetado — a nova
// página só acrescenta mais registros.
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

// Fechar a aba só tira ela da lista de "ativas" — tudo o que já foi captado
// permanece no acervo acumulado.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const abas = await obterAbasAtivas();
  if (abas.delete(tabId)) {
    await salvarAbasAtivas(abas);
  }
});
