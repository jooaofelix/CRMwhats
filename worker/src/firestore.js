/**
 * Cliente minimo do Firestore via REST, autenticado com a service account.
 *
 * Escritas feitas por aqui usam credenciais de administrador e NAO passam pelo
 * firestore.rules — por isso todo endpoint do Worker valida antes quem e o
 * usuario e se ele pertence a empresa informada.
 */

import { getAccessToken } from './jwt.js';

const BASE = 'https://firestore.googleapis.com/v1';

function root(env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID não configurado.');
  return `${BASE}/projects/${projectId}/databases/(default)/documents`;
}

/* ------------------------------------------------- conversao de tipos --- */

/** JS -> representacao tipada do Firestore. */
export function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toValue(v)])) } };
  }
  return { stringValue: String(value) };
}

/** Representacao do Firestore -> JS. */
export function fromValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
  return null;
}

export function toFields(object) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, toValue(v)]));
}
export function fromFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, fromValue(v)]));
}

/* --------------------------------------------------------- requisicao --- */

async function request(env, url, options = {}) {
  const token = await getAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = body?.error?.message || `Firestore respondeu ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

/* ----------------------------------------------------------- operacoes -- */

/** Le um documento. Devolve null quando nao existe. */
export async function getDocument(env, path) {
  try {
    const doc = await request(env, `${root(env)}/${path}`);
    return { id: path.split('/').pop(), ...fromFields(doc.fields) };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Cria um documento; com `docId` o id e fixo (upsert quando combinado com patch). */
export async function createDocument(env, collectionPath, data, docId = null) {
  const query = docId ? `?documentId=${encodeURIComponent(docId)}` : '';
  const doc = await request(env, `${root(env)}/${collectionPath}${query}`, {
    method: 'POST',
    body: JSON.stringify({ fields: toFields(data) })
  });
  return { id: doc.name.split('/').pop(), ...fromFields(doc.fields) };
}

/**
 * Atualiza (ou cria) apenas os campos informados.
 * A updateMask garante que nenhum outro campo do documento seja apagado.
 */
export async function patchDocument(env, path, data) {
  const mask = Object.keys(data)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join('&');
  const doc = await request(env, `${root(env)}/${path}?${mask}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFields(data) })
  });
  return { id: doc.name.split('/').pop(), ...fromFields(doc.fields) };
}

/**
 * Consulta uma colecao por igualdade de campo.
 * @param {string} parentPath caminho do documento pai ('' para a raiz)
 */
export async function queryCollection(env, parentPath, collectionId, filters = [], limit = 10) {
  const url = parentPath ? `${root(env)}/${parentPath}:runQuery` : `${root(env)}:runQuery`;

  const where = filters.length === 1
    ? { fieldFilter: { field: { fieldPath: filters[0].field }, op: filters[0].op || 'EQUAL', value: toValue(filters[0].value) } }
    : {
      compositeFilter: {
        op: 'AND',
        filters: filters.map((f) => ({
          fieldFilter: { field: { fieldPath: f.field }, op: f.op || 'EQUAL', value: toValue(f.value) }
        }))
      }
    };

  const body = await request(env, url, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        ...(filters.length ? { where } : {}),
        limit
      }
    })
  });

  return (Array.isArray(body) ? body : [])
    .filter((row) => row.document)
    .map((row) => ({ id: row.document.name.split('/').pop(), ...fromFields(row.document.fields) }));
}

/** Incrementa um contador numerico de forma atomica. */
export async function incrementField(env, path, field, amount = 1) {
  await request(env, `${root(env)}:commit`, {
    method: 'POST',
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
          fieldTransforms: [{ fieldPath: field, increment: toValue(amount) }]
        }
      }]
    })
  });
}
