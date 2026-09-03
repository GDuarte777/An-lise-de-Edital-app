# HORASIS LanceBot — extensão

Motor de lances rodando **dentro do seu navegador, na sua sessão** do Compras.gov.br.

## O que isto é

**O robô.** Você entra no Compras.gov.br como sempre entra, abre a disputa, e o painel
aparece no canto da tela já sabendo qual disputa é e quais itens estão abertos. Configura
piso e decremento por item, liga.

Não há login a fazer aqui, nem sessão a verificar: a sessão é a do seu próprio navegador,
na página de verdade. Essa é a razão de ser desta versão — a tentativa de fazer isso por
aplicativo instalado gastou quatro correções tentando responder "existe sessão?", e errou
todas pelo mesmo motivo: a URL que ele abria para decidir. Aqui a pergunta não existe.

O aplicativo em `desktop/` continua servindo para análise de edital, e compartilha este
mesmo motor de leitura (`scripts/gerar-motor.cjs`, com teste que falha se divergirem).

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

## A tela real (coleta em disputa ao vivo)

O campo e o botão finalmente foram observados, e nenhum dos dois era o que se supunha:

- **não existe `app-card-item`** na tela de disputa — os itens são `div` dentro de
  `p-dataview`. Procurar por esse componente devolvia lista vazia;
- o **campo de lance** é um `input` sem rótulo, sem `aria-label` e sem `formcontrolname`,
  cujo **`id` é o número do item** (`2`, `3`). É a melhor âncora possível: o campo já diz
  de que item ele é. Cuidado: `#2` não é seletor CSS válido, então em todo lugar se usa
  `input[id]` + teste do valor;
- o **botão** só se identifica pelo
  `title="Clique aqui ou tecle enter para enviar seu lance."`;
- **não há modal de confirmação**: o POST sai direto do clique, em ~86ms, para
  `POST /comprasnet-disputa/v1/compras/<n>/itens/<item>/lances`;
- o desfecho aparece num toast: **"Lance registrado com sucesso."**

## O que falta

- Layouts que o portal ainda não mostrou. Fora das regras acima o robô cai na heurística
  antiga e **aprende** os seletores no primeiro lance que der certo; se não achar nada,
  recusa operar em vez de improvisar.

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
