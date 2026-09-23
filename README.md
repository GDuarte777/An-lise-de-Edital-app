# LicitAI / HORASIS — plataforma de análise de editais

## Arquitetura

```
Navegador ──► Vercel            (somente arquivos estáticos: HTML, JS, CSS)
          └─► Supabase          (TODO o backend)
                ├── Edge Function `api`  → supabase/functions/api  (rotas /api/*)
                ├── Postgres + RLS       → supabase/migrations
                └── Auth                 → JWT usado pelas rotas de IA
```

**A Vercel não executa mais nenhuma função.** Ela publica o resultado de
`npm run build` e nada além disso. Todo o backend — chat, análise de edital,
análise de certidões, geração de documentos, comparação de produtos e o
proxy do PNCP — roda como uma única Edge Function do Supabase.

Isso não é preferência de plataforma. A função serverless da Vercel vinha
morrendo na carga do módulo e devolvendo `FUNCTION_INVOCATION_FAILED` sem
executar uma linha do nosso código: nem a telemetria de boot chegava a gravar.
Sem log de dentro e sem acesso ao log da plataforma, cada correção era um
palpite. No Supabase o log da função é legível no mesmo painel em que já está o
banco de dados, e o `/api/health` responde qual versão está no ar.

## Rodar localmente

**Pré-requisitos:** Node.js 22+ e a [CLI do Supabase](https://supabase.com/docs/guides/local-development)

```bash
npm install
npm run dev        # frontend (Vite) em http://localhost:5173
npm run dev:api    # backend (Edge Function) em http://127.0.0.1:54321
```

Para o frontend falar com o backend local em vez do de produção, crie um
`.env.local` com:

```
VITE_API_BASE=http://127.0.0.1:54321/functions/v1
```

Sem essa variável, o `npm run dev` usa o backend publicado — é o que se quer na
maior parte do tempo, já que a chave de IA de cada usuário vive no banco.

## Publicar

| O quê | Como | Quando |
| --- | --- | --- |
| Frontend | A Vercel publica sozinha a cada push em `main` | automático |
| Backend | `.github/workflows/deploy-supabase.yml` | automático a cada push em `main` que toque `supabase/` |
| Backend (manual) | `npm run deploy:api` | quando precisar publicar fora do CI |

O workflow exige o segredo `SUPABASE_ACCESS_TOKEN` no repositório
(Settings → Secrets and variables → Actions), gerado em
<https://supabase.com/dashboard/account/tokens>. Depois de publicar, ele chama
`/api/health` e falha se a função não responder — uma publicação que "deu certo"
mas cuja função não executa já custou caro aqui.

## Segredos da Edge Function

Configure em **Supabase → Edge Functions → api → Secrets**:

| Segredo | Para quê | Obrigatório |
| --- | --- | --- |
| `AI_KEYS_ENCRYPTION_KEY` | Cifra as chaves de API dos usuários em repouso (`openssl rand -hex 32`). Sem ela, as chaves ficam em texto puro na tabela e o `/api/health` avisa. | recomendado |
| `SUPABASE_ACCESS_TOKEN` | Usado por `/api/supabase/sync-secrets` | opcional |
| `SUPABASE_PROJECT_REF` | idem | opcional |
| `GEMINI_API_KEY` + `ALLOW_SERVER_AI_KEY_FALLBACK=true` | Chave da plataforma, cobrada de quem publicou. Desligada por padrão: o modelo do produto é cada usuário trazer a sua. | opcional |
| `DIAGNOSTICO_ATIVO=false` | Desliga a telemetria de diagnóstico na tabela `logs_diagnostico` | opcional |

`SUPABASE_URL` e `SUPABASE_ANON_KEY` são injetados pela própria plataforma.

## Verificações

```bash
npm run lint            # tipos do frontend
npm run typecheck:edge  # tipos do backend (Deno) com o tsc do projeto
npm test                # 140 testes
npm run build           # build de produção do frontend
```

`npm run typecheck:edge` existe porque não há Deno no CI: `tipos/edge-shims.d.ts`
declara o que o runtime de borda oferece para que um erro de tipo no backend
apareça aqui, e não em produção.

## Estrutura do backend

| Arquivo | Papel |
| --- | --- |
| `supabase/functions/api/index.ts` | Entrada HTTP, CORS, limite de corpo, telemetria, 404 e tratador de erros |
| `supabase/functions/api/expresso.ts` | Camada de compatibilidade com o Express (req/res/next) |
| `supabase/functions/api/rotas.ts` | As rotas `/api/*` |
| `supabase/functions/api/nucleo.ts` | IA, extração de documentos, geradores locais, limitador de requisições |
| `supabase/functions/api/segredos.ts` | Cópia de `src/utils/segredos.ts` (guardada por teste) |
| `supabase/functions/api/pncpQuery.ts` | Cópia de `src/utils/pncpQuery.ts` (guardada por teste) |

As duas cópias existem porque o Deno só enxerga os arquivos publicados junto da
função. `tests/copiasDaBorda.test.ts` falha se elas divergirem do original.
