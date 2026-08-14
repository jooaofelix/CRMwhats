/**
 * Conversas — inbox no formato lista / conversa / resumo do lead.
 *
 * Sem a Cloud API configurada, a tela funciona como historico: o envio abre o
 * WhatsApp com a mensagem pronta e registra o texto na conversa. Com a Cloud
 * API ativa, o envio passa pelo Worker e as mensagens recebidas chegam pelo
 * webhook — nos dois casos o historico fica ligado ao cadastro do CRM.
 */

import { state, subscribe, stageById, contactById } from '../state.js';
import {
  esc, initials, formatMoney, formatPhone, friendlyDateTime, formatTime,
  formatDate, norm, debounce, toDate
} from '../utils.js';
import { emptyState, toastOk, toastError, toastWarn, describeError } from '../ui.js';
import {
  watchConversations, watchMessages, markConversationRead, cloudApiEnabled,
  sendCloudMessage, logOutgoingMessage, openWhatsApp, renderForContact, linkConversation
} from '../whatsapp.js';
import { openContactModal, openFollowUpModal, openTemplatePickerModal } from '../modals.js';

let unsubState = null;
let unsubConversations = null;
let unsubMessages = null;

let conversations = [];
let messages = [];
let selectedId = null;
let searchTerm = '';
let loading = true;
let rootEl = null;

export function render(root, route) {
  rootEl = root;
  selectedId = route.query?.c || null;
  conversations = [];
  messages = [];
  loading = true;

  paint();

  unsubConversations = watchConversations((list) => {
    conversations = list;
    loading = false;
    // Abre a primeira conversa automaticamente no desktop.
    if (!selectedId && list.length && window.matchMedia('(min-width: 761px)').matches) {
      select(list[0].id);
      return;
    }
    paint();
  }, (err) => {
    loading = false;
    toastError(describeError(err));
    paint();
  });

  unsubState = subscribe(() => paint());
}

export function destroy() {
  unsubState?.(); unsubConversations?.(); unsubMessages?.();
  unsubState = unsubConversations = unsubMessages = null;
  conversations = []; messages = []; selectedId = null; rootEl = null;
}

/* ------------------------------------------------------------- selecao --- */

function select(conversationId) {
  selectedId = conversationId;
  messages = [];
  unsubMessages?.();

  if (conversationId) {
    unsubMessages = watchMessages(conversationId, (list) => { messages = list; paint(true); });
    markConversationRead(conversationId);
  }
  paint();
}

/* --------------------------------------------------------------- html ---- */

function paint(onlyThread = false) {
  if (!rootEl) return;

  if (!onlyThread || !rootEl.querySelector('.inbox')) {
    rootEl.innerHTML = build();
    wire();
    scrollThreadToEnd();
    return;
  }

  const body = rootEl.querySelector('.thread__body');
  if (body) {
    body.innerHTML = messagesHtml();
    scrollThreadToEnd();
  }
}

function build() {
  const current = conversations.find((c) => c.id === selectedId) || null;
  const contact = current?.contactId ? contactById(current.contactId) : null;

  return `
    <div class="page__head">
      <div class="page__title">
        <h1>Conversas</h1>
        <p>${cloudApiEnabled()
          ? 'WhatsApp Cloud API conectada — mensagens sincronizadas.'
          : 'Histórico local. Ative a WhatsApp Cloud API em Configurações para receber mensagens automaticamente.'}</p>
      </div>
    </div>

    <div class="inbox ${selectedId ? 'has-selection' : ''}">
      <aside class="inbox__list">
        <div class="inbox__search">
          <div class="search">
            <span data-icon="search" class="search__icon"></span>
            <input type="search" id="conv-search" placeholder="Buscar conversa…" value="${esc(searchTerm)}">
          </div>
        </div>
        <div class="inbox__scroll">${conversationListHtml()}</div>
      </aside>

      <section class="inbox__thread">${threadHtml(current, contact)}</section>

      <aside class="inbox__aside">${asideHtml(current, contact)}</aside>
    </div>`;
}

function conversationListHtml() {
  if (loading) return '<div style="padding:.6rem"><div class="skeleton" style="height:44px"></div></div>';

  const term = norm(searchTerm.trim());
  const list = conversations.filter((conversation) =>
    !term || norm(`${conversation.contactName || ''} ${conversation.waId || ''} ${conversation.lastMessage || ''}`).includes(term));

  if (!list.length) {
    return emptyState(
      conversations.length ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda',
      conversations.length ? 'Tente outro termo.' : 'Abra o WhatsApp de um contato para iniciar o histórico.'
    );
  }

  return list.map((conversation) => `
    <button class="convrow ${conversation.id === selectedId ? 'is-active' : ''}" data-conv="${esc(conversation.id)}">
      <span class="itemrow__avatar">${esc(initials(conversation.contactName || conversation.waId))}</span>
      <span class="itemrow__main">
        <strong>${esc(conversation.contactName || formatPhone(conversation.waId))}</strong>
        <span>${esc(conversation.lastMessage || 'Sem mensagens')}</span>
      </span>
      <span class="itemrow__side">
        <span class="dim" style="font-size:.72rem">${conversation.lastMessageAt ? esc(formatTime(conversation.lastMessageAt)) : ''}</span>
        ${conversation.unread ? `<span class="convrow__badge">${esc(String(conversation.unread))}</span>` : ''}
      </span>
    </button>`).join('');
}

