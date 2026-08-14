/**
 * Dashboard — responde, em uma tela, as seis perguntas de quem vende:
 * quem responder, quem precisa de follow-up, o que parou, quanto tem no funil,
 * quanto vendeu e o que fazer hoje.
 */

import { state, subscribe, visibleContacts, visibleTasks, stages,
  tasksToday, tasksOverdue, staleContacts, openContacts } from '../state.js';
import {
  esc, initials, formatMoney, formatMoneyCompact, formatPercent, formatTime,
  friendlyDateTime, relativeTime, daysSince, startOfMonth, sum, formatPhone, toDate
} from '../utils.js';
import { CONTACT_STATUS } from '../defaults.js';
import { emptyState, toastOk, toastError, describeError } from '../ui.js';
import { completeTask } from '../data.js';
import { openQuickActions } from '../modals.js';

let unsubscribe = null;

export function render(root) {
  const paint = () => {
    root.innerHTML = build();
    wire(root);
  };
  paint();
  unsubscribe = subscribe(paint);
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
}

/* ------------------------------------------------------------ metricas --- */

function metrics() {
  const contacts = visibleContacts();
  const tasks = visibleTasks();
  const monthStart = startOfMonth();

  const open = openContacts(contacts);
  const won = contacts.filter((c) => c.status === CONTACT_STATUS.WON);
  const lost = contacts.filter((c) => c.status === CONTACT_STATUS.LOST);

  const inMonth = (contact, field) => {
    const date = toDate(contact[field]);
    return date && date >= monthStart;
  };

  const leadsMonth = contacts.filter((c) => inMonth(c, 'createdAt'));
  const wonMonth = won.filter((c) => inMonth(c, 'wonAt'));
  const lostMonth = lost.filter((c) => inMonth(c, 'lostAt'));

  const decidedMonth = wonMonth.length + lostMonth.length;

  return {
    contacts, tasks, open, won, lost,
    leadsMonth, wonMonth, lostMonth,
    pipelineValue: sum(open, (c) => c.value),
    wonValueMonth: sum(wonMonth, (c) => c.value),
    conversion: decidedMonth ? (wonMonth.length / decidedMonth) * 100 : 0,
    today: tasksToday(tasks),
    overdue: tasksOverdue(tasks),
    stale: staleContacts(contacts)
  };
}

/* --------------------------------------------------------------- html ---- */

function build() {
  const m = metrics();
  const loading = state.loading.contacts || state.loading.tasks;
  const firstName = (state.member?.name || '').split(' ')[0];

  return `
    <div class="page__head">
      <div class="page__title">
        <h1>${firstName ? `Olá, ${esc(firstName)}` : 'Dashboard'}</h1>
        <p>${resumo(m)}</p>
      </div>
      <div class="page__actions">
        <a class="btn" href="#/funil">Ver funil</a>
        <a class="btn btn--primary" href="#/tarefas">Minhas tarefas</a>
      </div>
    </div>

    ${loading ? skeletonKpis() : kpis(m)}

    <div class="dash-grid">
      ${panelFollowUps(m)}
      ${panelStale(m)}
      ${panelPipeline(m)}
      ${panelTasks(m)}
    </div>`;
}

function resumo(m) {
  const parts = [];
  if (m.today.length) parts.push(`${m.today.length} follow-up(s) para hoje`);
  if (m.overdue.length) parts.push(`${m.overdue.length} atrasado(s)`);
  if (m.stale.length) parts.push(`${m.stale.length} negociação(ões) parada(s)`);
  return parts.length ? parts.join(' · ') : 'Tudo em dia por aqui. Bom trabalho!';
}

function skeletonKpis() {
  return `<div class="kpis">${'<div class="card kpi"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="height:26px;margin-top:.5rem"></div></div>'.repeat(6)}</div>`;
}

function kpi(label, value, { foot = '', tone = '', small = false } = {}) {
  return `
    <div class="card kpi ${tone ? `kpi--${tone}` : ''}">
      <span class="kpi__label">${esc(label)}</span>
      <span class="kpi__value ${small ? 'is-small' : ''}">${esc(value)}</span>
      ${foot ? `<span class="kpi__foot">${esc(foot)}</span>` : ''}
    </div>`;
}

