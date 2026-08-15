/**
 * Camada de acesso ao Firestore.
 *
 * Convencoes:
 *  - Todo dado de negocio vive sob companies/{companyId}/...
 *  - Datas sao gravadas com Timestamp do relogio do cliente (e nao
 *    serverTimestamp) para que a interface mostre o valor imediatamente,
 *    inclusive offline, sem o "flicker" de campo nulo.
 *  - Nenhuma funcao aqui monta HTML: apenas le e escreve.
 */

import {
  db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, Timestamp, writeBatch
} from './firebase.js';

import {
  state, setState, mapContact, mapTask, emit, stageById, wonStageId, lostStageId
} from './state.js';

import {
  defaultSettings, SEED_TEMPLATES, ROLES, CONTACT_STATUS, TASK_STATUS
} from './defaults.js';

import { appConfig } from './config.js';
import { clean, cleanMultiline, onlyDigits, norm, slugify, toDate, toWhatsAppNumber } from './utils.js';

/* ------------------------------------------------------------ helpers ---- */

export const now = () => Timestamp.now();
export const ts = (date) => (date ? Timestamp.fromDate(new Date(date)) : null);

function requireCompanyId() {
  const id = state.company?.id;
  if (!id) throw new Error('Nenhum workspace ativo.');
  return id;
}

/** Referencia para uma colecao do workspace atual. */
export function col(name, companyId = requireCompanyId()) {
  return collection(db, 'companies', companyId, name);
}
export function docRef(name, id, companyId = requireCompanyId()) {
  return doc(db, 'companies', companyId, name, id);
}

function actor() {
  return {
    uid: state.user?.uid || null,
    name: state.member?.name || state.profile?.displayName || state.user?.displayName || state.user?.email || 'Usuário'
  };
}

/* ------------------------------------------------- perfil e workspace ---- */

/** Cria/atualiza users/{uid} no primeiro acesso. */
export async function ensureUserProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const profile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || (user.email || '').split('@')[0] || 'Usuário',
      photoURL: user.photoURL || '',
      companyId: null,
      createdAt: now(),
      lastLoginAt: now()
    };
    await setDoc(ref, profile);
    return profile;
  }

  const profile = { ...snap.data(), uid: user.uid };
  // Atualizacao leve, sem bloquear o carregamento.
  updateDoc(ref, { lastLoginAt: now() }).catch(() => {});
  return profile;
}

export async function setActiveCompany(companyId) {
  await updateDoc(doc(db, 'users', state.user.uid), { companyId });
  state.profile = { ...state.profile, companyId };
  emit();
}

function randomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambiguos
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Cria o workspace e cadastra o criador como administrador.
 * As escritas sao sequenciais de proposito: a regra que autoriza o documento
 * de membro faz get() no documento da empresa, que precisa ja existir.
 */
export async function createCompany({ name, segment = '', userName }) {
  const user = state.user;
  if (!user) throw new Error('Sessão expirada.');

  const companyName = clean(name, 120);
  const base = slugify(companyName) || 'workspace';
  const joinCode = randomCode(6);
  const company = {
    name: companyName,
    segment: clean(segment, 80),
    ownerId: user.uid,
    plan: 'trial',
    planStatus: 'active',
    trialEndsAt: ts(new Date(Date.now() + 14 * 86400000)),
    seats: 2,
    joinCode,
    createdAt: now(),
    updatedAt: now()
  };

  // ID legivel (aparece no codigo de convite e na URL do webhook) com sufixo
  // aleatorio anticolisao.
  //
  // Nao da para checar antes se o id ja existe: ler companies/{id} exige ser
  // membro, entao a verificacao seria negada pelas regras. Em vez disso
  // tentamos criar — se o documento ja existir, a escrita vira um update, que
  // as regras negam — e sorteamos outro sufixo. Com 6 caracteres o segundo
  // sorteio praticamente nunca acontece.
  let companyId = '';
  const MAX_TENTATIVAS = 5;
  for (let attempt = 1; attempt <= MAX_TENTATIVAS; attempt++) {
    const candidate = `${base}-${randomCode(6).toLowerCase()}`;
    try {
      await setDoc(doc(db, 'companies', candidate), company);
      companyId = candidate;
      break;
    } catch (err) {
      const colisaoProvavel = err?.code === 'permission-denied' && attempt < MAX_TENTATIVAS;
      if (!colisaoProvavel) throw err;
      console.warn('[data] identificador em uso, sorteando outro', candidate);
    }
  }
  if (!companyId) throw new Error('Não foi possível criar o workspace. Tente novamente.');

  await setDoc(doc(db, 'companies', companyId, 'members', user.uid), {
    uid: user.uid,
    name: clean(userName, 80) || company.name,
    email: user.email || '',
    photoURL: user.photoURL || '',
    role: ROLES.ADMIN,
    active: true,
    joinCode,
    createdAt: now()
  });

  await setDoc(doc(db, 'companies', companyId, 'settings', 'pipeline'), {
    ...defaultSettings(),
    updatedAt: now()
  });

  // Modelos iniciais para o usuario ter algo pronto para usar.
  const batch = writeBatch(db);
  for (const tpl of SEED_TEMPLATES) {
    batch.set(doc(collection(db, 'companies', companyId, 'templates')), {
      ...tpl, createdAt: now(), createdBy: user.uid
    });
  }
  await batch.commit();

  await setActiveCompany(companyId);
  return { id: companyId, ...company };
}

