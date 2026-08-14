/** Configurações: workspace, funil, listas, mensagens, equipe, WhatsApp e dados. */

import { state, subscribe, isAdmin, stages } from '../state.js';
import { esc, clean, formatDate, initials, slugify } from '../utils.js';
import { ROLE_LABEL, ROLES, PLANS, TEMPLATE_VARS, defaultSettings } from '../defaults.js';
import { openModal, toastOk, toastError, toastWarn, describeError, confirmDialog, emptyState } from '../ui.js';
import {
  updateSettings, updateCompany, rotateJoinCode, updateMemberRole,
  setMemberActive, saveTemplate, deleteTemplate
} from '../data.js';
import { appConfig } from '../config.js';
import { checkWorkerHealth, cloudApiEnabled } from '../whatsapp.js';

let unsubscribe = null;
let section = 'workspace';

const SECTIONS = [
  ['workspace', 'Workspace'],
  ['funil', 'Etapas do funil'],
  ['listas', 'Origens e tags'],
  ['mensagens', 'Mensagens'],
  ['equipe', 'Equipe'],
  ['whatsapp', 'WhatsApp API'],
  ['dados', 'Dados']
];

export function render(root) {
  const paint = () => { root.innerHTML = build(); wire(root, paint); };
  paint();
  unsubscribe = subscribe(paint);
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
}

/* --------------------------------------------------------------- html ---- */

function build() {
  return `
    <div class="page__head">
      <div class="page__title">
        <h1>Configurações</h1>
        <p>${esc(state.company?.name || '')} · ${esc(ROLE_LABEL[state.member?.role] || '')}</p>
      </div>
    </div>

    <div class="settings-grid">
      <nav class="settings-nav">
        ${SECTIONS.map(([id, label]) =>
          `<button data-section="${id}" class="${section === id ? 'is-active' : ''}">${esc(label)}</button>`).join('')}
      </nav>
      <div>${sectionHtml()}</div>
    </div>`;
}

function sectionHtml() {
  switch (section) {
    case 'funil': return funnelSection();
    case 'listas': return listsSection();
    case 'mensagens': return templatesSection();
    case 'equipe': return teamSection();
    case 'whatsapp': return whatsappSection();
    case 'dados': return dataSection();
    default: return workspaceSection();
  }
}

const adminNotice = `<p class="muted" style="font-size:.85rem">Somente administradores podem alterar esta seção.</p>`;

/* ---------------------------------------------------------- workspace ---- */

function workspaceSection() {
  const company = state.company || {};
  const plan = PLANS[company.plan] || PLANS.trial;
  const inviteCode = `${company.id}.${company.joinCode || ''}`;

  return `
    <div class="stack">
      <section class="card card--pad">
        <h2>Empresa</h2>
        <div class="form" style="margin-top:.8rem">
          <div class="field">
            <label for="w-name">Nome</label>
            <input type="text" id="w-name" maxlength="120" value="${esc(company.name || '')}" ${isAdmin() ? '' : 'disabled'}>
          </div>
          <div class="field">
            <label for="w-segment">Segmento</label>
            <input type="text" id="w-segment" maxlength="80" value="${esc(company.segment || '')}" ${isAdmin() ? '' : 'disabled'}>
          </div>
          ${isAdmin() ? '<button class="btn btn--primary" id="btn-save-company">Salvar</button>' : adminNotice}
        </div>
      </section>

      <section class="card card--pad">
        <h2>Plano</h2>
        <div class="row" style="margin-top:.6rem">
          <span class="pill pill--brand">${esc(plan.label)}</span>
          <span class="muted" style="font-size:.85rem">
            até ${plan.seats} usuário(s) · ${plan.contacts.toLocaleString('pt-BR')} contatos
          </span>
        </div>
        ${company.trialEndsAt
          ? `<p class="muted" style="font-size:.85rem;margin-top:.5rem">Período de avaliação até ${esc(formatDate(company.trialEndsAt))}.</p>`
          : ''}
        <p class="muted" style="font-size:.82rem;margin:.5rem 0 0">
          A cobrança ainda não está ativa nesta versão. A estrutura de planos já está no banco
          para receber o gateway de pagamento sem migração.
        </p>
      </section>

      <section class="card card--pad">
        <h2>Convidar pessoas</h2>
        <p class="muted" style="font-size:.86rem">
          Quem receber este código entra no workspace como <strong>vendedor</strong>,
          com acesso apenas aos próprios contatos e tarefas.
        </p>
        <div class="field">
          <label for="w-invite">Código de convite</label>
          <input type="text" id="w-invite" readonly value="${esc(inviteCode)}">
        </div>
        <div class="row">
          <button class="btn" id="btn-copy-invite">Copiar código</button>
          ${isAdmin() ? '<button class="btn btn--danger" id="btn-rotate">Gerar novo código</button>' : ''}
        </div>
      </section>
    </div>`;
}

