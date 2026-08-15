/**
 * Teste ponta a ponta do Zapline CRM.
 * Serve o site real com o SDK do Firebase trocado por um mock em memória,
 * e percorre o checklist do MVP num navegador de verdade.
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const site = path.join(here, 'site');

/* ---------------------------------------------------- preparar o site ---- */

fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(path.join(repo, 'public'), site, { recursive: true });
fs.cpSync(path.join(here, 'mock'), path.join(site, 'js', 'mock'), { recursive: true });

const firebaseJs = path.join(site, 'js', 'firebase.js');
fs.writeFileSync(firebaseJs, fs.readFileSync(firebaseJs, 'utf8')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js', './mock/firebase-app.js')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js', './mock/firebase-auth.js')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js', './mock/firebase-firestore.js'));

const configJs = path.join(site, 'js', 'config.js');
fs.writeFileSync(configJs, fs.readFileSync(configJs, 'utf8')
  .replace("apiKey: 'COLE_SUA_API_KEY'", "apiKey: 'AIzaSyTESTE-chave-de-teste-0000000000'")
  .replace("projectId: 'SEU_PROJETO'", "projectId: 'zapline-teste'"));

/* --------------------------------------------------------- servidor ------ */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(site, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(site, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(4173, r));
const BASE = 'http://127.0.0.1:4173';

/* ------------------------------------------------------------- teste ----- */

const errors = [];
const results = [];
let failures = 0;

function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' });
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('popup', async (popup) => { await popup.close().catch(() => {}); });

const toastText = () => page.locator('#toast-root .toast').last().innerText().catch(() => '');
const waitToast = async (fragment, timeout = 6000) => {
  try {
    // polling por intervalo: com rAF, a aba fica congelada quando o popup
    // do WhatsApp assume o foco e o toast nunca é observado.
    await page.waitForFunction(
      (frag) => [...document.querySelectorAll('#toast-root .toast')]
        .some((t) => (t.textContent || '').toLowerCase().includes(frag.toLowerCase())),
      fragment, { timeout, polling: 100 });
    return true;
  } catch { return false; }
};

try {
  /* 0. configuração vinda das variáveis do Worker (sem editar config.js) */
  {
    const siteSemConfig = path.join(here, 'site-sem-config');
    fs.rmSync(siteSemConfig, { recursive: true, force: true });
    fs.cpSync(site, siteSemConfig, { recursive: true });
    // Devolve o config.js aos valores de exemplo do repositório.
    fs.cpSync(path.join(repo, 'public', 'js', 'config.js'),
      path.join(siteSemConfig, 'js', 'config.js'));

    const servidor = http.createServer((request, response) => {
      const rota = decodeURIComponent(request.url.split('?')[0]);
      if (rota === '/api/config') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          firebase: {
            apiKey: 'AIzaSyTESTE-chave-vinda-do-worker-000',
            authDomain: 'zapline-teste.firebaseapp.com',
            projectId: 'zapline-teste',
            storageBucket: 'zapline-teste.appspot.com',
            messagingSenderId: '000000000000',
            appId: '1:000000000000:web:abc123'
          }
        }));
        return;
      }
      let arquivo = path.join(siteSemConfig, rota === '/' ? 'index.html' : rota);
      if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
        arquivo = path.join(siteSemConfig, 'index.html');
      }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream' });
      response.end(fs.readFileSync(arquivo));
    });
    await new Promise((r) => servidor.listen(4175, r));

    const aba = await context.newPage();
    await aba.goto('http://127.0.0.1:4175', { waitUntil: 'networkidle' });
    let bootou = true;
    try {
      await aba.waitForSelector('#auth-screen:not(.hidden)', { timeout: 10000 });
    } catch { bootou = false; }
    check('0. App inicia com as credenciais vindas do Worker (config.js vazio)', bootou,
      bootou ? '' : await aba.locator('#setup-screen').innerText().catch(() => 'sem tela'));
    await aba.close();
    servidor.close();
  }

  /* 1. carregar + tela de login */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#auth-screen:not(.hidden)', { timeout: 10000 });
  check('1. Tela de login aparece', true);
  check('1b. Campo "seu nome" oculto no modo de login',
    !(await page.locator('#field-name').isVisible()));

  /* 2. criar conta */
  await page.click('#btn-toggle-mode');
  check('1c. Campo "seu nome" aparece no modo de cadastro',
    await page.locator('#field-name').isVisible());
  await page.fill('#auth-name', 'João Vendedor');
  await page.fill('#auth-email', 'joao@empresa.com.br');
  await page.fill('#auth-password', 'senha123');
  await page.click('#auth-submit');
  await page.waitForSelector('#onboarding-screen:not(.hidden)', { timeout: 10000 });
  check('2. Conta criada e onboarding exibido', true);

  /* 3. criar workspace */
  await page.fill('#company-name', 'Studio XPTO');
  await page.fill('#company-segment', 'Consultoria');
  await page.fill('#company-user', 'João Vendedor');
  await page.click('#onboarding-submit');
  await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 15000 });
  await page.waitForSelector('#view-root h1', { timeout: 10000 });
  check('3. Workspace criado e aplicação carregada', true,
    await page.locator('#workspace-name').innerText());

  /* 4. dashboard */
  const kpiCount = await page.locator('.kpis .kpi').count();
  check('4. Dashboard com indicadores', kpiCount >= 6, `${kpiCount} KPIs`);
  check('4b. Menu do usuário começa fechado',
    !(await page.locator('#user-panel').isVisible()));
  await page.click('#btn-user');
  check('4c. Menu do usuário abre ao clicar', await page.locator('#user-panel').isVisible());
  await page.keyboard.press('Escape');
  await page.click('#view-root h1');
  check('4d. Menu fecha ao clicar fora', !(await page.locator('#user-panel').isVisible()));

  /* 5. cadastrar lead */
  await page.click('#btn-new-contact');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.fill('#c-name', 'Maria Souza');
  await page.fill('#c-whatsapp', '(12) 97777-2020');
  await page.fill('#c-company', 'Souza Consultoria');
  await page.fill('#c-value', '2.500,00');
  await page.selectOption('#c-source', 'Indicação');
  await page.selectOption('#c-stage', 'proposta');
  await page.fill('#c-tags', 'QUENTE');
  await page.click('.modal [data-confirm]');
  check('5. Lead cadastrado', await waitToast('cadastrado com sucesso'));
  await page.waitForTimeout(400);
  // Detecta corrupção de formulário (foco roubado durante a digitação).
  const stored = await page.evaluate(() => {
    const s = window.__mockStore();
    const key = Object.keys(s).find((k) => /\/contacts\/[^/]+$/.test(k));
    return key ? { name: s[key].name, whatsapp: s[key].whatsapp, company: s[key].company } : null;
  });
  check('5b. Formulário grava os campos nos lugares certos',
    stored?.name === 'Maria Souza' && stored?.whatsapp === '(12) 97777-2020'
      && stored?.company === 'Souza Consultoria',
    JSON.stringify(stored));

  /* 6. lista de contatos */
  await page.goto(`${BASE}#/contatos`);
  await page.waitForSelector('table.data tbody tr', { timeout: 8000 });
  const rowText = await page.locator('table.data tbody tr').first().innerText();
  check('6. Contato aparece na lista', rowText.includes('Maria Souza'), rowText.replace(/\s+/g, ' ').slice(0, 70));

  /* 7. ficha do contato + timeline */
  await page.locator('table.data tbody tr').first().click();
  await page.waitForSelector('.contact-layout', { timeout: 8000 });
  await page.waitForSelector('.timeline .tl-item', { timeout: 8000 });
  const timeline = await page.locator('.timeline').innerText();
  check('7. Ficha aberta com timeline', timeline.includes('Lead criado'), timeline.replace(/\s+/g, ' ').slice(0, 60));

  /* 8. registrar interação */
  await page.click('[data-interaction="ligacao"]');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.fill('#i-title', 'Cliente pediu para retornar sexta-feira');
  await page.click('.modal [data-confirm]');
  check('8. Interação registrada', await waitToast('interação registrada'));
  await page.waitForTimeout(400);
  check('8b. Interação visível na timeline',
    (await page.locator('.timeline').innerText()).includes('retornar sexta-feira'));

  /* 9. programar follow-up */
  await page.click('#btn-followup');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.click('#fu-presets [data-days="1"]');
  await page.fill('#fu-note', 'Confirmar se analisou a proposta');
  await page.click('.modal [data-confirm]');
  check('9. Follow-up agendado', await waitToast('follow-up agendado'));

  /* 10. follow-up no dashboard */
  await page.goto(`${BASE}#/dashboard`);
  await page.waitForSelector('.dash-grid', { timeout: 8000 });
  await page.waitForTimeout(500);
  const dash = await page.locator('#view-root').innerText();
  check('10. Follow-up e tarefa aparecem no dashboard',
    dash.includes('Maria Souza') || dash.includes('Confirmar se analisou'),
    dash.replace(/\s+/g, ' ').slice(0, 90));

  /* 11. tarefas */
  await page.goto(`${BASE}#/tarefas`);
  await page.waitForSelector('.taskitem', { timeout: 8000 });
  check('11. Tarefa de follow-up criada automaticamente',
    (await page.locator('.taskitem').first().innerText()).includes('Confirmar'));

  /* 12. kanban + drag and drop */
  await page.goto(`${BASE}#/funil`);
  await page.waitForSelector('.kcard', { timeout: 8000 });
  const columnOf = async () => page.evaluate(() => {
    const card = document.querySelector('.kcard');
    return card?.closest('.column')?.dataset.stage || null;
  });
  const before = await columnOf();

  const card = page.locator('.kcard').first();
  // Coluna visível na viewport (as demais exigem a rolagem automática do quadro).
  const target = page.locator('.column[data-stage="contato"]');
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 60, cardBox.y + 40, { steps: 5 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 80, { steps: 12 });
  await page.mouse.up();
  const moved = await waitToast('contato realizado');
  await page.waitForTimeout(600);
  const after = await columnOf();
  check('12. Card movido no Kanban por arrastar', moved && after === 'contato',
    `${before} → ${after}`);

  /* 13. mudança de etapa registrada na timeline */
  await page.goto(`${BASE}#/contatos`);
  await page.waitForSelector('table.data tbody tr', { timeout: 8000 });
  await page.locator('table.data tbody tr').first().click();
  await page.waitForSelector('.timeline .tl-item', { timeout: 8000 });
  await page.waitForTimeout(400);
  check('13. Mudança de etapa registrada na timeline',
    (await page.locator('.timeline').innerText()).toLowerCase().includes('etapa alterada'));

  /* 14. modelo de mensagem + WhatsApp */
  const beforeTemplate = await page.evaluate(() => {
    const s = window.__mockStore();
    return Object.keys(s).filter((k) => /\/contacts\/[^/]+$/.test(k))
      .map((k) => ({ id: k.split('/').pop(), name: s[k].name, wa: s[k].whatsapp, stage: s[k].stage }));
  });
  check('13b. Contato íntegro antes do envio de mensagem',
    beforeTemplate.length === 1 && beforeTemplate[0].wa === '(12) 97777-2020',
    JSON.stringify(beforeTemplate));
  await page.click('#btn-template');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const composed = await page.inputValue('#tp-text');
  check('14. Modelo preenche variáveis do contato',
    composed.includes('Maria') && !composed.includes('{{'), composed.slice(0, 60));
  await page.click('.modal [data-confirm]');
  check('14b. WhatsApp aberto e registrado', await waitToast('whatsapp', 20000));

  /* 15. marcar como ganha */
  await page.waitForTimeout(300);
  await page.click('#btn-won');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.fill('#w-value', '3.000,00');
  await page.click('.modal [data-confirm]');
  check('15. Negociação marcada como ganha', await waitToast('venda de'));

  /* 16. indicadores atualizados */
  await page.goto(`${BASE}#/dashboard`);
  await page.waitForSelector('.kpis', { timeout: 8000 });
  await page.waitForTimeout(600);
  const kpiText = await page.locator('.kpis').innerText();
  check('16. Indicadores refletem a venda',
    /Vendas no mês\s*\n?\s*1/.test(kpiText) || kpiText.includes('3.000'),
    kpiText.replace(/\s+/g, ' ').slice(0, 120));

  /* 17. relatórios */
  await page.goto(`${BASE}#/relatorios`);
  await page.waitForSelector('.kpis', { timeout: 8000 });
  // innerText aplica text-transform do CSS — compara sem diferenciar caixa.
  const reportText = (await page.locator('#view-root').innerText()).toLowerCase();
  check('17. Relatórios calculam conversão e origem',
    reportText.includes('taxa de conversão') && reportText.includes('indicação')
      && reportText.includes('desempenho por responsável'),
    reportText.replace(/\s+/g, ' ').slice(0, 120));

  /* 18. configurações: modelos e etapas */
  await page.goto(`${BASE}#/configuracoes`);
  await page.waitForSelector('.settings-nav', { timeout: 8000 });
  await page.click('[data-section="mensagens"]');
  await page.waitForSelector('.tpl-card', { timeout: 8000 });
  const templateCount = await page.locator('.tpl-card').count();
  check('18. Modelos de mensagem criados com o workspace', templateCount >= 5, `${templateCount} modelos`);

  await page.click('[data-section="funil"]');
  await page.waitForSelector('#stage-editor', { timeout: 5000 });
  await page.fill('#stage-editor .stage-editor__row:first-child [data-field="name"]', 'Lead novinho');
  await page.click('#btn-save-stages');
  check('19. Etapas do funil configuráveis', await waitToast('etapas atualizadas'));

  /* 20. sair e entrar de novo */
  await page.click('#btn-user');
  await page.click('#btn-signout');
  await page.waitForSelector('#auth-screen:not(.hidden)', { timeout: 12000 });
  await page.fill('#auth-email', 'joao@empresa.com.br');
  await page.fill('#auth-password', 'senha123');
  await page.click('#auth-submit');
  await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 15000 });
  await page.goto(`${BASE}#/contatos`);
  await page.waitForSelector('#f-status', { timeout: 10000 });
  await page.selectOption('#f-status', 'todos');
  await page.waitForSelector('table.data tbody tr', { timeout: 10000 });
  check('20. Dados persistem após sair e entrar',
    (await page.locator('#view-root').innerText()).includes('Maria Souza'));

  /* 21. busca global */
  await page.fill('#global-search', 'Maria');
  await page.waitForSelector('#search-results .search__item', { timeout: 5000 });
  check('21. Busca global encontra por nome', true);
  await page.fill('#global-search', '97777');
  await page.waitForTimeout(400);
  const byPhone = await page.locator('#search-results').innerText();
  check('21b. Busca global encontra por telefone', byPhone.includes('Maria'), byPhone.slice(0, 50));
  await page.keyboard.press('Escape');

  /* 22. dados de demonstração */
  await page.goto(`${BASE}#/configuracoes`);
  await page.waitForSelector('.settings-nav', { timeout: 8000 });
  await page.click('[data-section="dados"]');
  await page.click('#btn-seed');
  await page.waitForSelector('.modal [data-confirm]', { timeout: 5000 });
  await page.click('.modal [data-confirm]');
  check('22. Dados de demonstração criados', await waitToast('demonstração', 25000));

  /* 22b. importação de CSV com etapa de conferência */
  await page.goto(`${BASE}#/contatos`);
  await page.waitForSelector('#btn-import', { timeout: 8000 });
  await page.click('#btn-import');
  await page.waitForSelector('#imp-file', { timeout: 5000 });
  await page.setInputFiles('#imp-file', path.join(repo, 'exemplo-contatos.csv'));
  await page.waitForSelector('#imp-preview .previewtable', { timeout: 8000 });
  const preview = await page.locator('#imp-preview').innerText();
  check('22b. Conferência do CSV antes de importar',
    preview.includes('Mariana Costa') && /4 contato/.test(preview),
    preview.replace(/\s+/g, ' ').slice(0, 70));
  await page.click('.modal [data-confirm]');
  check('22c. Contatos importados', await waitToast('importados com sucesso', 15000));

  /* 23. conversas */
  await page.goto(`${BASE}#/conversas`);
  await page.waitForSelector('.inbox', { timeout: 8000 });
  await page.waitForTimeout(800);
  const inbox = await page.locator('.inbox__list').innerText();
  check('23. Inbox lista a conversa registrada', inbox.includes('Maria'), inbox.replace(/\s+/g, ' ').slice(0, 60));

  /* 24. mobile */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}#/dashboard`);
  await page.waitForSelector('.tabbar', { timeout: 8000 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('24. Layout mobile sem rolagem horizontal', overflow <= 1, `overflow=${overflow}px`);

  const tabbarVisible = await page.locator('.tabbar').isVisible();
  check('24b. Barra de navegação mobile visível', tabbarVisible);

  await page.goto(`${BASE}#/funil`);
  await page.waitForSelector('.kcard', { timeout: 8000 });
  await page.locator('.kcard').first().click();
  await page.waitForSelector('.modal', { timeout: 5000 });
  const quick = await page.locator('.modal').innerText();
  check('25. Ações rápidas no celular', quick.includes('Abrir WhatsApp') && quick.includes('Mover para etapa'));
  await page.click('.modal [data-close]');

  await page.screenshot({ path: path.join(here, 'mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(`${BASE}#/funil`);
  await page.waitForSelector('.kcard', { timeout: 8000 });
  await page.screenshot({ path: path.join(here, 'desktop-funil.png') });
  await page.goto(`${BASE}#/dashboard`);
  await page.waitForSelector('.kpis', { timeout: 8000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(here, 'desktop-dashboard.png') });

} catch (err) {
  console.log(`\nERRO NO ROTEIRO: ${err.message}`);
  await page.screenshot({ path: path.join(here, 'erro.png') }).catch(() => {});
  failures++;
} finally {
  const realErrors = errors.filter((e) =>
    !e.includes('favicon') && !e.includes('manifest') && !/net::ERR/.test(e));
  console.log('\n--- console do navegador ---');
  if (realErrors.length) realErrors.slice(0, 25).forEach((e) => console.log(`  ! ${e}`));
  else console.log('  (nenhum erro)');
  check('26. Sem erros no console do navegador', realErrors.length === 0, `${realErrors.length} erro(s)`);

  console.log(`\n=== ${results.filter((r) => r.ok).length}/${results.length} verificações passaram ===`);
  await browser.close();
  server.close();
  process.exit(failures ? 1 : 0);
}
