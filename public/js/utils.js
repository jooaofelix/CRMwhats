/** Utilitarios puros — sem dependencia de Firebase ou DOM global. */

import { appConfig } from './config.js';

/* -------------------------------------------------------------- texto ---- */

/** Escapa HTML. Use SEMPRE que injetar dado vindo do usuario em innerHTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Remove espacos extras e limita o tamanho — usado antes de gravar no banco. */
export function clean(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ').slice(0, max);
}

/** Igual a clean(), mas preserva quebras de linha (observacoes, mensagens). */
export function cleanMultiline(value, max = 4000) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim().slice(0, max);
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Remove acentos e caixa — base para busca local. */
export function norm(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function slugify(value) {
  return norm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/* ---------------------------------------------------------- telefones ---- */

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Monta o numero em formato E.164 sem "+" (o que a API do WhatsApp espera).
 * Aceita "(12) 99999-9999", "+55 12 99999-9999", "5512999999999".
 */
export function toWhatsAppNumber(raw, countryCode = appConfig.defaultCountryCode) {
  let digits = onlyDigits(raw);
  if (!digits) return '';
  // Remove zeros de discagem nacional/internacional.
  digits = digits.replace(/^0+/, '');
  if (digits.length <= 11) digits = String(countryCode) + digits;
  return digits.slice(0, 15);
}

/** Formata para exibicao em pt-BR: (12) 99999-9999 */
export function formatPhone(raw) {
  const d = onlyDigits(raw);
  if (!d) return '';
  let local = d;
  if (d.length > 11 && d.startsWith('55')) local = d.slice(2);
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  if (local.length === 9)  return `${local.slice(0, 5)}-${local.slice(5)}`;
  if (local.length === 8)  return `${local.slice(0, 4)}-${local.slice(4)}`;
  return raw ? String(raw) : '';
}

/** Link oficial para abrir a conversa (funciona no desktop e no celular). */
export function waLink(phone, message = '') {
  const number = toWhatsAppNumber(phone);
  if (!number) return '';
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${number}${text}`;
}

/* -------------------------------------------------------------- datas ---- */

export const DAY_MS = 86400000;

/** Converte Timestamp do Firestore, Date, numero ou ISO em Date (ou null). */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (typeof value.toDate === 'function') {
    try { return value.toDate(); } catch { return null; }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date); d.setHours(0, 0, 0, 0); return d;
}
export function endOfDay(date = new Date()) {
  const d = new Date(date); d.setHours(23, 59, 59, 999); return d;
}
export function startOfMonth(date = new Date()) {
  const d = new Date(date); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
}
export function addDays(date, days) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d;
}

export function isToday(value) {
  const d = toDate(value);
  return !!d && d >= startOfDay() && d <= endOfDay();
}

export function isOverdue(value) {
  const d = toDate(value);
  return !!d && d.getTime() < Date.now();
}

const dtf = (opts) => new Intl.DateTimeFormat(appConfig.locale, opts);

export function formatDate(value) {
  const d = toDate(value);
  return d ? dtf({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '—';
}
export function formatShortDate(value) {
  const d = toDate(value);
  return d ? dtf({ day: '2-digit', month: '2-digit' }).format(d) : '—';
}
export function formatTime(value) {
  const d = toDate(value);
  return d ? dtf({ hour: '2-digit', minute: '2-digit' }).format(d) : '';
}
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${formatDate(d)} às ${formatTime(d)}`;
}

/** "Hoje às 14:20", "Ontem às 09:00", "12/08 às 10:00". */
export function friendlyDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  const today = startOfDay();
  const diffDays = Math.round((startOfDay(d) - today) / DAY_MS);
  if (diffDays === 0) return `Hoje às ${formatTime(d)}`;
  if (diffDays === -1) return `Ontem às ${formatTime(d)}`;
  if (diffDays === 1) return `Amanhã às ${formatTime(d)}`;
  return `${formatShortDate(d)} às ${formatTime(d)}`;
}

/** "há 3 dias", "em 2 dias", "agora". */
export function relativeTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(appConfig.locale, { numeric: 'auto' });
  if (abs < 60000) return 'agora';
  if (abs < 3600000) return rtf.format(Math.round(diff / 60000), 'minute');
  if (abs < DAY_MS) return rtf.format(Math.round(diff / 3600000), 'hour');
  if (abs < 30 * DAY_MS) return rtf.format(Math.round(diff / DAY_MS), 'day');
  return rtf.format(Math.round(diff / (30 * DAY_MS)), 'month');
}

/** Dias inteiros decorridos desde a data (0 = hoje). */
export function daysSince(value) {
  const d = toDate(value);
  if (!d) return null;
  return Math.floor((startOfDay() - startOfDay(d)) / DAY_MS);
}

/** Valor para <input type="datetime-local">. */
export function toInputDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function toInputDate(value) {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Le valores de inputs date/datetime-local no fuso local. */
export function fromInputDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

/* ------------------------------------------------------------- moeda ---- */

const currencyFmt = new Intl.NumberFormat(appConfig.locale, {
  style: 'currency', currency: appConfig.currency, maximumFractionDigits: 2
});
const compactFmt = new Intl.NumberFormat(appConfig.locale, {
  style: 'currency', currency: appConfig.currency, notation: 'compact', maximumFractionDigits: 1
});

export function formatMoney(value) {
  const n = Number(value) || 0;
  return currencyFmt.format(n);
}
/** Versao curta para KPIs: R$ 42,8 mil */
export function formatMoneyCompact(value) {
  const n = Number(value) || 0;
  return Math.abs(n) >= 10000 ? compactFmt.format(n) : currencyFmt.format(n);
}
/** Aceita "2.500,00", "2500.00", "R$ 2.500" e devolve number. */
export function parseMoney(input) {
  if (typeof input === 'number') return isFinite(input) ? input : 0;
  let s = String(input || '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

export function formatPercent(value, digits = 0) {
  const n = Number(value) || 0;
  return `${n.toFixed(digits).replace('.', ',')}%`;
}

/* -------------------------------------------------------------- misc ---- */

export function debounce(fn, wait = 250) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function sum(items, valueFn = (x) => x) {
  return items.reduce((acc, item) => acc + (Number(valueFn(item)) || 0), 0);
}

/** Ordena por data (mais recente primeiro por padrao). */
export function byDate(field, dir = 'desc') {
  return (a, b) => {
    const da = toDate(a[field])?.getTime() ?? (dir === 'desc' ? -Infinity : Infinity);
    const db = toDate(b[field])?.getTime() ?? (dir === 'desc' ? -Infinity : Infinity);
    return dir === 'desc' ? db - da : da - db;
  };
}

/**
 * Substitui variaveis {{nome}} de um template de mensagem.
 * Variaveis desconhecidas viram string vazia (nunca deixa "{{x}}" na mensagem).
 */
export function renderTemplate(body, vars) {
  return String(body || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Parser de CSV tolerante (aspas, ; ou , como separador, quebras dentro de aspas). */
export function parseCSV(text) {
  const content = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = content.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
}

/** Gera CSV a partir de linhas (para exportar relatorios). */
export function toCSV(headers, rows) {
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(escapeCell).join(';')).join('\n');
}

export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Cor de texto legivel sobre um fundo hex. */
export function contrastColor(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? '#12151d' : '#ffffff';
}
