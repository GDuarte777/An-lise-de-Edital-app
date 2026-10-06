# HORASIS — Robô de Lances (extensão do Chrome)

Extensão Manifest V3 que opera a sala de disputa do **Comprasnet** e do
**Licitanet**.

## Como instalar para testar

1. `chrome://extensions` → ligar **Modo do desenvolvedor**
2. **Carregar sem compactação** → apontar para esta pasta (`extensao/`)
3. Clicar no ícone do HORASIS e colar **App ID** e **Token** da página
   *Conectar Robô*
4. Abrir a sala de disputa. O painel sobe sozinho.

Não há robô a cadastrar antes. O motor lê o código da compra da própria URL da
sala e o backend cria (ou recupera) o robô daquela licitação na primeira
chamada. O que o operador configura é o **piso de margem**, item a item, na
tabela do painel — e enquanto um item estiver sem piso ele é monitorado mas não
recebe lance automático.

## Os arquivos

| Arquivo | Onde roda | Papel |
| --- | --- | --- |
| `background.js` | Service Worker | **Único lugar que conhece o backend.** Guarda credenciais e faz a chamada ao assistente de lances. |
| `popup.html` / `popup.js` | Popup da barra | App ID, Token e o botão que ativa o motor na aba. |
| `netprobe.js` | Mundo da página, `*.gov.br` | Sonda passiva: lê (nunca altera) o tráfego do portal e repassa ao motor. |
| `dispute.js` | Mundo isolado, Comprasnet | Motor da disputa: painel, leitura de itens, envio de lance, chat. |
| `licitanet-bridge.js` | Mundo da página, Licitanet | Alcança o estado interno da sala, que o mundo isolado não enxerga. |
| `licitanet-dispute.js` | Mundo isolado, Licitanet | Motor da disputa do Licitanet. |

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
