/**
 * Router por hash (#/rota/param).
 *
 * As views sao carregadas sob demanda com import() dinamico: o primeiro
 * carregamento da aplicacao baixa apenas o nucleo, e cada tela chega quando e
 * usada pela primeira vez.
 *
 * Contrato de uma view:
 *   export function render(root, ctx) -> void | Promise
 *   export function destroy() -> void            (opcional; libera listeners)
 */

const ROUTES = {
  dashboard:     () => import('./views/dashboard.js'),
  conversas:     () => import('./views/conversations.js'),
  contatos:      () => import('./views/contacts.js'),
  contato:       () => import('./views/contact.js'),
  funil:         () => import('./views/funnel.js'),
  tarefas:       () => import('./views/tasks.js'),
  relatorios:    () => import('./views/reports.js'),
  configuracoes: () => import('./views/settings.js')
};

const DEFAULT_ROUTE = 'dashboard';

let rootEl = null;
let currentView = null;
let currentName = '';
let token = 0;

/** Interpreta o hash atual. */
export function parseHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const name = segments[0] || DEFAULT_ROUTE;
  return {
    name: ROUTES[name] ? name : DEFAULT_ROUTE,
    params: segments.slice(1),
    query: Object.fromEntries(new URLSearchParams(queryPart || ''))
  };
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`;
  if (location.hash === target) { render(); return; }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
}

export function currentRouteName() {
  return currentName;
}

/** Destaca o item de menu ativo (sidebar e barra inferior). */
function highlightNav(name) {
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.route === name);
  });
}

async function render() {
  if (!rootEl) return;
  const route = parseHash();
  const runToken = ++token;

  highlightNav(route.name);
  document.title = `${titleFor(route.name)} · Zapline CRM`;

  // Libera a view anterior antes de montar a proxima.
  if (currentView?.destroy) {
    try { currentView.destroy(); } catch (err) { console.error('[router] destroy falhou', err); }
  }
  currentView = null;
  currentName = route.name;

  rootEl.innerHTML = '<div class="stack" style="max-width:520px"><div class="skeleton" style="height:28px;width:40%"></div><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px"></div></div>';

  try {
    const module = await ROUTES[route.name]();
    if (runToken !== token) return; // navegou de novo enquanto carregava

    currentView = module;
    rootEl.innerHTML = '';
    await module.render(rootEl, route);

    if (runToken === token) {
      rootEl.scrollTop = 0;
      window.scrollTo({ top: 0 });
    }
  } catch (err) {
    if (runToken !== token) return;
    console.error('[router] falha ao carregar a tela', err);
    rootEl.innerHTML = `
      <div class="card card--pad" style="max-width:520px">
        <h2>Não foi possível abrir esta tela</h2>
        <p class="muted">${String(err?.message || err)}</p>
        <button class="btn btn--primary" onclick="location.reload()">Recarregar</button>
      </div>`;
  }
}

function titleFor(name) {
  return {
    dashboard: 'Dashboard', conversas: 'Conversas', contatos: 'Contatos', contato: 'Contato',
    funil: 'Funil', tarefas: 'Tarefas', relatorios: 'Relatórios', configuracoes: 'Configurações'
  }[name] || 'Zapline CRM';
}

export function startRouter(element) {
  rootEl = element;
  window.addEventListener('hashchange', render);
  if (!location.hash || location.hash === '#') {
    history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
  }
  render();
}

export function stopRouter() {
  window.removeEventListener('hashchange', render);
  if (currentView?.destroy) {
    try { currentView.destroy(); } catch {}
  }
  currentView = null;
  rootEl = null;
}

/** Reexecuta a view atual (usado apos acoes que mudam a rota em si). */
export function refresh() {
  render();
}
