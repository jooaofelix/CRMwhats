/** Tarefas e follow-ups: o que precisa ser feito, agrupado por urgência. */

import { state, subscribe, visibleTasks, isAdmin } from '../state.js';
import { esc, friendlyDateTime, relativeTime, addDays, startOfDay, endOfDay } from '../utils.js';
import { TASK_STATUS, TASK_PRIORITIES } from '../defaults.js';
import { emptyState, toastOk, toastError, describeError, confirmDialog } from '../ui.js';
import { completeTask, reopenTask, deleteTask } from '../data.js';
import { openTaskModal } from '../modals.js';

let unsubscribe = null;
const filters = { range: 'pendentes', assignee: '' };

export function render(root) {
  const paint = () => { root.innerHTML = build(); wire(root, paint); };
  paint();
  unsubscribe = subscribe(paint);
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
}

/* ------------------------------------------------------------- filtros --- */

function selectTasks() {
  const all = visibleTasks().filter((task) =>
    !filters.assignee || task.assigneeId === filters.assignee);

  const today = startOfDay();
  const todayEnd = endOfDay();

  switch (filters.range) {
    case 'hoje':
      return all.filter((t) => t.status === TASK_STATUS.OPEN && t._due && t._due >= today && t._due <= todayEnd);
    case 'atrasadas':
      return all.filter((t) => t.status === TASK_STATUS.OPEN && t._due && t._due < today);
    case 'semana':
      return all.filter((t) => t.status === TASK_STATUS.OPEN && t._due && t._due <= endOfDay(addDays(new Date(), 7)));
    case 'concluidas':
      return all.filter((t) => t.status === TASK_STATUS.DONE);
    case 'pendentes':
    default:
      return all.filter((t) => t.status === TASK_STATUS.OPEN);
  }
}

/* --------------------------------------------------------------- html ---- */

function build() {
  const tasks = selectTasks().sort((a, b) => {
    const da = a._due?.getTime() ?? Infinity;
    const dbv = b._due?.getTime() ?? Infinity;
    return filters.range === 'concluidas' ? dbv - da : da - dbv;
  });

  const all = visibleTasks();
  const counts = {
    hoje: all.filter((t) => t.status === TASK_STATUS.OPEN && t._due && t._due >= startOfDay() && t._due <= endOfDay()).length,
    atrasadas: all.filter((t) => t.status === TASK_STATUS.OPEN && t._due && t._due < startOfDay()).length
  };

  return `
    <div class="page__head">
      <div class="page__title">
        <h1>Tarefas</h1>
        <p>${counts.atrasadas ? `${counts.atrasadas} atrasada(s) · ` : ''}${counts.hoje} para hoje</p>
      </div>
      <div class="page__actions">
        <button class="btn btn--primary" id="btn-add"><span data-icon="plus"></span> Nova tarefa</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented" id="range">
        ${[['pendentes', 'Pendentes'], ['hoje', 'Hoje'], ['atrasadas', 'Atrasadas'],
           ['semana', '7 dias'], ['concluidas', 'Concluídas']]
          .map(([id, label]) =>
            `<button data-range="${id}" class="${filters.range === id ? 'is-active' : ''}">${label}</button>`).join('')}
      </div>
      ${isAdmin() ? `
      <select id="f-assignee">
        <option value="">Todos os responsáveis</option>
        ${state.members.map((m) =>
          `<option value="${esc(m.id)}" ${filters.assignee === m.id ? 'selected' : ''}>${esc(m.name || m.email)}</option>`).join('')}
      </select>` : ''}
    </div>

    <div class="card">
      ${tasks.length ? tasks.map(taskHtml).join('') :
        emptyState('Nada por aqui', 'Nenhuma tarefa neste filtro.')}
    </div>`;
}

function taskHtml(task) {
  const done = task.status === TASK_STATUS.DONE;
  const overdue = !done && task._due && task._due < startOfDay();
  const priority = TASK_PRIORITIES.find((p) => p.id === task.priority)?.label || '';

  return `
    <div class="taskitem ${done ? 'is-done' : ''}" data-task="${esc(task.id)}">
      <button class="taskcheck ${done ? 'is-done' : ''}" data-toggle="${esc(task.id)}"
              aria-label="${done ? 'Reabrir tarefa' : 'Concluir tarefa'}"></button>
      <div class="taskitem__main">
        <div class="taskitem__title">${esc(task.title)}</div>
        <div class="taskitem__meta">
          <span class="prio prio--${esc(task.priority)}" title="Prioridade ${esc(priority)}"></span>
          ${task.type === 'followup' ? '<span class="pill pill--brand">Follow-up</span>' : ''}
          ${task.contactId
            ? `<a href="#/contato/${esc(task.contactId)}" data-stop>${esc(task.contactName || 'contato')}</a>`
            : ''}
          <span class="${overdue ? 'pill pill--danger' : ''}">${esc(friendlyDateTime(task._due))}</span>
          ${overdue ? `<span class="dim">${esc(relativeTime(task._due))}</span>` : ''}
          ${task.assigneeName ? `<span class="dim">· ${esc(task.assigneeName)}</span>` : ''}
        </div>
        ${task.notes ? `<div class="muted" style="font-size:.82rem;margin-top:.2rem">${esc(task.notes)}</div>` : ''}
      </div>
      <div class="row" style="gap:.15rem">
        <button class="iconbtn" data-edit="${esc(task.id)}" aria-label="Editar"><span data-icon="edit"></span></button>
        <button class="iconbtn" data-delete="${esc(task.id)}" aria-label="Excluir"><span data-icon="trash"></span></button>
      </div>
    </div>`;
}

/* --------------------------------------------------------------- wire ---- */

function wire(root, paint) {
  root.querySelector('#btn-add').addEventListener('click', () => openTaskModal(null, null, paint));

  root.querySelector('#range').addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (!button) return;
    filters.range = button.dataset.range;
    paint();
  });

  root.querySelector('#f-assignee')?.addEventListener('change', (event) => {
    filters.assignee = event.target.value;
    paint();
  });

  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-stop]')) return;

    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      const task = state.tasks.find((t) => t.id === id);
      try {
        if (task?.status === TASK_STATUS.DONE) {
          await reopenTask(id);
          toastOk('Tarefa reaberta.');
        } else {
          await completeTask(id);
          toastOk('Tarefa concluída.');
        }
      } catch (err) {
        console.error('[tarefas] alternar', err);
        toastError(describeError(err));
      }
      return;
    }

    const edit = event.target.closest('[data-edit]');
    if (edit) {
      const task = state.tasks.find((t) => t.id === edit.dataset.edit);
      if (task) openTaskModal(task, null, paint);
      return;
    }

    const remove = event.target.closest('[data-delete]');
    if (remove) {
      const ok = await confirmDialog({
        title: 'Excluir tarefa',
        message: 'A tarefa será removida definitivamente.',
        confirmText: 'Excluir',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteTask(remove.dataset.delete);
        toastOk('Tarefa excluída.');
      } catch (err) {
        toastError(describeError(err));
      }
    }
  });
}
