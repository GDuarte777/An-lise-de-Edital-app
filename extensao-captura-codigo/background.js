// background.js — service worker (MV3).
//
// Mantém dois pedaços de estado em chrome.storage.local:
//   - "abas_ativas": quais abas têm o interruptor ligado agora.
//   - "paginas_captadas": o ACERVO ACUMULADO, global — uma entrada por URL
//     distinta, que só é atualizada (nunca zerada) enquanto novas capturas
//     chegam, não importa em qual aba ou quantas vezes você troque de aba.

const CHAVE_ABAS_ATIVAS = "abas_ativas";
const CHAVE_PAGINAS = "paginas_captadas";

async function obterAbasAtivas() {
  const resultado = await chrome.storage.local.get(CHAVE_ABAS_ATIVAS);
  return new Set(resultado[CHAVE_ABAS_ATIVAS] || []);
}

async function salvarAbasAtivas(conjunto) {
  await chrome.storage.local.set({
    [CHAVE_ABAS_ATIVAS]: Array.from(conjunto),
  });
}

// O service worker é single-thread, mas as chamadas a chrome.storage são
// assíncronas (get → modifica → set). Se duas abas capturarem quase ao
// mesmo tempo, um "get" pode ler um valor desatualizado antes do "set" da
// outra. Serializamos todas as escritas no acervo numa fila simples para
// que cada atualização parta sempre do estado mais recente.
let filaDeEscrita = Promise.resolve();
function enfileirarEscrita(tarefa) {
  filaDeEscrita = filaDeEscrita.then(tarefa, tarefa);
  return filaDeEscrita;
}

async function atualizarPagina({ url, titulo, html, tamanhoBytes }) {
  return enfileirarEscrita(async () => {
    const resultado = await chrome.storage.local.get(CHAVE_PAGINAS);
    const paginas = resultado[CHAVE_PAGINAS] || {};

    const existente = paginas[url];
    paginas[url] = {
      url,
      titulo,
      html,
      tamanhoBytes,
      capturadoEm: existente?.capturadoEm || Date.now(),
      atualizadoEm: Date.now(),
    };

    await chrome.storage.local.set({ [CHAVE_PAGINAS]: paginas });
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
    // instalada/recarregada, já que o manifest só injeta automaticamente em
    // páginas carregadas depois disso. Injeta agora "na marra" e tenta de
    // novo antes de desistir.
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
    // Vem do content script: soma/atualiza a entrada dessa URL no acervo
    // global. Não precisa responder nada de volta.
    atualizarPagina(mensagem);
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
        // Não deu para falar com a página — desfaz o registro de "ativa"
        // para não ficar um estado inconsistente, e avisa o popup.
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
        await chrome.storage.local.remove(CHAVE_PAGINAS);
      });
      responder({ ok: true });
    })();
    return true;
  }
});

// Quando uma aba termina de carregar uma nova página, se ela estava marcada
// como "ativa", religa a captura automaticamente (o content script antigo
// morreu junto com a navegação). O acervo acumulado não é afetado — a nova
// página só entra como mais uma entrada.
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

// Fechar a aba só tira ela da lista de "ativas" — o que já foi captado
// permanece no acervo acumulado.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const abas = await obterAbasAtivas();
  if (abas.delete(tabId)) {
    await salvarAbasAtivas(abas);
  }
});
