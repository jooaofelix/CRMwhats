/**
 * Modais compartilhados entre as telas.
 * Todos gravam no Firestore e dao feedback com toast — nenhum e apenas visual.
 */

import { openModal, confirmDialog, toastOk, toastError, describeError } from './ui.js';
import {
  esc, clean, parseMoney, formatMoney, toInputDateTime, fromInputDateTime,
  addDays, formatPhone, parseCSV, initials
} from './utils.js';
import { state, stages, stageById, isAdmin, contactById } from './state.js';
import {
  createContact, saveContact, deleteContact, moveContactStage,
  addInteraction, createTask, updateTask, scheduleFollowUp, importContacts, markLost
} from './data.js';
import { INTERACTION_TYPES, TASK_PRIORITIES } from './defaults.js';
import { openWhatsApp, renderForContact, logOutgoingMessage, contactNumber } from './whatsapp.js';

/* ------------------------------------------------------------ helpers ---- */

const val = (root, selector) => root.querySelector(selector)?.value ?? '';

function optionList(items, selected, { valueKey = 'id', labelKey = 'name' } = {}) {
  return items.map((item) => {
    const value = typeof item === 'string' ? item : item[valueKey];
    const label = typeof item === 'string' ? item : item[labelKey];
    return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function memberOptions(selected) {
  const list = state.members.length ? state.members : [{ id: state.user.uid, name: state.member?.name || 'Eu' }];
  return list.map((m) =>
    `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.name || m.email)}</option>`
  ).join('');
}

/** Hora padrao para follow-ups sem horario informado. */
function defaultFollowUpDate(days) {
  const date = addDays(new Date(), days);
  date.setHours(state.settings.followUpDefaultHour ?? 9, 0, 0, 0);
  return date;
}

/* ------------------------------------------------------ contato (CRUD) --- */

/**
 * Cria ou edita um contato.
 * @param {object|null} contact  contato existente (null = novo)
 * @param {Function} [onSaved]   callback com o id salvo
 */
export function openContactModal(contact = null, onSaved) {
  const isEdit = Boolean(contact?.id);
  const settings = state.settings;

  const body = `
    <div class="form">
      <div class="field">
        <label for="c-name">Nome *</label>
        <input id="c-name" type="text" required maxlength="160" value="${esc(contact?.name || '')}" placeholder="Ex.: João Silva">
      </div>

      <div class="grid2">
        <div class="field">
          <label for="c-whatsapp">WhatsApp</label>
          <input id="c-whatsapp" type="tel" inputmode="tel" maxlength="40"
                 value="${esc(contact?.whatsapp || '')}" placeholder="(12) 99999-9999">
        </div>
        <div class="field">
          <label for="c-phone">Telefone</label>
          <input id="c-phone" type="tel" inputmode="tel" maxlength="40"
                 value="${esc(contact?.phone || '')}" placeholder="(12) 3333-3333">
        </div>
      </div>

      <div class="grid2">
        <div class="field">
          <label for="c-email">E-mail</label>
          <input id="c-email" type="email" maxlength="120" value="${esc(contact?.email || '')}" placeholder="contato@empresa.com">
        </div>
        <div class="field">
          <label for="c-company">Empresa</label>
          <input id="c-company" type="text" maxlength="120" value="${esc(contact?.company || '')}" placeholder="Empresa XPTO">
        </div>
      </div>

      <div class="grid2">
        <div class="field">
          <label for="c-taxid">CPF / CNPJ <span class="muted">(opcional)</span></label>
          <input id="c-taxid" type="text" maxlength="24" value="${esc(contact?.taxId || '')}">
        </div>
        <div class="field">
          <label for="c-source">Origem do lead</label>
          <select id="c-source">
            <option value="">Não informada</option>
            ${optionList(settings.sources || [], contact?.source || '')}
          </select>
        </div>
      </div>

      <div class="grid2">
        <div class="field">
          <label for="c-stage">Etapa do funil</label>
          <select id="c-stage">${optionList(stages(), contact?.stage || stages()[0]?.id)}</select>
        </div>
        <div class="field">
          <label for="c-value">Valor estimado</label>
          <input id="c-value" type="text" inputmode="decimal"
                 value="${contact?.value ? String(contact.value).replace('.', ',') : ''}" placeholder="2.500,00">
        </div>
      </div>

      <div class="grid2">
        <div class="field">
          <label for="c-owner">Responsável</label>
          <select id="c-owner" ${isAdmin() ? '' : 'disabled'}>
            ${memberOptions(contact?.ownerId || state.user.uid)}
          </select>
        </div>
        <div class="field">
          <label for="c-followup">Próximo follow-up</label>
          <input id="c-followup" type="datetime-local" value="${toInputDateTime(contact?.nextFollowUpAt)}">
        </div>
      </div>

      <div class="field">
        <label for="c-next">Próxima ação</label>
        <input id="c-next" type="text" maxlength="160" value="${esc(contact?.nextAction || '')}"
               placeholder="Ex.: Enviar orçamento revisado">
      </div>

      <div class="field">
        <label for="c-tags">Tags</label>
        <input id="c-tags" type="text" value="${esc((contact?.tags || []).join(', '))}"
               placeholder="Separe por vírgula: QUENTE, INDICAÇÃO">
        <div class="chips" style="margin-top:.35rem">
          ${(settings.tags || []).map((tag) => `<button type="button" class="chip" data-tag="${esc(tag)}">${esc(tag)}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label for="c-notes">Observações</label>
        <textarea id="c-notes" maxlength="4000" placeholder="Contexto da negociação, preferências, histórico…">${esc(contact?.notes || '')}</textarea>
      </div>
    </div>`;

  openModal({
    title: isEdit ? 'Editar contato' : 'Novo lead',
    body,
    wide: true,
    confirmText: isEdit ? 'Salvar alterações' : 'Cadastrar lead',
    onMount: (root) => {
      // Clicar numa tag sugerida adiciona/remove do campo.
      root.querySelectorAll('[data-tag]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const input = root.querySelector('#c-tags');
          const current = input.value.split(',').map((t) => t.trim()).filter(Boolean);
          const tag = chip.dataset.tag;
          const index = current.findIndex((t) => t.toUpperCase() === tag.toUpperCase());
          if (index >= 0) current.splice(index, 1);
          else current.push(tag);
          input.value = current.join(', ');
          chip.classList.toggle('is-active', index < 0);
        });
      });
      const currentTags = (contact?.tags || []).map((t) => t.toUpperCase());
      root.querySelectorAll('[data-tag]').forEach((chip) => {
        chip.classList.toggle('is-active', currentTags.includes(chip.dataset.tag.toUpperCase()));
      });
    },
    onConfirm: async (root) => {
      const name = clean(val(root, '#c-name'), 160);
      if (!name) {
        toastError('Informe o nome do contato.');
        root.querySelector('#c-name').focus();
        return false;
      }

      const ownerId = val(root, '#c-owner') || state.user.uid;
      const owner = state.members.find((m) => m.id === ownerId);
      const followUpRaw = val(root, '#c-followup');

      const payload = {
        name,
        whatsapp: val(root, '#c-whatsapp'),
        phone: val(root, '#c-phone'),
        email: val(root, '#c-email'),
        company: val(root, '#c-company'),
        taxId: val(root, '#c-taxid'),
        source: val(root, '#c-source'),
        stage: val(root, '#c-stage'),
        value: parseMoney(val(root, '#c-value')),
        ownerId,
        ownerName: owner?.name || state.member?.name || '',
        nextAction: val(root, '#c-next'),
        tags: val(root, '#c-tags').split(',').map((t) => clean(t, 30).toUpperCase()).filter(Boolean),
        notes: val(root, '#c-notes')
      };

      try {
        if (isEdit) {
          const previousStage = contact.stage;
          await saveContact(contact.id, payload);

          if (previousStage !== payload.stage) {
            await moveContactStage(contact.id, payload.stage);
          }
          if (followUpRaw) {
            const date = fromInputDateTime(followUpRaw);
            const changed = toInputDateTime(contact.nextFollowUpAt) !== followUpRaw;
            if (date && changed) await scheduleFollowUp(contact.id, date, { note: payload.nextAction });
          }
          toastOk('Contato atualizado com sucesso.');
          onSaved?.(contact.id);
        } else {
          const id = await createContact({
            ...payload,
            nextFollowUpAt: followUpRaw ? fromInputDateTime(followUpRaw) : null
          });
          toastOk('Cliente cadastrado com sucesso.');
          onSaved?.(id);
        }
      } catch (err) {
        console.error('[modal contato]', err);
        toastError(describeError(err));
        return false;
      }
    }
  });
}

export async function confirmDeleteContact(contact, onDeleted) {
  const ok = await confirmDialog({
    title: 'Excluir contato',
    message: `Excluir "${contact.name}" apaga também a timeline e as tarefas ligadas a ele. Esta ação não pode ser desfeita.`,
    confirmText: 'Excluir',
    danger: true
  });
  if (!ok) return;

  try {
    await deleteContact(contact.id);
    toastOk('Contato excluído.');
    onDeleted?.();
  } catch (err) {
    console.error('[excluir contato]', err);
    toastError(describeError(err));
  }
}

/* --------------------------------------------------------- follow-up ----- */

/** Agenda follow-up com atalhos (amanha, 2, 3, 7, 15 dias ou data escolhida). */
export function openFollowUpModal(contact, onDone) {
  let selectedDays = 1;

  const body = `
    <p class="muted" style="margin-top:0">Quando você deve retomar o contato com <strong>${esc(contact.name)}</strong>?</p>
    <div class="optiongrid" id="fu-presets">
      <button type="button" class="optionbtn is-selected" data-days="1">Amanhã</button>
      <button type="button" class="optionbtn" data-days="2">Em 2 dias</button>
      <button type="button" class="optionbtn" data-days="3">Em 3 dias</button>
      <button type="button" class="optionbtn" data-days="7">Em 7 dias</button>
      <button type="button" class="optionbtn" data-days="15">Em 15 dias</button>
      <button type="button" class="optionbtn" data-days="custom">Escolher data</button>
    </div>

    <div class="field" style="margin-top:1rem">
      <label for="fu-date">Data e horário</label>
      <input type="datetime-local" id="fu-date" value="${toInputDateTime(defaultFollowUpDate(1))}">
    </div>

    <div class="field">
      <label for="fu-note">Próxima ação</label>
      <input type="text" id="fu-note" maxlength="160" placeholder="Ex.: Ligar para confirmar a proposta"
             value="${esc(contact.nextAction || '')}">
    </div>

    <div class="field">
      <label for="fu-owner">Responsável</label>
      <select id="fu-owner">${memberOptions(contact.ownerId || state.user.uid)}</select>
    </div>`;

  openModal({
    title: 'Programar follow-up',
    body,
    confirmText: 'Agendar',
    onMount: (root) => {
      const dateInput = root.querySelector('#fu-date');
      root.querySelectorAll('#fu-presets .optionbtn').forEach((button) => {
        button.addEventListener('click', () => {
          root.querySelectorAll('#fu-presets .optionbtn').forEach((b) => b.classList.remove('is-selected'));
          button.classList.add('is-selected');
          selectedDays = button.dataset.days;
          if (selectedDays !== 'custom') {
            dateInput.value = toInputDateTime(defaultFollowUpDate(Number(selectedDays)));
          } else {
            dateInput.focus();
          }
        });
      });
    },
    onConfirm: async (root) => {
      const date = fromInputDateTime(val(root, '#fu-date'));
      if (!date) { toastError('Escolha uma data válida.'); return false; }

      try {
        await scheduleFollowUp(contact.id, date, {
          note: val(root, '#fu-note'),
          assigneeId: val(root, '#fu-owner')
        });
        toastOk('Follow-up agendado.');
        onDone?.();
      } catch (err) {
        console.error('[follow-up]', err);
        toastError(describeError(err));
        return false;
      }
    }
  });
}

/* ------------------------------------------------------- interacoes ------ */

/** Registra ligacao, mensagem, reuniao, anotacao ou proposta na timeline. */
export function openInteractionModal(contact, presetType = 'anotacao', onDone) {
  const body = `
    <div class="field">
      <label for="i-type">Tipo</label>
      <select id="i-type">
        ${INTERACTION_TYPES.filter((t) => t.id !== 'followup' && t.id !== 'tarefa')
          .map((t) => `<option value="${t.id}" ${t.id === presetType ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="i-title">Resumo</label>
      <input type="text" id="i-title" maxlength="200" placeholder="Ex.: Cliente pediu para retornar sexta-feira">
    </div>
    <div class="field">
      <label for="i-body">Detalhes <span class="muted">(opcional)</span></label>
      <textarea id="i-body" maxlength="4000" placeholder="O que foi conversado…"></textarea>
    </div>
    <div class="field">
      <label for="i-date">Quando aconteceu</label>
      <input type="datetime-local" id="i-date" value="${toInputDateTime(new Date())}">
    </div>`;

  openModal({
    title: 'Registrar interação',
    body,
    confirmText: 'Registrar',
    onConfirm: async (root) => {
      const type = val(root, '#i-type');
      const title = clean(val(root, '#i-title'), 200)
        || INTERACTION_TYPES.find((t) => t.id === type)?.label
        || 'Interação';

      try {
        await addInteraction(contact.id, {
          type,
          title,
          body: val(root, '#i-body'),
          at: fromInputDateTime(val(root, '#i-date')) || new Date()
        });
        toastOk('Interação registrada.');
        onDone?.();
      } catch (err) {
        console.error('[interação]', err);
        toastError(describeError(err));
        return false;
      }
    }
  });
}

/* ------------------------------------------------------------ tarefas ---- */

export function openTaskModal(task = null, contact = null, onDone) {
  const isEdit = Boolean(task?.id);
  const contactOptions = state.contacts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 300);

  const selectedContactId = task?.contactId || contact?.id || '';

  const body = `
    <div class="field">
      <label for="t-title">Título *</label>
      <input type="text" id="t-title" maxlength="200" value="${esc(task?.title || '')}"
             placeholder="Ex.: Ligar para João">
    </div>

    <div class="field">
      <label for="t-contact">Contato relacionado</label>
      <select id="t-contact">
        <option value="">Nenhum</option>
        ${contactOptions.map((c) =>
          `<option value="${esc(c.id)}" ${c.id === selectedContactId ? 'selected' : ''}>${esc(c.name)}${c.company ? ` — ${esc(c.company)}` : ''}</option>`
        ).join('')}
      </select>
    </div>

    <div class="grid2">
      <div class="field">
        <label for="t-due">Data e horário</label>
        <input type="datetime-local" id="t-due" value="${toInputDateTime(task?.dueAt || defaultFollowUpDate(0))}">
      </div>
      <div class="field">
        <label for="t-priority">Prioridade</label>
        <select id="t-priority">
          ${TASK_PRIORITIES.map((p) =>
            `<option value="${p.id}" ${p.id === (task?.priority || 'media') ? 'selected' : ''}>${esc(p.label)}</option>`
          ).join('')}
        </select>
      </div>
    </div>

    <div class="field">
      <label for="t-assignee">Responsável</label>
      <select id="t-assignee">${memberOptions(task?.assigneeId || state.user.uid)}</select>
    </div>

    <div class="field">
      <label for="t-notes">Observação</label>
      <textarea id="t-notes" maxlength="2000">${esc(task?.notes || '')}</textarea>
    </div>`;

  openModal({
    title: isEdit ? 'Editar tarefa' : 'Nova tarefa',
    body,
    confirmText: isEdit ? 'Salvar' : 'Criar tarefa',
    onConfirm: async (root) => {
      const title = clean(val(root, '#t-title'), 200);
      if (!title) { toastError('Informe o título da tarefa.'); return false; }

      const payload = {
        title,
        contactId: val(root, '#t-contact') || null,
        dueAt: fromInputDateTime(val(root, '#t-due')) || new Date(),
        priority: val(root, '#t-priority'),
        assigneeId: val(root, '#t-assignee'),
        notes: val(root, '#t-notes')
      };

      try {
        if (isEdit) {
          const assignee = state.members.find((m) => m.id === payload.assigneeId);
          const linked = payload.contactId ? contactById(payload.contactId) : null;
          await updateTask(task.id, {
            ...payload,
            contactName: linked?.name || '',
            assigneeName: assignee?.name || ''
          });
          toastOk('Tarefa atualizada.');
        } else {
          await createTask(payload);
          toastOk('Tarefa criada.');
        }
        onDone?.();
      } catch (err) {
        console.error('[tarefa]', err);
        toastError(describeError(err));
        return false;
      }
    }
  });
}

/* -------------------------------------------------- ganhou / perdeu ------ */

export function openWonLostModal(contact, outcome, onDone) {
  const won = outcome === 'won';

  const body = won ? `
    <p class="muted" style="margin-top:0">Confirme o valor fechado com <strong>${esc(contact.name)}</strong>.</p>
    <div class="field">
      <label for="w-value">Valor da venda</label>
      <input type="text" id="w-value" inputmode="decimal" value="${contact.value ? String(contact.value).replace('.', ',') : ''}" placeholder="2.500,00">
    </div>` : `
    <p class="muted" style="margin-top:0">Registrar a perda ajuda os relatórios a mostrarem onde as vendas escapam.</p>
    <div class="field">
      <label for="l-reason">Motivo</label>
      <select id="l-reason">
        ${(state.settings.lostReasons || []).map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="l-note">Observação <span class="muted">(opcional)</span></label>
      <input type="text" id="l-note" maxlength="160">
    </div>`;

  openModal({
    title: won ? 'Marcar como ganha' : 'Marcar como perdida',
    body,
    confirmText: won ? 'Confirmar venda' : 'Registrar perda',
    danger: !won,
    onConfirm: async (root) => {
      try {
        if (won) {
          const value = parseMoney(val(root, '#w-value'));
          await moveContactStage(contact.id, stages().find((s) => s.won)?.id, { value });
          toastOk(`Venda de ${formatMoney(value)} registrada. 🎉`);
        } else {
          const reason = [val(root, '#l-reason'), clean(val(root, '#l-note'), 120)]
            .filter(Boolean).join(' — ');
          await markLost(contact.id, reason);
          toastOk('Negociação marcada como perdida.');
        }
        onDone?.();
      } catch (err) {
        console.error('[ganho/perda]', err);
        toastError(describeError(err));
        return false;
      }
    }
  });
}

/* ------------------------------------------------ modelos de mensagem ---- */

/**
 * Escolhe um modelo, permite editar o texto e abre o WhatsApp com a mensagem
 * pronta. Tambem registra a mensagem no historico da conversa.
 */
export function openTemplatePickerModal(contact, onDone) {
  const templates = state.templates;
  const number = contactNumber(contact);

  const body = `
    ${!number ? '<p class="form__error">Este contato não tem número de WhatsApp cadastrado.</p>' : ''}
    <div class="field">
      <label for="tp-template">Modelo de mensagem</label>
      <select id="tp-template">
        <option value="">Escrever do zero</option>
        ${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.category ? ` · ${esc(t.category)}` : ''}</option>`).join('')}
      </select>
      ${templates.length ? '' : '<span class="field__hint">Cadastre modelos em Configurações › Mensagens.</span>'}
    </div>
    <div class="field">
      <label for="tp-text">Mensagem</label>
      <textarea id="tp-text" maxlength="4000" style="min-height:150px" placeholder="Olá ${esc((contact.name || '').split(' ')[0])}, tudo bem?"></textarea>
      <span class="field__hint">As variáveis do modelo já foram substituídas pelos dados deste contato.</span>
    </div>`;

  openModal({
    title: 'Enviar mensagem',
    body,
    confirmText: number ? 'Abrir no WhatsApp' : 'Fechar',
    onMount: (root) => {
      const select = root.querySelector('#tp-template');
      const textarea = root.querySelector('#tp-text');
      select.addEventListener('change', () => {
        const template = templates.find((t) => t.id === select.value);
        textarea.value = template ? renderForContact(template.body, contact) : '';
        textarea.focus();
      });
      if (templates.length) {
        select.value = templates[0].id;
        select.dispatchEvent(new Event('change'));
      }
    },
    onConfirm: async (root) => {
      if (!number) return;
      const message = val(root, '#tp-text');

      try {
        await openWhatsApp(contact, message, { log: false });
        await logOutgoingMessage(contact, message, { channel: 'manual' });
        await addInteraction(contact.id, {
          type: 'mensagem',
          title: 'Mensagem enviada pelo WhatsApp',
          body: message
        });
        toastOk('Conversa aberta no WhatsApp e registrada no histórico.');
        onDone?.();
      } catch (err) {
        console.error('[template]', err);
        toastError(describeError(err));
        return false;
      }
    }
  });
}

/* --------------------------------------------------------- importacao ---- */

const IMPORT_FIELDS = [
  { key: 'name',    label: 'Nome',       aliases: ['nome', 'name', 'cliente', 'contato'] },
  { key: 'whatsapp',label: 'WhatsApp',   aliases: ['whatsapp', 'celular', 'telefone', 'phone', 'fone', 'zap'] },
  { key: 'email',   label: 'E-mail',     aliases: ['email', 'e-mail', 'mail'] },
  { key: 'company', label: 'Empresa',    aliases: ['empresa', 'company', 'organizacao', 'organização'] },
  { key: 'notes',   label: 'Observação', aliases: ['observacao', 'observação', 'obs', 'notes', 'anotacao'] }
];

/** Importa contatos de CSV com etapa de conferencia antes de gravar. */
export function openImportModal(onDone) {
  const body = `
    <p class="muted" style="margin-top:0">
      Envie um arquivo CSV com uma linha de cabeçalho. Colunas reconhecidas:
      <strong>nome, telefone/whatsapp, e-mail, empresa, observação</strong>.
    </p>
    <div class="field">
      <label for="imp-file">Arquivo CSV</label>
      <input type="file" id="imp-file" accept=".csv,text/csv">
    </div>
    <div id="imp-preview"></div>`;

  let parsedRows = [];

  openModal({
    title: 'Importar contatos',
    body,
    wide: true,
    confirmText: 'Importar',
    onMount: (root) => {
      const preview = root.querySelector('#imp-preview');

      root.querySelector('#imp-file').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          preview.innerHTML = '<p class="form__error">Arquivo muito grande (máximo 2 MB).</p>';
          return;
        }

        try {
          const rows = parseCSV(await file.text());
          if (rows.length < 2) {
            preview.innerHTML = '<p class="form__error">O arquivo precisa ter cabeçalho e ao menos uma linha.</p>';
            return;
          }

          // Casa cada coluna do arquivo com um campo do CRM.
          const header = rows[0].map((h) => clean(h, 40).toLowerCase());
          const mapping = {};
          IMPORT_FIELDS.forEach((field) => {
            const index = header.findIndex((h) => field.aliases.some((alias) => h.includes(alias)));
            if (index >= 0) mapping[field.key] = index;
          });

          if (mapping.name === undefined) {
            preview.innerHTML = '<p class="form__error">Não encontrei a coluna de <strong>nome</strong> no arquivo.</p>';
            return;
          }

          parsedRows = rows.slice(1).map((row) => {
            const item = {};
            for (const [key, index] of Object.entries(mapping)) item[key] = clean(row[index] || '', 200);
            item.phone = item.whatsapp || '';
            item.source = 'Importação';
            return item;
          }).filter((item) => item.name);

          const sample = parsedRows.slice(0, 8);
          preview.innerHTML = `
            <div class="row" style="margin:.4rem 0 .6rem">
              <span class="pill pill--brand">${parsedRows.length} contato(s) prontos</span>
              <span class="muted" style="font-size:.82rem">Confira antes de confirmar</span>
            </div>
            <div class="tablewrap" style="border:1px solid var(--line)">
              <table class="data previewtable" style="min-width:520px">
                <thead><tr><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>Empresa</th></tr></thead>
                <tbody>
                  ${sample.map((item) => `<tr>
                    <td>${esc(item.name)}</td>
                    <td>${esc(formatPhone(item.whatsapp) || '—')}</td>
                    <td>${esc(item.email || '—')}</td>
                    <td>${esc(item.company || '—')}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
            ${parsedRows.length > sample.length
              ? `<p class="muted" style="font-size:.8rem;margin-top:.5rem">…e mais ${parsedRows.length - sample.length} linha(s).</p>`
              : ''}`;
        } catch (err) {
          console.error('[importação]', err);
          preview.innerHTML = '<p class="form__error">Não consegui ler este arquivo. Verifique se é um CSV válido.</p>';
        }
      });
    },
    onConfirm: async () => {
      if (!parsedRows.length) {
        toastError('Escolha um arquivo e confira os dados antes de importar.');
        return false;
      }
      try {
        const total = await importContacts(parsedRows);
        toastOk(`${total} contato(s) importados com sucesso.`);
        onDone?.();
      } catch (err) {
        console.error('[importação]', err);
        toastError(describeError(err));
        return false;
      }
    }
  });
}

