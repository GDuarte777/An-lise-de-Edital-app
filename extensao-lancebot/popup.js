/**
 * O que aparece ao clicar no ícone da extensão.
 *
 * Só diagnóstico: diz se a aba atual é a sala de disputa e o que o robô está fazendo
 * ali. Quem opera é o painel dentro da página — este popup fecha ao perder o foco, e
 * um robô cujo botão de parar some quando você clica fora seria perigoso.
 */
const pino = document.getElementById("pino");
const rotulo = document.getElementById("rotulo");
const detalhe = document.getElementById("detalhe");

function mostrar(estado, texto, extra) {
  pino.className = "pino" + (estado ? " " + estado : "");
  rotulo.textContent = texto;
  detalhe.textContent = extra || "";
}

chrome.tabs.query({ active: true, currentWindow: true }, (abas) => {
  const aba = abas && abas[0];
  if (!aba || !/cnetmobile\.estaleiro\.serpro\.gov\.br/.test(aba.url || "")) {
    return mostrar("", "Fora do Compras.gov.br", "Abra o portal para o painel aparecer.");
  }

  chrome.scripting.executeScript(
    {
      target: { tabId: aba.id },
      // SEM `world: "MAIN"`. Os scripts do robô rodam no mundo ISOLADO da extensão (é o
      // padrão do manifest), e é lá que vive `window.__lancebot`. Pedir o mundo MAIN
      // aqui devolveria `undefined` e o popup diria "painel não carregou" sempre.
      func: () => {
        const b = window.__lancebot;
        if (!b) return null;
        const d = b.identificarDisputa();
        return { armados: b.itensArmados(), itens: b.cartoes().length, disputa: d };
      }
    },
    (r) => {
      const info = r && r[0] && r[0].result;
      if (!info) return mostrar("", "Painel não carregou nesta aba", "Recarregue a página do portal.");
      if (!info.itens) {
        return mostrar("", "Nenhum item nesta tela", "Abra a sala da disputa (a tela com o campo de lance).");
      }
      const d = info.disputa || {};
      const onde = [d.titulo, d.uasg ? "UASG " + d.uasg : ""].filter(Boolean).join(" · ");
      if (info.armados.length) {
        return mostrar("on", `Operando ${info.armados.length} item(ns): ${info.armados.join(", ")}`, onde);
      }
      mostrar(d.conexaoCaiu ? "alerta" : "", `${info.itens} item(ns) na tela — robô parado`, onde);
    }
  );
});
