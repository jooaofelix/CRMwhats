/**
 * Valida firestore.indexes.json antes que o deploy falhe.
 *
 * O erro que motivou estes testes:
 *   HTTP 400 — "this index is not necessary, configure using single field
 *   index controls"
 * O Firestore cria indices de campo unico automaticamente e recusa quem tenta
 * declara-los como composto, abortando o `firebase deploy` inteiro.
 *
 * Execute com:  node --test test/firestore-indexes.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(repo, 'firestore.indexes.json'), 'utf8'));

test('o arquivo tem o formato esperado pelo firebase-tools', () => {
  assert.ok(Array.isArray(spec.indexes), 'indexes deve ser uma lista');
  assert.ok(Array.isArray(spec.fieldOverrides), 'fieldOverrides deve ser uma lista');
});

test('nenhum índice de campo único é declarado', () => {
  for (const index of spec.indexes) {
    assert.ok(
      index.fields.length >= 2,
      `"${index.collectionGroup}" tem ${index.fields.length} campo(s): índices de ` +
      'campo único são automáticos e o deploy é rejeitado com HTTP 400.'
    );
  }
});

test('cada índice declara collectionGroup, queryScope e ordem dos campos', () => {
  for (const index of spec.indexes) {
    assert.ok(index.collectionGroup, 'falta collectionGroup');
    assert.equal(index.queryScope, 'COLLECTION');
    for (const field of index.fields) {
      assert.ok(field.fieldPath, `${index.collectionGroup}: campo sem fieldPath`);
      assert.ok(['ASCENDING', 'DESCENDING'].includes(field.order),
        `${index.collectionGroup}.${field.fieldPath}: ordem inválida`);
    }
  }
});

test('não há índices duplicados', () => {
  const assinaturas = spec.indexes.map((index) =>
    `${index.collectionGroup}:${index.fields.map((f) => `${f.fieldPath}/${f.order}`).join(',')}`);
  assert.equal(new Set(assinaturas).size, assinaturas.length, 'há índices repetidos');
});

test('toda consulta com filtro + ordenação tem índice correspondente', () => {
  // Varre o código atrás de query(...) que combinem where() e orderBy():
  // essas são exatamente as que exigem índice composto.
  const arquivos = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entrada) => {
    const alvo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) walk(alvo);
    else if (alvo.endsWith('.js')) arquivos.push(alvo);
  });
  walk(path.join(repo, 'public', 'js'));

  const declarados = new Set(spec.indexes.map((index) =>
    `${index.collectionGroup}:${index.fields[0].fieldPath}`));

  for (const arquivo of arquivos) {
    const codigo = fs.readFileSync(arquivo, 'utf8');
    // query( col('nome') ... where('campo' ... orderBy(
    const re = /query\(\s*col\(\s*'([a-zA-Z]+)'[\s\S]{0,220}?where\(\s*'([a-zA-Z]+)'[\s\S]{0,220}?orderBy\(/g;
    for (const [, colecao, campo] of codigo.matchAll(re)) {
      assert.ok(
        declarados.has(`${colecao}:${campo}`),
        `${path.relative(repo, arquivo)}: a consulta em "${colecao}" filtra por ` +
        `"${campo}" e ordena — falta o índice composto em firestore.indexes.json`
      );
    }
  }
});