/**
 * Entra em um workspace existente usando o codigo de convite
 * no formato "identificador-do-workspace.CODIGO".
 */
export async function joinCompany(fullCode, userName) {
  const user = state.user;
  if (!user) throw new Error('Sessão expirada.');

  const raw = clean(fullCode, 120);
  const sep = raw.lastIndexOf('.');
  if (sep < 1) throw new Error('Código de convite inválido.');

  const companyId = raw.slice(0, sep).trim().toLowerCase();
  const code = raw.slice(sep + 1).trim().toUpperCase();
  if (!companyId || !code) throw new Error('Código de convite inválido.');

  await setDoc(doc(db, 'companies', companyId, 'members', user.uid), {
    uid: user.uid,
    name: clean(userName, 80) || user.displayName || user.email,
    email: user.email || '',
    photoURL: user.photoURL || '',
    role: ROLES.SALES,
    active: true,
    joinCode: code,
    createdAt: now()
  });

  await setActiveCompany(companyId);
  return companyId;
}

/** Carrega empresa + membro + configuracoes. Retorna false se nao ha workspace. */
export async function loadWorkspace(companyId) {
  if (!companyId) return false;

  // Ler companies/{id} exige ser membro. Quem perdeu o acesso (ou tem um
  // companyId antigo no perfil) recebe permission-denied — nesse caso o certo
  // e devolver false e cair no onboarding, nao derrubar a sessao.
  let companySnap;
  let memberSnap;
  try {
    [companySnap, memberSnap] = await Promise.all([
      getDoc(doc(db, 'companies', companyId)),
      getDoc(doc(db, 'companies', companyId, 'members', state.user.uid))
    ]);
  } catch (err) {
    if (err?.code === 'permission-denied') {
      console.warn('[data] sem acesso ao workspace', companyId);
      return false;
    }
    throw err;
  }

  if (!companySnap.exists() || !memberSnap.exists()) return false;

  const memberData = memberSnap.data();
  if (memberData.active === false) throw new Error('Seu acesso a este workspace foi desativado.');

  let settings = defaultSettings();
  try {
    const settingsSnap = await getDoc(doc(db, 'companies', companyId, 'settings', 'pipeline'));
    if (settingsSnap.exists()) {
      const stored = settingsSnap.data();
      settings = {
        ...settings,
        ...stored,
        whatsapp: { ...settings.whatsapp, ...(stored.whatsapp || {}) }
      };
    }
  } catch (err) {
    console.warn('[data] configurações não carregadas, usando padrão', err);
  }

  setState({
    company: { id: companyId, ...companySnap.data() },
    member: { id: state.user.uid, ...memberData },
    settings
  });
  return true;
}

export async function updateSettings(patch) {
  const companyId = requireCompanyId();
  await setDoc(doc(db, 'companies', companyId, 'settings', 'pipeline'),
    { ...patch, updatedAt: now() }, { merge: true });
  setState({ settings: { ...state.settings, ...patch } });
}

export async function updateCompany(patch) {
  const companyId = requireCompanyId();
  await updateDoc(doc(db, 'companies', companyId), { ...patch, updatedAt: now() });
  setState({ company: { ...state.company, ...patch } });
}

export async function rotateJoinCode() {
  const code = randomCode(6);
  await updateCompany({ joinCode: code });
  return code;
}

export async function updateMemberRole(uid, role) {
  await updateDoc(docRef('members', uid), { role });
}
export async function setMemberActive(uid, active) {
  await updateDoc(docRef('members', uid), { active });
}

/* ---------------------------------------------------------- listeners ---- */

