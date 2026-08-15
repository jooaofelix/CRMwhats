/** Componentes de interface reutilizaveis: toasts, modais, confirmacoes. */

import { esc } from './utils.js';

/* ------------------------------------------------------------- toasts ---- */

const TOAST_ICON = { ok: '✓', error: '!', warn: '!', info: 'i' };

/**
 * Feedback visivel para o usuario. Toda acao importante deve chamar isto —
 * nunca deixar o erro apenas no console.
 */
export function toast(message, type = 'info', timeout = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <strong aria-hidden="true">${TOAST_ICON[type] || 'i'}</strong>
    <span class="grow">${esc(message)}</span>
    <button class="toast__close" aria-label="Fechar">&times;</button>`;

  const remove = () => {
    el.style.transition = 'opacity .15s, transform .15s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 160);
  };
  el.querySelector('.toast__close').addEventListener('click', remove);
  root.appendChild(el);
  if (timeout) setTimeout(remove, timeout);
  return el;
}

export const toastOk = (m) => toast(m, 'ok');
export const toastError = (m) => toast(m, 'error', 6000);
export const toastWarn = (m) => toast(m, 'warn');

/** Converte erros do Firebase em mensagens uteis em portugues. */
export function describeError(error) {
  const code = error?.code || '';
  const map = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/email-already-in-use': 'Este e-mail já possui uma conta. Faça login.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/popup-closed-by-user': 'Login cancelado.',
    'auth/cancelled-popup-request': 'Login cancelado.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Libere pop-ups e tente novamente.',
    'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase Authentication.',
    'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
    'auth/operation-not-allowed': 'Este método de login não está habilitado no Firebase.',
    'permission-denied': 'Você não tem permissão para esta ação.',
    'unavailable': 'Sem conexão com o servidor. Tente novamente.',
    'failed-precondition': 'Consulta requer um índice do Firestore. Veja o console para o link de criação.',
    'not-found': 'Registro não encontrado.',
    'resource-exhausted': 'Limite do Firestore atingido. Tente novamente mais tarde.'
  };
  if (map[code]) return map[code];
  if (error?.message) {
    return String(error.message).replace(/^Firebase:\s*/, '').replace(/\(auth\/[^)]+\)\.?/, '').trim()
      || 'Não foi possível concluir a ação. Tente novamente.';
  }
  return 'Não foi possível concluir a ação. Tente novamente.';
}

/* ------------------------------------------------------------- modais ---- */

let openModals = 0;

/**
 * Abre um modal (vira bottom sheet no celular).
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string|Node} opts.body            conteudo (HTML string ja escapado ou Node)
 * @param {string} [opts.confirmText]        texto do botao primario (omitido = sem botao)
 * @param {string} [opts.cancelText]
 * @param {boolean} [opts.wide]
 * @param {boolean} [opts.danger]
 * @param {(root: HTMLElement, close: Function) => any} [opts.onMount]
 * @param {(root: HTMLElement) => Promise<boolean|void>|boolean|void} [opts.onConfirm]
 *        retorne false para manter o modal aberto (ex.: erro de validacao)
 * @returns {{ close: Function, root: HTMLElement }}
 */
export function openModal(opts) {
  const {
    title, body, confirmText, cancelText = 'Cancelar',
    wide = false, danger = false, onMount, onConfirm, onClose
  } = opts;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal__head">
        <h2>${esc(title)}</h2>
        <button class="iconbtn" data-close aria-label="Fechar">&times;</button>
      </div>
      <div class="modal__body" data-body></div>
      ${confirmText ? `
      <div class="modal__foot">
        <button class="btn" data-close>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${esc(confirmText)}</button>
      </div>` : ''}
    </div>`;

  const modal = backdrop.querySelector('.modal');
  const bodyEl = backdrop.querySelector('[data-body]');
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body || '';

  let closed = false;
  let confirmed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    openModals = Math.max(0, openModals - 1);
    if (!openModals) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.(confirmed);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);

  const confirmBtn = backdrop.querySelector('[data-confirm]');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.classList.add('is-loading');
      confirmBtn.disabled = true;
      try {
        const result = await onConfirm?.(modal, close);
        if (result !== false) { confirmed = true; close(); }
      } catch (err) {
        console.error('[modal] onConfirm falhou', err);
        toastError(describeError(err));
      } finally {
        confirmBtn.classList.remove('is-loading');
        confirmBtn.disabled = false;
      }
    });
  }

  document.getElementById('modal-root').appendChild(backdrop);
  openModals++;
  document.body.style.overflow = 'hidden';

  onMount?.(modal, close);

  // Foco no primeiro campo (só no desktop; no celular abriria o teclado por cima
  // da folha). O foco é aplicado de forma síncrona de propósito: um foco atrasado
  // rouba o cursor de quem já começou a digitar e joga o texto no campo errado.
  const firstField = modal.querySelector('input:not([type=hidden]), textarea, select');
  if (firstField && window.matchMedia('(min-width: 901px)').matches) {
    firstField.focus({ preventScroll: true });
  }

  return { close, root: modal };
}

/** Confirmacao simples. Resolve para true/false. */
export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p class="muted" style="margin:0">${esc(message)}</p>`,
      confirmText,
      danger,
      // O resultado sai pelo onClose: cobre confirmar, cancelar, ESC e backdrop.
      onClose: (wasConfirmed) => resolve(Boolean(wasConfirmed))
    });
  });
}

/* -------------------------------------------------------- helpers DOM ---- */

/** Cria um elemento com classes e HTML interno. */
export function el(tag, className = '', html = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

/** Estado vazio padronizado. */
export function emptyState(title, description = '', actionHtml = '') {
  return `<div class="empty">
    <strong>${esc(title)}</strong>
    ${description ? `<p>${esc(description)}</p>` : ''}
    ${actionHtml ? `<div style="margin-top:.8rem">${actionHtml}</div>` : ''}
  </div>`;
}

/** Marca um botao como "carregando" enquanto a promise roda. */
export async function withBusy(button, fn) {
  if (!button) return fn();
  const original = button.innerHTML;
  button.classList.add('is-loading');
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.classList.remove('is-loading');
    button.disabled = false;
    button.innerHTML = original;
  }
}
