/**
 * Prox CRM — backend seguro (Cloudflare Worker).
 *
 * Responsabilidades:
 *  1. Guardar as credenciais da Meta. O token NUNCA chega ao navegador.
 *  2. Enviar mensagens pela WhatsApp Cloud API para usuarios autenticados.
 *  3. Receber o webhook da Meta (mensagens, entrega, leitura, falhas) e
 *     registrar tudo no Firestore, ligado ao contato do CRM.
 *
 * Endpoints:
 *   GET  /api/health                  diagnostico (sem expor segredos)
 *   POST /api/messages/send           envio autenticado (Firebase ID token)
 *   GET  /webhook/:companyId          verificacao do webhook (hub.challenge)
 *   POST /webhook/:companyId          eventos da Meta
 */

import { verifyFirebaseIdToken, verifyMetaSignature, timingSafeEqual } from './jwt.js';
import {
  getDocument, createDocument, patchDocument, queryCollection, incrementField
} from './firestore.js';

const DEFAULT_GRAPH_VERSION = 'v25.0';
const MAX_BODY_BYTES = 256 * 1024;

/* ------------------------------------------------------------- helpers -- */

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',').map((o) => o.trim()).filter(Boolean);

  // Sem lista configurada, ecoa a origem (util em desenvolvimento).
  const allowOrigin = allowed.length
    ? (allowed.includes(origin) ? origin : allowed[0])
    : (origin || '*');

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(data, { status = 200, request, env, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(request ? corsHeaders(request, env) : {}),
      ...headers
    }
  });
}

const nowIso = () => new Date();

/** Normaliza um numero para E.164 sem "+" (formato usado pela Meta). */
export function normalizeNumber(raw, countryCode = '55') {
  let digits = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.length <= 11) digits = countryCode + digits;
  return digits.slice(0, 15);
}

/**
 * Numeros brasileiros circulam com e sem o nono digito: a Meta costuma
 * devolver o formato sem ele. Gera as variacoes para casar com o cadastro.
 */
export function numberVariants(number) {
  const variants = new Set([number]);
  const match = /^55(\d{2})(\d+)$/.exec(number);
  if (match) {
    const [, ddd, rest] = match;
    if (rest.length === 9 && rest.startsWith('9')) variants.add(`55${ddd}${rest.slice(1)}`);
    if (rest.length === 8) variants.add(`55${ddd}9${rest}`);
  }
  return [...variants];
}

/* -------------------------------------------------------- autenticacao -- */

/** Valida o ID token e confirma que o usuario e membro ativo da empresa. */
async function authorize(request, env, companyId) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) {
    const error = new Error('Autenticação ausente.');
    error.status = 401;
    throw error;
  }

  let user;
  try {
    user = await verifyFirebaseIdToken(header.slice(7), env.FIREBASE_PROJECT_ID);
  } catch (err) {
    const error = new Error(`Sessão inválida: ${err.message}`);
    error.status = 401;
    throw error;
  }

  if (!companyId || !/^[a-z0-9-]{3,80}$/.test(companyId)) {
    const error = new Error('Workspace inválido.');
    error.status = 400;
    throw error;
  }

  const member = await getDocument(env, `companies/${companyId}/members/${user.uid}`);
  if (!member || member.active === false) {
    const error = new Error('Você não tem acesso a este workspace.');
    error.status = 403;
    throw error;
  }

  return { user, member };
}

/* ------------------------------------------------------ WhatsApp envio -- */

async function sendWhatsAppMessage(env, { to, text }) {
  const version = env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const token = env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !token) {
    const error = new Error('Integração com a Meta não configurada no servidor.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || `A Meta recusou o envio (${response.status}).`);
    error.status = response.status === 401 ? 502 : 400;
    error.meta = body?.error || null;
    throw error;
  }

  return body;
}

/* --------------------------------------------------------- persistencia - */

/** Garante o documento da conversa (id = numero em E.164). */
async function upsertConversation(env, companyId, waId, patch) {
  const path = `companies/${companyId}/conversations/${waId}`;
  const existing = await getDocument(env, path);

  if (!existing) {
    await createDocument(env, `companies/${companyId}/conversations`,
      { waId, channel: 'whatsapp', archived: false, unread: 0, createdAt: nowIso(), ...patch }, waId);
    return { created: true };
  }

  await patchDocument(env, path, { ...patch, updatedAt: nowIso() });
  return { created: false, existing };
}

async function addMessage(env, companyId, waId, message) {
  return createDocument(env, `companies/${companyId}/conversations/${waId}/messages`, message);
}