/* -------------------------------------------------------------- funil ---- */

function funnelSection() {
  const list = stages();
  return `
    <section class="card card--pad">
      <h2>Etapas do funil</h2>
      <p class="muted" style="font-size:.86rem">
        Renomeie, reordene ou troque as cores. As etapas marcadas como
        <strong>ganho</strong> e <strong>perda</strong> alimentam os relatórios de conversão.
      </p>

      <div class="stage-editor" id="stage-editor" style="margin-top:.8rem">
        ${list.map((stage, index) => `
          <div class="stage-editor__row" data-stage="${esc(stage.id)}">
            <input type="color" value="${esc(stage.color)}" data-field="color" ${isAdmin() ? '' : 'disabled'}>
            <input type="text" class="grow" value="${esc(stage.name)}" maxlength="40" data-field="name" ${isAdmin() ? '' : 'disabled'}>
            ${stage.won ? '<span class="pill pill--ok">ganho</span>' : ''}
            ${stage.lost ? '<span class="pill pill--danger">perda</span>' : ''}
            ${isAdmin() ? `
              <button class="iconbtn" data-move="up" ${index === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
              <button class="iconbtn" data-move="down" ${index === list.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>` : ''}
          </div>`).join('')}
      </div>

      ${isAdmin() ? `
        <div class="row" style="margin-top:1rem">
          <button class="btn btn--primary" id="btn-save-stages">Salvar etapas</button>
          <button class="btn" id="btn-add-stage">Adicionar etapa</button>
          <button class="btn" id="btn-reset-stages">Restaurar padrão</button>
        </div>` : adminNotice}

      <hr style="border:0;border-top:1px solid var(--line);margin:1.2rem 0">

      <div class="field">
        <label for="s-stale">Dias sem interação para considerar um lead parado</label>
        <input type="number" id="s-stale" min="1" max="90" value="${esc(String(state.settings.staleDays ?? 5))}" ${isAdmin() ? '' : 'disabled'}>
      </div>
      <div class="field">
        <label for="s-hour">Horário padrão dos follow-ups</label>
        <input type="number" id="s-hour" min="0" max="23" value="${esc(String(state.settings.followUpDefaultHour ?? 9))}" ${isAdmin() ? '' : 'disabled'}>
      </div>
      ${isAdmin() ? '<button class="btn btn--primary" id="btn-save-prefs">Salvar preferências</button>' : ''}
    </section>`;
}

/* ------------------------------------------------------------- listas ---- */

