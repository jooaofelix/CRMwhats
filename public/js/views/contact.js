/** Ficha individual do contato: dados, ações rápidas e timeline. */

import { state, subscribe, stageById, stages, contactById } from '../state.js';
import {
  esc, initials, formatMoney, formatPhone, friendlyDateTime, formatDateTime,
  daysSince, waLink, toDate
} from '../utils.js';
import { CONTACT_STATUS, INTERACTION_TYPES } from '../defaults.js';
import { emptyState, toastOk, toastError, describeError, confirmDialog } from '../ui.js';
import { listInteractions, deleteInteraction, moveContactStage } from '../data.js';
import {
  openContactModal, openFollowUpModal, openInteractionModal, openTaskModal,
  openTemplatePickerModal, openWonLostModal, confirmDeleteContact
} from '../modals.js';
import { contactNumber } from '../whatsapp.js';

let unsubscribe = null;
let contactId = null;
let interactions = [];
let loadingTimeline = true;
/** Redesenha a tela. Definido no render() e usado pelas ações. */
let repaint = () => {};

export async function render(root, route) {
  contactId = route.params[0];
  if (!contactId) { location.hash = '#/contatos'; return; }

  interactions = [];
  loadingTimeline = true;

  const paint = () => {
    const contact = contactById(contactId);
    if (!contact) {
      // O listener pode ainda nao ter carregado; so damos erro depois de carregar.
      root.innerHTML = state.loading.contacts
        ? '<div class="skeleton" style="height:120px;max-width:520px"></div>'
        : `<div class="card card--pad" style="max-width:520px">
             <h2>Contato não encontrado</h2>
             <p class="muted">Ele pode ter sido excluído.</p>
             <a class="btn btn--primary" href="#/contatos">Voltar para contatos</a>
           </div>`;
      return;
    }
    root.innerHTML = build(contact);
    wire(root, contact);
  };

  repaint = paint;
  paint();
  unsubscribe = subscribe(paint);

  await reloadTimeline();
  paint();
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  repaint = () => {};
  interactions = [];
  contactId = null;
}

async function reloadTimeline() {
  loadingTimeline = true;
  try {
    interactions = await listInteractions(contactId, 120);
  } catch (err) {
    console.error('[contato] timeline', err);
    toastError('Não foi possível carregar o histórico.');
    interactions = [];
  } finally {
    loadingTimeline = false;
  }
}

/* --------------------------------------------------------------- html ---- */

