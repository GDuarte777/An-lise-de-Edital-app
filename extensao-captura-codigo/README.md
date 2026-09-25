# Extensão — Captura de Código de Sites

Extensão de navegador (Chrome / Edge / outros baseados em Chromium,
Manifest V3) que capta o HTML das páginas que você visita, acumula **todas**
as capturas num acervo único (persiste entre abas, sites e reinícios do
navegador) e deixa baixar o resultado consolidado em JSON. A interface abre
num **painel lateral** que fica fixo enquanto você navega — só fecha quando
você quiser.

## O que ela faz

- **Painel lateral fixo**: clicar no ícone abre um painel lateral que
  **permanece aberto** enquanto você navega e troca de abas. Ele só fecha
  quando você fecha o painel (ou minimiza a janela). Diferente de um popup
  comum, não some ao clicar fora.
- **Interruptor liga/desliga**: ativa ou desativa a captura da aba atual.
- Enquanto ativa, a extensão observa o DOM da página (via `MutationObserver`)
  e recaptura o HTML sempre que a página muda (conteúdo carregado
  dinamicamente, SPA navegando entre telas, etc.), com um pequeno atraso
  para não recapturar a cada micro-alteração.
- **O acervo é acumulativo, global e append-only**: cada captura vira um
  **novo registro** adicionado à lista. Trocar de aba, navegar entre páginas,
  fechar a aba ou captar em várias abas ao mesmo tempo **não apaga nada** — o
  total só cresce. (Capturas idênticas seguidas da mesma URL são ignoradas
  para não empilhar cópias iguais; qualquer mudança real de conteúdo entra
  como registro novo.)
- O painel mostra o **total acumulado** (B / KB / MB), quantas capturas e
  quantas páginas distintas estão no acervo, a lista das capturas (título,
  URL e tamanho de cada uma) e o horário da última captura — tudo atualizado
  ao vivo.
- Botão **"Baixar tudo (JSON)"**: baixa um único arquivo `.json` com todas as
  capturas do acervo (`url`, `titulo`, `tamanhoBytes`, `capturadoEm` e `html`
  de cada uma) — pronto para importar em outra plataforma.
- Botão **"Limpar tudo"**: apaga o acervo inteiro (pede confirmação, porque é
  destrutivo).
- Se você navegar para outra página na mesma aba com a captura ligada, ela
  religa automaticamente na página nova.
- A extensão pede `unlimitedStorage`, então o acervo não esbarra no limite de
  ~10 MB do armazenamento padrão (que antes podia travar a gravação e parecer
  que "zerava").

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione a pasta `extensao-captura-codigo/`.
5. O ícone da extensão aparece na barra de ferramentas — fixe-o para acesso
   rápido.

Se já tinha instalado uma versão anterior, clique em **Recarregar** no card
da extensão em `chrome://extensions` em vez de instalar de novo.

## Como usar

1. Abra o primeiro site cujo código você quer captar.
2. Clique no ícone da extensão — o painel lateral abre e fica fixo.
3. Ative o interruptor. Navegue à vontade — mesma aba, abas novas, sites
   diferentes. Ligue o interruptor em cada aba que quiser captar; o painel
   permanece aberto e o total vai somando tudo, ao vivo.
4. Quando quiser, clique em **Baixar tudo (JSON)** para exportar o acervo
   inteiro acumulado até aquele momento.

## Formato do JSON exportado

```json
{
  "geradoEm": "2026-09-25T12:00:00.000Z",
  "totalCapturas": 3,
  "totalPaginas": 2,
  "totalBytes": 72590,
  "capturas": [
    {
      "url": "https://exemplo.com/pagina-a",
      "titulo": "Página A",
      "tamanhoBytes": 21034,
      "capturadoEm": "2026-09-25T11:58:10.000Z",
      "html": "<html>...</html>"
    }
  ]
}
```

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | Configuração da extensão (MV3) |
| `content.js` | Roda dentro da página; captura `document.documentElement.outerHTML`, observa mudanças no DOM e manda cada captura para o background |
| `background.js` | Service worker; mantém o acervo append-only (`capturas`) e quais abas estão com captura ativa (`abas_ativas`), religando a captura após navegações e abrindo o painel lateral ao clicar no ícone |
| `popup.html` / `popup.css` / `popup.js` | Interface do painel lateral (interruptor, métrica do acervo, lista de capturas, botões) |
| `icons/` | Ícones da extensão |

## Limitações conhecidas

- Não funciona em páginas internas do navegador (`chrome://`, a própria loja
  de extensões, etc.) — o Chrome bloqueia scripts de conteúdo nelas.
- O que é captado é o HTML renderizado no momento (DOM atual), não o
  "view-source" original do servidor — isso é intencional, já que inclui o
  conteúdo montado por JavaScript.
- O acervo vive em `chrome.storage.local` da extensão — some se você
  desinstalar a extensão ou usar "Limpar tudo", mas **sobrevive** a trocar de
  aba, fechar abas, fechar o navegador e reiniciar o computador.
- O painel lateral requer Chrome/Edge 114+ (API `sidePanel`).
