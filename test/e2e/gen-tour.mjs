/**
 * Gera as capturas de tela usadas na página de apresentação
 * (public/apresentacao.html), a partir do app real rodando com os dados de
 * demonstração — nada de mockup desenhado à mão.
 *
 * Rode depois de mudanças visuais:  node test/e2e/gen-tour.mjs
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const site = path.join(here, 'site-tour');
const saida = path.join(repo, 'public', 'assets', 'tour');

/* ------------------------------------------------- prepara uma cópia ----- */

fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(path.join(repo, 'public'), site, { recursive: true });
fs.cpSync(path.join(here, 'mock'), path.join(site, 'js', 'mock'), { recursive: true });
fs.mkdirSync(saida, { recursive: true });

const fb = path.join(site, 'js', 'firebase.js');
fs.writeFileSync(fb, fs.readFileSync(fb, 'utf8')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js', './mock/firebase-app.js')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js', './mock/firebase-auth.js')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js', './mock/firebase-firestore.js'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(site, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(site, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(4180, r));
const BASE = 'http://127.0.0.1:4180';

/* ------------------------------------------------------- monta a base --- */

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,          // telas retina: o print fica nítido
  locale: 'pt-BR',
  colorScheme: 'light'
});
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#auth-screen:not(.hidden)');
await page.click('#btn-toggle-mode');
await page.fill('#auth-name', 'Joana Ribeiro');
await page.fill('#auth-email', 'joana@studioxpto.com.br');
await page.fill('#auth-password', 'demo1234');
await page.click('#auth-submit');

await page.waitForSelector('#onboarding-screen:not(.hidden)');
await page.fill('#company-name', 'Studio XPTO');
await page.fill('#company-segment', 'Consultoria');
await page.fill('#company-user', 'Joana Ribeiro');
await page.click('#onboarding-submit');
await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 20000 });

// Dados de demonstração, para as telas não aparecerem vazias.
await page.goto(`${BASE}#/configuracoes`);
await page.waitForSelector('.settings-nav');
await page.click('[data-section="dados"]');
await page.click('#btn-seed');
await page.waitForSelector('.modal [data-confirm]');
await page.click('.modal [data-confirm]');
await page.waitForFunction(
  () => [...document.querySelectorAll('#toast-root .toast')]
    .some((t) => (t.textContent || '').includes('demonstração')),
  null, { timeout: 40000, polling: 200 });

/** Remove os toasts para não aparecerem nas capturas. */
const limpar = () => page.evaluate(() => {
  document.getElementById('toast-root').innerHTML = '';
  document.getElementById('user-panel')?.setAttribute('hidden', '');
});

async function capturar(nome, rota, { espera = '.card', pausa = 900, mobile = false } = {}) {
  if (mobile) await page.setViewportSize({ width: 414, height: 896 });
  await page.goto(`${BASE}${rota}`);
  await page.waitForSelector(espera, { timeout: 15000 });
  await page.waitForTimeout(pausa);
  await limpar();
  await page.screenshot({ path: path.join(saida, `${nome}.png`) });
  if (mobile) await page.setViewportSize({ width: 1440, height: 900 });
  console.log(`  tour/${nome}.png`);
}

await capturar('dashboard', '#/dashboard', { espera: '.kpis' });
await capturar('funil', '#/funil', { espera: '.kcard' });
await capturar('contatos', '#/contatos', { espera: 'table.data tbody tr' });

// Abre a ficha do primeiro contato (timeline preenchida).
await page.locator('table.data tbody tr').first().click();
await page.waitForSelector('.timeline .tl-item', { timeout: 15000 });
await page.waitForTimeout(900);
await limpar();
await page.screenshot({ path: path.join(saida, 'contato.png') });
console.log('  tour/contato.png');

await capturar('tarefas', '#/tarefas', { espera: '.taskitem' });
await capturar('relatorios', '#/relatorios', { espera: '.kpis' });
await capturar('mobile', '#/dashboard', { espera: '.kpis', mobile: true });

await browser.close();
server.close();
fs.rmSync(site, { recursive: true, force: true });
console.log('\nCapturas em public/assets/tour/');
