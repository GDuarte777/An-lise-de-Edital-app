// popup.js — interface do popup: liga/desliga a captura da aba atual,
// mostra o tamanho já captado em tempo real e baixa o resultado.

const elAlternar = document.getElementById("alternar");
const elPonto = document.getElementById("ponto-status");
const elSiteAtual = document.getElementById("site-atual");
const elTamanho = document.getElementById("tamanho-captado");
const elBarra = document.getElementById("barra-preenchimento");
const elUltimaAtualizacao = document.getElementById("ultima-atualizacao");
const elEstadoVazio = document.getElementById("estado-vazio");
const elBtnBaixar = document.getElementById("btn-baixar");
const elBtnLimpar = document.getElementById("btn-limpar");

// Escala usada só para desenhar a barra de progresso (não é um limite real).
const ESCALA_VISUAL_BYTES = 1.5 * 1024 * 1024; // 1,5 MB

let tabId = null;
let ultimoHtml = "";
let ultimoNomeSugerido = "pagina";

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
  return mesmoDia ? `Atualizado às ${hora}` : `Atualizado em ${data.toLocaleString("pt-BR")}`;
}

function nomeArquivoSugerido(url, titulo) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const base = (titulo || host || "pagina")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return `${host}-${base || "pagina"}`;
  } catch {
    return "pagina-captada";
  }
}

function aplicarEstado(estado) {
  const ativo = Boolean(estado && estado.ativo);
  const tamanho = (estado && estado.tamanhoBytes) || 0;

  elAlternar.checked = ativo;
  elPonto.classList.toggle("ligado", ativo);
  elTamanho.textContent = formatarBytes(tamanho);
  elUltimaAtualizacao.textContent = formatarHorario(
    estado && estado.atualizadoEm,
  );

  const percentual = Math.min(
    100,
    Math.round((tamanho / ESCALA_VISUAL_BYTES) * 100),
  );
  elBarra.style.width = `${tamanho > 0 ? Math.max(4, percentual) : 0}%`;

  const temConteudo = Boolean(estado && estado.html);
  elBtnBaixar.disabled = !temConteudo;
  elBtnLimpar.disabled = !temConteudo;
  elEstadoVazio.hidden = ativo || temConteudo;

  ultimoHtml = (estado && estado.html) || "";
  if (estado && estado.url) {
    ultimoNomeSugerido = nomeArquivoSugerido(estado.url, estado.titulo);
  }
}

async function iniciar() {
  const [aba] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!aba || !aba.id) {
    elSiteAtual.textContent = "Nenhuma aba ativa";
    elAlternar.disabled = true;
    return;
  }

  tabId = aba.id;
  elSiteAtual.textContent = aba.url || "";

  const restrito = !/^https?:/i.test(aba.url || "");
  if (restrito) {
    elSiteAtual.textContent = "Esta página não pode ser captada";
    elAlternar.disabled = true;
    elBtnBaixar.disabled = true;
    elBtnLimpar.disabled = true;
    elEstadoVazio.hidden = false;
    return;
  }

  const chave = `captura_${tabId}`;
  const resultado = await chrome.storage.local.get(chave);
  aplicarEstado(resultado[chave]);
}

elAlternar.addEventListener("change", async () => {
  if (tabId == null) return;
  const ativo = elAlternar.checked;
  elPonto.classList.toggle("ligado", ativo);
  await chrome.runtime.sendMessage({
    tipo: "alternar-captura",
    tabId,
    ativo,
  });
});

elBtnBaixar.addEventListener("click", () => {
  if (!ultimoHtml) return;

  const blob = new Blob([ultimoHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const carimbo = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  chrome.downloads.download(
    {
      url,
      filename: `${ultimoNomeSugerido}-${carimbo}.html`,
      saveAs: false,
    },
    () => {
      // Libera o objeto depois que o download for despachado.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
  );
});

elBtnLimpar.addEventListener("click", async () => {
  if (tabId == null) return;
  await chrome.runtime.sendMessage({ tipo: "limpar-captura", tabId });
  elAlternar.checked = false;
  aplicarEstado(null);
});

// Mantém o popup atualizado enquanto ele está aberto e a página muda.
chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area !== "local" || tabId == null) return;
  const chave = `captura_${tabId}`;
  if (mudancas[chave]) {
    aplicarEstado(mudancas[chave].newValue);
  }
});

iniciar();
