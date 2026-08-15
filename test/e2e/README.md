# Teste ponta a ponta

Percorre o checklist do MVP em um navegador real (Chromium via Playwright),
com o SDK do Firebase substituído por um mock em memória — assim o teste roda
sem projeto Firebase, sem rede e sem custo de leituras.

## Como funciona

1. `run.mjs` copia `public/` para `test/e2e/site/`.
2. Reescreve os imports de `js/firebase.js` para os mocks de `mock/`
   (`firebase-app.js`, `firebase-auth.js`, `firebase-firestore.js`).
3. Preenche `js/config.js` com credenciais de teste.
4. Sobe um servidor estático e dirige o navegador pelo fluxo completo.

O mock do Firestore implementa documentos, coleções, `where`/`orderBy`/`limit`,
`onSnapshot`, `writeBatch` e `Timestamp`, e persiste em `localStorage` — o que
permite testar “sair e entrar novamente sem perder os dados”. Ele reproduz de
propósito um comportamento do Firestore real: documentos sem o campo usado no
`orderBy` ficam fora do resultado.

## Executando

```bash
cd test/e2e
npm install
npm test
```

Se o Chromium do Playwright estiver em um caminho próprio, aponte com:

```bash
CHROMIUM_PATH=/caminho/para/chrome npm test
```

O teste falha (código de saída 1) se qualquer verificação quebrar **ou** se
aparecer qualquer erro no console do navegador. Ao final ele grava
`desktop-dashboard.png`, `desktop-funil.png` e `mobile.png` para inspeção
visual.

## O que é verificado

Criar conta · criar workspace · dashboard e indicadores · cadastrar lead (com
conferência de que cada campo foi para o lugar certo) · lista de contatos ·
ficha e timeline · registrar interação · agendar follow-up · follow-up no
dashboard · tarefa criada automaticamente · arrastar card no Kanban · mudança
de etapa na timeline · modelo de mensagem com variáveis · abrir WhatsApp ·
marcar venda ganha · indicadores atualizados · relatórios · modelos e etapas
configuráveis · sair e entrar sem perder dados · busca global por nome e por
telefone · dados de demonstração · importação de CSV com conferência · inbox ·
layout mobile sem rolagem horizontal · ações rápidas no celular.
