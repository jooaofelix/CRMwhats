/** Relatórios simples: período, origem, responsável, conversão e tempo de fechamento. */

import { subscribe, visibleContacts, stages } from '../state.js';
import {
  esc, formatMoney, formatMoneyCompact, formatPercent, formatDate, toInputDate,
  fromInputDateTime, startOfDay, endOfDay, startOfMonth, addDays, sum, toCSV,
  downloadFile, toDate, DAY_MS
} from '../utils.js';
import { CONTACT_STATUS } from '../defaults.js';
import { emptyState } from '../ui.js';

let unsubscribe = null;
const period = { preset: '30d', from: null, to: null };

export function render(root) {
  const paint = () => { root.innerHTML = build(); wire(root, paint); };
  paint();
  unsubscribe = subscribe(paint);
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
}

/* -------------------------------------------------------------- periodo -- */

function range() {
  const to = endOfDay();
  switch (period.preset) {
    case 'hoje': return { from: startOfDay(), to };
    case '7d':   return { from: startOfDay(addDays(new Date(), -6)), to };
    case 'mes':  return { from: startOfMonth(), to };
    case 'custom': return {
      from: period.from ? startOfDay(period.from) : startOfDay(addDays(new Date(), -29)),
      to: period.to ? endOfDay(period.to) : to
    };
    case '30d':
    default: return { from: startOfDay(addDays(new Date(), -29)), to };
  }
}

function compute() {
  const { from, to } = range();
  const contacts = visibleContacts();

  const within = (value) => {
    const date = toDate(value);
    return date && date >= from && date <= to;
  };

  const created = contacts.filter((c) => within(c.createdAt));
  const won = contacts.filter((c) => c.status === CONTACT_STATUS.WON && within(c.wonAt));
  const lost = contacts.filter((c) => c.status === CONTACT_STATUS.LOST && within(c.lostAt));
  const open = contacts.filter((c) => c.status === CONTACT_STATUS.OPEN);

  const decided = won.length + lost.length;
  const wonValue = sum(won, (c) => c.value);

  // Tempo medio entre criacao e fechamento das vendas ganhas no periodo.
  const cycles = won
    .map((c) => {
      const start = toDate(c.createdAt);
      const end = toDate(c.wonAt);
      return start && end ? (end - start) / DAY_MS : null;
    })
    .filter((days) => days !== null && days >= 0);

  return {
    from, to, created, won, lost, open,
    conversion: decided ? (won.length / decided) * 100 : 0,
    wonValue,
    lostValue: sum(lost, (c) => c.value),
    pipelineValue: sum(open, (c) => c.value),
    ticket: won.length ? wonValue / won.length : 0,
    avgCycle: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null
  };
}

/* --------------------------------------------------------------- html ---- */

function build() {
  const r = compute();

  return `
    <div class="page__head">
      <div class="page__title">
        <h1>Relatórios</h1>
        <p>${esc(formatDate(r.from))} até ${esc(formatDate(r.to))}</p>
      </div>
      <div class="page__actions">
        <button class="btn" id="btn-export">Exportar CSV</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented" id="period">
        ${[['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Mês atual'], ['custom', 'Personalizado']]
          .map(([id, label]) => `<button data-preset="${id}" class="${period.preset === id ? 'is-active' : ''}">${label}</button>`).join('')}
      </div>
      ${period.preset === 'custom' ? `
        <input type="date" id="p-from" value="${toInputDate(r.from)}">
        <input type="date" id="p-to" value="${toInputDate(r.to)}">` : ''}
    </div>

    <div class="kpis">
      ${kpiCard('Leads no período', String(r.created.length))}
      ${kpiCard('Vendas ganhas', String(r.won.length), formatMoney(r.wonValue), 'ok')}
      ${kpiCard('Vendas perdidas', String(r.lost.length), formatMoney(r.lostValue), 'danger')}
      ${kpiCard('Taxa de conversão', formatPercent(r.conversion, 1), 'ganhas ÷ decididas')}
      ${kpiCard('Ticket médio', formatMoneyCompact(r.ticket), 'por venda ganha')}
      ${kpiCard('Tempo até fechar', r.avgCycle === null ? '—' : `${r.avgCycle.toFixed(1)} dias`, 'média do período')}
      ${kpiCard('Funil atual', formatMoneyCompact(r.pipelineValue), `${r.open.length} em aberto`, 'brand')}
    </div>

    <div class="dash-grid">
      ${barPanel('Leads por origem', bySource(r.created), r.created.length)}
      ${barPanel('Desempenho por responsável', byOwner(r), null, true)}
      ${stagePanel()}
      ${lostReasonsPanel(r)}
    </div>`;
}

function kpiCard(label, value, foot = '', tone = '') {
  return `
    <div class="card kpi ${tone ? `kpi--${tone}` : ''}">
      <span class="kpi__label">${esc(label)}</span>
      <span class="kpi__value is-small">${esc(value)}</span>
      ${foot ? `<span class="kpi__foot">${esc(foot)}</span>` : ''}
    </div>`;
}

