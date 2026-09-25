// popup.js — interface (usada como PAINEL LATERAL). Liga/desliga a captura
// da aba ativa e mostra o ACERVO ACUMULADO (append-only, global): cada
// captura entra como um novo registro; trocar de aba, navegar ou fechar a
// aba não apaga nada. O painel fica aberto enquanto você navega, então ele
// atualiza a métrica ao vivo e reflete a aba ativa do momento.

const CHAVE_CAPTURAS = "capturas";
const CHAVE_ABAS_ATIVAS = "abas_ativas";

const elAlternar = document.getElementById("alternar");
const elPonto = document.getElementById("ponto-status");
const elSiteAtual = document.getElementById("site-atual");
const elTamanho = document.getElementById("tamanho-captado");
const elBarra = document.getElementById("barra-preenchimento");
const elUltimaAtualizacao = document.getElementById("ultima-atualizacao");
const elContagemPaginas = document.getElementById("contagem-paginas");
const elListaPaginas = document.getElementById("lista-paginas");
const elEstadoVazio = document.getElementById("estado-vazio");
const elBtnBaixar = document.getElementById("btn-baixar");
const elBtnLimpar = document.getElementById("btn-limpar");

// Escala usada só para desenhar a barra de progresso (não é um limite real).
const ESCALA_VISUAL_BYTES = 10 * 1024 * 1024; // 10 MB

let tabId = null;

function formatarBytes(bytes) {
  if (!bytes) return "0 B";
  const unidades = ["B", "KB", "MB", "GB"];
  const indice = Math.min(
    unidades.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const valor = bytes / Math.pow(1024, indice);
  return `${valor.toFixed(indice === 0 ? 0 : 1)} ${unidades[indice]}`;
}

function formatarHorario(timestamp) {
  if (!timestamp) return "Nenhuma captura ainda";
  const data = new Date(timestamp);
  const agora = new Date();
  const mesmoDia = data.toDateString() === agora.toDateString();
  const hora = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return mesmoDia
    ? `Última captura às ${hora}`
    : `Última captura em ${data.toLocaleString("pt-BR")}`;
}

function renderizarLista(capturas) {
  elListaPaginas.innerHTML = "";
  // Mais recentes primeiro.
  const ordenadas = [...capturas].sort(
    (a, b) => b.capturadoEm - a.capturadoEm,
  );

  for (const captura of ordenadas) {
    const li = document.createElement("li");

    const titulo = document.createElement("span");
    titulo.className = "item-titulo";
    titulo.textContent = captura.titulo || captura.url;
    titulo.title = captura.url;

    const info = document.createElement("div");
    info.className = "item-info";

    const url = document.createElement("span");
    url.textContent = captura.url;
    url.title = captura.url;

    const tamanho = document.createElement("span");
    tamanho.textContent = formatarBytes(captura.tamanhoBytes);

    info.append(url, tamanho);
    li.append(titulo, info);
    elListaPaginas.appendChild(li);
  }
}

function renderizarAcervo(capturas) {
  const lista = Array.isArray(capturas) ? capturas : [];
  const totalBytes = lista.reduce((s, c) => s + (c.tamanhoBytes || 0), 0);
  const ultima = lista.reduce((m, c) => Math.max(m, c.capturadoEm || 0), 0);
  const paginasDistintas = new Set(lista.map((c) => c.url)).size;

  elTamanho.textContent = formatarBytes(totalBytes);
  elUltimaAtualizacao.textContent = formatarHorario(ultima);
  elContagemPaginas.textContent =
    `${lista.length} ${lista.length === 1 ? "captura" : "capturas"}` +
    ` · ${paginasDistintas} ${paginasDistintas === 1 ? "página" : "páginas"}`;

  const percentual = Math.min(
    100,
    Math.round((totalBytes / ESCALA_VISUAL_BYTES) * 100),
  );
  elBarra.style.width = `${totalBytes > 0 ? Math.max(4, percentual) : 0}%`;

  const temConteudo = lista.length > 0;
  elBtnBaixar.disabled = !temConteudo;
  elBtnLimpar.disabled = !temConteudo;
  elListaPaginas.hidden = !temConteudo;
  if (temConteudo) renderizarLista(lista);

  atualizarEstadoVazio();
}

function atualizarEstadoVazio() {
  const semConteudo = elListaPaginas.hidden;
  elEstadoVazio.hidden = elAlternar.checked || !semConteudo;
}

async function atualizarAbaAtual() {
  const [aba] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!aba || !aba.id) {
    tabId = null;
    elSiteAtual.textContent = "Nenhuma aba ativa";
    elAlternar.disabled = true;
    elAlternar.checked = false;
    elPonto.classList.remove("ligado");
    atualizarEstadoVazio();
    return;
  }

  tabId = aba.id;
  elSiteAtual.textContent = aba.url || "";

  const restrito = !/^https?:/i.test(aba.url || "");
  if (restrito) {
    elSiteAtual.textContent = "Esta página não pode ser captada";
    elAlternar.disabled = true;
    elAlternar.checked = false;
    elPonto.classList.remove("ligado");
    atualizarEstadoVazio();
    return;
  }

  elAlternar.disabled = false;
  const resultado = await chrome.storage.local.get(CHAVE_ABAS_ATIVAS);
  const abasAtivas = new Set(resultado[CHAVE_ABAS_ATIVAS] || []);
  const ativoNestaAba = abasAtivas.has(tabId);
  elAlternar.checked = ativoNestaAba;
  elPonto.classList.toggle("ligado", ativoNestaAba);
  atualizarEstadoVazio();
}

