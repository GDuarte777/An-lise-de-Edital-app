# Extensão — Captura de Código de Sites

Extensão de navegador (Chrome / Edge / outros baseados em Chromium,
Manifest V3) que capta o HTML da página que você está visitando, mostra em
tempo real quanto já foi captado e deixa baixar o resultado num clique.

## O que ela faz

- **Interruptor liga/desliga** no popup: ativa ou desativa a captura da aba
  atual.
- Enquanto ativa, a extensão observa o DOM da página (via `MutationObserver`)
  e recaptura o HTML sempre que a página muda (conteúdo carregado
  dinamicamente, SPA navegando entre telas, etc.), com um pequeno atraso
  para não recapturar a cada micro-alteração.
- O popup mostra o **tamanho já captado** (B / KB / MB), uma barra de
  progresso visual e o horário da última atualização.
- Botão **"Baixar código captado"**: salva o HTML captado como um arquivo
  `.html` na pasta de downloads do navegador.
- Botão **"Limpar"**: descarta a captura da aba atual.
- Se você navegar para outra página na mesma aba com a captura ligada, ela
  religa automaticamente na página nova.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione a pasta `extensao-captura-codigo/`.
5. O ícone da extensão aparece na barra de ferramentas — fixe-o para acesso
   rápido.

## Como usar

1. Abra o site cujo código você quer captar.
2. Clique no ícone da extensão e ative o interruptor.
3. Acompanhe o tamanho captado crescendo conforme a página carrega/atualiza.
4. Clique em **Baixar código captado** para salvar o HTML atual.

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | Configuração da extensão (MV3) |
| `content.js` | Roda dentro da página; captura `document.documentElement.outerHTML` e observa mudanças no DOM |
| `background.js` | Service worker; guarda quais abas estão com captura ativa e religa a captura após navegações |
| `popup.html` / `popup.css` / `popup.js` | Interface do popup (interruptor, métrica, botões) |
| `icons/` | Ícones da extensão |

## Limitações conhecidas

- Não funciona em páginas internas do navegador (`chrome://`, a própria loja
  de extensões, etc.) — o Chrome bloqueia scripts de conteúdo nelas.
- O que é captado é o HTML renderizado no momento (DOM atual), não o
  "view-source" original do servidor — isso é intencional, já que inclui o
  conteúdo montado por JavaScript.
- A captura vive em `chrome.storage.local` por aba; fechar a aba descarta a
  captura correspondente.
