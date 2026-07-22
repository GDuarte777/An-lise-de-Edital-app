# Guia de Implantação (Deploy) na Vercel — Plataforma HORASIS

Este guia detalha os passos, configurações e as **importantes considerações arquiteturais** necessárias para implantar esta plataforma na **Vercel**.

---

## ⚠️ Alerta de Arquitetura Importante: Vercel vs. Servidor Persistente

Antes de prosseguir, é fundamental compreender como a infraestrutura da Vercel afeta o funcionamento do **LanceBot**:

1. **Ambiente Serverless (Sem Estado):** 
   A Vercel é uma plataforma de hospedagem baseada em funções Serverless (AWS Lambda). Isso significa que as requisições para as rotas `/api/*` geram instâncias temporárias que ligam, processam a requisição e desligam em poucos segundos.
2. **Perda de Memória e Timers (Robôs de Lances):**
   A plataforma possui lógicas de robôs em tempo real que utilizam `setInterval`, loops em segundo plano e estados armazenados na variável `activeBots` em memória no servidor Node.js. **Na Vercel, essa memória é apagada constantemente.** Seus robôs ativos de lances serão interrompidos ou reiniciados do zero quase que imediatamente.
3. **Execução de Script Python (`lance_bot.py`):**
   Processos secundários em segundo plano (como a execução do robô Python nativo para simular navegação ou lances) não são suportados de forma contínua em funções serverless padrão da Vercel devido ao limite de tempo de execução (timeout de 10s na conta gratuita).

### 💡 Recomendação de Infraestrutura
* **Somente o Frontend na Vercel:** Se deseja usar a Vercel, o ideal é hospedar **apenas o Frontend** (Vite + React) nela, e apontar as requisições de API para um servidor persistente dedicado (como **Google Cloud Run** — que você já possui ativo —, **Railway**, **Render** ou uma **VPS dedicada** no DigitalOcean/AWS EC2).
* **Manter em Cloud Run:** O ambiente atual em que sua plataforma está sendo executada (Cloud Run com containers) é a arquitetura **perfeita e recomendada**, pois mantém o processo do Node.js ativo 24 horas por dia, preservando os robôs de lances na memória e permitindo a execução paralela de processos Python de forma contínua.

---

## Passo a Passo para Deploy Completo na Vercel

Se mesmo com as limitações de backend você deseja prosseguir ou hospedar a plataforma na Vercel, siga as instruções abaixo:

### 1. Configurações de Build na Vercel

Ao importar o seu repositório Git na Vercel, preencha os seguintes parâmetros de Build:

* **Framework Preset:** `Vite` (ou `Other` caso queira buildar o pacote completo)
* **Root Directory:** `./` (Diretório raiz)
* **Build Command:** `npm run build`
* **Output Directory:** `dist`
* **Install Command:** `npm install`

---

### 2. Configuração do `vercel.json`
Para que a Vercel saiba como direcionar as rotas estáticas do frontend e as rotas de API para a função serverless do Node.js, crie um arquivo chamado `vercel.json` na raiz do seu projeto com o seguinte conteúdo:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.ts",
      "use": "@vercel/node"
    },
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": { "distDir": "dist" }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "server.ts"
    },
    {
      "src": "/assets/(.*)",
      "dest": "/dist/assets/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/dist/index.html"
    }
  ]
}
```

---

### 3. Variáveis de Ambiente Necessárias (Environment Variables)

Você deve cadastrar todas as variáveis de ambiente necessárias nas configurações do projeto na aba **Settings > Environment Variables** na Vercel. 

#### Variáveis Necessárias (Server-Side e Integrações):
Configure exatamente conforme os limites do seu projeto:

| Nome da Variável | Descrição / Exemplo | Requerido |
| :--- | :--- | :---: |
| `GEMINI_API_KEY` | Sua Chave de API do Gemini para os fallbacks globais de IA. | Sim |
| `VITE_SUPABASE_URL` | URL do seu projeto Supabase para buscar chaves e persistência. | Sim |
| `VITE_SUPABASE_ANON_KEY` | Chave anônima pública do Supabase. | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço (Service Role) caso use operações de admin no banco. | Opcional |

*Nota: As variáveis com prefixo `VITE_` serão expostas de forma segura ao código client-side do React em tempo de build.*

---

## Resumo Arquitetural: Onde hospedar cada parte?

| Componente | Hospedagem Recomendada | Motivo |
| :--- | :--- | :--- |
| **Frontend (Interface React)** | **Vercel** ou **Netlify** | Entrega estática ultra-rápida global via CDN. |
| **Backend & Robô (Node.js/Python)** | **Google Cloud Run** / **Railway** | Mantém conexão persistente ativa, executa loops de lances (`activeBots`), scripts Python e gerencia websockets de forma ininterrupta. |