/** Procura no CRM o contato dono de um numero. */
async function findContactByNumber(env, companyId, waId) {
  for (const variant of numberVariants(waId)) {
    const found = await queryCollection(env, `companies/${companyId}`, 'contacts',
      [{ field: 'waNumber', value: variant }], 1);
    if (found.length) return found[0];
  }
  return null;
}

async function addInteraction(env, companyId, contactId, data) {
  return createDocument(env, `companies/${companyId}/interactions`, {
    contactId,
    createdAt: nowIso(),
    createdBy: 'whatsapp-webhook',
    createdByName: 'WhatsApp',
    ...data
  });
}

/* ------------------------------------------------------------- webhook -- */

/**
 * Trata um lote de eventos da Meta.
 * A Meta reenvia o webhook quando nao recebe 200 rapidamente, por isso o
 * processamento roda em waitUntil e a resposta sai imediatamente.
 */
async function processWebhook(env, companyId, payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};

      /* ---- mensagens recebidas ---- */
      for (const message of value.messages || []) {
        const waId = normalizeNumber(message.from);
        const profileName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name || '';

        const text = message.text?.body
          || message.button?.text
          || message.interactive?.list_reply?.title
          || message.interactive?.button_reply?.title
          || '';

        const contact = await findContactByNumber(env, companyId, waId);

        await upsertConversation(env, companyId, waId, {
          lastMessage: (text || `[${message.type}]`).slice(0, 160),
          lastMessageAt: nowIso(),
          lastDirection: 'in',
          ...(contact ? { contactId: contact.id, contactName: contact.name, contactCompany: contact.company || '' } : {}),
          ...(profileName ? { profileName } : {})
        });

        await addMessage(env, companyId, waId, {
          direction: 'in',
          type: message.type || 'text',
          text,
          status: 'recebida',
          waMessageId: message.id,
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : nowIso(),
          profileName
        });

        await incrementField(env, `companies/${companyId}/conversations/${waId}`, 'unread', 1)
          .catch((err) => console.warn('[webhook] contador de não lidas', err.message));

        if (contact) {
          // A resposta do cliente conta como interacao: tira o lead do
          // alerta de "sem retorno" e alimenta a timeline.
          await patchDocument(env, `companies/${companyId}/contacts/${contact.id}`, {
            lastContactAt: nowIso(),
            updatedAt: nowIso()
          }).catch((err) => console.warn('[webhook] atualizar contato', err.message));

          await addInteraction(env, companyId, contact.id, {
            type: 'mensagem',
            title: 'Mensagem recebida no WhatsApp',
            body: text.slice(0, 1000)
          }).catch((err) => console.warn('[webhook] interação', err.message));
        }
      }

      /* ---- status de envio (entregue, lida, falha) ---- */
      for (const status of value.statuses || []) {
        const waId = normalizeNumber(status.recipient_id);
        const messages = await queryCollection(env,
          `companies/${companyId}/conversations/${waId}`, 'messages',
          [{ field: 'waMessageId', value: status.id }], 1);

        if (!messages.length) continue;

        await patchDocument(env,
          `companies/${companyId}/conversations/${waId}/messages/${messages[0].id}`,
          {
            status: status.status || 'desconhecido',
            statusAt: status.timestamp ? new Date(Number(status.timestamp) * 1000) : nowIso(),
            ...(status.errors?.length
              ? { errorCode: String(status.errors[0].code || ''), errorTitle: String(status.errors[0].title || '') }
              : {})
          });
      }
    }
  }
}

/* --------------------------------------------------------------- rotas -- */

/**
 * Configuracao publica do Firebase, vinda das variaveis do Worker.
 *
 * Permite configurar a aplicacao pelo painel do Cloudflare, sem editar codigo
 * nem fazer deploy. Sao valores publicos por natureza (identificam o projeto);
 * quem protege os dados sao as regras do Firestore. Nenhum segredo de servidor
 * — token da Meta, app secret, chave da service account — passa por aqui.
 */
function handleConfig(request, env) {
  const firebase = {
    apiKey: env.FIREBASE_API_KEY || '',
    authDomain: env.FIREBASE_AUTH_DOMAIN || '',
    projectId: env.FIREBASE_PROJECT_ID || '',
    storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.FIREBASE_APP_ID || ''
  };

  // authDomain segue sempre o padrao <projectId>.firebaseapp.com — deduzir
  // poupa uma variavel. O storageBucket NAO e deduzido: projetos antigos usam
  // <projectId>.appspot.com e os novos <projectId>.firebasestorage.app, e
  // chutar errado seria pior do que deixar vazio (o CRM nao usa Storage).
  if (firebase.projectId && !firebase.authDomain) {
    firebase.authDomain = `${firebase.projectId}.firebaseapp.com`;
  }

  const configured = Boolean(firebase.apiKey && firebase.projectId && firebase.appId);

  return json(
    { firebase: configured ? firebase : null },
    { request, env, headers: { 'Cache-Control': 'public, max-age=60' } }
  );
}

