// Utilitários de interface: templates com escape, formatação, modais, formulários e avisos.
export const state = { meta: null, user: null };

/* ---------------- Templates seguros ---------------- */
class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s ?? ''));
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const val = (v) => {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
};
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += val(vals[i]);
  });
  return new Raw(out);
}
/**
 * Plural correto (manual, tom de voz): "1 tarefa", "2 tarefas" em vez de "tarefa(s)".
 * Usa o número mais próximo antes da palavra, no mesmo bloco de texto; sem número, mantém como está.
 */
const PLURAL_RE = /(?<![\wÀ-ÿ])(\d[\d.,]*)|([A-Za-zÀ-ÿ-]+)\((s|es|ões|eis|ns)\)/g;
const BLOCK_TAG = /^<\/?(li|div|p|td|th|tr|h\d|section|article|ul|ol|button|label|option|header|footer|br|hr|dt|dd)\b/i;
function pluralWord(base, suf, n) {
  if (n === 1) return base;
  if (suf === 'ões') return base.endsWith('ão') ? `${base.slice(0, -2)}ões` : `${base}ões`;
  if (suf === 'eis') return base.endsWith('il') ? `${base.slice(0, -2)}eis` : `${base}eis`;
  if (suf === 'ns') return base.endsWith('m') ? `${base.slice(0, -1)}ns` : `${base}ns`;
  return base + suf;
}
export function fixPlurals(str) {
  if (!str || str.indexOf('(') === -1) return str;
  let last = null;
  let skip = false;
  return String(str)
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<(textarea|pre|code)\b/i.test(part)) skip = true;
        else if (/^<\/(textarea|pre|code)>/i.test(part)) skip = false;
        if (BLOCK_TAG.test(part)) last = null;
        return part;
      }
      if (skip) return part;
      return part.replace(PLURAL_RE, (m, num, base, suf) => {
        if (num) {
          last = Number(num.replace(/\./g, '').replace(',', '.'));
          return m;
        }
        return last == null || Number.isNaN(last) ? m : pluralWord(base, suf, last);
      });
    })
    .join('');
}

export const render = (el, tpl) => {
  el.innerHTML = fixPlurals(val(tpl));
  return el;
};
export const $ = (sel, root = document) => root.querySelector(sel);
/** Substitui o elemento por uma cópia vazia (remove ouvintes de eventos acumulados). */
export function fresh(el) {
  const n = el.cloneNode(false);
  el.replaceWith(n);
  return n;
}
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegação de eventos: on(root, 'click', '[data-act=x]', fn) */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

/* ---------------- Formatação ---------------- */
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const fmtDate = (v) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('pt-BR') : '—');
export const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }) : '—';
export const fmtMoney = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const fmtNum = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR'));
export const fmtPct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export function fmtDuration(s) {
  if (s == null || s === '') return '—';
  s = Number(s);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export function relTime(v) {
  if (!v) return '—';
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  const abs = Math.abs(diff);
  const fut = diff < 0;
  const f = (n, u) => (fut ? `em ${n} ${u}` : `há ${n} ${u}`);
  if (abs < 60) return fut ? 'em instantes' : 'agora';
  if (abs < 3600) return f(Math.round(abs / 60), 'min');
  if (abs < 86400) return f(Math.round(abs / 3600), 'h');
  const d = Math.round(abs / 86400);
  return f(d, d === 1 ? 'dia' : 'dias');
}
export const toLocalInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '');

/* ---------------- Metadados ---------------- */
export const opts = (list, { all = false } = {}) => (state.meta?.options[list] || []).filter((o) => all || o.active);
export const optLabel = (list, v) => {
  if (v == null || v === '') return '—';
  return (state.meta?.options[list] || []).find((o) => o.value === v)?.label || v;
};
export const K = (group, v) => {
  const g = state.meta?.constants[group] || {};
  const item = g[v];
  if (item == null) return v ?? '—';
  return typeof item === 'object' ? item.label : item;
};
export const userName = (id) => state.meta?.users.find((u) => u.id === Number(id))?.name || '—';
export const productName = (id) => state.meta?.products.find((p) => p.id === Number(id))?.name || '—';
export const stageById = (id) => state.meta?.stages.find((s) => s.id === Number(id));
export const can = {
  write: () => state.user && state.user.role !== 'leitura',
  manage: () => ['admin', 'gestor'].includes(state.user?.role),
  admin: () => state.user?.role === 'admin',
};

