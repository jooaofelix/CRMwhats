/**
 * Testes do Worker que rodam sem rede: normalizacao de numeros, conversao de
 * tipos do Firestore, assinatura do webhook e roteamento HTTP.
 *
 * Execute com:  node --test worker/test/worker.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import worker, { normalizeNumber, numberVariants } from '../src/index.js';
import { toValue, fromValue, toFields, fromFields } from '../src/firestore.js';
import { verifyMetaSignature, timingSafeEqual } from '../src/jwt.js';

const ENV = {
  FIREBASE_PROJECT_ID: 'projeto-teste',
  WHATSAPP_VERIFY_TOKEN: 'frase-secreta',
  META_APP_SECRET: 'app-secret-teste',
  ALLOWED_ORIGINS: 'https://zapline.pages.dev'
};

const ctx = { waitUntil: (promise) => { void promise; } };
const req = (url, init) => new Request(`https://api.exemplo${url}`, init);

/* ------------------------------------------------------------- numeros -- */

test('normalizeNumber monta E.164 sem "+"', () => {
  assert.equal(normalizeNumber('(12) 97777-2020'), '5512977772020');
  assert.equal(normalizeNumber('+55 12 97777-2020'), '5512977772020');
  assert.equal(normalizeNumber('5512977772020'), '5512977772020');
  assert.equal(normalizeNumber('012 97777-2020'), '5512977772020');
  assert.equal(normalizeNumber(''), '');
  assert.equal(normalizeNumber('abc'), '');
});

test('numberVariants cobre o nono dígito', () => {
  const comNove = numberVariants('5512977772020');
  assert.ok(comNove.includes('5512977772020'));
  assert.ok(comNove.includes('551277772020'), 'deve gerar a versão sem o 9');

  const semNove = numberVariants('551277772020');
  assert.ok(semNove.includes('5512977772020'), 'deve gerar a versão com o 9');
});

/* ---------------------------------------------------------- conversoes -- */

test('conversão de tipos do Firestore preserva os valores', () => {
  const date = new Date('2026-08-14T12:30:00.000Z');
  const original = {
    name: 'Maria Souza',
    value: 2500,
    ratio: 1.5,
    active: true,
    missing: null,
    tags: ['QUENTE', 'VIP'],
    meta: { origem: 'Indicação', nivel: 2 },
    createdAt: date
  };

  const round = fromFields(toFields(original));
  assert.equal(round.name, 'Maria Souza');
  assert.equal(round.value, 2500);
  assert.equal(round.ratio, 1.5);
  assert.equal(round.active, true);
  assert.equal(round.missing, null);
  assert.deepEqual(round.tags, ['QUENTE', 'VIP']);
  assert.deepEqual(round.meta, { origem: 'Indicação', nivel: 2 });
  assert.equal(round.createdAt.toISOString(), date.toISOString());
});

test('inteiros e decimais usam representações distintas', () => {
  assert.deepEqual(toValue(10), { integerValue: '10' });
  assert.deepEqual(toValue(10.5), { doubleValue: 10.5 });
  assert.equal(fromValue({ integerValue: '42' }), 42);
});

/* ---------------------------------------------------------- assinatura -- */

async function signBody(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

test('verifyMetaSignature aceita assinatura correta e recusa adulterada', async () => {
  const body = JSON.stringify({ entry: [{ id: '1' }] });
  const signature = await signBody(body, 'app-secret-teste');

  assert.equal(await verifyMetaSignature(body, signature, 'app-secret-teste'), true);
  assert.equal(await verifyMetaSignature(`${body} `, signature, 'app-secret-teste'), false);
  assert.equal(await verifyMetaSignature(body, signature, 'outro-secret'), false);
  assert.equal(await verifyMetaSignature(body, null, 'app-secret-teste'), false);
  assert.equal(await verifyMetaSignature(body, signature, ''), false);
});

test('timingSafeEqual compara corretamente', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
});

/* ------------------------------------------------------------- rotas ---- */

test('GET /api/health informa o que está configurado, sem vazar segredos', async () => {
  const response = await worker.fetch(req('/api/health'), ENV, ctx);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.webhookConfigured, true);
  assert.equal(body.whatsappConfigured, false);
  assert.equal(body.graphApiVersion, 'v25.0');

  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('app-secret-teste'), 'não pode expor o app secret');
  assert.ok(!serialized.includes('frase-secreta'), 'não pode expor o verify token');
});

test('GET /api/config devolve null enquanto o Firebase não foi configurado', async () => {
  const response = await worker.fetch(req('/api/config'), ENV, ctx);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.firebase, null);
});

test('GET /api/config entrega as credenciais públicas e deduz os domínios', async () => {
  const env = {
    ...ENV,
    FIREBASE_API_KEY: 'AIzaSyExemplo0000000000000000000000',
    FIREBASE_PROJECT_ID: 'zapline-teste',
    FIREBASE_APP_ID: '1:000000000000:web:abc123'
  };
  const body = await (await worker.fetch(req('/api/config'), env, ctx)).json();

  assert.equal(body.firebase.apiKey, 'AIzaSyExemplo0000000000000000000000');
  assert.equal(body.firebase.authDomain, 'zapline-teste.firebaseapp.com');
  assert.equal(body.firebase.storageBucket, 'zapline-teste.appspot.com');
});

