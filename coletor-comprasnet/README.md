# Coletor HORASIS — estrutura da tela de lances

Extensão de uso único. Ela **não dá lance** e **não envia nada para lugar nenhum**.
Serve para uma coisa só: descobrir como a tela de lances do Compras.gov.br é montada de
verdade, para o LanceBot parar de operar com base em chute.

## Por que ela existe

Todo localizador de campo e botão escrito até agora foi adivinhado — o robô nunca viu o
HTML real do portal. É a causa da maior parte do que não funciona. Vinte segundos numa
sessão real resolvem isso.

## O que sai, e o que não sai

**Sai:** nomes de tag, id, classe, rótulo, placeholder, cabeçalho de tabela, o caminho CSS
de cada campo e botão, a lista de requisições que a página fez e qual delas o botão
"Atualizar" dispara.

**Não sai:** todo dígito é trocado por `#` antes de gravar.

| Na tela | No arquivo |
|---|---|
| `R$ 1.250,50` | `R$ #.###,##` |
| `CNPJ 12.345.678/0001-99` | `CNPJ ##.###.###/####-##` |
| `Pregão 90013/2025` | `Pregão #####/####` |

Valor de lance, CNPJ, número de pregão e UASG não atravessam. Isso é verificado por teste
automatizado (`npm run test:coletor`, na pasta `desktop/`).

O arquivo é salvo na sua pasta de Downloads. Você decide se me manda.

## Instalar (4 passos, ~1 minuto)

1. Baixe esta pasta `coletor-comprasnet/` para o seu computador.
2. No Chrome ou Edge, abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta `coletor-comprasnet`.

## Usar

1. Entre no Compras.gov.br normalmente, do seu jeito de sempre — senha, 2FA, certificado.
   A extensão não participa do login.
2. Abra um pregão **em fase de lances**, na tela onde você daria o lance.
3. Um cartão escuro aparece no canto inferior direito.
4. **Clique em "Atualizar" do próprio portal uma vez** — é assim que descobrimos qual
   requisição a atualização dispara.
5. Espere uns 20 segundos sem fazer nada, para o coletor ver se a tela muda sozinha.
6. Clique em **"Coletar estrutura"**. O arquivo `.json` cai em Downloads.

Se o cartão não aparecer, abra o console (F12) e rode `__horasisColetor.baixar()`.

Se aparecer mais de um cartão, a tela usa quadros aninhados (iframes) — colete em todos.
Isso por si só já é uma descoberta importante.

## Depois

Me mande o `.json`. Com ele eu escrevo os localizadores reais e o mecanismo de atualização
que a tela de fato usa — em vez de heurística.

## Desinstalar

`chrome://extensions` → Remover. Ela não deixa nada para trás.