function listsSection() {
  return `
    <div class="stack">
      <section class="card card--pad">
        <h2>Origens de lead</h2>
        <p class="muted" style="font-size:.86rem">Uma por linha. Aparecem no cadastro e no relatório de origem.</p>
        <textarea id="s-sources" style="min-height:150px" ${isAdmin() ? '' : 'disabled'}>${esc((state.settings.sources || []).join('\n'))}</textarea>
      </section>

      <section class="card card--pad">
        <h2>Tags sugeridas</h2>
        <p class="muted" style="font-size:.86rem">Sugestões rápidas no cadastro — o usuário pode digitar outras livremente.</p>
        <textarea id="s-tags" style="min-height:130px" ${isAdmin() ? '' : 'disabled'}>${esc((state.settings.tags || []).join('\n'))}</textarea>
      </section>

      <section class="card card--pad">
        <h2>Motivos de perda</h2>
        <textarea id="s-lost" style="min-height:120px" ${isAdmin() ? '' : 'disabled'}>${esc((state.settings.lostReasons || []).join('\n'))}</textarea>
      </section>

      <section class="card card--pad">
        <h2>Link padrão</h2>
        <p class="muted" style="font-size:.86rem">Usado na variável <code>{{link}}</code> dos modelos de mensagem.</p>
        <input type="url" id="s-link" placeholder="https://sua-empresa.com.br/agenda"
               value="${esc(state.settings.defaultLink || '')}" ${isAdmin() ? '' : 'disabled'}>
      </section>

      ${isAdmin() ? '<button class="btn btn--primary" id="btn-save-lists">Salvar listas</button>' : adminNotice}
    </div>`;
}

/* ---------------------------------------------------------- mensagens ---- */

function templatesSection() {
  return `
    <section class="card card--pad">
      <div class="row" style="margin-bottom:.5rem">
        <h2 class="grow">Modelos de mensagem</h2>
        <button class="btn btn--primary btn--sm" id="btn-new-template">
          <span data-icon="plus"></span> Novo modelo
        </button>
      </div>
      <p class="muted" style="font-size:.86rem">
        Variáveis disponíveis:
        ${TEMPLATE_VARS.map((v) => `<code class="varchip" title="${esc(v.desc)}">{{${esc(v.key)}}}</code>`).join(' ')}
      </p>

      <div class="stack" style="margin-top:1rem">
        ${state.templates.length ? state.templates.map((template) => `
          <article class="card tpl-card" data-template="${esc(template.id)}">
            <div class="row">
              <strong class="grow">${esc(template.name)}</strong>
              ${template.category ? `<span class="pill">${esc(template.category)}</span>` : ''}
              <button class="iconbtn" data-edit-template="${esc(template.id)}" aria-label="Editar"><span data-icon="edit"></span></button>
              <button class="iconbtn" data-del-template="${esc(template.id)}" aria-label="Excluir"><span data-icon="trash"></span></button>
            </div>
            <div class="tpl-card__body">${esc(template.body)}</div>
          </article>`).join('')
        : emptyState('Nenhum modelo cadastrado', 'Crie mensagens prontas para primeiro contato, proposta e follow-up.')}
      </div>
    </section>`;
}

/* ------------------------------------------------------------- equipe ---- */

function teamSection() {
  return `
    <section class="card card--pad">
      <h2>Equipe</h2>
      <p class="muted" style="font-size:.86rem">
        O administrador vê todos os contatos e configura o workspace.
        O vendedor trabalha com a própria carteira.
      </p>

      <div class="stack" style="margin-top:.9rem">
        ${state.members.map((member) => `
          <div class="row card card--pad" style="padding:.7rem .8rem">
            <span class="itemrow__avatar">${esc(initials(member.name || member.email))}</span>
            <div class="grow">
              <strong>${esc(member.name || member.email)}</strong>
              <div class="muted" style="font-size:.8rem">${esc(member.email || '')}</div>
            </div>
            ${member.id === state.company?.ownerId ? '<span class="pill pill--brand">Dono</span>' : ''}
            ${isAdmin() && member.id !== state.company?.ownerId ? `
              <select data-role-for="${esc(member.id)}" style="width:auto">
                <option value="${ROLES.ADMIN}" ${member.role === ROLES.ADMIN ? 'selected' : ''}>Administrador</option>
                <option value="${ROLES.SALES}" ${member.role === ROLES.SALES ? 'selected' : ''}>Vendedor</option>
              </select>
              <button class="btn btn--sm ${member.active === false ? '' : 'btn--danger'}" data-toggle-active="${esc(member.id)}">
                ${member.active === false ? 'Reativar' : 'Desativar'}
              </button>`
            : `<span class="pill">${esc(ROLE_LABEL[member.role] || member.role)}</span>`}
          </div>`).join('')}
      </div>

      <p class="muted" style="font-size:.84rem;margin-top:1rem">
        Para adicionar alguém, envie o código de convite (aba <strong>Workspace</strong>).
      </p>
    </section>`;
}