async function iniciar() {
  const resultado = await chrome.storage.local.get(CHAVE_CAPTURAS);
  renderizarAcervo(resultado[CHAVE_CAPTURAS] || []);
  await atualizarAbaAtual();
}

elAlternar.addEventListener("change", async () => {
  if (tabId == null) return;
  const ativo = elAlternar.checked;
  elPonto.classList.toggle("ligado", ativo);
  elAlternar.disabled = true;

  const resposta = await chrome.runtime.sendMessage({
    tipo: "alternar-captura",
    tabId,
    ativo,
  });

  elAlternar.disabled = false;

  if (resposta && resposta.ok === false) {
    elAlternar.checked = false;
    elPonto.classList.remove("ligado");
    elUltimaAtualizacao.textContent =
      resposta.erro || "Não foi possível iniciar a captura nesta página.";
  }

  atualizarEstadoVazio();
});

elBtnBaixar.addEventListener("click", async () => {
  const resultado = await chrome.storage.local.get(CHAVE_CAPTURAS);
  const capturas = resultado[CHAVE_CAPTURAS] || [];
  if (capturas.length === 0) return;

  const exportacao = {
    geradoEm: new Date().toISOString(),
    totalCapturas: capturas.length,
    totalPaginas: new Set(capturas.map((c) => c.url)).size,
    totalBytes: capturas.reduce((s, c) => s + (c.tamanhoBytes || 0), 0),
    capturas: capturas.map((c) => ({
      url: c.url,
      titulo: c.titulo,
      tamanhoBytes: c.tamanhoBytes,
      capturadoEm: new Date(c.capturadoEm).toISOString(),
      html: c.html,
    })),
  };

  const blob = new Blob([JSON.stringify(exportacao, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  chrome.downloads.download(
    {
      url,
      filename: `acervo-capturado-${carimbo}.json`,
      saveAs: false,
    },
    () => {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
  );
});

elBtnLimpar.addEventListener("click", async () => {
  const confirmado = window.confirm(
    "Isso apaga TODO o acervo acumulado (todas as capturas até agora). Continuar?",
  );
  if (!confirmado) return;

  await chrome.runtime.sendMessage({ tipo: "limpar-tudo" });
  renderizarAcervo([]);
});

// Atualiza a métrica ao vivo enquanto o painel fica aberto (inclusive quando
// outra aba está captando em segundo plano).
chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area !== "local") return;
  if (mudancas[CHAVE_CAPTURAS]) {
    renderizarAcervo(mudancas[CHAVE_CAPTURAS].newValue || []);
  }
  if (mudancas[CHAVE_ABAS_ATIVAS]) {
    atualizarAbaAtual();
  }
});

// Como o painel lateral permanece aberto ao navegar, ele acompanha a aba
// ativa do momento (toggle + site mostrado).
chrome.tabs.onActivated.addListener(atualizarAbaAtual);
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) atualizarAbaAtual();
});
chrome.windows.onFocusChanged.addListener(atualizarAbaAtual);

iniciar();
