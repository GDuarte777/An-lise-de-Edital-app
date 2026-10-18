# HORASIS — Licitações (extensão do Chrome)

Extensão Manifest V3 com duas partes independentes:

1. **Robô de lances** — opera a sala de disputa do **Comprasnet** e do
   **Licitanet**.
2. **Cadastro de fornecedor** — preenche sozinha o formulário de
   credenciamento das plataformas de licitação, com os dados que o
   fornecedor digitou uma vez.

A segunda não usa o backend nem credencial nenhuma: dá para instalar a
extensão só para ela.

## Como instalar para testar

1. `chrome://extensions` → ligar **Modo do desenvolvedor**
2. **Carregar sem compactação** → apontar para esta pasta (`extensao/`)
3. Clicar no ícone do HORASIS — abre o **painel lateral**, que fica aberto até
   você fechá-lo no ✕ — e colar **App ID** e **Token** da aba *Robô de Lances*.
   As duas são credenciais da sua conta, e o backend confere que formam um par
   (App ID de uma conta com Token de outra não passa)
4. Abrir a sala de disputa. O painel sobe sozinho.

Não há robô a cadastrar antes. O motor lê o código da compra da própria URL da
sala e o backend cria (ou recupera) o robô daquela licitação na primeira
chamada.

**Toda a configuração do robô vive aqui, não na plataforma:**

| O quê | Onde | Alcance |
| --- | --- | --- |
| Modo, faixa de redução, tempo de resposta, CNPJ | Popup, seção *Configuração do robô* | A conta inteira — vale para as disputas abertas a partir dali |
| Piso de margem, lance manual, desconto, variação | Tabela do painel, na sala de disputa | Aquele item daquela compra |

Enquanto um item estiver sem piso ele é monitorado mas não recebe lance
automático: sem piso não há como o robô saber onde parar.

## Os arquivos

| Arquivo | Onde roda | Papel |
| --- | --- | --- |
| `background.js` | Service Worker | **Único lugar que conhece o backend.** Guarda credenciais e faz a chamada ao assistente de lances. |
| `popup.html` / `popup.js` | Painel lateral | App ID, Token, configuração do robô e o botão que ativa o motor na aba. |
| `netprobe.js` | Mundo da página, `*.gov.br` | Sonda passiva: lê (nunca altera) o tráfego do portal e repassa ao motor. |
| `dispute.js` | Mundo isolado, Comprasnet | Motor da disputa: painel, leitura de itens, envio de lance, chat. |
| `licitanet-bridge.js` | Mundo da página, Licitanet | Alcança o estado interno da sala, que o mundo isolado não enxerga. |
| `licitanet-dispute.js` | Mundo isolado, Licitanet | Motor da disputa do Licitanet. |
| `cadastro-campos.js` | Mundo isolado + painel de dados | **Catálogo e regras do cadastro.** Puro, sem DOM: que dados existem, como reconhecer cada um pelo rótulo, em que formato escrever. |
| `cadastro-preenchimento.js` | Mundo isolado, portais | Varre o formulário, acha o rótulo de cada campo e escreve. |
| `cadastro.html` / `cadastro.js` | Aba da extensão | Onde o fornecedor digita os dados uma vez. O formulário é montado a partir do catálogo. |

### Por que a chamada ao backend sai do Service Worker

Um content script roda na origem do portal e está sujeito ao CSP e ao CORS da
página do governo. O Service Worker roda na origem da extensão, onde vale
`host_permissions`.

Há um segundo motivo, que pesa mais: os motores mandam **apenas o corpo** da
chamada (`{ action: 'horasis_bid_assistant', payload }`). O endereço e o token
são lidos do `chrome.storage` dentro do worker. Assim o token da conta nunca
existe dentro de um script que roda na mesma página que o portal — uma falha de
XSS no portal não entrega a credencial do fornecedor.

## Para onde a extensão fala

```
POST <API_BASE>/api/apps/<appId>/functions/bidAssistant
Authorization: Bearer <token>
apikey: <chave publicável do Supabase>
```