function threadHtml(conversation, contact) {
  if (!conversation) {
    return `<div class="grow" style="display:grid;place-items:center;padding:2rem">
      ${emptyState('Selecione uma conversa', 'As mensagens aparecem aqui.')}
    </div>`;
  }

  const stage = contact ? stageById(contact.stage) : null;

  return `
    <header class="thread__head">
      <button class="iconbtn desktop-hidden" id="btn-back-list" aria-label="Voltar"><span data-icon="back"></span></button>
      <span class="itemrow__avatar">${esc(initials(conversation.contactName || conversation.waId))}</span>
      <div class="grow">
        <strong>${esc(conversation.contactName || formatPhone(conversation.waId))}</strong>
        <div class="muted" style="font-size:.78rem">${esc(formatPhone(conversation.waId))}
          ${stage ? `· ${esc(stage.name)}` : ''}</div>
      </div>
      ${contact
        ? `<a class="btn btn--sm" href="#/contato/${esc(contact.id)}">Abrir ficha</a>`
        : '<button class="btn btn--sm btn--primary" id="btn-link">Vincular ao CRM</button>'}
    </header>

    <div class="thread__body">${messagesHtml()}</div>

    <footer class="thread__foot">
      ${state.templates.length ? `
      <select id="composer-template" aria-label="Modelo de mensagem">
        <option value="">Usar um modelo…</option>
        ${state.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
      </select>` : ''}
      <div class="composer">
        <textarea id="composer-text" placeholder="Escreva sua mensagem…" maxlength="4000"></textarea>
        <button class="btn btn--wa" id="btn-send" title="${cloudApiEnabled() ? 'Enviar pela Cloud API' : 'Abrir no WhatsApp'}">
          <span data-icon="${cloudApiEnabled() ? 'send' : 'whatsapp'}"></span>
        </button>
      </div>
      ${cloudApiEnabled() ? '' : '<span class="field__hint">O envio abre o WhatsApp com a mensagem pronta e guarda o texto no histórico.</span>'}
    </footer>`;
}

function messagesHtml() {
  if (!messages.length) {
    return emptyState('Sem mensagens nesta conversa', 'Envie a primeira mensagem pelo campo abaixo.');
  }

  let lastDay = '';
  return messages.map((message) => {
    const date = toDate(message.timestamp);
    const day = date ? formatDate(date) : '';
    const separator = day && day !== lastDay ? `<span class="daysep">${esc(day)}</span>` : '';
    lastDay = day;

    if (message.type === 'note') {
      return `${separator}<div class="bubble bubble--note">${esc(message.text)}</div>`;
    }

    const statusLabel = message.direction === 'out'
      ? ` · ${esc(statusText(message.status))}`
      : '';

    return `${separator}
      <div class="bubble bubble--${message.direction === 'in' ? 'in' : 'out'}">
        ${esc(message.text || `[${message.type || 'mídia'}]`)}
        <span class="bubble__meta">${esc(formatTime(date))}${statusLabel}</span>
      </div>`;
  }).join('');
}

function statusText(status) {
  return {
    registrada: 'registrada', enviada: 'enviada', sent: 'enviada',
    delivered: 'entregue', read: 'lida', failed: 'falhou'
  }[status] || status || '';
}

function asideHtml(conversation, contact) {
  if (!conversation) return '';

  if (!contact) {
    return `
      <div class="card card--pad">
        <h3>Sem cadastro no CRM</h3>
        <p class="muted" style="font-size:.86rem">Esta conversa ainda não está ligada a um contato.</p>
        <button class="btn btn--primary btn--block" id="btn-create-lead">Criar lead</button>
      </div>`;
  }

  const stage = stageById(contact.stage);
  return `
    <div class="card card--pad">
      <div class="row" style="margin-bottom:.6rem">
        <span class="itemrow__avatar">${esc(initials(contact.name))}</span>
        <div class="grow">
          <strong>${esc(contact.name)}</strong>
          <div class="muted" style="font-size:.78rem">${esc(contact.company || '—')}</div>
        </div>
      </div>
      ${stage ? `<span class="pill pill--stage" style="background:${esc(stage.color)}">${esc(stage.name)}</span>` : ''}
      <dl class="datalist" style="margin-top:.6rem">
        <div class="datalist__row"><dt>Valor</dt><dd><strong>${esc(formatMoney(contact.value))}</strong></dd></div>
        <div class="datalist__row"><dt>Responsável</dt><dd>${esc(contact.ownerName || '—')}</dd></div>
        <div class="datalist__row"><dt>Próxima ação</dt><dd>${esc(contact.nextAction || '—')}</dd></div>
        <div class="datalist__row"><dt>Follow-up</dt>
          <dd>${contact.nextFollowUpAt ? esc(friendlyDateTime(contact.nextFollowUpAt)) : '—'}</dd></div>
      </dl>
      ${contact.tags?.length
        ? `<div class="chips">${contact.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
        : ''}
      <div class="stack" style="gap:.45rem;margin-top:.8rem">
        <button class="btn btn--block" id="btn-aside-followup"><span data-icon="clock"></span> Programar follow-up</button>
        <button class="btn btn--block" id="btn-aside-template"><span data-icon="send"></span> Usar modelo</button>
        <a class="btn btn--block" href="#/contato/${esc(contact.id)}">Ver histórico completo</a>
      </div>
    </div>`;
}

/* --------------------------------------------------------------- wire ---- */

function scrollThreadToEnd() {
  const body = rootEl?.querySelector('.thread__body');
  if (body) body.scrollTop = body.scrollHeight;
}

function wire() {
  const searchInput = rootEl.querySelector('#conv-search');
  searchInput?.addEventListener('input', debounce(() => {
    searchTerm = searchInput.value;
    const scroll = rootEl.querySelector('.inbox__scroll');
    if (scroll) scroll.innerHTML = conversationListHtml();
    bindConversationRows();
  }, 180));

  bindConversationRows();

  rootEl.querySelector('#btn-back-list')?.addEventListener('click', () => { select(null); });

  const conversation = conversations.find((c) => c.id === selectedId);
  const contact = conversation?.contactId ? contactById(conversation.contactId) : null;

  // Modelo escolhido no composer.
  const templateSelect = rootEl.querySelector('#composer-template');
  templateSelect?.addEventListener('change', () => {
    const template = state.templates.find((t) => t.id === templateSelect.value);
    if (!template) return;
    const textarea = rootEl.querySelector('#composer-text');
    textarea.value = contact ? renderForContact(template.body, contact) : template.body;
    textarea.focus();
  });

  rootEl.querySelector('#btn-send')?.addEventListener('click', () => sendMessage(conversation, contact));
  rootEl.querySelector('#composer-text')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendMessage(conversation, contact);
    }
  });

  rootEl.querySelector('#btn-link')?.addEventListener('click', () => linkToExistingContact(conversation));
  rootEl.querySelector('#btn-create-lead')?.addEventListener('click', () => {
    openContactModal(
      { whatsapp: conversation.waId, name: conversation.contactName || '' },
      async (contactId) => {
        const created = contactById(contactId);
        if (created) {
          await linkConversation(conversation.id, created);
          toastOk('Conversa vinculada ao novo lead.');
          paint();
        }
      }
    );
  });

  rootEl.querySelector('#btn-aside-followup')?.addEventListener('click', () => contact && openFollowUpModal(contact));
  rootEl.querySelector('#btn-aside-template')?.addEventListener('click', () => contact && openTemplatePickerModal(contact));
}

function bindConversationRows() {
  rootEl.querySelectorAll('[data-conv]').forEach((button) => {
    button.addEventListener('click', () => select(button.dataset.conv));
  });
}

async function sendMessage(conversation, contact) {
  const textarea = rootEl.querySelector('#composer-text');
  const text = textarea?.value.trim();
  if (!text) return;
  if (!conversation) return;

  const button = rootEl.querySelector('#btn-send');
  button.disabled = true;

  try {
    if (cloudApiEnabled() && contact) {
      await sendCloudMessage(contact, text);
      toastOk('Mensagem enviada pela WhatsApp Cloud API.');
    } else if (contact) {
      await openWhatsApp(contact, text, { log: false });
      await logOutgoingMessage(contact, text, { channel: 'manual' });
      toastOk('WhatsApp aberto e mensagem registrada no histórico.');
    } else {
      // Conversa ainda sem cadastro: abre pelo numero e guarda o texto.
      window.open(`https://wa.me/${encodeURIComponent(conversation.waId)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      toastWarn('Vincule esta conversa a um contato para registrar o histórico.');
    }
    textarea.value = '';
  } catch (err) {
    console.error('[conversas] enviar', err);
    toastError(describeError(err));
  } finally {
    button.disabled = false;
  }
}

/** Vincula a conversa a um contato existente escolhido pelo numero/nome. */
async function linkToExistingContact(conversation) {
  const { openModal } = await import('../ui.js');
  const options = state.contacts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 300);

  openModal({
    title: 'Vincular conversa',
    body: `
      <div class="field">
        <label for="link-contact">Contato do CRM</label>
        <select id="link-contact">
          ${options.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.company ? ` — ${esc(c.company)}` : ''}</option>`).join('')}
        </select>
      </div>`,
    confirmText: 'Vincular',
    onConfirm: async (modalRoot) => {
      const chosen = contactById(modalRoot.querySelector('#link-contact').value);
      if (!chosen) return false;
      try {
        await linkConversation(conversation.id, chosen);
        toastOk('Conversa vinculada.');
        paint();
      } catch (err) {
        toastError(describeError(err));
        return false;
      }
    }
  });
}
