/**
 * Estado central da aplicacao.
 *
 * Estrategia de leitura (custo/performance):
 *  - Um unico onSnapshot por colecao "quente" (contacts, tasks, templates,
 *    members). Sao bases pequenas em PMEs e ficam em memoria, o que permite
 *    busca, filtros, kanban e relatorios sem novas leituras no Firestore.
 *  - Colecoes "frias" (interactions, messages) sao lidas sob demanda, por
 *    contato/conversa.
 */

import { toDate, norm, onlyDigits, byDate } from './utils.js';
import { defaultSettings, ROLES, CONTACT_STATUS, TASK_STATUS } from './defaults.js';

export const state = {
  /** Firebase User */
  user: null,
  /** users/{uid} */
  profile: null,
  /** companies/{id} */
  company: null,
  /** companies/{id}/members/{uid} */
  member: null,
  /** companies/{id}/settings/pipeline (mesclado com os padroes) */
  settings: defaultSettings(),

  contacts: [],
  tasks: [],
  templates: [],
  members: [],

  loading: { contacts: true, tasks: true, templates: true, members: true },
  error: null
};

/* --------------------------------------------------------- assinaturas ---- */

const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

let emitScheduled = false;
/** Notifica as views. Agrupa emissoes no mesmo tick para evitar re-render duplo. */
export function emit() {
  if (emitScheduled) return;
  emitScheduled = true;
  queueMicrotask(() => {
    emitScheduled = false;
    for (const fn of subscribers) {
      try { fn(state); } catch (err) { console.error('[state] assinante falhou', err); }
    }
  });
}

export function setState(patch) {
  Object.assign(state, patch);
  emit();
}

export function resetState() {
  state.user = null;
  state.profile = null;
  state.company = null;
  state.member = null;
  state.settings = defaultSettings();
  state.contacts = [];
  state.tasks = [];
  state.templates = [];
  state.members = [];
  state.loading = { contacts: true, tasks: true, templates: true, members: true };
  state.error = null;
  emit();
}

/* ------------------------------------------------------------ mappers ---- */

/** Normaliza o documento do contato e pre-calcula campos de busca. */
export function mapContact(id, data) {
  const c = { id, ...data };
  c.value = Number(data.value) || 0;
  c.tags = Array.isArray(data.tags) ? data.tags : [];
  c.status = data.status || CONTACT_STATUS.OPEN;
  c._search = norm([data.name, data.company, data.email, (data.tags || []).join(' ')].join(' '));
  c._digits = onlyDigits(`${data.phone || ''}${data.whatsapp || ''}`);
  c._lastTouch = toDate(data.lastContactAt) || toDate(data.updatedAt) || toDate(data.createdAt);
  return c;
}

export function mapTask(id, data) {
  return {
    id, ...data,
    status: data.status || TASK_STATUS.OPEN,
    priority: data.priority || 'media',
    _due: toDate(data.dueAt)
  };
}

/* ---------------------------------------------------------- seletores ---- */

export function isAdmin() {
  return state.member?.role === ROLES.ADMIN;
}

/** Vendedor enxerga a propria carteira; administrador enxerga tudo. */
export function visibleContacts() {
  if (isAdmin()) return state.contacts;
  const uid = state.user?.uid;
  return state.contacts.filter((c) => c.ownerId === uid || !c.ownerId);
}

export function visibleTasks() {
  if (isAdmin()) return state.tasks;
  const uid = state.user?.uid;
  return state.tasks.filter((t) => t.assigneeId === uid || !t.assigneeId);
}

export function stages() {
  return [...(state.settings.stages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function stageById(id) {
  return stages().find((s) => s.id === id) || null;
}

export function stageName(id) {
  return stageById(id)?.name || 'Sem etapa';
}

export function stageColor(id) {
  return stageById(id)?.color || '#94a3b8';
}

/** Etapas que ainda estao em jogo (nao ganhas nem perdidas). */
export function openStages() {
  return stages().filter((s) => !s.won && !s.lost);
}

export function wonStageId() {
  return stages().find((s) => s.won)?.id || 'fechado';
}
export function lostStageId() {
  return stages().find((s) => s.lost)?.id || 'perdido';
}

export function contactById(id) {
  return state.contacts.find((c) => c.id === id) || null;
}

export function memberById(uid) {
  return state.members.find((m) => m.id === uid) || null;
}

/** Contatos em negociacao aberta (base do funil financeiro). */
export function openContacts(list = visibleContacts()) {
  return list.filter((c) => c.status === CONTACT_STATUS.OPEN);
}

export function openTasks(list = visibleTasks()) {
  return list.filter((t) => t.status === TASK_STATUS.OPEN);
}

/** Follow-ups/tarefas com vencimento hoje. */
export function tasksToday(list = visibleTasks()) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return openTasks(list)
    .filter((t) => t._due && t._due >= start && t._due <= end)
    .sort((a, b) => a._due - b._due);
}

/** Tarefas vencidas (antes de hoje). */
export function tasksOverdue(list = visibleTasks()) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return openTasks(list)
    .filter((t) => t._due && t._due < start)
    .sort((a, b) => a._due - b._due);
}

/** Negociacoes abertas sem interacao ha N dias. */
export function staleContacts(list = visibleContacts(), days = state.settings.staleDays ?? 5) {
  const limitMs = Date.now() - days * 86400000;
  return openContacts(list)
    .filter((c) => {
      const t = c._lastTouch?.getTime();
      return t !== undefined && t !== null && t < limitMs;
    })
    .sort((a, b) => (a._lastTouch?.getTime() || 0) - (b._lastTouch?.getTime() || 0));
}

/** Contatos criados no periodo. */
export function contactsBetween(list, from, to) {
  return list.filter((c) => {
    const d = toDate(c.createdAt);
    return d && d >= from && d <= to;
  });
}

export { byDate };
