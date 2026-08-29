# HORASIS LanceBot — extensão

Robô de lances que roda **dentro do seu navegador, na sua sessão** do Compras.gov.br.

## Por que extensão

A coleta na tela real mostrou que quase toda chamada de dados do portal exige um token
de hCaptcha (`?captcha=P1_...`), gerado pelo widget que roda **dentro da página**. Isso
torna impossível um robô por fora — de Electron, de servidor, de qualquer lugar: ele não
teria como produzir esse token. O robô tem que viver na página. Como consequência, não
existe login para implementar: você entra no gov.br do seu jeito e o robô herda a sessão.

## O que já está pronto e testado

- **Guarda de margem** — nunca desce abaixo do seu piso.
- **Trava de validade** — leitura com mais de 8s não vira lance. A tela do portal congela
  quando a conexão cai; sem isso o robô ofertaria contra preço que não existe mais.
- **Leitura do item** — pelos componentes reais (`app-card-item`,
  `app-identificacao-e-fase-item`), não por ids `pn_id_###`, que mudam a cada carga.
- **Digitação vencendo a máscara de moeda**, conferindo o valor **antes** de clicar.
  Se o campo não ficar exato, ele limpa e recusa.
- **Modal de confirmação** e leitura do desfecho pelo POST do portal.
- **Sem confirmação em 6s, o robô para** — para não repetir um lance que pode ter entrado.
- **Queda de conexão**: detecta pelo WebSocket fechando e pelo "Recarregar página" que o
  portal mostra em `app-situacao-conexao-sistema`, e recarrega sozinho. É exatamente o
  que você faz na mão hoje.
- **Sem polling**: o portal empurra por WebSocket; a mensagem é o gatilho para reler.

## O que falta

- **Painel do operador** (piso, decremento, ligar/parar). Hoje só pelo console.
- **Campo e botão de lance numa disputa ao vivo.** Nunca vi um. O robô procura dentro do
  cartão do item e **aprende** os seletores no primeiro lance que der certo, guardando
  para as próximas. Se não achar, recusa operar em vez de improvisar.

## Instalar

`chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação → esta pasta.

## Testar

Na pasta `desktop/`: `npm run test:extensao` — 18 casos contra uma réplica da tela real.
