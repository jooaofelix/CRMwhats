/**
 * Ponto de entrada: configuracao, autenticacao, montagem do shell e router.
 */

import { resolveConfig } from './config.js';
import { toast, toastOk, toastError, describeError } from './ui.js';
import { esc, initials, debounce, norm, onlyDigits, formatPhone } from './utils.js';
import { ROLE_LABEL, PLANS } from './defaults.js';

const boot = document.getElementById('boot');
const setupScreen = document.getElementById('setup-screen');
const authScreen = document.getElementById('auth-screen');
const onboardingScreen = document.getElementById('onboarding-screen');
const appShell = document.getElementById('app-shell');

const show = (element) => element?.classList.remove('hidden');
const hide = (element) => element?.classList.add('hidden');

/* ------------------------------------------------------- pre-flight ------ */

// A configuração pode vir deste repositório (config.js) ou das variáveis do
// Worker (/api/config) — por isso a checagem é assíncrona.
resolveConfig()
  .then((configured) => {
    if (!configured) {
      hide(boot);
      show(setupScreen);
      return;
    }
    return start();
  })
  .catch((err) => {
    console.error('[app] falha na inicialização', err);
    hide(boot);
    document.body.insertAdjacentHTML('afterbegin',
      `<div class="setup"><div class="setup__card card card--pad">
        <h1>Não foi possível iniciar</h1>
        <p class="muted">${esc(err?.message || String(err))}</p>
        <button class="btn btn--primary" onclick="location.reload()">Tentar novamente</button>
      </div></div>`);
  });

/* -------------------------------------------------------- bootstrap ------ */

async function start() {
  const [{ auth, onAuthStateChanged, signOut, getRedirectResult }, dataModule, stateModule] =
    await Promise.all([
      import('./firebase.js'),
      import('./data.js'),
      import('./state.js')
    ]);

  const { state, setState, resetState, subscribe } = stateModule;
  const { ensureUserProfile, loadWorkspace, startListeners, stopListeners } = dataModule;

  // Resultado de login por redirecionamento (fallback do popup no celular).
  getRedirectResult(auth).catch((err) => {
    if (err?.code && err.code !== 'auth/no-auth-event') {
      console.warn('[auth] redirect', err);
    }
  });

  setupAuthScreen();
  setupOnboardingScreen();
  setupShell({ auth, signOut, state, resetState, stopListeners });

  let sessionToken = 0;

  onAuthStateChanged(auth, async (user) => {
    const runToken = ++sessionToken;

    if (!user) {
      stopListeners();
      resetState();
      hide(boot); hide(onboardingScreen); hide(appShell);
      show(authScreen);
      const { stopRouter } = await import('./router.js');
      stopRouter();
      return;
    }

    try {
      state.user = user;
      const profile = await ensureUserProfile(user);
      if (runToken !== sessionToken) return;
      setState({ profile });

      const hasWorkspace = profile.companyId
        ? await loadWorkspace(profile.companyId)
        : false;
      if (runToken !== sessionToken) return;

      if (!hasWorkspace) {
        hide(boot); hide(authScreen); hide(appShell);
        show(onboardingScreen);
        document.getElementById('company-user').value =
          user.displayName || (user.email || '').split('@')[0] || '';
        return;
      }

      startListeners();
      hide(boot); hide(authScreen); hide(onboardingScreen);
      show(appShell);
      paintIdentity();

      const { startRouter } = await import('./router.js');
      startRouter(document.getElementById('view-root'));
    } catch (err) {
      console.error('[app] sessão', err);
      hide(boot);
      show(authScreen);
      toastError(describeError(err));
      await signOut(auth).catch(() => {});
    }
  });

  subscribe(() => paintIdentity());

  /* ---------------------------------------------------- identidade ----- */

  function paintIdentity() {
    if (!state.user || !state.company) return;

    const name = state.member?.name || state.profile?.displayName || state.user.email;
    document.getElementById('user-initials').textContent = initials(name);
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-email').textContent = state.user.email || '';
    document.getElementById('user-role').textContent = ROLE_LABEL[state.member?.role] || 'Usuário';

    document.getElementById('workspace-name').textContent = state.company.name;
    document.getElementById('workspace-initials').textContent = initials(state.company.name);
    document.getElementById('workspace-plan').textContent =
      `Plano ${PLANS[state.company.plan]?.label || 'Trial'}`;

    // Badge de pendencias do dia (hoje + atrasadas).
    const badge = document.getElementById('nav-task-badge');
    const pending = stateModule.tasksToday().length + stateModule.tasksOverdue().length;
    if (pending > 0) {
      badge.textContent = pending > 99 ? '99+' : String(pending);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
}

/* ------------------------------------------------------ tela de login ---- */

function setupAuthScreen() {
  let mode = 'login';

  const form = document.getElementById('auth-form');
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const nameField = document.getElementById('field-name');
  const submit = document.getElementById('auth-submit');
  const toggle = document.getElementById('btn-toggle-mode');
  const errorBox = document.getElementById('auth-error');
  const passwordInput = document.getElementById('auth-password');

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  const applyMode = () => {
    const isSignup = mode === 'signup';
    title.textContent = isSignup ? 'Criar sua conta' : 'Entrar na sua conta';
    subtitle.textContent = isSignup
      ? 'Leva menos de um minuto. Depois você cria o workspace da empresa.'
      : 'Use seu e-mail ou sua conta Google.';
    nameField.hidden = !isSignup;
    submit.textContent = isSignup ? 'Criar conta' : 'Entrar';
    toggle.textContent = isSignup ? 'Já tenho conta' : 'Criar uma conta';
    passwordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
    showError('');
  };
  applyMode();

  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    applyMode();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');

    const email = document.getElementById('auth-email').value.trim();
    const password = passwordInput.value;
    const displayName = document.getElementById('auth-name').value.trim();

    if (!email || !password) return showError('Preencha e-mail e senha.');
    if (password.length < 6) return showError('A senha precisa ter pelo menos 6 caracteres.');
    if (mode === 'signup' && !displayName) return showError('Informe seu nome.');

    submit.disabled = true;
    submit.classList.add('is-loading');
    try {
      const {
        auth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
        updateProfile, setPersistence, browserLocalPersistence
      } = await import('./firebase.js');

      await setPersistence(auth, browserLocalPersistence);

      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      console.error('[auth]', err);
      showError(describeError(err));
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-loading');
    }
  });

  document.getElementById('btn-google').addEventListener('click', async () => {
    showError('');
    try {
      const { auth, googleProvider, signInWithPopup, signInWithRedirect } = await import('./firebase.js');
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        // Em muitos navegadores de celular o popup e bloqueado: cai no redirect.
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment',
             'auth/cancelled-popup-request'].includes(err.code)) {
          await signInWithRedirect(auth, googleProvider);
          return;
        }
        throw err;
      }
    } catch (err) {
      console.error('[auth google]', err);
      showError(describeError(err));
    }
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email) return showError('Digite seu e-mail para receber o link de redefinição.');
    try {
      const { auth, sendPasswordResetEmail } = await import('./firebase.js');
      await sendPasswordResetEmail(auth, email);
      toastOk('Enviamos um link de redefinição para o seu e-mail.');
    } catch (err) {
      showError(describeError(err));
    }
  });
}

