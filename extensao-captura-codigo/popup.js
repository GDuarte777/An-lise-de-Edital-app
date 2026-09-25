// popup.js — interface do popup: liga/desliga a captura da aba atual e
// mostra o ACERVO ACUMULADO (global, entre todas as abas e sites) — trocar
// de aba ou fechar uma página não zera nada, só some captura em cima do
// que já existe.

const CHAVE_PAGINAS = "paginas_captadas";
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
const ESCALA_VISUAL_BYTES = 5 * 1024 * 1024; // 5 MB

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
    ? `Última atualização às ${hora}`
    : `Última atualização em ${data.toLocaleString("pt-BR")}`;
}

function renderizarLista(paginas) {
  elListaPaginas.innerHTML = "";
  const entradas = Object.values(paginas).sort(
    (a, b) => b.atualizadoEm - a.atualizadoEm,
  );

  for (const pagina of entradas) {
    const li = document.createElement("li");

    const titulo = document.createElement("span");
    titulo.className = "item-titulo";
    titulo.textContent = pagina.titulo || pagina.url;
    titulo.title = pagina.url;

    const info = document.createElement("div");
    info.className = "item-info";

    const url = document.createElement("span");
    url.textContent = pagina.url;
    url.title = pagina.url;

    const tamanho = document.createElement("span");
    tamanho.textContent = formatarBytes(pagina.tamanhoBytes);

    info.append(url, tamanho);
    li.append(titulo, info);
    elListaPaginas.appendChild(li);
  }
}

function renderizarAcervo(paginas) {
  const entradas = Object.values(paginas || {});
  const totalBytes = entradas.reduce(
    (soma, p) => soma + (p.tamanhoBytes || 0),
    0,
  );
  const ultimaAtualizacao = entradas.reduce(
    (max, p) => Math.max(max, p.atualizadoEm || 0),
    0,
  );

  elTamanho.textContent = formatarBytes(totalBytes);
  elUltimaAtualizacao.textContent = formatarHorario(ultimaAtualizacao);
  elContagemPaginas.textContent =
    entradas.length === 1
      ? "1 página no acervo"
      : `${entradas.length} páginas no acervo`;

  const percentual = Math.min(
    100,
    Math.round((totalBytes / ESCALA_VISUAL_BYTES) * 100),
  );
  elBarra.style.width = `${totalBytes > 0 ? Math.max(4, percentual) : 0}%`;

  const temConteudo = entradas.length > 0;
  elBtnBaixar.disabled = !temConteudo;
  elBtnLimpar.disabled = !temConteudo;
  elListaPaginas.hidden = !temConteudo;
  if (temConteudo) renderizarLista(paginas);

  return { totalBytes, quantidade: entradas.length };
}

function atualizarEstadoVazio() {
  const semConteudo = elListaPaginas.hidden;
  elEstadoVazio.hidden = elAlternar.checked || !semConteudo;
}

async function iniciar() {
  const [aba] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const resultadoStorage = await chrome.storage.local.get([
    CHAVE_PAGINAS,
    CHAVE_ABAS_ATIVAS,
  ]);
  renderizarAcervo(resultadoStorage[CHAVE_PAGINAS] || {});

  if (!aba || !aba.id) {
    elSiteAtual.textContent = "Nenhuma aba ativa";
    elAlternar.disabled = true;
    atualizarEstadoVazio();
    return;
  }

  tabId = aba.id;
  elSiteAtual.textContent = aba.url || "";

  const restrito = !/^https?:/i.test(aba.url || "");
  if (restrito) {
    elSiteAtual.textContent = "Esta página não pode ser captada";
    elAlternar.disabled = true;
    atualizarEstadoVazio();
    return;
  }

  const abasAtivas = new Set(resultadoStorage[CHAVE_ABAS_ATIVAS] || []);
  const ativoNestaAba = abasAtivas.has(tabId);
  elAlternar.checked = ativoNestaAba;
  elPonto.classList.toggle("ligado", ativoNestaAba);
  atualizarEstadoVazio();
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
    // Não deu para falar com a página (aba aberta antes de instalar a
    // extensão, página interna do navegador, etc.). Desfaz o toggle e avisa.
    elAlternar.checked = false;
    elPonto.classList.remove("ligado");
    elUltimaAtualizacao.textContent =
      resposta.erro || "Não foi possível iniciar a captura nesta página.";
  }

  atualizarEstadoVazio();
});

elBtnBaixar.addEventListener("click", async () => {
  const resultado = await chrome.storage.local.get(CHAVE_PAGINAS);
  const paginas = resultado[CHAVE_PAGINAS] || {};
  const entradas = Object.values(paginas);
  if (entradas.length === 0) return;

  const exportacao = {
    geradoEm: new Date().toISOString(),
    totalPaginas: entradas.length,
    totalBytes: entradas.reduce((s, p) => s + (p.tamanhoBytes || 0), 0),
    paginas: entradas.map((p) => ({
      url: p.url,
      titulo: p.titulo,
      tamanhoBytes: p.tamanhoBytes,
      capturadoEm: new Date(p.capturadoEm).toISOString(),
      atualizadoEm: new Date(p.atualizadoEm).toISOString(),
      html: p.html,
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
    "Isso apaga todo o acervo acumulado (todas as páginas captadas até agora). Continuar?",
  );
  if (!confirmado) return;

  await chrome.runtime.sendMessage({ tipo: "limpar-tudo" });
  renderizarAcervo({});
  atualizarEstadoVazio();
});

// Mantém o popup atualizado ao vivo, inclusive enquanto outra aba está
// captando em segundo plano.
chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area !== "local") return;
  if (mudancas[CHAVE_PAGINAS]) {
    renderizarAcervo(mudancas[CHAVE_PAGINAS].newValue || {});
    atualizarEstadoVazio();
  }
});

iniciar();
