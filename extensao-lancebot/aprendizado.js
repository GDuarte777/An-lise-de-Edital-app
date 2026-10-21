/**
 * Gravador de disputa — o material para o robô executável de amanhã.
 *
 * Tudo o que acontece numa disputa é anotado: como a tela estava, o que o portal
 * respondeu, o que o robô decidiu e o que aconteceu depois. É esse registro que vai
 * permitir escrever um bot fora do navegador sem ter que descobrir o portal de novo —
 * este projeto já gastou várias correções justamente por falta desse tipo de evidência.
 *
 * Onde fica: `chrome.storage.local`, na máquina do operador. NADA sai daqui sozinho.
 * Só sai quando ele clica em exportar, e aí vai para um arquivo que ele escolhe.
 *
 * O que é mascarado: CPF e CNPJ, sempre, mesmo sendo dados dele — identificam pessoas e
 * não fazem falta nenhuma para entender a mecânica da disputa. Valor, horário e estrutura
 * ficam inteiros, porque são exatamente o que o robô futuro precisa aprender.
 */
(() => {
  const CHAVE = "lancebot.aprendizado";
  const LIMITE = 4000;          // eventos guardados; os mais antigos saem primeiro

  const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
  const RE_CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;

  /** Remove o que identifica pessoas, preservando o resto. */
  function limpar(v, prof) {
    const p = prof || 0;
    if (p > 6) return "[fundo]";
    if (typeof v === "string") {
      return v.replace(RE_CPF, "[CPF]").replace(RE_CNPJ, "[CNPJ]").slice(0, 2000);
    }
    if (Array.isArray(v)) return v.slice(0, 60).map((x) => limpar(x, p + 1));
    if (v && typeof v === "object") {
      const saida = {};
      for (const k of Object.keys(v).slice(0, 60)) saida[k] = limpar(v[k], p + 1);
      return saida;
    }
    return v;
  }

  let eventos = [];
  let carregado = false;
  let sujo = false;

  function carregar(pronto) {
    try {
      chrome.storage.local.get(CHAVE, (r) => {
        const g = r && r[CHAVE];
        eventos = Array.isArray(g) ? g : [];
        carregado = true;
        if (pronto) pronto();
      });
    } catch (e) { carregado = true; if (pronto) pronto(); }
  }

  // Grava em lote: uma disputa gera muitos eventos por segundo, e escrever a cada um
  // deixaria o navegador lento justamente na hora do lance.
  function salvar() {
    if (!sujo) return;
    sujo = false;
    try { chrome.storage.local.set({ [CHAVE]: eventos }); } catch (e) { /* fora da extensão */ }
  }

  function anotar(tipo, dados) {
    eventos.push({ em: Date.now(), tipo, dados: limpar(dados) });
    if (eventos.length > LIMITE) eventos.splice(0, eventos.length - LIMITE);
    sujo = true;
  }

  function tudo() { return eventos.slice(); }
  function quantos() { return eventos.length; }

  function limpezaGeral() {
    eventos = [];
    sujo = true;
    salvar();
  }

  /** Um arquivo com tudo o que foi observado, para o operador guardar ou me mandar. */
  function exportar(identidade) {
    const doc = {
      versao: 1,
      geradoEm: new Date().toISOString(),
      disputa: limpar(identidade || null),
      navegador: navigator.userAgent.slice(0, 200),
      eventos: eventos
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" }));
    a.download = `horasis-aprendizado-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    return eventos.length;
  }

  carregar();
  setInterval(salvar, 4000);
  window.addEventListener("beforeunload", salvar);

  const api = { anotar, tudo, quantos, exportar, limpezaGeral, limpar, salvar, CHAVE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : globalThis).__lancebotAprendizado = api;
})();