/* --------------------------------------------------------- onboarding ---- */

function setupOnboardingScreen() {
  const form = document.getElementById('onboarding-form');
  const errorBox = document.getElementById('onboarding-error');
  const submit = document.getElementById('onboarding-submit');

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  // Alternador entre "criar workspace" e "entrar com código de convite".
  const joinBlock = document.createElement('div');
  joinBlock.className = 'field';
  joinBlock.hidden = true;
  joinBlock.innerHTML = `
    <label for="join-code">Código de convite</label>
    <input type="text" id="join-code" placeholder="empresa-ab12.K7M2QD" autocapitalize="off" spellcheck="false">
    <span class="field__hint">Peça este código ao administrador do workspace.</span>`;
  form.insertBefore(joinBlock, form.querySelector('.form__error'));

  const switcher = document.createElement('button');
  switcher.type = 'button';
  switcher.className = 'link link--center';
  switcher.textContent = 'Tenho um código de convite';
  form.appendChild(switcher);

  let mode = 'create';
  switcher.addEventListener('click', () => {
    mode = mode === 'create' ? 'join' : 'create';
    const joining = mode === 'join';
    document.getElementById('company-name').closest('.field').hidden = joining;
    document.getElementById('company-segment').closest('.field').hidden = joining;
    joinBlock.hidden = !joining;
    submit.textContent = joining ? 'Entrar no workspace' : 'Criar workspace';
    switcher.textContent = joining ? 'Quero criar um workspace novo' : 'Tenho um código de convite';
    showError('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');

    const userName = document.getElementById('company-user').value.trim();
    if (!userName) return showError('Informe seu nome.');

    submit.disabled = true;
    submit.classList.add('is-loading');
    try {
      const { createCompany, joinCompany } = await import('./data.js');

      if (mode === 'join') {
        const code = document.getElementById('join-code').value.trim();
        if (!code) throw new Error('Informe o código de convite.');
        await joinCompany(code, userName);
      } else {
        const name = document.getElementById('company-name').value.trim();
        if (!name) throw new Error('Informe o nome da empresa.');
        await createCompany({
          name,
          segment: document.getElementById('company-segment').value.trim(),
          userName
        });
      }
      toastOk('Workspace pronto! Bem-vindo ao Zapline CRM.');
      location.reload();
    } catch (err) {
      console.error('[onboarding]', err);
      // "permission-denied" só significa código inválido quando o usuário
      // estava mesmo entrando por convite.
      showError(mode === 'join' && err?.code === 'permission-denied'
        ? 'Código de convite inválido ou expirado.'
        : describeError(err));
      submit.disabled = false;
      submit.classList.remove('is-loading');
    }
  });

  document.getElementById('btn-signout-onboarding').addEventListener('click', async () => {
    const { auth, signOut } = await import('./firebase.js');
    await signOut(auth);
    location.reload();
  });
}