A primeira chamada de cada sala leva `purchase_id` (o código lido da URL) e um
objeto `portal` com a identificação que o portal já tiver publicado. É só dali
que o backend sabe de que licitação se trata. A resposta traz `bot_config.id`,
e o motor passa a enviá-lo nas chamadas seguintes — o caminho rápido, que evita
uma busca por compra em cada uma das dezenas de chamadas por minuto durante a
disputa.

`API_BASE` padrão está em `background.js` (`API_BASE_PADRAO`) e pode ser
sobrescrito em **Avançado** no popup — é por ali que se aponta a extensão para
um `supabase functions serve` local sem reempacotar nada.

O caminho da rota foi mantido no mesmo formato da implementação anterior de
propósito: trocar de backend passa a ser trocar de host, e não mexer no motor.

## Por que painel lateral, e não o popup do ícone

A janela que o Chrome abre ao clicar no ícone de uma extensão (`default_popup`)
fecha sozinha assim que perde o foco. Não há API que mude isso — qualquer
clique na página do portal a fazia sumir no meio de uma configuração.

O painel lateral (`side_panel` + `setPanelBehavior({openPanelOnActionClick})`)
fica aberto até o operador fechá-lo, e ainda convive lado a lado com a sala de
disputa em vez de cobri-la. Por isso o manifesto **não** declara
`default_popup`: declarar os dois faz o popup vencer.

O mesmo `popup.html` serve ao painel lateral. Ele é fluido (`width: 100%`)
porque a largura do painel é escolhida pelo operador, arrastando a borda.

## Como a disputa é encontrada

O portal é uma aplicação de página única. Quando o content script é injetado, o
operador quase nunca está na sala de disputa ainda — ele navega até ela depois,
e a URL muda sem recarregar a página. Por isso o motor **não desiste** se não
achar o código da compra de cara: ele vigia, por duas vias.

| Via | Como | Para quê |
| --- | --- | --- |
| Rota | `popstate`, `hashchange` e uma sondagem de 1s | `pushState` não dispara evento nenhum, e é assim que as rotas internas do portal mudam |
| Tráfego | A sonda repassa cada resposta da API; o motor procura `/compras/<código>` na URL ou `chaveCompra` no corpo | Funciona mesmo quando a rota não carrega o código |

Assim que uma das duas encontra, o painel sobe sozinho. `iniciarNaCompra` é
idempotente de propósito: as duas vias podem acertar no mesmo instante.

## Convenção de nomes

Tudo que a extensão expõe ao mundo da página usa prefixo `HZ_`/`hz-`:

| Tipo | Exemplos |
| --- | --- |
| Mensagens `postMessage` | `HZ_NET_SONDA`, `HZ_NET_CHAT_URL`, `HZ_LI_ESTADO` |
| Mensagens do runtime | `horasis_bid_assistant`, `horasis_save_config`, `horasis_dispute_status` |
| Chaves de `chrome.storage` | `hz_app_id`, `hz_token`, `hz_bot_compra_<compra>` |
| DOM e CSS | `#hz-painel-disputa`, `.hzd-*`, `#hz-li-painel`, `.hzl-*` |

Isso importa: a sonda e o motor conversam por `window.postMessage` na origem do
portal. Se um arquivo for renomeado sem o outro, eles param de se ver **sem erro
nenhum no console** — o painel simplesmente fica vazio.

## Pendente

**`content.js` não existe aqui.** Na extensão de origem ele cuidava do
monitoramento de mensagens de chat fora da sala de disputa (nas páginas
`*.gov.br` de acompanhamento) e o arquivo não veio junto dos demais.

O motor da disputa **não depende dele** — o chat dentro da sala é lido pelo
próprio `dispute.js`. O que falta é só o monitoramento das compras cadastradas
fora da disputa.

Quando o arquivo aparecer, além de aplicar o visual novo, ele precisa receber a
mesma renomeação da tabela acima; o que ele espera do resto é:

- ouvir `HZ_NET_SONDA` e responder o `HZ_NET_SONDA_OLA` da sonda
- marcar `window.__HZ_MONITOR_CHAT_ATIVO__` quando assume a ingestão do chat
  (o `dispute.js` lê essa marca para não enviar as mesmas mensagens duas vezes)
- responder `horasis_open_panel` ao popup
- ler `hz_app_id` / `hz_token` do `chrome.storage`