test('GET /api/config nunca expõe segredos de servidor', async () => {
  const env = {
    ...ENV,
    FIREBASE_API_KEY: 'AIzaSyExemplo0000000000000000000000',
    FIREBASE_PROJECT_ID: 'zapline-teste',
    FIREBASE_APP_ID: '1:000000000000:web:abc123',
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----segredo-----END PRIVATE KEY-----',
    FIREBASE_CLIENT_EMAIL: 'sa@zapline-teste.iam.gserviceaccount.com',
    WHATSAPP_ACCESS_TOKEN: 'EAAG-token-da-meta'
  };
  const texto = await (await worker.fetch(req('/api/config'), env, ctx)).text();

  for (const segredo of ['segredo', 'iam.gserviceaccount.com', 'EAAG-token-da-meta',
    'app-secret-teste', 'frase-secreta']) {
    assert.ok(!texto.includes(segredo), `vazou: ${segredo}`);
  }
});

test('config incompleta não é entregue pela metade', async () => {
  const env = { ...ENV, FIREBASE_API_KEY: 'AIzaSyExemplo0000000000000000000000' };
  const body = await (await worker.fetch(req('/api/config'), env, ctx)).json();
  assert.equal(body.firebase, null, 'sem projectId/appId o app não conseguiria iniciar');
});

test('OPTIONS responde o preflight de CORS', async () => {
  const response = await worker.fetch(
    req('/api/messages/send', { method: 'OPTIONS', headers: { Origin: 'https://zapline.pages.dev' } }),
    ENV, ctx);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://zapline.pages.dev');
});

test('CORS não libera origem fora da lista', async () => {
  const response = await worker.fetch(
    req('/api/health', { headers: { Origin: 'https://site-malicioso.com' } }), ENV, ctx);

  assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), 'https://site-malicioso.com');
});

test('webhook GET devolve o challenge só com o verify token correto', async () => {
  const ok = await worker.fetch(
    req('/webhook/studio-xpto?hub.mode=subscribe&hub.verify_token=frase-secreta&hub.challenge=12345'),
    ENV, ctx);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');

  const errado = await worker.fetch(
    req('/webhook/studio-xpto?hub.mode=subscribe&hub.verify_token=chute&hub.challenge=12345'),
    ENV, ctx);
  assert.equal(errado.status, 403);
});

test('webhook POST recusa payload sem assinatura válida', async () => {
  const body = JSON.stringify({ entry: [] });

  const semAssinatura = await worker.fetch(
    req('/webhook/studio-xpto', { method: 'POST', body }), ENV, ctx);
  assert.equal(semAssinatura.status, 401);

  const assinaturaErrada = await worker.fetch(
    req('/webhook/studio-xpto', {
      method: 'POST', body,
      headers: { 'X-Hub-Signature-256': 'sha256=0000' }
    }), ENV, ctx);
  assert.equal(assinaturaErrada.status, 401);
});

test('webhook POST aceita payload assinado corretamente', async () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const signature = await signBody(body, 'app-secret-teste');

  const response = await worker.fetch(
    req('/webhook/studio-xpto', {
      method: 'POST', body, headers: { 'X-Hub-Signature-256': signature }
    }), ENV, ctx);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'EVENT_RECEIVED');
});

test('envio sem autenticação é recusado com 401', async () => {
  const response = await worker.fetch(
    req('/api/messages/send', {
      method: 'POST',
      body: JSON.stringify({ companyId: 'studio-xpto', to: '5512977772020', text: 'oi' })
    }), ENV, ctx);

  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Autenticação/);
});

test('rota desconhecida devolve 404 quando não há frontend no Worker', async () => {
  const response = await worker.fetch(req('/qualquer-coisa'), ENV, ctx);
  assert.equal(response.status, 404);
});

/* ------------------------------------ Worker servindo também o frontend -- */

/** Simula o binding [assets] do wrangler.toml. */
function envComAssets() {
  const pedidos = [];
  return {
    env: {
      ...ENV,
      ASSETS: {
        fetch: (request) => {
          pedidos.push(new URL(request.url).pathname);
          return new Response('<!doctype html><title>Zapline</title>', {
            headers: { 'Content-Type': 'text/html' }
          });
        }
      }
    },
    pedidos
  };
}

test('link profundo cai no index.html quando o Worker serve o frontend', async () => {
  const { env, pedidos } = envComAssets();
  const response = await worker.fetch(req('/algum/caminho'), env, ctx);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /Zapline/);
  assert.deepEqual(pedidos, ['/index.html']);
});

test('rota /api/* desconhecida não vira index.html', async () => {
  const { env, pedidos } = envComAssets();
  const response = await worker.fetch(req('/api/inexistente'), env, ctx);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'Rota não encontrada.');
  assert.deepEqual(pedidos, [], 'a API nunca deve ser respondida com HTML');
});

test('POST em rota desconhecida não devolve HTML', async () => {
  const { env, pedidos } = envComAssets();
  const response = await worker.fetch(req('/algum/caminho', { method: 'POST' }), env, ctx);

  assert.equal(response.status, 404);
  assert.deepEqual(pedidos, []);
});

test('webhook continua funcionando com o frontend no mesmo Worker', async () => {
  const { env, pedidos } = envComAssets();
  const response = await worker.fetch(
    req('/webhook/studio-xpto?hub.mode=subscribe&hub.verify_token=frase-secreta&hub.challenge=999'),
    env, ctx);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '999');
  assert.deepEqual(pedidos, []);
});

test('webhook de workspace com id inválido não é roteado', async () => {
  const response = await worker.fetch(req('/webhook/id com espaco'), ENV, ctx);
  assert.equal(response.status, 404);
});