function bySource(contacts) {
  const map = new Map();
  for (const contact of contacts) {
    const key = contact.source || 'Não informada';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, value: count }))
    .sort((a, b) => b.value - a.value);
}

function byOwner(r) {
  const map = new Map();
  const bump = (id, name, field, amount = 1) => {
    const key = id || 'sem-responsavel';
    if (!map.has(key)) map.set(key, { label: name || 'Sem responsável', leads: 0, won: 0, value: 0 });
    map.get(key)[field] += amount;
  };

  r.created.forEach((c) => bump(c.ownerId, c.ownerName, 'leads'));
  r.won.forEach((c) => { bump(c.ownerId, c.ownerName, 'won'); bump(c.ownerId, c.ownerName, 'value', c.value || 0); });

  return [...map.values()]
    .map((row) => ({ ...row, valueLabel: `${row.won} venda(s) · ${formatMoneyCompact(row.value)}`, value: row.leads }))
    .sort((a, b) => b.value - a.value);
}

function barPanel(title, rows, total = null, showLabel = false) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const denominator = total ?? rows.reduce((acc, row) => acc + row.value, 0);

  return `
    <section class="card panel">
      <div class="panel__head"><h2>${esc(title)}</h2></div>
      <div class="panel__body">
        ${rows.length ? `<div class="bars">${rows.map((row) => `
          <div class="bar">
            <div class="bar__top">
              <span>${esc(row.label)}</span>
              <strong>${showLabel ? esc(row.valueLabel) : `${row.value}${denominator ? ` · ${formatPercent((row.value / denominator) * 100)}` : ''}`}</strong>
            </div>
            <div class="bar__track"><div class="bar__fill" style="width:${Math.round((row.value / max) * 100)}%"></div></div>
          </div>`).join('')}</div>`
        : emptyState('Sem dados no período')}
      </div>
    </section>`;
}

function stagePanel() {
  const contacts = visibleContacts();
  const rows = stages().map((stage) => {
    const inStage = contacts.filter((c) => c.stage === stage.id);
    return {
      label: stage.name,
      color: stage.color,
      count: inStage.length,
      total: sum(inStage, (c) => c.value)
    };
  });
  const max = Math.max(1, ...rows.map((row) => row.total));

  return `
    <section class="card panel">
      <div class="panel__head"><h2>Valor por etapa</h2></div>
      <div class="panel__body">
        <div class="bars">${rows.map((row) => `
          <div class="bar">
            <div class="bar__top">
              <span><span class="dot" style="background:${esc(row.color)}"></span> ${esc(row.label)} <span class="dim">· ${row.count}</span></span>
              <strong>${esc(formatMoneyCompact(row.total))}</strong>
            </div>
            <div class="bar__track"><div class="bar__fill" style="width:${Math.round((row.total / max) * 100)}%;background:${esc(row.color)}"></div></div>
          </div>`).join('')}</div>
      </div>
    </section>`;
}

function lostReasonsPanel(r) {
  const map = new Map();
  for (const contact of r.lost) {
    const key = (contact.lostReason || 'Não informado').split(' — ')[0];
    map.set(key, (map.get(key) || 0) + 1);
  }
  const rows = [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  return barPanel('Motivos de perda', rows, r.lost.length);
}

/* --------------------------------------------------------------- wire ---- */

function wire(root, paint) {
  root.querySelector('#period').addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset]');
    if (!button) return;
    period.preset = button.dataset.preset;
    paint();
  });

  root.querySelector('#p-from')?.addEventListener('change', (event) => {
    period.from = fromInputDateTime(event.target.value);
    paint();
  });
  root.querySelector('#p-to')?.addEventListener('change', (event) => {
    period.to = fromInputDateTime(event.target.value);
    paint();
  });

  root.querySelector('#btn-export').addEventListener('click', () => {
    const r = compute();
    const rows = [
      ['Período', `${formatDate(r.from)} a ${formatDate(r.to)}`],
      ['Leads criados', r.created.length],
      ['Vendas ganhas', r.won.length],
      ['Valor ganho', formatMoney(r.wonValue)],
      ['Vendas perdidas', r.lost.length],
      ['Valor perdido', formatMoney(r.lostValue)],
      ['Taxa de conversão', formatPercent(r.conversion, 1)],
      ['Ticket médio', formatMoney(r.ticket)],
      ['Tempo médio até fechar (dias)', r.avgCycle === null ? '—' : r.avgCycle.toFixed(1)],
      ['Valor no funil', formatMoney(r.pipelineValue)],
      [],
      ['Origem', 'Leads']
    ];
    bySource(r.created).forEach((row) => rows.push([row.label, row.value]));
    rows.push([], ['Responsável', 'Leads', 'Ganhas', 'Valor']);
    byOwner(r).forEach((row) => rows.push([row.label, row.leads, row.won, formatMoney(row.value)]));

    downloadFile(
      `relatorio-${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(['Indicador', 'Valor'], rows)
    );
  });
}