/* ------------------------------------------------- acoes rapidas mobile -- */

/**
 * Folha de acoes rapidas do contato — pensada para o uso no celular,
 * onde arrastar cards e digitar formularios longos e desconfortavel.
 */
export function openQuickActions(contact, onChange) {
  const currentStage = stageById(contact.stage);

  const body = `
    <div class="row" style="margin-bottom:.9rem">
      <span class="itemrow__avatar">${esc(initials(contact.name))}</span>
      <div class="grow">
        <strong>${esc(contact.name)}</strong>
        <div class="muted" style="font-size:.82rem">${esc(contact.company || formatPhone(contact.whatsapp || contact.phone) || '—')}</div>
      </div>
      ${currentStage ? `<span class="pill pill--stage" style="background:${esc(currentStage.color)}">${esc(currentStage.name)}</span>` : ''}
    </div>

    <div class="optiongrid">
      <button type="button" class="optionbtn" data-action="whatsapp">Abrir WhatsApp</button>
      <button type="button" class="optionbtn" data-action="note">Adicionar nota</button>
      <button type="button" class="optionbtn" data-action="followup">Programar follow-up</button>
      <button type="button" class="optionbtn" data-action="task">Criar tarefa</button>
      <button type="button" class="optionbtn" data-action="won">Marcar ganha</button>
      <button type="button" class="optionbtn" data-action="lost">Marcar perdida</button>
    </div>

    <div class="field" style="margin-top:1rem">
      <label for="qa-stage">Mover para etapa</label>
      <select id="qa-stage">${stages().map((s) =>
        `<option value="${esc(s.id)}" ${s.id === contact.stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>

    <a class="btn btn--block" href="#/contato/${esc(contact.id)}" data-action="open">Abrir ficha completa</a>`;

  const { close } = openModal({
    title: 'Ações rápidas',
    body,
    onMount: (root) => {
      root.querySelector('#qa-stage').addEventListener('change', async (event) => {
        const stageId = event.target.value;
        if (stageId === contact.stage) return;
        try {
          await moveContactStage(contact.id, stageId);
          toastOk(`Movido para ${stageById(stageId)?.name}.`);
          onChange?.();
          close();
        } catch (err) {
          toastError(describeError(err));
        }
      });

      root.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'open') { close(); return; }

        close();
        if (action === 'whatsapp') openTemplatePickerModal(contact, onChange);
        if (action === 'note') openInteractionModal(contact, 'anotacao', onChange);
        if (action === 'followup') openFollowUpModal(contact, onChange);
        if (action === 'task') openTaskModal(null, contact, onChange);
        if (action === 'won') openWonLostModal(contact, 'won', onChange);
        if (action === 'lost') openWonLostModal(contact, 'lost', onChange);
      });
    }
  });
}