/* ---------------- Componentes ---------------- */
export const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;
export const relBadge = (r) => badge(K('relationships', r), `rel-${r}`);
export const empty = (msg) => html`<div class="empty">${msg}</div>`;
export function optoutBadge(list) {
  if (!list || !list.length) return '';
  const txt = list.includes('todos') ? 'Não contatar' : `Não contatar: ${list.map((c) => K('contact_channels', c)).join(', ')}`;
  return badge(txt, 'danger');
}
export function statusIntegration(s, label) {
  const kind = { ativa: 'ok', em_teste: 'warn', pendente: 'muted', erro: 'danger', desativada: 'muted' }[s] || '';
  return badge(label || K('integration_status', s), kind);
}

export function selectOptions(list, value, { placeholder = 'Selecione…', allowEmpty = true } = {}) {
  const items = Array.isArray(list) ? list : [];
  return html`${allowEmpty ? html`<option value="">${placeholder}</option>` : ''}${items.map(
    (o) => html`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`,
  )}`;
}
export const toItems = (obj) => Object.entries(obj || {}).map(([value, label]) => ({ value, label: typeof label === 'object' ? label.label : label }));
export const userItems = () => (state.meta?.users || []).map((u) => ({ value: u.id, label: u.name }));
export const productItems = () => (state.meta?.products || []).filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }));
export const stageItems = () => (state.meta?.stages || []).map((s) => ({ value: s.id, label: s.name }));

/**
 * Campo de formulário. type: text,email,tel,number,date,datetime,textarea,select,checkbox,money
 */
export function field(f) {
  const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
  const cls = ['field', f.full ? 'full' : '', f.recommended && !f.value && f.value !== 0 ? 'recommended' : '', f.half ? 'half' : ''].join(' ');
  const req = f.required ? raw('required') : '';
  const common = html`id="${id}" name="${f.name}" ${req} ${f.disabled ? raw('disabled') : ''} ${f.placeholder ? html`placeholder="${f.placeholder}"` : ''}`;
  let input;
  switch (f.type) {
    case 'textarea':
      input = html`<textarea ${common} rows="${f.rows || 3}">${f.value ?? ''}</textarea>`;
      break;
    case 'select':
      input = html`<select ${common}>${selectOptions(f.options, f.value, { placeholder: f.placeholder || 'Selecione…', allowEmpty: f.allowEmpty !== false })}</select>`;
      break;
    case 'checkbox':
      return html`<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${f.value ? raw('checked') : ''} ${f.disabled ? raw('disabled') : ''}> ${f.label}</label>`;
    case 'datetime':
      input = html`<input type="datetime-local" ${common} value="${toLocalInput(f.value)}">`;
      break;
    case 'money':
    case 'number':
      input = html`<input type="number" step="${f.step || (f.type === 'money' ? '0.01' : 'any')}" min="${f.min ?? ''}" ${common} value="${f.value ?? ''}">`;
      break;
    default:
      input = html`<input type="${f.type || 'text'}" ${common} value="${f.value ?? ''}" ${f.maxlength ? html`maxlength="${f.maxlength}"` : ''}>`;
  }
  return html`<div class="${cls}"><label for="${id}">${f.label}${f.required ? html` <span class="req">*</span>` : ''}${f.recommended ? html` <span class="rec" title="Campo recomendado">recomendado</span>` : ''}${f.sale ? html` <span class="rec sale" title="Obrigatório para concluir a venda">venda</span>` : ''}</label>${input}${f.help ? html`<small>${f.help}</small>` : ''}</div>`;
}

/** Lê um formulário para objeto. Campos datetime-local são convertidos para ISO. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    }
    else if (el.type === 'datetime-local') out[el.name] = fromLocalInput(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

/* ---------------- Avisos ---------------- */
export function toast(msg, kind = 'ok') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = fixPlurals(msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add('hide'), kind === 'error' ? 6000 : 3500);
  setTimeout(() => t.remove(), kind === 'error' ? 6600 : 4000);
}
export const toastError = (e) => toast(e?.message || String(e), 'error');