let unsubscribers = [];

/** Abre os listeners das colecoes "quentes". Idempotente. */
export function startListeners() {
  stopListeners();
  const companyId = requireCompanyId();

  const track = (label, ref, onData) => {
    const unsub = onSnapshot(ref,
      (snap) => {
        onData(snap);
        state.loading[label] = false;
        emit();
      },
      (err) => {
        console.error(`[data] listener ${label} falhou`, err);
        state.loading[label] = false;
        state.error = err;
        emit();
      });
    unsubscribers.push(unsub);
  };

  track('contacts',
    query(col('contacts', companyId), orderBy('updatedAt', 'desc'), limit(appConfig.contactsPageSize)),
    (snap) => { state.contacts = snap.docs.map((d) => mapContact(d.id, d.data())); });

  // Tarefas concluidas antigas nao interessam ao dia a dia: buscamos as
  // abertas (todas) e as concluidas recentes ficam de fora do listener.
  track('tasks',
    query(col('tasks', companyId), orderBy('dueAt', 'asc'), limit(500)),
    (snap) => { state.tasks = snap.docs.map((d) => mapTask(d.id, d.data())); });

  track('templates',
    query(col('templates', companyId), orderBy('name', 'asc')),
    (snap) => { state.templates = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });

  track('members',
    col('members', companyId),
    (snap) => { state.members = snap.docs.map((d) => ({ id: d.id, ...d.data() })); });
}

export function stopListeners() {
  unsubscribers.forEach((unsub) => { try { unsub(); } catch {} });
  unsubscribers = [];
}

/* ----------------------------------------------------------- contatos ---- */

/** Normaliza o payload vindo do formulario antes de gravar. */
function buildContactPayload(input) {
  const name = clean(input.name, 160);
  const phone = clean(input.phone, 40);
  const whatsapp = clean(input.whatsapp || input.phone, 40);
  return {
    name,
    phone,
    whatsapp,
    phoneDigits: onlyDigits(whatsapp || phone),
    waNumber: toWhatsAppNumber(whatsapp || phone),
    email: clean(input.email, 120).toLowerCase(),
    company: clean(input.company, 120),
    taxId: clean(input.taxId, 24),
    source: clean(input.source, 40),
    ownerId: input.ownerId || state.user.uid,
    ownerName: clean(input.ownerName, 80) || actor().name,
    stage: input.stage || state.settings.stages?.[0]?.id || 'novo',
    value: Number(input.value) || 0,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => clean(t, 30)).filter(Boolean).slice(0, 12) : [],
    notes: cleanMultiline(input.notes, 4000),
    nextAction: clean(input.nextAction, 160),
    searchName: norm(name)
  };
}

export async function createContact(input) {
  const payload = buildContactPayload(input);
  if (!payload.name) throw new Error('Informe o nome do contato.');

  const stage = stageById(payload.stage);
  const ref = await addDoc(col('contacts'), {
    ...payload,
    status: stage?.won ? CONTACT_STATUS.WON : stage?.lost ? CONTACT_STATUS.LOST : CONTACT_STATUS.OPEN,
    nextFollowUpAt: input.nextFollowUpAt ? ts(input.nextFollowUpAt) : null,
    lastContactAt: input.lastContactAt ? ts(input.lastContactAt) : null,
    createdAt: now(),
    updatedAt: now(),
    createdBy: state.user.uid
  });

  await addInteraction(ref.id, {
    type: 'system',
    title: 'Lead criado',
    body: payload.source ? `Origem: ${payload.source}` : ''
  }, { touch: false });

  if (input.nextFollowUpAt) {
    await scheduleFollowUp(ref.id, input.nextFollowUpAt, { note: payload.nextAction, skipContactUpdate: true });
  }

  return ref.id;
}

export async function updateContact(contactId, patch) {
  const payload = { ...patch, updatedAt: now() };
  if (patch.name !== undefined) payload.searchName = norm(patch.name);
  if (patch.whatsapp !== undefined || patch.phone !== undefined) {
    const number = patch.whatsapp || patch.phone || '';
    payload.phoneDigits = onlyDigits(number);
    payload.waNumber = toWhatsAppNumber(number);
  }
  await updateDoc(docRef('contacts', contactId), payload);
}

export async function saveContact(contactId, input) {
  const payload = buildContactPayload(input);
  if (!payload.name) throw new Error('Informe o nome do contato.');
  await updateDoc(docRef('contacts', contactId), { ...payload, updatedAt: now() });
}

