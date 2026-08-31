# HORASIS LanceBot — extensão

Motor de lances rodando **dentro do seu navegador, na sua sessão** do Compras.gov.br.

## O que isto é, e o que não é

**O robô é o aplicativo instalado, em `desktop/`.** Esta extensão é o mesmo motor de
leitura rodando no Chrome, para quem preferir operar direto no navegador.

Vale registrar o raciocínio errado que quase fez esta extensão virar o produto: a coleta
mostrou que quase toda chamada de dados do portal exige um token de hCaptcha
(`?captcha=P1_...`), gerado pelo widget que roda **dentro da página** — logo, o robô tem
que viver numa página. Isso está certo. O que não segue é "logo, tem que ser extensão":
um aplicativo Electron **também tem uma página**, e ela é dele.

E essa diferença decide o caso. A sessão do gov.br cai em poucos minutos sem interação;
numa aba do navegador a aba vai para segundo plano, o SPA para de renovar o token e a
sessão morre — por isso se atualiza a página o tempo todo. No aplicativo a janela é dele,
então ele mantém a sessão viva sozinho (ver `desktop/src/main/auth/sessao-viva.ts`).
É por isso que os robôs de mercado são aplicativos instalados.

**Limitação desta extensão, e ela é séria:** aqui a sessão NÃO é mantida viva, porque não
há como. Se a sessão cair, o robô para. Para deixar ligado sem acompanhar, use o
aplicativo.

O motor de leitura é literalmente o mesmo arquivo nos dois — `desktop` embute
`margem.js` e `conteudo.js` via `scripts/gerar-motor.cjs`, com teste que falha se
divergirem.

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

- **Painel do operador** — no canto inferior direito da sala. Escolhe o item, o piso e o
  decremento, liga e para. Mostra o melhor lance, o seu lance e **qual seria o próximo**,
  antes de você ligar. Fica em Shadow DOM: o CSS do portal não o afeta, e — o que
  importa mais — os campos dele não podem ser confundidos com o campo de lance do item,
  porque `querySelector` não atravessa shadow root.

## O que falta

- **Campo e botão de lance numa disputa ao vivo.** Nunca vi um. O robô procura dentro do
  cartão do item e **aprende** os seletores no primeiro lance que der certo, guardando
  para as próximas. Se não achar, recusa operar em vez de improvisar.

## Instalar

Baixe o `HORASIS-LanceBot-Extensao.zip` da Release, descompacte numa pasta fixa e:
`chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação → essa pasta.
(Ou aponte direto para esta pasta, se estiver com o projeto clonado.)

## Usar

1. Entre no gov.br normalmente e abra a sala da disputa.
2. O painel aparece sozinho no canto inferior direito.
3. Escolha o item, informe o **piso** (nunca oferta abaixo dele) e o **decremento**.
4. Confira o "Próximo lance" que o painel mostra. Só então clique em **Ligar robô**.

Enquanto estiver ligado, os campos ficam travados e o rodapé mostra cada lance de
concorrente, cada envio e cada motivo de parada. Qualquer parada é definitiva: o robô não
volta sozinho, você decide.

## Testar

Na pasta `desktop/`: `npm run test:extensao` — 44 casos contra uma réplica da tela real,
incluindo o painel.