/* ----------------------------------------------------------- whatsapp ---- */

function whatsappSection() {
  const wa = state.settings.whatsapp || {};
  const hasWorker = Boolean(appConfig.workerUrl);

  return `
    <div class="stack">
      <section class="card card--pad">
        <h2>Nível 1 — atalho do WhatsApp <span class="pill pill--ok">ativo</span></h2>
        <p class="muted" style="font-size:.87rem">
          Já funciona sem nenhuma configuração: o botão “Abrir no WhatsApp” monta a conversa
          pelo link oficial <code>wa.me</code>, com o modelo de mensagem já preenchido, e o
          envio fica registrado na timeline do contato.
        </p>
      </section>

      <section class="card card--pad">
        <h2>Nível 2 — WhatsApp Cloud API ${cloudApiEnabled()
          ? '<span class="pill pill--ok">conectada</span>'
          : '<span class="pill">não configurada</span>'}</h2>

        <p class="muted" style="font-size:.87rem">
          O envio e o recebimento passam pelo Cloudflare Worker, que guarda o token da Meta.
          <strong>Nenhuma credencial fica no navegador.</strong> Os campos abaixo são apenas
          identificadores públicos; o access token, o app secret e o verify token vivem
          exclusivamente nas <em>secrets</em> do Worker (<code>wrangler secret put</code>).
        </p>

        <div class="form" style="margin-top:.9rem">
          <div class="field">
            <label for="wa-url">URL do Worker</label>
            <input type="text" id="wa-url" value="${esc(appConfig.workerUrl || '')}" readonly
                   placeholder="configure em public/js/config.js → appConfig.workerUrl">
            <span class="field__hint">Definida em <code>public/js/config.js</code>.</span>
          </div>

          <div class="field">
            <label for="wa-phone-id">Phone Number ID</label>
            <input type="text" id="wa-phone-id" maxlength="40" value="${esc(wa.phoneNumberId || '')}" ${isAdmin() ? '' : 'disabled'}>
          </div>
          <div class="field">
            <label for="wa-waba">WhatsApp Business Account ID</label>
            <input type="text" id="wa-waba" maxlength="40" value="${esc(wa.wabaId || '')}" ${isAdmin() ? '' : 'disabled'}>
          </div>
          <div class="field">
            <label for="wa-display">Número exibido</label>
            <input type="text" id="wa-display" maxlength="30" value="${esc(wa.displayNumber || '')}" placeholder="+55 12 99999-9999" ${isAdmin() ? '' : 'disabled'}>
          </div>
          <label class="checkline">
            <input type="checkbox" id="wa-enabled" ${wa.enabled ? 'checked' : ''} ${isAdmin() && hasWorker ? '' : 'disabled'}>
            Ativar envio pela Cloud API
          </label>
          ${hasWorker ? '' : '<p class="field__hint">Configure <code>appConfig.workerUrl</code> para habilitar esta opção.</p>'}

          ${isAdmin() ? `
            <div class="row">
              <button class="btn btn--primary" id="btn-save-wa">Salvar</button>
              <button class="btn" id="btn-test-wa" ${hasWorker ? '' : 'disabled'}>Testar conexão</button>
            </div>` : adminNotice}
          <div id="wa-status"></div>
        </div>
      </section>

      <section class="card card--pad">
        <h2>Webhook</h2>
        <p class="muted" style="font-size:.87rem">Cadastre esta URL no painel da Meta (produto WhatsApp › Configuração):</p>
        <pre>${esc(appConfig.workerUrl ? `${appConfig.workerUrl.replace(/\/$/, '')}/webhook/${state.company?.id || ''}` : 'https://SEU-WORKER.workers.dev/webhook/SEU-WORKSPACE')}</pre>
        <p class="muted" style="font-size:.84rem">
          O <em>verify token</em> é o valor da secret <code>WHATSAPP_VERIFY_TOKEN</code> do Worker.
          Assine o campo <code>messages</code> para receber mensagens e status de entrega/leitura.
        </p>
      </section>
    </div>`;
}