async function handleHealth(request, env) {
  return json({
    status: 'ok',
    service: 'prox-crm-worker',
    firebaseConfigured: Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY),
    whatsappConfigured: Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
    webhookConfigured: Boolean(env.WHATSAPP_VERIFY_TOKEN && env.META_APP_SECRET),
    graphApiVersion: env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION
  }, { request, env });
}

async function handleSend(request, env) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'Mensagem grande demais.' }, { status: 413, request, env });
  }

  let payload;
  try { payload = JSON.parse(raw); } catch {
    return json({ error: 'Corpo da requisição inválido.' }, { status: 400, request, env });
  }

  const companyId = String(payload.companyId || '');
  const { user, member } = await authorize(request, env, companyId);

  const to = normalizeNumber(payload.to);
  const text = String(payload.text || '').trim().slice(0, 4000);
  if (!to) return json({ error: 'Número de destino inválido.' }, { status: 400, request, env });
  if (!text) return json({ error: 'Mensagem vazia.' }, { status: 400, request, env });

  const result = await sendWhatsAppMessage(env, { to, text });
  const waMessageId = result.messages?.[0]?.id || null;

  await upsertConversation(env, companyId, to, {
    lastMessage: text.slice(0, 160),
    lastMessageAt: nowIso(),
    lastDirection: 'out',
    unread: 0,
    ...(payload.contactId ? { contactId: String(payload.contactId) } : {})
  });

  await addMessage(env, companyId, to, {
    direction: 'out',
    type: 'text',
    text,
    status: 'enviada',
    channel: 'cloud-api',
    waMessageId,
    timestamp: nowIso(),
    sentBy: user.uid,
    sentByName: member.name || user.email || ''
  });

  if (payload.contactId) {
    await addInteraction(env, companyId, String(payload.contactId), {
      type: 'mensagem',
      title: 'Mensagem enviada pela Cloud API',
      body: text.slice(0, 1000),
      createdBy: user.uid,
      createdByName: member.name || ''
    }).catch((err) => console.warn('[send] interação', err.message));

    await patchDocument(env, `companies/${companyId}/contacts/${payload.contactId}`, {
      lastContactAt: nowIso(),
      updatedAt: nowIso()
    }).catch((err) => console.warn('[send] atualizar contato', err.message));
  }

  return json({ ok: true, waMessageId }, { request, env });
}

function handleWebhookVerification(url, env) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';

  const expected = env.WHATSAPP_VERIFY_TOKEN || '';
  if (mode === 'subscribe' && expected && timingSafeEqual(token, expected)) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

async function handleWebhookEvent(request, env, ctx, companyId) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 });

  const valid = await verifyMetaSignature(
    raw, request.headers.get('X-Hub-Signature-256'), env.META_APP_SECRET);
  if (!valid) {
    console.warn('[webhook] assinatura inválida');
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(raw); } catch {
    return new Response('Bad payload', { status: 400 });
  }

  // Responde imediatamente: a Meta reenvia o lote se demorarmos.
  ctx.waitUntil(
    processWebhook(env, companyId, payload)
      .catch((err) => console.error('[webhook] falha ao processar', err))
  );

  return new Response('EVENT_RECEIVED', { status: 200 });
}

/* ------------------------------------------------------------- entrada -- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (pathname === '/api/health') return handleHealth(request, env);
      if (pathname === '/api/config') return handleConfig(request, env);

      if (pathname === '/api/messages/send' && request.method === 'POST') {
        return await handleSend(request, env);
      }

      const webhookMatch = /^\/webhook\/([A-Za-z0-9_-]{1,80})$/.exec(pathname);
      if (webhookMatch) {
        const companyId = webhookMatch[1];
        if (request.method === 'GET') return handleWebhookVerification(url, env);
        if (request.method === 'POST') return await handleWebhookEvent(request, env, ctx, companyId);
      }

      // Rotas fora da API: quando o Worker também serve o frontend (binding
      // ASSETS), os arquivos existentes já foram entregues antes de chegar
      // aqui — então isto só atende links profundos, devolvendo o app.
      if (env.ASSETS && request.method === 'GET' && !pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), request));
      }

      return json({ error: 'Rota não encontrada.' }, { status: 404, request, env });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[worker]', err);
      return json({ error: err.message || 'Erro interno.' }, { status, request, env });
    }
  }
};
