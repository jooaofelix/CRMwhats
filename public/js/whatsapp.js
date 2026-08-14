/**
 * Integracao com o WhatsApp — dois niveis:
 *
 * NIVEL 1 (sempre disponivel, sem configuracao)
 *   Abre a conversa no WhatsApp pelo link oficial wa.me, com a mensagem ja
 *   preenchida a partir de um modelo. Registra a acao na timeline do contato.
 *
 * NIVEL 2 (WhatsApp Cloud API, opcional)
 *   Quando appConfig.workerUrl esta configurado e a integracao esta ativa nas
 *   configuracoes do workspace, o envio passa pelo Cloudflare Worker, que
 *   guarda o token da Meta. O frontend nunca ve credenciais: envia apenas o
 *   ID token do Firebase para se identificar.
 */

import { appConfig } from './config.js';
import {
  auth, db, collection, doc, addDoc, setDoc, updateDoc,
  query, orderBy, limit, onSnapshot
} from './firebase.js';
import { state, stageById } from './state.js';
import { addInteraction, now } from './data.js';
import {
  waLink, renderTemplate, formatMoney, formatDate, cleanMultiline, toWhatsAppNumber
} from './utils.js';

/* ------------------------------------------------------------ modelos ---- */

/** Monta as variaveis disponiveis para os modelos de mensagem. */
export function templateVars(contact) {
  const fullName = contact?.name || '';
  return {
    nome: fullName.split(/\s+/)[0] || '',
    nome_completo: fullName,
    empresa: contact?.company || '',
    responsavel: contact?.ownerName || state.member?.name || '',
    valor: formatMoney(contact?.value || 0),
    etapa: stageById(contact?.stage)?.name || '',
    data: formatDate(new Date()),
    link: state.settings?.defaultLink || ''
  };
}

/** Aplica um modelo a um contato. */
export function renderForContact(body, contact) {
  return renderTemplate(body, templateVars(contact));
}

/* ------------------------------------------------------------- nivel 1 --- */

/** Numero utilizavel do contato (WhatsApp tem prioridade sobre telefone). */
export function contactNumber(contact) {
  return toWhatsAppNumber(contact?.whatsapp || contact?.phone || '');
}

/**
 * Abre a conversa no WhatsApp em outra aba e registra a interacao.
 * Chame sempre a partir de um clique do usuario — abrir janela fora de um
 * gesto do usuario e bloqueado pelos navegadores.
 */
export async function openWhatsApp(contact, message = '', { log = true } = {}) {
  const number = contactNumber(contact);
  if (!number) throw new Error('Este contato não possui um número de WhatsApp válido.');

  const url = waLink(number, message);
  window.open(url, '_blank', 'noopener');

  if (log) {
    await addInteraction(contact.id, {
      type: 'mensagem',
      title: 'Conversa aberta no WhatsApp',
      body: message ? cleanMultiline(message, 1000) : ''
    }).catch((err) => console.warn('[whatsapp] falha ao registrar interação', err));
  }
  return url;
}

/* ------------------------------------------------------------- nivel 2 --- */

/** A Cloud API so e considerada ativa com Worker configurado E integracao ligada. */
export function cloudApiEnabled() {
  return Boolean(appConfig.workerUrl) && Boolean(state.settings?.whatsapp?.enabled);
}

async function workerFetch(path, { method = 'GET', body = null } = {}) {
  if (!appConfig.workerUrl) throw new Error('Backend (Cloudflare Worker) não configurado.');
  const user = auth.currentUser;
  if (!user) throw new Error('Sessão expirada.');

  const token = await user.getIdToken();
  const response = await fetch(`${appConfig.workerUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!response.ok) {
    throw new Error(data.error || data.message || `Falha na requisição (${response.status}).`);
  }
  return data;
}

export async function checkWorkerHealth() {
  return workerFetch('/api/health');
}

/**
 * Envia uma mensagem pela Cloud API atraves do Worker.
 * O Worker e quem grava a mensagem no Firestore (com o status devolvido pela Meta).
 */
export async function sendCloudMessage(contact, text) {
  const to = contactNumber(contact);
  if (!to) throw new Error('Contato sem número de WhatsApp válido.');

  return workerFetch('/api/messages/send', {
    method: 'POST',
    body: {
      companyId: state.company.id,
      contactId: contact.id,
      to,
      type: 'text',
      text: cleanMultiline(text, 4000)
    }
  });
}

/* ------------------------------------------------------- conversas ------- */

/**
 * Garante que exista um documento de conversa para o contato.
 * O id da conversa e o numero em E.164 — assim a mensagem que chega pelo
 * webhook (que so conhece o numero) cai na mesma conversa.
 */
export async function ensureConversation(contact) {
  const number = contactNumber(contact);
  if (!number) throw new Error('Contato sem número de WhatsApp válido.');

  const ref = doc(db, 'companies', state.company.id, 'conversations', number);
  await setDoc(ref, {
    waId: number,
    contactId: contact.id,
    contactName: contact.name,
    contactCompany: contact.company || '',
    channel: 'whatsapp',
    archived: false,
    updatedAt: now()
  }, { merge: true });
  return number;
}

/** Escuta a lista de conversas (usada apenas enquanto a tela Conversas esta aberta). */
export function watchConversations(onData, onError) {
  const ref = query(
    collection(db, 'companies', state.company.id, 'conversations'),
    orderBy('lastMessageAt', 'desc'),
    limit(80)
  );
  return onSnapshot(ref,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[whatsapp] listener de conversas falhou', err);
      onError?.(err);
    });
}

/** Escuta as mensagens de uma conversa. */
export function watchMessages(conversationId, onData, onError) {
  const ref = query(
    collection(db, 'companies', state.company.id, 'conversations', conversationId, 'messages'),
    orderBy('timestamp', 'asc'),
    limit(200)
  );
  return onSnapshot(ref,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[whatsapp] listener de mensagens falhou', err);
      onError?.(err);
    });
}

/**
 * Registra localmente uma mensagem enviada por fora da API (nivel 1).
 * Mantem o historico do inbox coerente mesmo sem a Cloud API.
 */
export async function logOutgoingMessage(contact, text, { channel = 'manual' } = {}) {
  const conversationId = await ensureConversation(contact);
  const body = cleanMultiline(text, 4000);

  await addDoc(
    collection(db, 'companies', state.company.id, 'conversations', conversationId, 'messages'),
    {
      direction: 'out',
      type: 'text',
      text: body,
      status: channel === 'manual' ? 'registrada' : 'enviada',
      channel,
      timestamp: now(),
      sentBy: state.user.uid,
      sentByName: state.member?.name || ''
    }
  );

  await updateDoc(doc(db, 'companies', state.company.id, 'conversations', conversationId), {
    lastMessage: body.slice(0, 160),
    lastMessageAt: now(),
    lastDirection: 'out',
    unread: 0,
    updatedAt: now()
  });

  return conversationId;
}

/** Zera o contador de nao lidas ao abrir a conversa. */
export async function markConversationRead(conversationId) {
  await updateDoc(
    doc(db, 'companies', state.company.id, 'conversations', conversationId),
    { unread: 0 }
  ).catch(() => {});
}

/** Vincula uma conversa (vinda do webhook) a um contato do CRM. */
export async function linkConversation(conversationId, contact) {
  await updateDoc(doc(db, 'companies', state.company.id, 'conversations', conversationId), {
    contactId: contact.id,
    contactName: contact.name,
    contactCompany: contact.company || '',
    updatedAt: now()
  });
}