/* -------------------------------------------------------------- dados ---- */

function dataSection() {
  return `
    <div class="stack">
      <section class="card card--pad">
        <h2>Dados de demonstração</h2>
        <p class="muted" style="font-size:.86rem">
          Cria alguns leads, tarefas e interações de exemplo para você testar o fluxo completo.
          Os dados são gravados normalmente no Firestore — dá para editar e apagar como qualquer registro.
        </p>
        <button class="btn btn--primary" id="btn-seed">Carregar dados de demonstração</button>
      </section>

      <section class="card card--pad">
        <h2>Exportar</h2>
        <p class="muted" style="font-size:.86rem">Baixe seus contatos em CSV a partir da tela de Contatos.</p>
        <a class="btn" href="#/contatos">Ir para Contatos</a>
      </section>
    </div>`;
}

/* --------------------------------------------------------------- wire ---- */

function wire(root, paint) {
  root.querySelector('.settings-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-section]');
    if (!button) return;
    section = button.dataset.section;
    paint();
  });

  const save = async (button, fn, message) => {
    button.disabled = true;
    try {
      await fn();
      toastOk(message);
    } catch (err) {
      console.error('[configurações]', err);
      toastError(describeError(err));
    } finally {
      button.disabled = false;
    }
  };

  /* -------- workspace -------- */
  root.querySelector('#btn-save-company')?.addEventListener('click', (event) =>
    save(event.target, () => updateCompany({
      name: clean(root.querySelector('#w-name').value, 120),
      segment: clean(root.querySelector('#w-segment').value, 80)
    }), 'Dados da empresa atualizados.'));

  root.querySelector('#btn-copy-invite')?.addEventListener('click', async () => {
    const code = root.querySelector('#w-invite').value;
    try {
      await navigator.clipboard.writeText(code);
      toastOk('Código copiado.');
    } catch {
      root.querySelector('#w-invite').select();
      toastWarn('Copie o código selecionado.');
    }
  });

  root.querySelector('#btn-rotate')?.addEventListener('click', async (event) => {
    const ok = await confirmDialog({
      title: 'Gerar novo código',
      message: 'O código atual deixa de funcionar. Quem já entrou continua com acesso.',
      confirmText: 'Gerar',
      danger: true
    });
    if (!ok) return;
    save(event.target, async () => { await rotateJoinCode(); paint(); }, 'Novo código gerado.');
  });

  /* -------- funil -------- */
  root.querySelector('#btn-save-stages')?.addEventListener('click', (event) => {
    const rows = [...root.querySelectorAll('#stage-editor .stage-editor__row')];
    const current = stages();
    const updated = rows.map((row, index) => {
      const original = current.find((s) => s.id === row.dataset.stage) || {};
      return {
        ...original,
        id: row.dataset.stage,
        name: clean(row.querySelector('[data-field="name"]').value, 40) || original.name,
        color: row.querySelector('[data-field="color"]').value,
        order: index
      };
    });
    save(event.target, () => updateSettings({ stages: updated }), 'Etapas atualizadas.');
  });

  root.querySelector('#stage-editor')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-move]');
    if (!button) return;
    const row = button.closest('.stage-editor__row');
    const sibling = button.dataset.move === 'up'
      ? row.previousElementSibling
      : row.nextElementSibling;
    if (!sibling) return;
    if (button.dataset.move === 'up') row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
  });

  root.querySelector('#btn-add-stage')?.addEventListener('click', () => {
    openModal({
      title: 'Nova etapa',
      body: `<div class="field"><label for="ns-name">Nome</label>
             <input type="text" id="ns-name" maxlength="40" placeholder="Ex.: Visita agendada"></div>`,
      confirmText: 'Adicionar',
      onConfirm: async (modalRoot) => {
        const name = clean(modalRoot.querySelector('#ns-name').value, 40);
        if (!name) { toastError('Informe o nome da etapa.'); return false; }

        const current = stages();
        const id = slugify(name) || `etapa-${current.length + 1}`;
        if (current.some((s) => s.id === id)) { toastError('Já existe uma etapa com esse nome.'); return false; }

        // Entra antes das etapas terminais (ganho/perda).
        const terminalIndex = current.findIndex((s) => s.won || s.lost);
        const position = terminalIndex >= 0 ? terminalIndex : current.length;
        const updated = [...current];
        updated.splice(position, 0, { id, name, color: '#64748b' });

        await updateSettings({ stages: updated.map((s, i) => ({ ...s, order: i })) });
        toastOk('Etapa adicionada.');
        paint();
      }
    });
  });

  root.querySelector('#btn-reset-stages')?.addEventListener('click', async (event) => {
    const ok = await confirmDialog({
      title: 'Restaurar etapas padrão',
      message: 'Os contatos mantêm a etapa atual, mas etapas personalizadas somem da lista.',
      confirmText: 'Restaurar',
      danger: true
    });
    if (!ok) return;
    save(event.target, async () => {
      await updateSettings({ stages: defaultSettings().stages });
      paint();
    }, 'Etapas restauradas.');
  });

  root.querySelector('#btn-save-prefs')?.addEventListener('click', (event) =>
    save(event.target, () => updateSettings({
      staleDays: Math.min(90, Math.max(1, Number(root.querySelector('#s-stale').value) || 5)),
      followUpDefaultHour: Math.min(23, Math.max(0, Number(root.querySelector('#s-hour').value) || 9))
    }), 'Preferências salvas.'));

  /* -------- listas -------- */
  root.querySelector('#btn-save-lists')?.addEventListener('click', (event) => {
    const lines = (id, max) => root.querySelector(id).value
      .split('\n').map((line) => clean(line, 40)).filter(Boolean).slice(0, max);

    save(event.target, () => updateSettings({
      sources: lines('#s-sources', 30),
      tags: lines('#s-tags', 30).map((t) => t.toUpperCase()),
      lostReasons: lines('#s-lost', 20),
      defaultLink: clean(root.querySelector('#s-link').value, 200)
    }), 'Listas atualizadas.');
  });

  /* -------- mensagens -------- */
  root.querySelector('#btn-new-template')?.addEventListener('click', () => templateModal(null, paint));
  root.querySelectorAll('[data-edit-template]').forEach((button) => {
    button.addEventListener('click', () => {
      const template = state.templates.find((t) => t.id === button.dataset.editTemplate);
      if (template) templateModal(template, paint);
    });
  });
  root.querySelectorAll('[data-del-template]').forEach((button) => {
    button.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Excluir modelo', message: 'O modelo será removido definitivamente.',
        confirmText: 'Excluir', danger: true
      });
      if (!ok) return;
      try {
        await deleteTemplate(button.dataset.delTemplate);
        toastOk('Modelo excluído.');
      } catch (err) { toastError(describeError(err)); }
    });
  });

  /* -------- equipe -------- */
  root.querySelectorAll('[data-role-for]').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await updateMemberRole(select.dataset.roleFor, select.value);
        toastOk('Permissão atualizada.');
      } catch (err) { toastError(describeError(err)); }
    });
  });
  root.querySelectorAll('[data-toggle-active]').forEach((button) => {
    button.addEventListener('click', async () => {
      const member = state.members.find((m) => m.id === button.dataset.toggleActive);
      try {
        await setMemberActive(member.id, member.active === false);
        toastOk(member.active === false ? 'Acesso reativado.' : 'Acesso desativado.');
      } catch (err) { toastError(describeError(err)); }
    });
  });

  /* -------- whatsapp -------- */
  root.querySelector('#btn-save-wa')?.addEventListener('click', (event) =>
    save(event.target, () => updateSettings({
      whatsapp: {
        ...(state.settings.whatsapp || {}),
        phoneNumberId: clean(root.querySelector('#wa-phone-id').value, 40),
        wabaId: clean(root.querySelector('#wa-waba').value, 40),
        displayNumber: clean(root.querySelector('#wa-display').value, 30),
        enabled: root.querySelector('#wa-enabled').checked
      }
    }), 'Integração atualizada.'));

  root.querySelector('#btn-test-wa')?.addEventListener('click', async (event) => {
    const status = root.querySelector('#wa-status');
    event.target.disabled = true;
    status.innerHTML = '<p class="muted" style="font-size:.85rem">Testando…</p>';
    try {
      const health = await checkWorkerHealth();
      status.innerHTML = `<p class="muted" style="font-size:.85rem">
        Worker respondeu: <strong>${esc(health.status || 'ok')}</strong>
        ${health.whatsappConfigured ? '· credenciais da Meta presentes' : '· <strong>faltam secrets da Meta</strong>'}
      </p>`;
    } catch (err) {
      status.innerHTML = `<p class="form__error">${esc(describeError(err))}</p>`;
    } finally {
      event.target.disabled = false;
    }
  });

  /* -------- dados -------- */
  root.querySelector('#btn-seed')?.addEventListener('click', async (event) => {
    const ok = await confirmDialog({
      title: 'Carregar dados de demonstração',
      message: 'Serão criados leads, tarefas e interações de exemplo neste workspace.',
      confirmText: 'Carregar'
    });
    if (!ok) return;

    event.target.disabled = true;
    try {
      const { seedDemoData } = await import('../seed.js');
      const total = await seedDemoData();
      toastOk(`${total} registros de demonstração criados.`);
    } catch (err) {
      console.error('[seed]', err);
      toastError(describeError(err));
    } finally {
      event.target.disabled = false;
    }
  });
}

