# Prox CRM

Mini CRM SaaS de vendas e relacionamento pelo WhatsApp, para pequenas empresas,
profissionais liberais, prestadores de serviço e equipes comerciais pequenas.

Ele resolve um problema específico: a empresa recebe contatos pelo WhatsApp,
envia orçamentos, conversa — e perde vendas porque esquece de responder, de
fazer follow-up ou de acompanhar em que etapa cada cliente está.

O Prox transforma esses contatos em um funil simples: etapas claras,
follow-up com hora marcada, alerta de cliente parado e visão do quanto está
em negociação.

---

## Sumário

- [Como funciona](#como-funciona)
- [Tecnologias](#tecnologias)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Rodando localmente](#rodando-localmente)
- [Configuração do Firebase](#configuração-do-firebase)
  - [Authentication](#authentication)
  - [Cloud Firestore](#cloud-firestore)
  - [Regras de segurança](#regras-de-segurança)
  - [Índices](#índices)
- [Modelo de dados](#modelo-de-dados)
- [Deploy no Cloudflare](#deploy-no-cloudflare)
- [Cloudflare Worker (backend seguro)](#cloudflare-worker-backend-seguro)
- [WhatsApp Cloud API](#whatsapp-cloud-api)
- [Variáveis de ambiente e secrets](#variáveis-de-ambiente-e-secrets)
- [Multiempresa, papéis e planos](#multiempresa-papéis-e-planos)
- [Testes](#testes)
- [Decisões de projeto](#decisões-de-projeto)

---

## Como funciona

O funil padrão (configurável em *Configurações › Etapas do funil*):

```
NOVO LEAD → CONTATO REALIZADO → EM NEGOCIAÇÃO → PROPOSTA ENVIADA
          → AGUARDANDO CLIENTE → FECHADO   |   PERDIDO
```

Telas:

| Tela | O que resolve |
|---|---|
| **Dashboard** | Quem responder hoje, quem precisa de follow-up, o que parou, quanto tem no funil, quanto vendeu |
| **Conversas** | Inbox: lista de conversas, conversa atual e resumo do lead ao lado |
| **Contatos** | Cadastro completo, busca, filtros, importação de CSV e exportação |
| **Funil** | Kanban com arrastar e soltar; a mudança grava no Firestore e entra na timeline |
| **Tarefas** | Tarefas e follow-ups por urgência (hoje, atrasadas, 7 dias, concluídas) |
| **Relatórios** | Leads por período/origem, conversão, desempenho por responsável, tempo até fechar |
| **Configurações** | Workspace, etapas, listas, modelos de mensagem, equipe, WhatsApp API, dados |

A integração com o WhatsApp tem **dois níveis**, e o nível 1 funciona sem
nenhuma configuração — veja [WhatsApp Cloud API](#whatsapp-cloud-api).

---

## Tecnologias

- **Frontend:** HTML, CSS e JavaScript (ES Modules) — sem framework e sem etapa
  de build. O navegador carrega os módulos direto.
- **Autenticação:** Firebase Authentication (e-mail/senha e Google).
- **Banco:** Cloud Firestore, com cache local persistente.
- **Hospedagem:** Cloudflare Workers — o mesmo Worker serve os arquivos
  estáticos e a API (WhatsApp Cloud API e webhooks).
- **Versionamento:** Git/GitHub.

Não há dependências de runtime no frontend: o SDK do Firebase é carregado por
CDN (`gstatic.com`) como módulo ES.

---

## Estrutura de pastas

```
.
├── public/                    # frontend estático servido pelo Worker
│   ├── index.html             # shell da aplicação (login, onboarding e app)
│   ├── apresentacao.html      # página pública: o que é o sistema, com prints
│   ├── manifest.webmanifest
│   ├── _headers               # cabeçalhos de segurança
│   ├── assets/                # logo.svg, PNGs do ícone e prints de tour/
│   ├── css/app.css            # design system completo (tokens, componentes, telas)
│   ├── css/landing.css        # exclusivo da página de apresentação
│   └── js/
│       ├── config.js          # CONFIGURAÇÃO — preencha aqui (só dados públicos)
│       ├── firebase.js        # inicialização e reexport do SDK
│       ├── defaults.js        # etapas, origens, tags, papéis, planos, modelos
│       ├── state.js           # estado central + seletores derivados
│       ├── data.js            # acesso ao Firestore (CRUD e listeners)
│       ├── whatsapp.js        # níveis 1 e 2 da integração, conversas
│       ├── modals.js          # modais compartilhados (contato, follow-up, etc.)
│       ├── router.js          # router por hash, com import() sob demanda
│       ├── ui.js              # toasts, modais, tratamento de erros
│       ├── utils.js           # formatação, datas, moeda, CSV, telefone
│       ├── seed.js            # dados de demonstração
│       ├── app.js             # bootstrap: auth, onboarding, shell, busca global
│       └── views/             # uma tela por arquivo
│           ├── dashboard.js   conversations.js   contacts.js   contact.js
│           └── funnel.js      tasks.js           reports.js    settings.js
│
├── worker/                    # backend seguro (Cloudflare Worker)
│   ├── src/index.js           # rotas: /api/health, /api/messages/send, /webhook/:id
│   ├── src/firestore.js       # cliente REST do Firestore (service account)
│   ├── src/jwt.js             # verificação de ID token, OAuth2 e HMAC da Meta
│   └── test/worker.test.mjs   # testes sem rede (node --test)
│
├── test/
│   ├── firestore-indexes.test.mjs  # valida os índices antes do deploy
│   └── e2e/                   # fluxo completo em Chromium (Firebase simulado)
│
├── wrangler.toml              # Worker + assets estáticos (fica na raiz)
├── .dev.vars.example          # modelo dos segredos para desenvolvimento local
│
├── firestore.rules            # regras de segurança
├── firestore.indexes.json     # índice composto da timeline
└── firebase.json
```

---

## Rodando localmente

**Não abra `index.html` pelo `file://`** — módulos ES exigem HTTP.

```bash
# 1. Preencha public/js/config.js com as credenciais do seu projeto Firebase
# 2. Suba o Worker com o frontend junto (igual à produção)
npm install
npm run dev

# Só o frontend, sem a API:
npm run dev:static
```

Acesse a URL que o `wrangler dev` imprimir (normalmente
`http://localhost:8787`).

Se o `config.js` ainda estiver com os valores de exemplo, a aplicação mostra uma
tela explicando o que preencher, em vez de quebrar.

Lembre-se de autorizar `localhost` em *Firebase › Authentication › Settings ›
Authorized domains*.

---

## Configuração do Firebase

1. Crie um projeto em <https://console.firebase.google.com>.
2. Adicione um app **Web** e copie o objeto de configuração.
3. Informe os valores à aplicação por **um** dos dois caminhos abaixo.

### Opção A — variáveis do Worker (sem editar código)

Em *Workers & Pages › seu Worker › Settings › Variables and Secrets*, crie:

| Variável | Exemplo |
|---|---|
| `FIREBASE_API_KEY` | `AIza...` |
| `FIREBASE_PROJECT_ID` | `seu-projeto` |
| `FIREBASE_APP_ID` | `1:000000000000:web:abc123` |

`FIREBASE_AUTH_DOMAIN` é deduzido do `FIREBASE_PROJECT_ID` quando ausente.
`FIREBASE_MESSAGING_SENDER_ID` e `FIREBASE_STORAGE_BUCKET` são opcionais — o
CRM não usa Firebase Storage, e o sufixo do bucket varia entre projetos
(`.appspot.com` nos antigos, `.firebasestorage.app` nos novos), então ele não
é deduzido. O frontend lê tudo isso em `GET /api/config` no carregamento.

É o caminho recomendado para produção: permite ambientes diferentes
(homologação e produção) a partir do mesmo código.

### Opção B — no repositório

Cole os valores em `public/js/config.js` e faça o commit. Este arquivo tem
**prioridade** sobre as variáveis do Worker, o que é prático no
desenvolvimento local:

```js
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: 'seu-projeto.firebaseapp.com',
  projectId: 'seu-projeto',
  storageBucket: 'seu-projeto.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:abc123'
};
```

> **Sobre a `apiKey`:** ela é pública por natureza e apenas identifica o projeto.
> Quem protege os dados são as **regras do Firestore** e a autenticação. O que
> nunca pode aparecer no frontend é o token da Meta, o app secret e a chave da
> service account — esses ficam só nas secrets do Worker.

### Authentication

Em *Authentication › Sign-in method*, habilite:

- **E-mail/senha**
- **Google**

Em *Authentication › Settings › Authorized domains*, adicione o domínio do
Worker (`<nome-do-worker>.<sub>.workers.dev`) e o domínio próprio, se houver.

### Cloud Firestore

Crie o banco em modo de produção (as regras deste repositório substituem as
padrão) e escolha a região mais próxima dos seus usuários — para o Brasil,
`southamerica-east1`.

### Regras de segurança

As regras estão em `firestore.rules`. Elas garantem que:

- nada é público — todo acesso exige autenticação;
- todo dado vive sob `companies/{companyId}/…` e só é acessível a quem tem
  documento em `companies/{companyId}/members/{uid}`;
- o papel é lido do documento de **membro**, nunca de `users/{uid}` (que o
  próprio usuário pode editar);
- só administradores mudam configurações, papéis e o código de convite;
- ninguém rebaixa o dono da empresa;
- um convidado só entra apresentando o código de convite válido, e sempre como
  vendedor.

Publicando:

```bash
npm install -g firebase-tools
firebase login
firebase use seu-projeto
firebase deploy --only firestore:rules
```

### Índices

```bash
firebase deploy --only firestore:indexes
```

`firestore.indexes.json` declara **um** índice composto: a timeline do contato
(`where contactId == X` + `orderBy createdAt`). É a única consulta do projeto
que combina filtro e ordenação — as demais telas filtram em memória, então o
Firestore resolve tudo com os índices de campo único que ele já cria sozinho.

Dois detalhes que valem lembrar:

- **Não declare índices de campo único.** O Firestore os cria automaticamente e
  rejeita a declaração com `HTTP 400 — this index is not necessary`, abortando o
  deploy inteiro. O teste em `test/firestore-indexes.test.mjs` barra isso antes.
- **Índice composto não usado não é neutro:** ele encarece toda escrita na
  coleção. Por isso a lista é curta de propósito.

Se o Firestore pedir um índice novo, o erro no console traz um link que o cria
com um clique — e o app mostra um aviso amigável em vez de falhar em silêncio.

---

## Modelo de dados

Multiempresa por subcoleção: o `companyId` é o caminho, o que torna as regras
simples e impossibilita vazamento entre workspaces.

```
users/{uid}                                   perfil + workspace ativo
companies/{companyId}                         nome, dono, plano, código de convite
companies/{companyId}/members/{uid}           papel (admin | vendedor), ativo
companies/{companyId}/settings/pipeline       etapas, origens, tags, WhatsApp (sem segredos)
companies/{companyId}/contacts/{id}           lead/cliente + oportunidade atual
companies/{companyId}/interactions/{id}       timeline (contactId, tipo, texto, autor)
companies/{companyId}/tasks/{id}              tarefas e follow-ups
companies/{companyId}/templates/{id}          modelos de mensagem
companies/{companyId}/conversations/{waId}    conversa (id = número em E.164)
companies/{companyId}/conversations/{waId}/messages/{id}
```

Campos de um contato: `name`, `phone`, `whatsapp`, `waNumber`, `email`,
`company`, `taxId`, `source`, `ownerId`/`ownerName`, `stage`, `status`,
`value`, `tags[]`, `notes`, `nextAction`, `nextFollowUpAt`, `lastContactAt`,
`createdAt`, `updatedAt`, `wonAt`/`lostAt`/`lostReason`.

**Sobre `deals`:** nesta versão cada contato carrega **uma** oportunidade em
aberto (etapa + valor), o que cobre o caso de uso de PMEs sem exigir uma
coleção separada. Quando for preciso mais de uma negociação por cliente, a
migração natural é mover `stage`/`value`/`wonAt`/`lostAt` para
`companies/{id}/deals/{dealId}` com `contactId` — o resto do modelo não muda.

**Sobre datas:** os carimbos são gravados com o relógio do cliente
(`Timestamp.now()`) em vez de `serverTimestamp()`. Isso faz o valor aparecer na
tela imediatamente, inclusive offline, sem o campo nulo que pisca enquanto o
servidor responde.

---

## Deploy no Cloudflare

Frontend e API vivem **no mesmo Worker**: um projeto, um domínio e nenhuma
configuração de CORS. O `wrangler.toml` fica na raiz do repositório justamente
para que o build do Cloudflare funcione com as opções padrão.

```
/                    → public/index.html        (arquivo estático)
/css/*, /js/*, …     → arquivos de public/      (servidos sem invocar o Worker)
/api/*, /webhook/*   → worker/src/index.js
```

### Pelo painel (deploy automático a cada push)

*Workers & Pages › Create › Workers › Connect to Git*:

| Configuração | Valor |
|---|---|
| Root directory | `/` |
| Build command | *(vazio — não há build)* |
| Deploy command | `npx wrangler deploy` |
| Branch | o branch de produção do repositório (ex.: `main`) |

O nome do Worker vem do campo `name` do `wrangler.toml` e **precisa bater com o
nome do projeto** no painel — se divergirem, o deploy publica um Worker
diferente do que você está olhando.

### Por linha de comando

```bash
npx wrangler deploy
```

Depois do primeiro deploy, adicione o domínio (`<nome-do-worker>.<sub>.workers.dev` ou
o seu domínio próprio) nos *Authorized domains* do Firebase Authentication, e
aponte o frontend para a própria origem em `public/js/config.js`:

```js
export const appConfig = {
  workerUrl: '/',   // mesma origem: frontend e API no mesmo Worker
  // …
};
```

O arquivo `public/_headers` (cabeçalhos de segurança) é aplicado
automaticamente. Não existe `_redirects`: o frontend usa roteamento por hash
(`#/dashboard`), então o servidor só recebe `/` — e um `_redirects` com
`/* → /index.html` engoliria as rotas `/api/*`.

### Hospedando o frontend separado (opcional)

Se preferir servir o frontend pelo Cloudflare Pages, aponte o projeto para o
diretório `public` e configure `appConfig.workerUrl` com a URL completa do
Worker. Nesse caso preencha `ALLOWED_ORIGINS` no `wrangler.toml` com o domínio
do Pages, senão o navegador bloqueia as chamadas por CORS.

---

## Cloudflare Worker (backend seguro)

O Worker existe por um motivo: **o token da Meta não pode ficar no navegador**.
Todo envio pela Cloud API e todo webhook passam por ele.

```bash
npm install

# Segredos (um comando por valor — eles nunca vão para o Git)
wrangler secret put FIREBASE_PROJECT_ID
wrangler secret put FIREBASE_CLIENT_EMAIL
wrangler secret put FIREBASE_PRIVATE_KEY
wrangler secret put WHATSAPP_ACCESS_TOKEN
wrangler secret put WHATSAPP_PHONE_NUMBER_ID
wrangler secret put WHATSAPP_VERIFY_TOKEN
wrangler secret put META_APP_SECRET

# Origens autorizadas (CORS) — edite [vars] em wrangler.toml
wrangler deploy
```

A service account sai de *Firebase › Configurações do projeto › Contas de
serviço › Gerar nova chave privada*. Do JSON baixado você usa `project_id`,
`client_email` e `private_key`. **Não versione esse arquivo** — ele já está no
`.gitignore`.

Para desenvolvimento local, copie `.dev.vars.example` para `.dev.vars` e rode
`npm run dev` — o `wrangler dev` sobe o frontend e a API juntos, como em
produção.

No painel, os mesmos segredos ficam em *Settings › Variables and Secrets*.

### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/health` | Diagnóstico: diz o que está configurado, sem expor segredos |
| `GET` | `/api/config` | Configuração pública do Firebase para o frontend |
| `POST` | `/api/messages/send` | Envio pela Cloud API. Exige `Authorization: Bearer <Firebase ID token>` |
| `GET` | `/webhook/:companyId` | Verificação do webhook (`hub.challenge`) |
| `POST` | `/webhook/:companyId` | Eventos da Meta (assinatura obrigatória) |

Proteções implementadas: verificação da assinatura do ID token contra as chaves
públicas do Firebase (emissor, audiência e validade conferidos), checagem de
que o usuário é membro **ativo** da empresa, validação HMAC
`X-Hub-Signature-256` com comparação em tempo constante, CORS por lista de
origens, limite de tamanho do corpo e resposta imediata ao webhook (o
processamento roda em `waitUntil`, evitando reenvios da Meta).

---

## WhatsApp Cloud API

### Nível 1 — sem API configurada (funciona de imediato)

Não exige conta de desenvolvedor, token nem aprovação. O botão **Abrir no
WhatsApp** monta a conversa pelo link oficial `wa.me` com a mensagem já
preenchida a partir de um modelo, e o envio fica registrado na timeline do
contato e no histórico da conversa.

Modelos ficam em *Configurações › Mensagens* e aceitam variáveis:

```
{{nome}}  {{nome_completo}}  {{empresa}}  {{responsavel}}
{{valor}} {{etapa}}          {{data}}     {{link}}
```

### Nível 2 — WhatsApp Cloud API oficial

1. Crie um app em <https://developers.facebook.com> e adicione o produto
   **WhatsApp**.
2. Anote o **Phone Number ID**, o **WhatsApp Business Account ID** e gere um
   **token permanente** (via usuário de sistema no Business Manager).
3. Grave os segredos no Worker (seção anterior) e faça o deploy.
4. No painel da Meta, em *WhatsApp › Configuração › Webhook*, cadastre:

   ```
   URL de callback:  https://SEU-WORKER.workers.dev/webhook/SEU-WORKSPACE-ID
   Verify token:     o valor da secret WHATSAPP_VERIFY_TOKEN
   ```

   Assine o campo **`messages`**.
5. No CRM, em *Configurações › WhatsApp API*, preencha o Phone Number ID e
   marque **Ativar envio pela Cloud API**. O botão **Testar conexão** chama
   `/api/health` e mostra o que está faltando.

O `companyId` vai na URL do webhook, então cada workspace pode ter seu próprio
número. O id do workspace aparece na aba *Workspace* das configurações.

O webhook trata mensagens recebidas, status de **entrega**, **leitura** e
**falhas**, e registra tudo no histórico do contato. Mensagens recebidas também
atualizam o "último contato" — o lead sai automaticamente do alerta de cliente
parado.

A versão da Graph API fica em `GRAPH_API_VERSION` (`wrangler.toml`), hoje
`v25.0`. Confira a
[documentação oficial da Meta](https://developers.facebook.com/docs/whatsapp/cloud-api)
antes de atualizar.

---

## Variáveis de ambiente e secrets

### Frontend — `public/js/config.js` (público, versionado, opcional)

Quando preenchido, tem prioridade sobre as variáveis do Worker.

| Chave | Descrição |
|---|---|
| `firebaseConfig.*` | Configuração Web do Firebase (pública por natureza) |
| `appConfig.workerUrl` | `'/'` quando o Worker serve o frontend; URL completa se estiverem separados; vazio = opera só no nível 1 |
| `appConfig.defaultCountryCode` | DDI padrão dos links do WhatsApp (`55`) |
| `appConfig.defaultStaleDays` | Dias sem interação para marcar um lead como parado |
| `appConfig.contactsPageSize` | Teto de contatos carregados em memória |

### Worker — `[vars]` em `wrangler.toml` (público)

| Chave | Descrição |
|---|---|
| `GRAPH_API_VERSION` | Versão da Graph API (padrão `v25.0`) |
| `ALLOWED_ORIGINS` | Origens autorizadas no CORS. Vazio quando frontend e API estão no mesmo Worker |
| `FIREBASE_API_KEY` | Chave Web do Firebase (pública) |
| `FIREBASE_PROJECT_ID` | Id do projeto. Usado também pela API para falar com o Firestore |
| `FIREBASE_APP_ID` | Id do app Web (público) |
| `FIREBASE_AUTH_DOMAIN` | Opcional — deduzido do `FIREBASE_PROJECT_ID` |
| `FIREBASE_STORAGE_BUCKET` | Opcional — não é deduzido (o sufixo varia por projeto) |
| `FIREBASE_MESSAGING_SENDER_ID` | Opcional |

### Worker — secrets (`wrangler secret put`, **nunca no Git**)

| Secret | Descrição |
|---|---|
| `FIREBASE_CLIENT_EMAIL` | E-mail da service account |
| `FIREBASE_PRIVATE_KEY` | Chave privada da service account (`\n` escapados) |
| `WHATSAPP_ACCESS_TOKEN` | Token permanente da Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Id do número no WhatsApp Business |
| `WHATSAPP_VERIFY_TOKEN` | Frase que você escolhe e repete no painel da Meta |
| `META_APP_SECRET` | App secret, valida o `X-Hub-Signature-256` |

---

## Multiempresa, papéis e planos

Cada empresa é um workspace isolado. Para adicionar alguém, o administrador
copia o **código de convite** em *Configurações › Workspace* (formato
`identificador-da-empresa.CODIGO`) e envia para a pessoa, que o informa na
tela de onboarding. O código pode ser rotacionado a qualquer momento.

| Papel | Acesso |
|---|---|
| **Administrador** | Todos os contatos e tarefas, configurações, gestão de usuários |
| **Vendedor** | Trabalha com a própria carteira de contatos e tarefas |

Novos papéis entram em `ROLES`/`ROLE_LABEL` (`public/js/defaults.js`) e nas
funções auxiliares do `firestore.rules`.

Os planos (`trial`, `solo`, `pro`, `business`) estão definidos em
`defaults.js` e gravados no documento da empresa (`plan`, `planStatus`,
`trialEndsAt`, `seats`). **Não há cobrança nesta versão** — a estrutura existe
para que um gateway de pagamento seja plugado depois sem migração de dados.

---

## Testes

**Worker e configuração** (sem rede, com `node --test`):

```bash
npm test
```

Cobre normalização de números (inclusive o nono dígito brasileiro), conversão
de tipos do Firestore, assinatura HMAC do webhook (aceita a correta, recusa
adulterada e com secret errado), CORS, verificação do webhook, recusa de envio
sem autenticação, roteamento (incluindo `/api/*` nunca respondendo HTML) e a
garantia de que `/api/config` não vaza segredos de servidor.

A validação de `firestore.indexes.json` roda junto: formato, ausência de
índices de campo único, duplicatas, e a checagem de que toda consulta com
filtro + ordenação tem um índice correspondente declarado.

**Página de apresentação:** `public/apresentacao.html` explica o sistema para
quem ainda não tem conta, com capturas reais das telas. Ela é linkada da tela
de login e fica em `/apresentacao.html`. Os prints saem de
`node test/e2e/gen-tour.mjs`, que sobe o app com os dados de demonstração e
fotografa cada tela — rode de novo depois de mudanças visuais, para a
apresentação não descrever uma interface que não existe mais.

**Ícones:** os PNGs de `public/assets/` são gerados do `logo.svg` com
`node test/e2e/gen-icons.mjs`. Ao trocar o logotipo, rode esse comando e
incremente o `?v=` nos links do `index.html` e do manifesto — `/assets/*` é
servido com cache de 7 dias, e sem o novo `v` o navegador continua mostrando
o ícone antigo.

**Frontend:** o fluxo completo do MVP foi validado em navegador real
(Chromium via Playwright) com o SDK do Firebase substituído por um mock em
memória — criar conta, criar workspace, cadastrar lead, abrir a ficha, mudar
etapa, arrastar no Kanban, registrar interação, agendar follow-up, ver o
follow-up no dashboard, usar modelo de mensagem, marcar ganha, conferir
indicadores e relatórios, sair e entrar sem perder dados, e usar no celular.

---

## Decisões de projeto

**Sem framework e sem build.** O MVP cabe confortavelmente em módulos ES. Isso
elimina a etapa de build, o `node_modules` no frontend e o custo de manter uma
árvore de dependências — e o deploy no Pages vira uma cópia de arquivos.

**Poucos listeners, filtragem em memória.** São quatro `onSnapshot`
(`contacts`, `tasks`, `templates`, `members`), com teto configurável. Bases de
PME cabem em memória, o que permite busca, filtros, Kanban e relatórios sem
novas leituras no Firestore. Timeline e mensagens são carregadas sob demanda,
por contato/conversa.

**Cache local persistente.** O Firestore relê do disco antes de ir à rede,
reduzindo leituras cobradas e mantendo a interface utilizável em conexão ruim.

**Etapas configuráveis desde o começo.** As etapas são dados, não código. As
terminais carregam as marcas `won`/`lost`, então os relatórios continuam
corretos mesmo que o cliente renomeie tudo.

**Feedback sempre visível.** Toda ação importante emite um toast de sucesso ou
de erro, com mensagens em português traduzidas dos códigos do Firebase. Nenhum
erro fica só no console.

**Mobile como caso de uso principal.** O vendedor usa o CRM no celular: menu
inferior, modais que viram bottom sheet, botões grandes e uma folha de **ações
rápidas** (abrir WhatsApp, nota, follow-up, tarefa, mover etapa, ganhar/perder)
a um toque de qualquer card — sem depender de arrastar.
