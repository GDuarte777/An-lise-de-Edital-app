# Extensão — Captura de Código de Sites

Extensão de navegador (Chrome / Edge / outros baseados em Chromium,
Manifest V3) que capta o HTML das páginas que você visita, acumula tudo num
**acervo único** (persiste entre abas, sites e até reinícios do navegador) e
deixa baixar o resultado consolidado em JSON.

## O que ela faz

- **Interruptor liga/desliga** no popup: ativa ou desativa a captura da aba
  atual.
- Enquanto ativa, a extensão observa o DOM da página (via `MutationObserver`)
  e recaptura o HTML sempre que a página muda (conteúdo carregado
  dinamicamente, SPA navegando entre telas, etc.), com um pequeno atraso
  para não recapturar a cada micro-alteração.
- **O acervo é acumulativo e global**: cada página captada vira uma entrada
  (por URL) num único acervo compartilhado. Trocar de aba, fechar a aba ou
  captar em várias abas ao mesmo tempo **não zera nada** — o total só cresce.
  Recapturar a mesma URL atualiza o conteúdo daquela entrada (mantém a data
  da primeira captura, atualiza a da última).
- O popup mostra o **total acumulado** (B / KB / MB), quantas páginas estão
  no acervo, a lista das páginas captadas (título, URL e tamanho de cada
  uma) e o horário da última atualização.
- Botão **"Baixar tudo (JSON)"**: baixa um único arquivo `.json` com todas as
  páginas do acervo (`url`, `titulo`, `tamanhoBytes`, `capturadoEm`,
  `atualizadoEm` e `html` de cada uma) — pronto para importar em outra
  plataforma.
- Botão **"Limpar tudo"**: apaga o acervo inteiro (pede confirmação, porque é
  destrutivo).
- Se você navegar para outra página na mesma aba com a captura ligada, ela
  religa automaticamente na página nova.

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
2. Clique no ícone da extensão e ative o interruptor.
3. Navegue à vontade — dentro da mesma aba, em abas novas, em sites
   diferentes. Ligue o interruptor em cada aba que quiser captar; o total no
   popup vai somando tudo.
4. Quando quiser, clique em **Baixar tudo (JSON)** para exportar o acervo
   inteiro acumulado até aquele momento.

## Formato do JSON exportado

```json
{
  "geradoEm": "2026-09-25T12:00:00.000Z",
  "totalPaginas": 2,
  "totalBytes": 48213,
  "paginas": [
    {
      "url": "https://exemplo.com/pagina-a",
      "titulo": "Página A",
      "tamanhoBytes": 21034,
      "capturadoEm": "2026-09-25T11:58:10.000Z",
      "atualizadoEm": "2026-09-25T11:59:40.000Z",
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
| `background.js` | Service worker; mantém o acervo acumulado (`paginas_captadas`) e quais abas estão com captura ativa (`abas_ativas`), religando a captura após navegações |
| `popup.html` / `popup.css` / `popup.js` | Interface do popup (interruptor, métrica do acervo, lista de páginas, botões) |
| `icons/` | Ícones da extensão |

## Limitações conhecidas

- Não funciona em páginas internas do navegador (`chrome://`, a própria loja
  de extensões, etc.) — o Chrome bloqueia scripts de conteúdo nelas.
- O que é captado é o HTML renderizado no momento (DOM atual), não o
  "view-source" original do servidor — isso é intencional, já que inclui o
  conteúdo montado por JavaScript.
- O acervo vive em `chrome.storage.local` da extensão — some se você
  desinstalar a extensão ou limpar os dados dela manualmente, mas
  **sobrevive** a fechar abas, fechar o navegador e reiniciar o computador.
- Cada URL distinta é uma entrada; recapturar a mesma URL substitui o
  conteúdo daquela entrada (não duplica).
