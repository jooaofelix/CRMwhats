/**
 * Utilitarios de criptografia usados pelo Worker (WebCrypto, sem dependencias).
 *
 *  - verifyFirebaseIdToken: valida o ID token que o frontend envia.
 *  - getAccessToken: troca a service account por um access token do Google,
 *    para escrever no Firestore via REST.
 *  - verifyMetaSignature: confere o X-Hub-Signature-256 dos webhooks da Meta.
 */

const encoder = new TextEncoder();

/* ------------------------------------------------------------ base64 ---- */

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

/** Comparacao em tempo constante (evita timing attack em assinaturas). */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------- verificacao do ID token ---- */

let jwkCache = { keys: null, expiresAt: 0 };

/**
 * Chaves publicas do Firebase Auth em formato JWK (mais simples que os
 * certificados X.509: o WebCrypto importa JWK direto).
 */
async function firebasePublicKeys() {
  const now = Date.now();
  if (jwkCache.keys && now < jwkCache.expiresAt) return jwkCache.keys;

  const response = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!response.ok) throw new Error('Não foi possível obter as chaves públicas do Firebase.');

  const body = await response.json();
  // Respeita o cache-control devolvido pelo Google (normalmente algumas horas).
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 3600);
  jwkCache = { keys: body.keys, expiresAt: now + maxAge * 1000 };
  return body.keys;
}

/**
 * Valida assinatura, emissor, audiencia e validade do ID token.
 * @returns {Promise<{uid: string, email?: string}>}
 */
export async function verifyFirebaseIdToken(token, projectId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Token malformado.');

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJwtPart(headerPart);
  const payload = decodeJwtPart(payloadPart);

  if (header.alg !== 'RS256') throw new Error('Algoritmo do token não suportado.');

  const keys = await firebasePublicKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Chave do token não encontrada.');

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    base64UrlToBytes(signaturePart),
    encoder.encode(`${headerPart}.${payloadPart}`));
  if (!valid) throw new Error('Assinatura do token inválida.');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) throw new Error('Token expirado.');
  if (payload.iat > now + 60) throw new Error('Token emitido no futuro.');
  if (payload.aud !== projectId) throw new Error('Token de outro projeto.');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Emissor inválido.');
  if (!payload.sub) throw new Error('Token sem usuário.');

  return { uid: payload.sub, email: payload.email, name: payload.name };
}

/* --------------------------------------------- access token do Google --- */

let tokenCache = { token: null, expiresAt: 0 };

async function importServiceAccountKey(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  return crypto.subtle.importKey(
    'pkcs8', base64UrlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * Access token OAuth2 para a API do Firestore, assinando um JWT com a
 * service account. O token e reaproveitado ate perto de expirar.
 */
export async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && now < tokenCache.expiresAt - 60) return tokenCache.token;

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error('Service account não configurada (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${bytesToBase64Url(encoder.encode(JSON.stringify(header)))}.${bytesToBase64Url(encoder.encode(JSON.stringify(claims)))}`;
  const key = await importServiceAccountKey(privateKey);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  const assertion = `${unsigned}.${bytesToBase64Url(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Falha ao obter access token do Google: ${await response.text()}`);
  }

  const data = await response.json();
  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

/* ------------------------------------------- assinatura do webhook ------ */

/**
 * Confere o cabecalho X-Hub-Signature-256 enviado pela Meta.
 * Precisa do corpo BRUTO da requisicao (antes de qualquer JSON.parse).
 */
export async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));

  const expected = `sha256=${[...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0')).join('')}`;

  return timingSafeEqual(expected, signatureHeader.trim());
}
