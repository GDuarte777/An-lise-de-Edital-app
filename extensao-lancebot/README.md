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

## O que o painel mostra

- **Sem login da plataforma, por ora.** A porta de entrada HORASIS foi desligada para
  que o robô possa ser testado em disputa de verdade — o painel abre direto. O código do
  login (`horasis.js` e `fundo.js`) continua no pacote, inteiro, para voltar depois.
- **Qual disputa é** — modalidade, número, UASG e órgão, lidos do cabeçalho do portal.
- **Cronômetro em tempo real** do fim dos lances, ficando vermelho no último minuto.
- **Três abas**: Aguardando · Em disputa · Encerrados, com a contagem em cada uma.
- **Melhor lance e Meu lance** por item, com destaque quando você lidera.
- **Lance mínimo (R$)** — o limite que o robô respeita.
- **Intervalo mínimo** — quanto ele desce por lance, em R$ ou %.
- **Permitir lances em casas decimais** — os **centavos** do seu mínimo viram margem de
  briga. Configurado R$ 550,99, se um concorrente cobrir o valor nos centavos o robô
  disputa centavo a centavo **até R$ 550,00** e para ali. Os reais do seu mínimo continuam
  intocáveis. Com a opção desligada, o robô avisa o empate em vez de ficar parado calado.
- **Disputar apenas nos segundos finais** — só oferta no fim. Falha fechada: se não
  conseguir ler o tempo restante, não oferta, porque ofertar cedo quando você pediu para
  esperar é pior do que não ofertar.
- **Classificação** — sua posição pelos lances e propostas que o portal mostra na tela.
  Não é a classificação oficial do pregoeiro; o painel diz isso.
- **Chat da disputa**, lido da resposta que o próprio portal busca — mais confiável do
  que depender de a gaveta de mensagens estar aberta.
- **Próximo lance** aparece antes de você ligar, calculado pela mesma guarda que decide
  de verdade.

Cada item liga e para sozinho. Um item que atinge o mínimo não derruba os outros.

## O gravador de aprendizado

Tudo o que acontece na disputa fica anotado: como a tela estava, o que o portal
respondeu, o que o robô decidiu e o que aconteceu depois. É esse material que vai
permitir escrever um robô executável fora do navegador sem descobrir o portal de novo.

Fica em `chrome.storage.local`, na sua máquina. **Nada sai daí sozinho** — só quando você
clica em "Exportar aprendizado". CPF e CNPJ são mascarados mesmo sendo seus: identificam
pessoas e não fazem falta para entender a mecânica. Valor, horário e estrutura ficam
inteiros, porque são exatamente o que o robô futuro precisa.

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