/* ---------------- Modal ---------------- */
/**
 * Abre um modal com formulário. onSubmit(data, form) pode lançar erro (exibido no próprio modal).
 * Retorna uma Promise resolvida com o resultado de onSubmit ou null se cancelado.
 */
export function modal({ title, body, submitLabel = 'Salvar', onSubmit, wide = false, cancelLabel = 'Cancelar', danger = false, onMount }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = fixPlurals(val(html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <form novalidate>
        <header><h2>${title}</h2><button type="button" class="icon" data-close aria-label="Fechar">×</button></header>
        <div class="modal-body">${body}</div>
        <div class="modal-error" hidden></div>
        <footer>
          <button type="button" class="btn ghost" data-close>${onSubmit ? cancelLabel : 'Fechar'}</button>
          ${onSubmit ? html`<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${submitLabel}</button>` : ''}
        </footer>
      </form></div>`));
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const errBox = wrap.querySelector('.modal-error');
    const close = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', esc);
      resolve(v);
    };
    const esc = (e) => e.key === 'Escape' && close(null);
    document.addEventListener('keydown', esc);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) close(null);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return close(null);
      const invalid = [...form.elements].find((el) => el.required && !el.value && el.type !== 'checkbox');
      if (invalid) {
        errBox.hidden = false;
        errBox.textContent = `Preencha o campo obrigatório: ${invalid.closest('.field')?.querySelector('label')?.childNodes[0]?.textContent?.trim() || invalid.name}.`;
        invalid.focus();
        return;
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      errBox.hidden = true;
      try {
        const r = await onSubmit(formData(form), form, errBox);
        if (r !== false) close(r ?? true);
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = err.message || String(err);
      } finally {
        btn.disabled = false;
      }
    });
    if (onMount) onMount(form, close);
    const first = form.querySelector('input:not([type=hidden]):not([data-nofocus]),select:not([data-nofocus]),textarea:not([data-nofocus])');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmDialog(title, message, { danger = false, confirmLabel = 'Confirmar' } = {}) {
  const r = await modal({ title, body: html`<p>${message}</p>`, submitLabel: confirmLabel, danger, onSubmit: () => true });
  return !!r;
}

/* ---------------- Tabela simples ---------------- */
export function table(columns, rows, { rowAttr, emptyMsg = 'Nenhum registro encontrado.' } = {}) {
  if (!rows.length) return empty(emptyMsg);
  return html`<div class="table-wrap"><table>
    <thead><tr>${columns.map((c) => html`<th class="${c.cls || ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr ${rowAttr ? raw(rowAttr(r)) : ''}>${columns.map((c) => html`<td class="${c.cls || ''}" data-label="${typeof c.label === 'string' ? c.label : ''}">${c.render ? c.render(r) : r[c.key] ?? '—'}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

export function pager(total, page, limit) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return html`<div class="pager"><span>${total} registro(s)</span></div>`;
  return html`<div class="pager"><span>${total} registro(s) · página ${page} de ${pages}</span>
    <button class="btn small ghost" data-page="${page - 1}" ${page <= 1 ? raw('disabled') : ''}>Anterior</button>
    <button class="btn small ghost" data-page="${page + 1}" ${page >= pages ? raw('disabled') : ''}>Próxima</button></div>`;
}

/** Converte período rápido em {from,to} ISO. */
export function periodRange(key, custom = {}) {
  const now = new Date();
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let from;
  let to = now;
  switch (key) {
    case 'hoje':
      from = start(now);
      break;
    case '7d':
      from = new Date(start(now).getTime() - 6 * 86400000);
      break;
    case 'mes':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'mes_anterior':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, -1);
      break;
    case '90d':
      from = new Date(start(now).getTime() - 89 * 86400000);
      break;
    case 'ano':
      from = new Date(now.getFullYear(), 0, 1);
      break;
    case 'custom':
      from = custom.from ? new Date(`${custom.from}T00:00:00`) : new Date(start(now).getTime() - 29 * 86400000);
      to = custom.to ? new Date(`${custom.to}T23:59:59.999`) : now;
      break;
    default:
      from = new Date(start(now).getTime() - 29 * 86400000);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
export const PERIODS = [
  { value: 'hoje', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_anterior', label: 'Mês anterior' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'ano', label: 'Este ano' },
  { value: 'custom', label: 'Personalizado' },
];

/** Barra de filtros padrão (período, usuário, origem, etapa, produto, status). */
export function filterBar(values = {}, { show = ['period', 'owner', 'origin', 'stage', 'product', 'status'] } = {}) {
  return html`<form class="filters" data-filters>
    ${show.includes('period') ? html`<label>Período<select name="period">${selectOptions(PERIODS, values.period || '30d', { allowEmpty: false })}</select></label>
      <label class="custom-range" ${values.period === 'custom' ? '' : raw('hidden')}>De<input type="date" name="cfrom" value="${values.cfrom || ''}"></label>
      <label class="custom-range" ${values.period === 'custom' ? '' : raw('hidden')}>Até<input type="date" name="cto" value="${values.cto || ''}"></label>` : ''}
    ${show.includes('owner') ? html`<label>Usuário<select name="owner_id">${selectOptions(userItems(), values.owner_id, { placeholder: 'Todos' })}</select></label>` : ''}
    ${show.includes('origin') ? html`<label>Origem<select name="origin">${selectOptions(opts('origem'), values.origin, { placeholder: 'Todas' })}</select></label>` : ''}
    ${show.includes('stage') ? html`<label>Etapa<select name="stage_id">${selectOptions(stageItems(), values.stage_id, { placeholder: 'Todas' })}</select></label>` : ''}
    ${show.includes('product') ? html`<label>Produto<select name="product_id">${selectOptions(productItems(), values.product_id, { placeholder: 'Todos' })}</select></label>` : ''}
    ${show.includes('status') ? html`<label>Status<select name="status">${selectOptions(toItems(state.meta.constants.opp_status), values.status, { placeholder: 'Todos' })}</select></label>` : ''}
  </form>`;
}
export function readFilters(form) {
  const d = Object.fromEntries(new FormData(form).entries());
  $$('.custom-range', form).forEach((el) => (el.hidden = d.period !== 'custom'));
  const range = d.period ? periodRange(d.period, { from: d.cfrom, to: d.cto }) : {};
  return { values: d, query: { ...range, owner_id: d.owner_id, origin: d.origin, stage_id: d.stage_id, product_id: d.product_id, status: d.status } };
}

/** Subnavegação dentro de um item do menu (ex.: CRM › Funil | Leads | Atividades). items: [[href, rótulo, chave]] */
export function subnav(items, active) {
  return html`<nav class="subnav">${items.map(([href, label, key]) => html`<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`)}</nav>`;
}
export const crmTabs = (active) =>
  subnav(
    [
      ['#/funil', 'Funil de vendas', 'funil'],
      ['#/leads', 'Leads e prospects', 'leads'],
      ['#/atividades', 'Ligações e atividades', 'atividades'],
    ],
    active,
  );
export const hasModule = (m) => (state.user?.modules || []).includes(m);
/** Mês atual no formato AAAA-MM e rótulo por extenso. */
export const monthLabel = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

/** Foto do usuário (ou iniciais, quando não houver foto). size: px. */
export function avatar(u, size = 32) {
  const initials = String(u?.name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const hue = [...String(u?.name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  if (u?.photo) return html`<img class="avatar" src="${u.photo}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px">`;
  return html`<span class="avatar initials" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:hsl(${hue} 45% 42%)">${initials}</span>`;
}

/** Valor curto para espaços pequenos (manual, tom de voz): R$ 1,4 mi · R$ 247,9 mil. */
export function fmtMoneyShort(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  const f = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (Math.abs(n) >= 1e6) return `R$ ${f(n / 1e6)} mi`;
  if (Math.abs(n) >= 1e4) return `R$ ${f(n / 1e3)} mil`;
  return fmtMoney(n);
}