function kpis(m) {
  const pendentes = m.today.length + m.overdue.length;
  return `
    <div class="kpis">
      ${kpi('Leads no mês', String(m.leadsMonth.length), { foot: `${m.contacts.length} no total` })}
      ${kpi('Vendas no mês', String(m.wonMonth.length), { foot: `${m.lostMonth.length} perdida(s)`, tone: 'ok' })}
      ${kpi('Taxa de conversão', formatPercent(m.conversion, 1), { foot: 'ganhas ÷ decididas no mês' })}
      ${kpi('Valor do funil', formatMoneyCompact(m.pipelineValue), { foot: `${m.open.length} em aberto`, tone: 'brand', small: true })}
      ${kpi('Fechado no mês', formatMoneyCompact(m.wonValueMonth), { foot: 'vendas confirmadas', tone: 'ok', small: true })}
      ${kpi('Follow-ups pendentes', String(pendentes), {
        foot: m.overdue.length ? `${m.overdue.length} atrasado(s)` : 'nenhum atrasado',
        tone: m.overdue.length ? 'danger' : ''
      })}
    </div>`;
}

/* ------------------------------------------------------------- paineis --- */

function contactRow(contact, sideHtml, { danger = false } = {}) {
  return `
    <button class="itemrow" data-contact="${esc(contact.id)}">
      <span class="itemrow__avatar" ${danger ? 'style="background:var(--danger-100);color:#b91c1c"' : ''}>${esc(initials(contact.name))}</span>
      <span class="itemrow__main">
        <strong>${esc(contact.name)}</strong>
        <span>${esc(contact.company || formatPhone(contact.whatsapp || contact.phone) || '—')}</span>
      </span>
      <span class="itemrow__side">${sideHtml}</span>
    </button>`;
}

function panelFollowUps(m) {
  const rows = [];

  for (const task of m.overdue.slice(0, 6)) {
    const contact = task.contactId ? state.contacts.find((c) => c.id === task.contactId) : null;
    rows.push(`
      <button class="itemrow" data-task-open="${esc(task.id)}" data-contact-id="${esc(task.contactId || '')}">
        <span class="itemrow__avatar" style="background:var(--danger-100);color:#b91c1c">${esc(initials(task.contactName || task.title))}</span>
        <span class="itemrow__main">
          <strong>${esc(task.contactName || task.title)}</strong>
          <span>${esc(task.title)}</span>
        </span>
        <span class="itemrow__side">
          <span class="pill pill--danger">${esc(relativeTime(task._due))}</span>
          ${contact ? `<span class="dim">${esc(formatMoney(contact.value))}</span>` : ''}
        </span>
      </button>`);
  }

  for (const task of m.today.slice(0, 8)) {
    rows.push(`
      <button class="itemrow" data-task-open="${esc(task.id)}" data-contact-id="${esc(task.contactId || '')}">
        <span class="itemrow__avatar">${esc(initials(task.contactName || task.title))}</span>
        <span class="itemrow__main">
          <strong>${esc(task.contactName || task.title)}</strong>
          <span>${esc(task.title)}</span>
        </span>
        <span class="itemrow__side">
          <strong>${esc(formatTime(task._due))}</strong>
          <button class="btn btn--sm btn--ghost" data-task-done="${esc(task.id)}">Concluir</button>
        </span>
      </button>`);
  }

  return `
    <section class="card panel">
      <div class="panel__head">
        <h2><span data-icon="clock"></span> Follow-ups de hoje</h2>
        ${m.overdue.length ? `<span class="pill pill--danger">${m.overdue.length} atrasado(s)</span>` : ''}
      </div>
      <div class="panel__body">
        ${rows.length ? rows.join('') : emptyState('Nenhum follow-up para hoje', 'Programe o próximo retorno direto na ficha do cliente.')}
      </div>
      ${rows.length ? '<div class="panel__foot"><a class="link" href="#/tarefas">Ver todas as tarefas</a></div>' : ''}
    </section>`;
}

