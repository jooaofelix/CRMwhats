/**
 * Gera os PNGs do ícone a partir de public/assets/logo.svg, renderizando no
 * Chromium. Rode depois de alterar o logotipo:  node test/e2e/gen-icons.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const svg = fs.readFileSync(path.join(repo, 'public', 'assets', 'logo.svg'), 'utf8')
  // O PNG é estático: fixa a versão clara (o SVG troca de cor por media query).
  .replace(/@media[^}]*\{[^}]*\}[^}]*\}/s, '');

const tamanhos = [
  { arquivo: 'icon-32.png', px: 32 },
  { arquivo: 'icon-180.png', px: 180 },   // apple-touch-icon
  { arquivo: 'icon-192.png', px: 192 },
  { arquivo: 'icon-512.png', px: 512 }
];

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
});

for (const { arquivo, px } of tamanhos) {
  const page = await browser.newPage({ viewport: { width: px, height: px } });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}
     svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
  await page.screenshot({
    path: path.join(repo, 'public', 'assets', arquivo),
    omitBackground: true
  });
  await page.close();
  console.log(`  ${arquivo} (${px}×${px})`);
}

await browser.close();