function templateModal(template, onDone) {
  openModal({
    title: template ? 'Editar modelo' : 'Novo modelo',
    body: `
      <div class="grid2">
        <div class="field">
          <label for="tpl-name">Nome *</label>
          <input type="text" id="tpl-name" maxlength="80" value="${esc(template?.name || '')}" placeholder="Ex.: Follow-up de proposta">
        </div>
        <div class="field">
          <label for="tpl-cat">Categoria</label>
          <input type="text" id="tpl-cat" maxlength="40" value="${esc(template?.category || '')}" placeholder="Ex.: Follow-up">
        </div>
      </div>
      <div class="field">
        <label for="tpl-body">Mensagem *</label>
        <textarea id="tpl-body" style="min-height:150px" maxlength="3000">${esc(template?.body || '')}</textarea>
        <span class="field__hint">
          Clique para inserir: ${TEMPLATE_VARS.map((v) => `<button type="button" class="varchip" data-var="${esc(v.key)}">{{${esc(v.key)}}}</button>`).join(' ')}
        </span>
      </div>`,
    wide: true,
    confirmText: 'Salvar modelo',
    onMount: (modalRoot) => {
      const textarea = modalRoot.querySelector('#tpl-body');
      modalRoot.querySelectorAll('[data-var]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const token = `{{${chip.dataset.var}}}`;
          const start = textarea.selectionStart ?? textarea.value.length;
          textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(textarea.selectionEnd ?? start);
          textarea.focus();
          textarea.selectionStart = textarea.selectionEnd = start + token.length;
        });
      });
    },
    onConfirm: async (modalRoot) => {
      try {
        await saveTemplate(template?.id || null, {
          name: modalRoot.querySelector('#tpl-name').value,
          category: modalRoot.querySelector('#tpl-cat').value,
          body: modalRoot.querySelector('#tpl-body').value
        });
        toastOk('Modelo salvo.');
        onDone?.();
      } catch (err) {
        toastError(describeError(err));
        return false;
      }
    }
  });
}