E o `manifest.json` volta a declarar o bloco de `content_scripts` para
`*.gov.br` com `content.js`.


## O preenchimento do cadastro

O fornecedor abre **Meus dados de fornecedor** no painel lateral, digita CNPJ,
endereço, contato, representante e conta bancária, e salva. A partir daí, ao
abrir o cadastro de qualquer plataforma da lista do manifesto, a extensão
reconhece os campos e escreve.

### Três coisas que ela nunca faz

| Nunca | Por quê |
| --- | --- |
| Inventa valor | Cadastro de fornecedor é declaração com efeito legal. Campo sem dado guardado fica **em branco** e aparece na lista "sem dado guardado" do painel da página. Select cuja opção não corresponde ao que foi guardado não é escolhido — a segunda melhor opção num select de bancos é a conta de outra pessoa. |
| Envia o formulário | Não clica em Salvar, Continuar ou Enviar. Conferir e assinar é do fornecedor. |
| Toca em senha, arquivo ou captcha | `TIPOS_IGNORADOS`, em `cadastro-preenchimento.js`. |

### Onde os dados ficam

Em `chrome.storage.local`, chave `hz_cadastro_perfil` — só neste navegador.
**Não vão para o backend do HORASIS**, e por isso não há nada a sincronizar
entre contas: para levar o perfil a outro computador existem os botões
*Exportar JSON* e *Importar JSON*. O arquivo exportado leva CPF, PIS e conta
bancária dentro; é documento, não configuração.

Pelo mesmo motivo **nenhum dado pessoal está commitado aqui**. O repositório
vira `public/extensao-horasis.zip`, que qualquer usuário da plataforma baixa —
um perfil de exemplo com CPF real viajaria junto. Quem já tem os dados prontos
importa o JSON.

### Como um campo é reconhecido

Em ordem, até achar: `<label for>`, `<label>` em volta, `aria-label`,
`aria-labelledby`, e então proximidade — rótulo irmão, célula anterior da
tabela, texto solto antes do campo. O que sai dali vai para
`reconhecerCampo()`, que pontua contra o catálogo. Três regras merecem nota:

- **Especificidade vence ordem.** "Nome fantasia" e "Nome" casam os dois com o
  mesmo rótulo; ganha o padrão que exige mais letras. Sem isso, acrescentar um
  campo ao catálogo mudaria em silêncio o destino de outro.
- **A seção desempata.** "Cidade" no endereço e "Cidade" na agência são o mesmo
  rótulo; o título da seção em volta decide. O mesmo separa o "Nome" do
  contato do "Nome" do representante.
- **Cada rótulo serve a um campo só.** A caixinha do dígito verificador fica na
  mesma linha da agência e não tem rótulo próprio — sem essa regra ela herdaria
  o rótulo do vizinho e receberia o número da agência inteiro. O que não tem
  rótulo e vem logo depois da agência ou da conta é o dígito dela; o mesmo vale
  para o "Isento" ao lado da inscrição estadual.

### Por que roda em todo `*.gov.br`

São 27 estados, cada um com seu portal, e nenhum padrão de domínio entre eles.
`*.gov.br` já estava no manifesto por causa da sonda do robô de lances, então
cobrir os portais estaduais não pede permissão nova. Os portais privados
(Licitanet, BLL, BNC, Portal de Compras Públicas, Licitar Digital, BBMNet e
outros) estão listados um a um.

Para não pesar nas páginas que não são cadastro, a varredura automática só
acontece em página com pelo menos 6 campos de formulário, e o painel só sobe
quando 4 campos do catálogo foram reconhecidos — um formulário de busca de
licitação também tem CNPJ. Plataforma fora da lista se resolve pelo botão
**Preencher esta página agora**, que injeta o preenchedor na aba aberta.

### O que é testado

`tests/cadastroCampos.test.ts` exercita o catálogo puro (reconhecimento,
formatação, escolha de opção). `tests/cadastroPreenchimento.test.ts` monta em
jsdom um formulário com a estrutura dos portais reais — rótulo em `<label
for>`, layout em tabela, passo escondido do assistente, dígito sem rótulo — e
confere o que foi escrito. Os dois carregam os arquivos da extensão num escopo
isolado, com `new Function`, porque content script clássico não tem `export`.
