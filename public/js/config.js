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

/** Indica se o config.js ja foi preenchido com valores reais. */
export function isConfigured() {
  const key = firebaseConfig.apiKey || '';
  return key.length > 20 && !key.startsWith('COLE_') && !firebaseConfig.projectId.startsWith('SEU_');
}
