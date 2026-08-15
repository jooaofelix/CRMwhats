/**
 * Configuracao publica do frontend.
 *
 * IMPORTANTE SOBRE SEGURANCA
 * --------------------------
 * As chaves do Firebase Web (apiKey, appId, etc.) sao publicas por natureza:
 * elas apenas identificam o projeto. Quem protege os dados sao as REGRAS DO
 * FIRESTORE (arquivo firestore.rules) e a autenticacao.
 *
 * NUNCA coloque aqui:
 *   - token da WhatsApp Cloud API / Meta
 *   - app secret da Meta
 *   - chave de service account do Firebase
 *   - qualquer credencial de servidor
 * Esses valores vivem exclusivamente como secrets do Cloudflare Worker
 * (veja worker/README e o README principal).
 *
 * Copie os valores em: console.firebase.google.com > Configuracoes do projeto >
 * Seus apps > Web > Configuracao do SDK.
 */

export const firebaseConfig = {
  apiKey: 'COLE_SUA_API_KEY',
  authDomain: 'SEU_PROJETO.firebaseapp.com',
  projectId: 'SEU_PROJETO',
  storageBucket: 'SEU_PROJETO.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000'
};

export const appConfig = {
  /** Nome exibido do produto. */
  appName: 'Zapline CRM',

  /**
   * Base das chamadas ao backend seguro (Cloudflare Worker).
   *
   *   '/'   frontend e API no mesmo Worker (padrao deste projeto)
   *   URL   quando o frontend esta em outro dominio, ex.:
   *         'https://crmwhats.seu-subdominio.workers.dev'
   *   ''    sem backend: o CRM opera no "Nivel 1" e continua 100% funcional
   *         usando o atalho wa.me para abrir conversas no WhatsApp
   */
  workerUrl: '/',

  /** DDI padrao usado ao montar links do WhatsApp (55 = Brasil). */
  defaultCountryCode: '55',

  locale: 'pt-BR',
  currency: 'BRL',

  /** Quantos dias sem interacao caracterizam um lead "parado" (padrao inicial). */
  defaultStaleDays: 5,

  /** Teto de contatos carregados em memoria (evita custo em bases grandes). */
  contactsPageSize: 500
};

/** Indica se ja temos credenciais reais do Firebase (deste arquivo ou do Worker). */
export function isConfigured() {
  const key = firebaseConfig.apiKey || '';
  return key.length > 20 && !key.startsWith('COLE_') && !firebaseConfig.projectId.startsWith('SEU_');
}

/** De onde vieram as credenciais em uso — usado na tela de configuracao. */
export let configSource = 'nenhuma';

/**
 * Resolve a configuracao do Firebase em duas etapas:
 *
 *  1. valores preenchidos neste arquivo (bom para desenvolvimento local);
 *  2. senao, GET /api/config no Worker, que devolve as variaveis de ambiente
 *     FIREBASE_API_KEY, FIREBASE_PROJECT_ID e FIREBASE_APP_ID.
 *
 * A segunda opcao permite configurar a aplicacao pelo painel do Cloudflare,
 * sem editar codigo nem refazer deploy.
 *
 * @returns {Promise<boolean>} true quando ha credenciais utilizaveis
 */
export async function resolveConfig() {
  if (isConfigured()) {
    configSource = 'config.js';
    return true;
  }

  const base = (appConfig.workerUrl || '').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/api/config`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return false;

    const data = await response.json();
    if (!data?.firebase?.apiKey) return false;

    // Mutação proposital: firebase.js lê este mesmo objeto ao inicializar.
    Object.assign(firebaseConfig, data.firebase);
    configSource = 'variáveis do Worker';
    return isConfigured();
  } catch (err) {
    console.warn('[config] não foi possível obter a configuração do Worker', err);
    return false;
  }
}