function build(contact) {
  const stage = stageById(contact.stage);
  const idle = daysSince(contact._lastTouch);
  const number = contactNumber(contact);
  const followUpOverdue = contact.nextFollowUpAt && toDate(contact.nextFollowUpAt) < new Date();

  return `
    <div class="page__head">
      <div class="row">
        <a class="iconbtn" href="#/contatos" aria-label="Voltar"><span data-icon="back"></span></a>
        <div class="page__title">
          <h1>${esc(contact.name)}</h1>
          <p>${esc(contact.company || 'Sem empresa')} ${contact.source ? `· origem ${esc(contact.source)}` : ''}</p>
        </div>
      </div>
      <div class="page__actions">
        <button class="btn" id="btn-edit"><span data-icon="edit"></span> Editar</button>
        ${contact.status === CONTACT_STATUS.OPEN ? `
          <button class="btn" id="btn-lost">Perdida</button>
          <button class="btn btn--primary" id="btn-won">Marcar ganha</button>` : `
          <span class="pill ${contact.status === CONTACT_STATUS.WON ? 'pill--ok' : 'pill--danger'}">
            ${contact.status === CONTACT_STATUS.WON ? 'Venda ganha' : 'Negociação perdida'}
          </span>
          <button class="btn" id="btn-reopen">Reabrir</button>`}
      </div>
    </div>

    <div class="contact-layout">
      <div class="stack">
        <section class="card contact-hero">
          <div class="contact-hero__top">
            <span class="contact-hero__avatar">${esc(initials(contact.name))}</span>
            <div class="grow">
              <div style="font-weight:650;font-size:1.02rem">${esc(contact.name)}</div>
              <div class="muted" style="font-size:.85rem">${esc(formatPhone(contact.whatsapp || contact.phone) || 'Sem telefone')}</div>
              ${stage ? `<span class="pill pill--stage" style="background:${esc(stage.color)};margin-top:.35rem">${esc(stage.name)}</span>` : ''}
            </div>
          </div>

          <div class="contact-hero__actions">
            <a class="btn btn--wa ${number ? '' : 'is-loading'}" id="btn-wa"
               href="${number ? esc(waLink(number)) : '#'}" target="_blank" rel="noopener">
              <span data-icon="whatsapp"></span> Abrir no WhatsApp
            </a>
            <button class="btn" id="btn-template"><span data-icon="send"></span> Modelo</button>
            <button class="btn" id="btn-followup"><span data-icon="clock"></span> Follow-up</button>
          </div>

          <dl class="datalist">
            <div class="datalist__row"><dt>Valor</dt><dd><strong>${esc(formatMoney(contact.value))}</strong></dd></div>
            <div class="datalist__row"><dt>Responsável</dt><dd>${esc(contact.ownerName || '—')}</dd></div>
            <div class="datalist__row"><dt>Último contato</dt>
              <dd>${contact._lastTouch ? esc(friendlyDateTime(contact._lastTouch)) : '—'}
                ${idle !== null && idle > (state.settings.staleDays ?? 5)
                  ? `<span class="pill pill--warn">${idle} dias</span>` : ''}</dd></div>
            <div class="datalist__row"><dt>Próximo follow-up</dt>
              <dd>${contact.nextFollowUpAt
                ? `<span class="pill ${followUpOverdue ? 'pill--danger' : 'pill--warn'}">${esc(friendlyDateTime(contact.nextFollowUpAt))}</span>`
                : '<span class="dim">não agendado</span>'}</dd></div>
            <div class="datalist__row"><dt>Próxima ação</dt><dd>${esc(contact.nextAction || '—')}</dd></div>
            <div class="datalist__row"><dt>WhatsApp</dt><dd>${esc(formatPhone(contact.whatsapp) || '—')}</dd></div>
            <div class="datalist__row"><dt>Telefone</dt><dd>${esc(formatPhone(contact.phone) || '—')}</dd></div>
            <div class="datalist__row"><dt>E-mail</dt>
              <dd>${contact.email ? `<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>` : '—'}</dd></div>
            <div class="datalist__row"><dt>CPF / CNPJ</dt><dd>${esc(contact.taxId || '—')}</dd></div>
            <div class="datalist__row"><dt>Criado em</dt><dd>${esc(formatDateTime(contact.createdAt))}</dd></div>
          </dl>

          ${contact.tags?.length ? `
            <div class="chips">${contact.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}

          ${contact.notes ? `
            <div>
              <div class="kpi__label" style="margin-bottom:.25rem">Observações</div>
              <p class="muted" style="white-space:pre-wrap;margin:0;font-size:.87rem">${esc(contact.notes)}</p>
            </div>` : ''}

          ${contact.lostReason ? `<p class="muted" style="margin:0;font-size:.85rem"><strong>Motivo da perda:</strong> ${esc(contact.lostReason)}</p>` : ''}
        </section>

        <section class="card card--pad">
          <div class="kpi__label" style="margin-bottom:.5rem">Mover no funil</div>
          <select id="stage-select">
            ${stages().map((s) => `<option value="${esc(s.id)}" ${s.id === contact.stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
          <button class="btn btn--danger btn--block" id="btn-delete" style="margin-top:.9rem">
            <span data-icon="trash"></span> Excluir contato
          </button>
        </section>
      </div>

      <section class="card panel">
        <div class="panel__head">
          <h2>Histórico</h2>
          <button class="btn btn--sm" id="btn-task">Nova tarefa</button>
        </div>
        <div class="panel__body" style="max-height:none;padding:1rem 1.1rem">
          <div class="quickadd">
            ${INTERACTION_TYPES.filter((t) => t.id !== 'tarefa' && t.id !== 'followup').map((type) => `
              <button class="btn btn--sm" data-interaction="${type.id}">
                <span data-icon="${type.icon}"></span> ${esc(type.label)}
              </button>`).join('')}
          </div>
          ${timelineHtml()}
        </div>
      </section>
    </div>`;
}

function timelineHtml() {
  if (loadingTimeline) {
    return '<div class="stack"><div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:85%"></div></div>';
  }
  if (!interactions.length) {
    return emptyState('Nenhum registro ainda', 'Registre ligações, mensagens e propostas para não perder o fio da conversa.');
  }

  return `<div class="timeline">${interactions.map((item) => {
    const type = item.type === 'system' ? 'sistema' : item.type;
    return `
      <div class="tl-item" data-kind="${esc(item.type)}">
        <div class="tl-item__head">
          <span class="tl-item__title">${esc(item.title || type)}</span>
          <span class="pill">${esc(labelFor(item.type))}</span>
          <span class="spacer"></span>
          <span class="tl-item__time">${esc(friendlyDateTime(item.createdAt))}</span>
          <button class="iconbtn" data-del-interaction="${esc(item.id)}" title="Excluir registro" style="width:26px;height:26px">
            <span data-icon="trash" style="width:14px;height:14px"></span>
          </button>
        </div>
        ${item.body ? `<div class="tl-item__body">${esc(item.body)}</div>` : ''}
        ${item.createdByName ? `<div class="tl-item__time">por ${esc(item.createdByName)}</div>` : ''}
      </div>`;
  }).join('')}</div>`;
}

function labelFor(typeId) {
  if (typeId === 'system') return 'Sistema';
  if (typeId === 'stage') return 'Etapa';
  return INTERACTION_TYPES.find((t) => t.id === typeId)?.label || typeId;
}

/* --------------------------------------------------------------- wire ---- */

function wire(root, contact) {
  const refresh = async () => { await reloadTimeline(); repaint(); };

  root.querySelector('#btn-edit')?.addEventListener('click', () => openContactModal(contact, refresh));
  root.querySelector('#btn-template')?.addEventListener('click', () => openTemplatePickerModal(contact, refresh));
  root.querySelector('#btn-followup')?.addEventListener('click', () => openFollowUpModal(contact, refresh));
  root.querySelector('#btn-task')?.addEventListener('click', () => openTaskModal(null, contact, refresh));
  root.querySelector('#btn-won')?.addEventListener('click', () => openWonLostModal(contact, 'won', refresh));
  root.querySelector('#btn-lost')?.addEventListener('click', () => openWonLostModal(contact, 'lost', refresh));
  root.querySelector('#btn-delete')?.addEventListener('click', () =>
    confirmDeleteContact(contact, () => { location.hash = '#/contatos'; }));

  root.querySelector('#btn-reopen')?.addEventListener('click', async () => {
    try {
      const target = stages().find((s) => !s.won && !s.lost)?.id;
      await moveContactStage(contact.id, target);
      toastOk('Negociação reaberta.');
      await refresh();
    } catch (err) { toastError(describeError(err)); }
  });

  // Registrar interacao pelo botao do WhatsApp (o link ja abriu em outra aba).
  root.querySelector('#btn-wa')?.addEventListener('click', async (event) => {
    if (!contactNumber(contact)) {
      event.preventDefault();
      toastError('Este contato não possui número de WhatsApp.');
      return;
    }
    try {
      const { addInteraction } = await import('../data.js');
      await addInteraction(contact.id, { type: 'mensagem', title: 'Conversa aberta no WhatsApp' });
      await refresh();
    } catch (err) { console.warn('[contato] registro do WhatsApp', err); }
  });

  root.querySelectorAll('[data-interaction]').forEach((button) => {
    button.addEventListener('click', () =>
      openInteractionModal(contact, button.dataset.interaction, refresh));
  });

  root.querySelector('#stage-select')?.addEventListener('change', async (event) => {
    const stageId = event.target.value;
    if (stageId === contact.stage) return;
    const stage = stageById(stageId);

    if (stage?.lost) { openWonLostModal(contact, 'lost', refresh); event.target.value = contact.stage; return; }
    if (stage?.won) { openWonLostModal(contact, 'won', refresh); event.target.value = contact.stage; return; }

    try {
      await moveContactStage(contact.id, stageId);
      toastOk(`Movido para ${stage?.name}.`);
      await refresh();
    } catch (err) {
      console.error('[contato] mover etapa', err);
      toastError(describeError(err));
      event.target.value = contact.stage;
    }
  });

  root.querySelectorAll('[data-del-interaction]').forEach((button) => {
    button.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Excluir registro',
        message: 'Este item será removido do histórico do contato.',
        confirmText: 'Excluir',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteInteraction(button.dataset.delInteraction);
        toastOk('Registro removido.');
        await refresh();
      } catch (err) {
        toastError(describeError(err));
      }
    });
  });
}
