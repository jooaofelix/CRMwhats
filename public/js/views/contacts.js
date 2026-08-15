/** Lista de leads/clientes com busca e filtros. Tabela no desktop, cards no celular. */

import { state, subscribe, visibleContacts, stages, stageById, isAdmin } from '../state.js';
import {
  esc, norm, onlyDigits, initials, formatMoney, formatPhone, friendlyDateTime,
  relativeTime, toCSV, downloadFile, debounce, toDate
} from '../utils.js';
import { CONTACT_STATUS } from '../defaults.js';
import { emptyState } from '../ui.js';
import { openContactModal, openImportModal, openQuickActions } from '../modals.js';

let unsubscribe = null;

/** Filtros preservados enquanto a tela existir. */
const filters = { term: '', stage: '', owner: '', tag: '', source: '', status: 'todos' };

export function render(root) {
  root.innerHTML = shell();
  wireToolbar(root);
  paintList(root);
  unsubscribe = subscribe(() => paintList(root));
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
}

/* --------------------------------------------------------------- html ---- */

function shell() {
  const settings = state.settings;
  return `
    <div class="page__head">
      <div class="page__title">
        <h1>Contatos</h1>
        <p id="contacts-count">Carregando…</p>
      </div>
      <div class="page__actions">
        <button class="btn" id="btn-import"><span data-icon="upload"></span> Importar CSV</button>
        <button class="btn" id="btn-export">Exportar</button>
        <button class="btn btn--primary" id="btn-add"><span data-icon="plus"></span> Novo lead</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="search">
        <span data-icon="search" class="search__icon"></span>
        <input type="search" id="f-term" placeholder="Nome, telefone, empresa ou tag…" value="${esc(filters.term)}">
      </div>
      <select id="f-status">
        <option value="todos">Todos</option>
        <option value="abertos">Em aberto</option>
        <option value="ganho">Ganhos</option>
        <option value="perdido">Perdidos</option>
      </select>
      <select id="f-stage">
        <option value="">Todas as etapas</option>
        ${stages().map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
      </select>
      <select id="f-source">
        <option value="">Todas as origens</option>
        ${(settings.sources || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
      ${isAdmin() ? `
      <select id="f-owner">
        <option value="">Todos os responsáveis</option>
        ${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name || m.email)}</option>`).join('')}
      </select>` : ''}
      <select id="f-tag">
        <option value="">Todas as tags</option>
        ${(settings.tags || []).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
      </select>
    </div>

    <div id="contacts-list"></div>`;
}

/* ------------------------------------------------------------- filtro ---- */

function applyFilters() {
  const term = norm(filters.term.trim());
  const digits = onlyDigits(filters.term);

  return visibleContacts().filter((contact) => {
    if (filters.status === 'abertos' && contact.status !== CONTACT_STATUS.OPEN) return false;
    if (filters.status === 'ganho' && contact.status !== CONTACT_STATUS.WON) return false;
    if (filters.status === 'perdido' && contact.status !== CONTACT_STATUS.LOST) return false;
    if (filters.stage && contact.stage !== filters.stage) return false;
    if (filters.owner && contact.ownerId !== filters.owner) return false;
    if (filters.source && contact.source !== filters.source) return false;
    if (filters.tag && !(contact.tags || []).some((t) => t.toUpperCase() === filters.tag.toUpperCase())) return false;

    if (term.length >= 2 || digits.length >= 4) {
      const matchText = term.length >= 2 && contact._search?.includes(term);
      const matchPhone = digits.length >= 4 && contact._digits?.includes(digits);
      if (!matchText && !matchPhone) return false;
    }
    return true;
  }).sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
}

/* --------------------------------------------------------------- lista --- */

function paintList(root) {
  const list = applyFilters();
  const container = root.querySelector('#contacts-list');
  const counter = root.querySelector('#contacts-count');
  if (!container) return;

  if (state.loading.contacts) {
    container.innerHTML = '<div class="card card--pad"><div class="skeleton" style="height:18px;width:50%"></div></div>';
    return;
  }

  counter.textContent = list.length === visibleContacts().length
    ? `${list.length} contato(s)`
    : `${list.length} de ${visibleContacts().length} contato(s)`;

  if (!list.length) {
    container.innerHTML = `<div class="card">${emptyState(
      'Nenhum contato encontrado',
      state.contacts.length ? 'Ajuste os filtros ou a busca.' : 'Cadastre seu primeiro lead para começar.',
      '<button class="btn btn--primary" data-add>Cadastrar lead</button>'
    )}</div>`;
    container.querySelector('[data-add]')?.addEventListener('click', () => openContactModal());
    return;
  }

  container.innerHTML = `
    <div class="card tablewrap desktop-only-table">
      <table class="data">
        <thead>
          <tr>
            <th>Contato</th><th>Etapa</th><th>Valor</th>
            <th>Responsável</th><th>Último contato</th><th>Próximo follow-up</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>
    <div class="cardlist mobile-cards">${list.map(cardHtml).join('')}</div>`;

  container.querySelectorAll('[data-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      const id = element.dataset.id;
      if (event.target.closest('[data-quick]')) {
        const contact = state.contacts.find((c) => c.id === id);
        if (contact) openQuickActions(contact);
        return;
      }
      location.hash = `#/contato/${id}`;
    });
  });
}