export async function deleteContact(contactId) {
  // Remove a timeline e as tarefas ligadas ao contato para nao deixar orfaos.
  const [interactions, tasks] = await Promise.all([
    getDocs(query(col('interactions'), where('contactId', '==', contactId), limit(400))),
    getDocs(query(col('tasks'), where('contactId', '==', contactId), limit(400)))
  ]);

  const batch = writeBatch(db);
  interactions.forEach((d) => batch.delete(d.ref));
  tasks.forEach((d) => batch.delete(d.ref));
  batch.delete(docRef('contacts', contactId));
  await batch.commit();
}

/** Move o contato de etapa e registra a mudanca na timeline. */
export async function moveContactStage(contactId, newStageId, extra = {}) {
  const contact = state.contacts.find((c) => c.id === contactId);
  const fromName = contact ? (stageById(contact.stage)?.name || contact.stage) : '';
  const stage = stageById(newStageId);
  if (!stage) throw new Error('Etapa inválida.');

  const patch = {
    stage: newStageId,
    status: stage.won ? CONTACT_STATUS.WON : stage.lost ? CONTACT_STATUS.LOST : CONTACT_STATUS.OPEN,
    updatedAt: now()
  };
  if (stage.won) { patch.wonAt = now(); patch.lostAt = null; patch.lostReason = ''; }
  else if (stage.lost) { patch.lostAt = now(); patch.wonAt = null; patch.lostReason = clean(extra.lostReason, 120); }
  else { patch.wonAt = null; patch.lostAt = null; patch.lostReason = ''; }
  if (extra.value !== undefined) patch.value = Number(extra.value) || 0;

  await updateDoc(docRef('contacts', contactId), patch);

  await addInteraction(contactId, {
    type: 'stage',
    title: fromName ? `Etapa alterada: ${fromName} → ${stage.name}` : `Etapa definida: ${stage.name}`,
    body: extra.lostReason ? `Motivo: ${extra.lostReason}` : ''
  }, { touch: false });
}

export async function markWon(contactId, value) {
  await moveContactStage(contactId, wonStageId(), { value });
}
export async function markLost(contactId, reason) {
  await moveContactStage(contactId, lostStageId(), { lostReason: reason });
}

/* -------------------------------------------------------- interacoes ---- */

/**
 * Grava um item na timeline.
 * @param {object} opts
 * @param {boolean} [opts.touch=true] atualiza lastContactAt do contato
 */
export async function addInteraction(contactId, { type, title, body = '', meta = null, at = null }, opts = {}) {
  const { touch = true } = opts;
  const who = actor();

  const ref = await addDoc(col('interactions'), {
    contactId,
    type: clean(type, 40) || 'anotacao',
    title: clean(title, 200),
    body: cleanMultiline(body, 4000),
    meta: meta || null,
    createdAt: at ? ts(at) : now(),
    createdBy: who.uid,
    createdByName: who.name
  });

  if (touch) {
    await updateDoc(docRef('contacts', contactId), {
      lastContactAt: at ? ts(at) : now(),
      updatedAt: now()
    }).catch((err) => console.warn('[data] não foi possível atualizar o último contato', err));
  }

  return ref.id;
}

