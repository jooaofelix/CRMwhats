/**
 * Funil em Kanban com arrastar e soltar.
 *
 * O drag usa Pointer Events (mouse, toque e caneta no mesmo codigo):
 *  - mouse: comeca a arrastar apos 5px de movimento;
 *  - toque: comeca apos um toque longo (300ms), para nao atrapalhar a rolagem.
 * Ao soltar, a etapa e gravada no Firestore e a mudanca entra na timeline.
 */

import { state, subscribe, visibleContacts, stages, stageById, isAdmin } from '../state.js';
import {
  esc, norm, initials, formatMoney, formatMoneyCompact, friendlyDateTime,
  relativeTime, sum, debounce, toDate
} from '../utils.js';
import { toastOk, toastError, describeError } from '../ui.js';
import { moveContactStage } from '../data.js';
import { openContactModal, openWonLostModal, openQuickActions } from '../modals.js';

let unsubscribe = null;
let boardEl = null;
const filters = { term: '', owner: '' };

export function render(root) {
  root.innerHTML = `
    <div class="page__head">
      <div class="page__title">
        <h1>Funil</h1>
        <p id="funnel-summary">Carregando…</p>
      </div>
      <div class="page__actions">
        <button class="btn btn--primary" id="btn-add"><span data-icon="plus"></span> Novo lead</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="search">
        <span data-icon="search" class="search__icon"></span>
        <input type="search" id="f-term" placeholder="Filtrar por nome ou empresa…" value="${esc(filters.term)}">
      </div>
      ${isAdmin() ? `
      <select id="f-owner">
        <option value="">Todos os responsáveis</option>
        ${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name || m.email)}</option>`).join('')}
      </select>` : ''}
      <span class="muted desktop-only" style="font-size:.82rem">Arraste os cards entre as colunas.</span>
    </div>

    <div class="board" id="board"></div>`;

  boardEl = root.querySelector('#board');

  const termInput = root.querySelector('#f-term');
  termInput.addEventListener('input', debounce(() => { filters.term = termInput.value; paint(); }, 180));
  root.querySelector('#f-owner')?.addEventListener('change', (event) => {
    filters.owner = event.target.value; paint();
  });
  root.querySelector('#btn-add').addEventListener('click', () => openContactModal());

  paint();
  unsubscribe = subscribe(paint);
  enableDragAndDrop();
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  cleanupDrag();
  boardEl = null;
}

/* -------------------------------------------------------------- pintura -- */

function filtered() {
  const term = norm(filters.term.trim());
  return visibleContacts().filter((contact) => {
    if (filters.owner && contact.ownerId !== filters.owner) return false;
    if (term.length >= 2 && !contact._search?.includes(term)) return false;
    return true;
  });
}

function paint() {
  if (!boardEl) return;
  const list = filtered();
  const summary = document.getElementById('funnel-summary');

  const openTotal = sum(list.filter((c) => {
    const stage = stageById(c.stage);
    return stage && !stage.won && !stage.lost;
  }), (c) => c.value);

  if (summary) {
    summary.textContent = state.loading.contacts
      ? 'Carregando…'
      : `${list.length} negociação(ões) · ${formatMoney(openTotal)} em aberto`;
  }

  boardEl.innerHTML = stages().map((stage) => {
    const cards = list
      .filter((contact) => contact.stage === stage.id)
      .sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
    const total = sum(cards, (c) => c.value);

    return `
      <section class="column" data-stage="${esc(stage.id)}">
        <header class="column__head">
          <div class="column__title">
            <span class="dot" style="background:${esc(stage.color)}"></span>
            ${esc(stage.name)}
            <span class="column__count">${cards.length}</span>
          </div>
          <span class="column__total">${esc(formatMoneyCompact(total))}</span>
        </header>
        <div class="column__body" data-drop="${esc(stage.id)}">
          ${cards.map(cardHtml).join('') || '<p class="dim" style="font-size:.8rem;padding:.5rem;text-align:center">Vazio</p>'}
        </div>
      </section>`;
  }).join('');
}

function cardHtml(contact) {
  const overdue = contact.nextFollowUpAt && toDate(contact.nextFollowUpAt) < new Date();
  return `
    <article class="kcard" data-card="${esc(contact.id)}" tabindex="0">
      <div class="kcard__head">
        <div class="grow">
          <div class="kcard__name">${esc(contact.name)}</div>
          ${contact.company ? `<div class="kcard__company">${esc(contact.company)}</div>` : ''}
        </div>
        <span class="kcard__owner" title="${esc(contact.ownerName || '')}">${esc(initials(contact.ownerName || '?'))}</span>
      </div>
      <div class="row" style="gap:.4rem">
        <span class="kcard__value">${esc(formatMoney(contact.value))}</span>
        ${contact.tags?.length ? `<span class="tag">${esc(contact.tags[0])}</span>` : ''}
      </div>
      <div class="kcard__foot">
        <span title="Última interação">${contact._lastTouch ? esc(relativeTime(contact._lastTouch)) : 'sem interação'}</span>
        ${contact.nextFollowUpAt
          ? `<span class="pill ${overdue ? 'pill--danger' : 'pill--warn'}" style="font-size:.68rem">
               ${esc(friendlyDateTime(contact.nextFollowUpAt))}</span>`
          : ''}
      </div>
    </article>`;
}

/* ----------------------------------------------------------- drag/drop --- */

let drag = null;
let pressTimer = null;
/** Evita que o "click" disparado apos soltar o card abra a ficha do contato. */
let suppressClickUntil = 0;

function enableDragAndDrop() {
  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('click', onCardClick);
  boardEl.addEventListener('keydown', onCardKey);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function cleanupDrag() {
  clearTimeout(pressTimer);
  drag?.floating?.remove();
  drag = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
}

function onPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const card = event.target.closest('.kcard');
  if (!card || event.target.closest('button, a')) return;

  const contact = state.contacts.find((c) => c.id === card.dataset.card);
  if (!contact) return;

  drag = {
    contact, card,
    startX: event.clientX, startY: event.clientY,
    active: false, moved: false,
    touch: event.pointerType === 'touch',
    fromStage: contact.stage
  };

  // No toque, o arraste so comeca com toque longo — assim a rolagem continua natural.
  if (drag.touch) {
    pressTimer = setTimeout(() => { if (drag && !drag.moved) beginDrag(event); }, 300);
  }
}

function beginDrag(event) {
  if (!drag || drag.active) return;
  drag.active = true;

  const rect = drag.card.getBoundingClientRect();
  drag.offsetX = (drag.startX ?? event.clientX) - rect.left;
  drag.offsetY = (drag.startY ?? event.clientY) - rect.top;

  const floating = drag.card.cloneNode(true);
  floating.classList.add('kcard__drag');
  floating.style.width = `${rect.width}px`;
  floating.style.left = `${rect.left}px`;
  floating.style.top = `${rect.top}px`;
  document.body.appendChild(floating);

  drag.floating = floating;
  drag.card.classList.add('is-ghost');
  document.body.style.userSelect = 'none';
  if (navigator.vibrate && drag.touch) navigator.vibrate(12);
}

function onPointerMove(event) {
  if (!drag) return;

  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;

  if (!drag.active) {
    if (Math.hypot(dx, dy) > 8) {
      drag.moved = true;
      clearTimeout(pressTimer);
      if (!drag.touch) beginDrag(event);   // mouse: arrasta direto
      else { drag = null; return; }        // toque: era rolagem
    }
    return;
  }

  event.preventDefault();
  drag.floating.style.left = `${event.clientX - drag.offsetX}px`;
  drag.floating.style.top = `${event.clientY - drag.offsetY}px`;

  const target = document.elementFromPoint(event.clientX, event.clientY);
  const column = target?.closest('.column');
  document.querySelectorAll('.column.is-over').forEach((c) => c.classList.remove('is-over'));
  if (column) column.classList.add('is-over');

  // Rola o quadro quando o card chega perto das bordas.
  const boardRect = boardEl.getBoundingClientRect();
  if (event.clientX > boardRect.right - 60) boardEl.scrollLeft += 12;
  else if (event.clientX < boardRect.left + 60) boardEl.scrollLeft -= 12;
}

async function onPointerUp(event) {
  clearTimeout(pressTimer);
  if (!drag) return;

  const current = drag;
  drag = null;

  if (!current.active) return;

  suppressClickUntil = Date.now() + 350;
  current.floating?.remove();
  current.card.classList.remove('is-ghost');
  document.body.style.userSelect = '';

  const column = document.elementFromPoint(event.clientX, event.clientY)?.closest('.column');
  document.querySelectorAll('.column.is-over').forEach((c) => c.classList.remove('is-over'));

  const stageId = column?.dataset.stage;
  if (!stageId || stageId === current.fromStage) return;

  const stage = stageById(stageId);
  // Ganho/perda pedem confirmacao: valor final e motivo alimentam os relatorios.
  if (stage?.won) { openWonLostModal(current.contact, 'won'); return; }
  if (stage?.lost) { openWonLostModal(current.contact, 'lost'); return; }

  try {
    await moveContactStage(current.contact.id, stageId);
    toastOk(`${current.contact.name} → ${stage?.name}.`);
  } catch (err) {
    console.error('[funil] mover', err);
    toastError(describeError(err));
    paint();
  }
}

function onCardClick(event) {
  if (Date.now() < suppressClickUntil) return;
  const card = event.target.closest('.kcard');
  if (!card || card.classList.contains('is-ghost')) return;

  const contact = state.contacts.find((c) => c.id === card.dataset.card);
  if (!contact) return;

  if (window.matchMedia('(max-width: 900px)').matches) openQuickActions(contact);
  else location.hash = `#/contato/${contact.id}`;
}

function onCardKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.kcard');
  if (!card) return;
  event.preventDefault();
  location.hash = `#/contato/${card.dataset.card}`;
}