function stagePill(stageId) {
  const stage = stageById(stageId);
  if (!stage) return '<span class="pill">Sem etapa</span>';
  return `<span class="pill pill--stage" style="background:${esc(stage.color)}">${esc(stage.name)}</span>`;
}

function rowHtml(contact) {
  const overdue = contact.nextFollowUpAt && toDate(contact.nextFollowUpAt) < new Date();
  return `
    <tr data-id="${esc(contact.id)}">
      <td>
        <div class="row">
          <span class="itemrow__avatar">${esc(initials(contact.name))}</span>
          <div class="grow">
            <div style="font-weight:600">${esc(contact.name)}</div>
            <div class="muted" style="font-size:.8rem">
              ${esc([contact.company, formatPhone(contact.whatsapp || contact.phone)].filter(Boolean).join(' · ') || '—')}
            </div>
          </div>
        </div>
      </td>
      <td>${stagePill(contact.stage)}</td>
      <td><strong>${esc(formatMoney(contact.value))}</strong></td>
      <td class="muted">${esc(contact.ownerName || '—')}</td>
      <td class="muted">${contact._lastTouch ? esc(relativeTime(contact._lastTouch)) : '—'}</td>
      <td>${contact.nextFollowUpAt
        ? `<span class="pill ${overdue ? 'pill--danger' : 'pill--warn'}">${esc(friendlyDateTime(contact.nextFollowUpAt))}</span>`
        : '<span class="dim">—</span>'}</td>
    </tr>`;
}

function cardHtml(contact) {
  const overdue = contact.nextFollowUpAt && toDate(contact.nextFollowUpAt) < new Date();
  return `
    <article class="card leadcard" data-id="${esc(contact.id)}">
      <div class="leadcard__top">
        <span class="itemrow__avatar">${esc(initials(contact.name))}</span>
        <div class="grow">
          <div style="font-weight:620">${esc(contact.name)}</div>
          <div class="muted" style="font-size:.8rem">${esc(contact.company || formatPhone(contact.whatsapp || contact.phone) || '—')}</div>
        </div>
        <strong>${esc(formatMoney(contact.value))}</strong>
      </div>
      <div class="leadcard__meta">
        ${stagePill(contact.stage)}
        ${contact.nextFollowUpAt
          ? `<span class="pill ${overdue ? 'pill--danger' : 'pill--warn'}">${esc(friendlyDateTime(contact.nextFollowUpAt))}</span>`
          : ''}
        ${contact._lastTouch ? `<span class="dim">${esc(relativeTime(contact._lastTouch))}</span>` : ''}
        <span class="spacer"></span>
        <button class="btn btn--sm" data-quick>Ações</button>
      </div>
    </article>`;
}

/* -------------------------------------------------------------- wire ----- */

function wireToolbar(root) {
  const bind = (id, key) => {
    const element = root.querySelector(id);
    if (!element) return;
    element.value = filters[key];
    element.addEventListener('change', () => {
      filters[key] = element.value;
      paintList(root);
    });
  };

  const termInput = root.querySelector('#f-term');
  termInput.addEventListener('input', debounce(() => {
    filters.term = termInput.value;
    paintList(root);
  }, 200));

  bind('#f-status', 'status');
  bind('#f-stage', 'stage');
  bind('#f-source', 'source');
  bind('#f-owner', 'owner');
  bind('#f-tag', 'tag');

  root.querySelector('#btn-add').addEventListener('click', () => openContactModal());
  root.querySelector('#btn-import').addEventListener('click', () => openImportModal());
  root.querySelector('#btn-export').addEventListener('click', () => {
    const list = applyFilters();
    const csv = toCSV(
      ['Nome', 'WhatsApp', 'Telefone', 'E-mail', 'Empresa', 'Etapa', 'Valor', 'Responsável', 'Origem', 'Tags', 'Último contato', 'Próximo follow-up'],
      list.map((c) => [
        c.name, c.whatsapp, c.phone, c.email, c.company,
        stageById(c.stage)?.name || '', String(c.value || 0).replace('.', ','),
        c.ownerName, c.source, (c.tags || []).join(' / '),
        c._lastTouch ? friendlyDateTime(c._lastTouch) : '',
        c.nextFollowUpAt ? friendlyDateTime(c.nextFollowUpAt) : ''
      ])
    );
    downloadFile(`contatos-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  });
}