export async function listInteractions(contactId, max = 100) {
  const snap = await getDocs(query(
    col('interactions'),
    where('contactId', '==', contactId),
    orderBy('createdAt', 'desc'),
    limit(max)
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteInteraction(id) {
  await deleteDoc(docRef('interactions', id));
}

/* ------------------------------------------------------------ tarefas ---- */

export async function createTask(input) {
  const title = clean(input.title, 200);
  if (!title) throw new Error('Informe o título da tarefa.');

  const contact = input.contactId ? state.contacts.find((c) => c.id === input.contactId) : null;
  const assigneeId = input.assigneeId || state.user.uid;
  const assignee = state.members.find((m) => m.id === assigneeId);

  const ref = await addDoc(col('tasks'), {
    title,
    type: input.type || 'tarefa',
    contactId: input.contactId || null,
    contactName: contact?.name || clean(input.contactName, 160) || '',
    assigneeId,
    assigneeName: assignee?.name || actor().name,
    dueAt: input.dueAt ? ts(input.dueAt) : ts(new Date()),
    priority: input.priority || 'media',
    status: TASK_STATUS.OPEN,
    notes: cleanMultiline(input.notes, 2000),
    createdAt: now(),
    createdBy: state.user.uid
  });
  return ref.id;
}

export async function updateTask(taskId, patch) {
  const payload = { ...patch };
  if (patch.dueAt !== undefined) payload.dueAt = patch.dueAt ? ts(patch.dueAt) : null;
  await updateDoc(docRef('tasks', taskId), payload);
}

export async function completeTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  await updateDoc(docRef('tasks', taskId), {
    status: TASK_STATUS.DONE,
    completedAt: now(),
    completedBy: state.user.uid
  });

  if (task?.contactId) {
    await addInteraction(task.contactId, {
      type: task.type === 'followup' ? 'followup' : 'tarefa',
      title: `Concluída: ${task.title}`
    });
    // Se era o follow-up agendado do contato, limpa o agendamento.
    const contact = state.contacts.find((c) => c.id === task.contactId);
    const due = toDate(task.dueAt)?.getTime();
    const scheduled = toDate(contact?.nextFollowUpAt)?.getTime();
    if (contact && due && scheduled && Math.abs(due - scheduled) < 60000) {
      await updateDoc(docRef('contacts', task.contactId), { nextFollowUpAt: null, updatedAt: now() })
        .catch(() => {});
    }
  }
}

export async function reopenTask(taskId) {
  await updateDoc(docRef('tasks', taskId), { status: TASK_STATUS.OPEN, completedAt: null });
}

export async function deleteTask(taskId) {
  await deleteDoc(docRef('tasks', taskId));
}

/**
 * Agenda um follow-up: grava a data no contato, cria a tarefa e
 * registra na timeline. E o fluxo usado pelos atalhos "amanha / 2 dias / ...".
 */
export async function scheduleFollowUp(contactId, when, { note = '', assigneeId = null, skipContactUpdate = false } = {}) {
  const date = new Date(when);
  if (isNaN(date)) throw new Error('Data de follow-up inválida.');

  const contact = state.contacts.find((c) => c.id === contactId);

  if (!skipContactUpdate) {
    await updateDoc(docRef('contacts', contactId), {
      nextFollowUpAt: ts(date),
      nextAction: clean(note, 160) || contact?.nextAction || 'Follow-up',
      updatedAt: now()
    });
  }

  const taskId = await createTask({
    title: clean(note, 160) || `Follow-up: ${contact?.name || 'contato'}`,
    type: 'followup',
    contactId,
    contactName: contact?.name || '',
    assigneeId: assigneeId || contact?.ownerId || state.user.uid,
    dueAt: date,
    priority: 'media'
  });

  await addInteraction(contactId, {
    type: 'followup',
    title: 'Follow-up programado',
    body: note ? clean(note, 200) : '',
    meta: { taskId, dueAt: date.toISOString() }
  }, { touch: false });

  return taskId;
}

/* ----------------------------------------------------------- modelos ---- */

export async function saveTemplate(id, input) {
  const payload = {
    name: clean(input.name, 80),
    category: clean(input.category, 40),
    body: cleanMultiline(input.body, 3000),
    updatedAt: now()
  };
  if (!payload.name) throw new Error('Informe o nome do modelo.');
  if (!payload.body) throw new Error('Escreva o conteúdo da mensagem.');

  if (id) await updateDoc(docRef('templates', id), payload);
  else await addDoc(col('templates'), { ...payload, createdAt: now(), createdBy: state.user.uid });
}

export async function deleteTemplate(id) {
  await deleteDoc(docRef('templates', id));
}

/* --------------------------------------------------------- importacao ---- */

/**
 * Importa contatos em lote (usado pela tela de importacao de CSV,
 * apos a etapa de conferencia).
 */
export async function importContacts(rows) {
  const companyId = requireCompanyId();
  const who = actor();
  const chunkSize = 200; // limite de operacoes por batch do Firestore e 500
  let imported = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const payload = buildContactPayload({
        ...row,
        ownerId: state.user.uid,
        ownerName: who.name
      });
      if (!payload.name) continue;

      const contactRef = doc(collection(db, 'companies', companyId, 'contacts'));
      batch.set(contactRef, {
        ...payload,
        status: CONTACT_STATUS.OPEN,
        nextFollowUpAt: null,
        lastContactAt: null,
        createdAt: now(),
        updatedAt: now(),
        createdBy: state.user.uid,
        importedAt: now()
      });

      batch.set(doc(collection(db, 'companies', companyId, 'interactions')), {
        contactId: contactRef.id,
        type: 'system',
        title: 'Lead importado',
        body: row.notes ? cleanMultiline(row.notes, 500) : '',
        createdAt: now(),
        createdBy: who.uid,
        createdByName: who.name
      });
      imported++;
    }

    await batch.commit();
  }

  return imported;
}