function panelStale(m) {
  const days = state.settings.staleDays ?? 5;
  const rows = m.stale.slice(0, 8).map((contact) => {
    const idle = daysSince(contact._lastTouch);
    return contactRow(contact, `
      <span class="pill pill--warn">${idle === null ? '—' : `${idle} dia(s)`}</span>
      <span class="dim">${esc(formatMoney(contact.value))}</span>`, { danger: false });
  });

  return `
    <section class="card panel">
      <div class="panel__head">
        <h2><span data-icon="alert"></span> Clientes sem retorno</h2>
        <span class="muted" style="font-size:.78rem">+${days} dias</span>
      </div>
      <div class="panel__body">
        ${rows.length ? rows.join('') : emptyState('Nenhuma negociação parada', `Todo mundo teve interação nos últimos ${days} dias.`)}
      </div>
      ${rows.length ? '<div class="panel__foot"><span class="muted" style="font-size:.8rem">Toque em um cliente para retomar a conversa.</span></div>' : ''}
    </section>`;
}

function panelPipeline(m) {
  const list = stages();
  const maxValue = Math.max(1, ...list.map((stage) =>
    sum(m.contacts.filter((c) => c.stage === stage.id), (c) => c.value)));

  const bars = list.map((stage) => {
    const inStage = m.contacts.filter((c) => c.stage === stage.id);
    const total = sum(inStage, (c) => c.value);
    return `
      <a class="bar" href="#/funil" style="text-decoration:none;color:inherit;display:block">
        <div class="bar__top">
          <span><span class="dot" style="background:${esc(stage.color)}"></span> ${esc(stage.name)}
            <span class="dim">· ${inStage.length}</span></span>
          <strong>${esc(formatMoneyCompact(total))}</strong>
        </div>
        <div class="bar__track">
          <div class="bar__fill" style="width:${Math.round((total / maxValue) * 100)}%;background:${esc(stage.color)}"></div>
        </div>
      </a>`;
  }).join('');

  return `
    <section class="card panel">
      <div class="panel__head">
        <h2><span data-icon="board"></span> Seu funil</h2>
        <strong>${esc(formatMoney(m.pipelineValue))}</strong>
      </div>
      <div class="panel__body"><div class="bars">${bars}</div></div>
    </section>`;
}

function panelTasks(m) {
  const pending = m.tasks
    .filter((t) => t.status === 'aberta')
    .sort((a, b) => (a._due?.getTime() || 0) - (b._due?.getTime() || 0))
    .slice(0, 8);

  return `
    <section class="card panel">
      <div class="panel__head">
        <h2><span data-icon="check"></span> Próximas tarefas</h2>
        <a class="link" href="#/tarefas">Ver todas</a>
      </div>
      <div class="panel__body panel__body--flush">
        ${pending.length ? pending.map((task) => `
          <div class="taskitem">
            <button class="taskcheck" data-task-done="${esc(task.id)}" aria-label="Concluir tarefa"></button>
            <div class="taskitem__main">
              <div class="taskitem__title">${esc(task.title)}</div>
              <div class="taskitem__meta">
                <span class="prio prio--${esc(task.priority)}"></span>
                ${task.contactName ? `<span>${esc(task.contactName)}</span>·` : ''}
                <span>${esc(friendlyDateTime(task._due))}</span>
              </div>
            </div>
          </div>`).join('')
        : emptyState('Nenhuma tarefa pendente', 'Crie tarefas para não esquecer de retornar aos clientes.')}
      </div>
    </section>`;
}

/* --------------------------------------------------------------- wire ---- */

function wire(root) {
  root.addEventListener('click', async (event) => {
    // Concluir tarefa
    const doneBtn = event.target.closest('[data-task-done]');
    if (doneBtn) {
      event.preventDefault();
      event.stopPropagation();
      try {
        await completeTask(doneBtn.dataset.taskDone);
        toastOk('Tarefa concluída.');
      } catch (err) {
        console.error('[dashboard] concluir tarefa', err);
        toastError(describeError(err));
      }
      return;
    }

    // Abrir ficha a partir de uma tarefa
    const taskRow = event.target.closest('[data-task-open]');
    if (taskRow) {
      const contactId = taskRow.dataset.contactId;
      if (contactId) location.hash = `#/contato/${contactId}`;
      else location.hash = '#/tarefas';
      return;
    }

    // Cliente parado: no celular abre as acoes rapidas, no desktop abre a ficha
    const contactRowEl = event.target.closest('[data-contact]');
    if (contactRowEl) {
      const contact = state.contacts.find((c) => c.id === contactRowEl.dataset.contact);
      if (!contact) return;
      if (window.matchMedia('(max-width: 900px)').matches) openQuickActions(contact);
      else location.hash = `#/contato/${contact.id}`;
    }
  });
}