/* -------------------------------------------------------------- shell ---- */

function setupShell({ auth, signOut, state, resetState, stopListeners }) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');

  const closeSidebar = () => {
    sidebar.classList.remove('is-open');
    scrim.hidden = true;
  };
  document.getElementById('btn-open-sidebar').addEventListener('click', () => {
    sidebar.classList.add('is-open');
    scrim.hidden = false;
  });
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  scrim.addEventListener('click', closeSidebar);
  document.getElementById('main-nav').addEventListener('click', (e) => {
    if (e.target.closest('a')) closeSidebar();
  });

  // Menu do usuario
  const userBtn = document.getElementById('btn-user');
  const userPanel = document.getElementById('user-panel');
  userBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = userPanel.hidden;
    userPanel.hidden = !open;
    userBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!userPanel.hidden && !e.target.closest('.usermenu')) {
      userPanel.hidden = true;
      userBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('btn-signout').addEventListener('click', async () => {
    stopListeners();
    resetState();
    await signOut(auth);
    location.hash = '';
    location.reload();
  });

  document.getElementById('btn-new-contact').addEventListener('click', async () => {
    const { openContactModal } = await import('./modals.js');
    openContactModal();
  });

  setupGlobalSearch(state);
}

/* ------------------------------------------------------- busca global ---- */

function setupGlobalSearch(state) {
  const input = document.getElementById('global-search');
  const results = document.getElementById('search-results');
  let items = [];
  let cursor = -1;

  const close = () => { results.hidden = true; cursor = -1; };

  const openContact = (id) => {
    close();
    input.value = '';
    input.blur();
    location.hash = `#/contato/${id}`;
  };

  const search = (term) => {
    const q = norm(term.trim());
    const digits = onlyDigits(term);
    if (!q && !digits) return [];

    return state.contacts
      .filter((contact) => {
        if (digits.length >= 4 && contact._digits?.includes(digits)) return true;
        return q.length >= 2 && contact._search?.includes(q);
      })
      .slice(0, 8);
  };

  const paint = () => {
    if (!items.length) {
      results.innerHTML = '<div class="search__empty">Nenhum contato encontrado.</div>';
      results.hidden = false;
      return;
    }
    results.innerHTML = items.map((contact, index) => `
      <button class="search__item ${index === cursor ? 'is-active' : ''}" data-id="${esc(contact.id)}">
        <span class="itemrow__avatar">${esc(initials(contact.name))}</span>
        <span class="itemrow__main">
          <strong>${esc(contact.name)}</strong>
          <span>${esc([contact.company, formatPhone(contact.whatsapp || contact.phone)].filter(Boolean).join(' · '))}</span>
        </span>
      </button>`).join('');
    results.hidden = false;
  };

  input.addEventListener('input', debounce(() => {
    const term = input.value;
    if (term.trim().length < 2) return close();
    items = search(term);
    cursor = -1;
    paint();
  }, 160));

  input.addEventListener('keydown', (event) => {
    if (results.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      cursor = Math.min(cursor + 1, items.length - 1); paint();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cursor = Math.max(cursor - 1, 0); paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = items[cursor >= 0 ? cursor : 0];
      if (chosen) openContact(chosen.id);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-id]');
    if (button) openContact(button.dataset.id);
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search')) close();
  });

  // Atalho de teclado no desktop.
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
}

/* --------------------------------------------------------- diagnostico --- */

window.addEventListener('unhandledrejection', (event) => {
  console.error('[app] promessa não tratada', event.reason);
  if (event.reason?.code === 'permission-denied') {
    toast('Você não tem permissão para esta ação.', 'error');
  }
});
