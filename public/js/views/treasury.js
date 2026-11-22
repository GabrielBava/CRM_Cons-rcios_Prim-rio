// Financeiro da empresa: visão geral do caixa (administrador), contas a pagar, contas a receber e cadastros.
// Cada lançamento (título) tem uma ou mais ocorrências: pontual, parcelada, recorrente ou assinatura.
import { get, post, patch } from '../api.js';
import { html, raw, render, $, $$, on, fresh, state, selectOptions, userItems, table, badge, fmtMoney, fmtMoneyShort, fmtDate, fmtDateTime, relTime, modal, field, toast, toastError, empty, subnav, hasModule, fmtMoneyInput, moneyValue, todayLocal } from '../ui.js';
import { fileToBase64 } from './record-tabs.js';
import { icon } from '../icons.js';

const DIR = {
  pagar: { title: 'Contas a pagar', one: 'despesa', new: 'Nova despesa', partner: 'Fornecedor ou parceiro', settle: 'Pagar', settled: 'Pago', account: 'Conta de saída', done: 'pagamento', doneMonth: 'Pago no mês' },
  receber: { title: 'Contas a receber', one: 'receita', new: 'Nova receita', partner: 'Instituição pagadora', settle: 'Receber', settled: 'Recebido', account: 'Conta de entrada', done: 'recebimento', doneMonth: 'Recebido no mês' },
};
const KINDS = { pontual: 'Pontual (spot)', parcelada: 'Parcelada', recorrente: 'Recorrente', assinatura: 'Assinatura' };
const SIT = { aberto: ['Em aberto', ''], atrasado: ['Atrasado', 'danger'], pago: ['Pago', 'ok'], cancelado: ['Cancelado', 'muted'] };
const sitBadge = (i, dir) => badge(i.situation === 'pago' ? DIR[dir].settled : SIT[i.situation]?.[0] || i.situation, SIT[i.situation]?.[1] || '');
const NOTE_KIND = { observacao: 'Observação', atraso: 'Motivo do atraso', alteracao: 'Alteração', baixa: 'Baixa', estorno: 'Estorno', arquivo: 'Arquivo', rateio: 'Rateio', cancelamento: 'Cancelamento', renovacao: 'Renovação' };
const FILE_KIND = { comprovante: 'Comprovante', boleto: 'Boleto', nota_fiscal: 'Nota fiscal', contrato: 'Contrato', outro: 'Outro' };
const monthName = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');

let cat = null;
const loadCatalogs = async () => (cat = await get('/api/financeiro/cadastros'));
const items = (list, label = (x) => x.name) => list.map((x) => ({ value: x.id, label: label(x) }));
const finModule = () => hasModule('financeiro');

/** Lê o arquivo de um lançamento (com o cabeçalho da sessão) e abre em outra aba. */
async function openFile(id) {
  try {
    const res = await fetch(`/api/financeiro/arquivos/${id}`, { headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
    window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
  } catch (e) {
    toastError(e);
  }
}
const readFile = async (input) => {
  const f = input?.files?.[0];
  if (!f) return {};
  if (f.size > 8 * 1024 * 1024) throw new Error('Arquivo maior que 8 MB.');
  return { filename: f.name, mime: f.type, content_base64: await fileToBase64(f) };
};
const fileInput = (name = 'file', label = 'Comprovante', required = false) => html`<div class="field"><label>${label}${required ? html` <span class="req">*</span>` : ''}</label><input type="file" name="${name}" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xml,.xlsx,.xls,.csv,.doc,.docx"><small>PDF ou imagem, até 8 MB.</small></div>`;

/** Select de categoria agrupado (Pessoal, Estrutura, Tecnologia…). */
function categorySelect(dir, value, name = 'category_id') {
  const list = cat.categorias.filter((c) => c.direction === dir);
  const groups = [...new Set(list.map((c) => c.group_name || 'Outras'))];
  return html`<select name="${name}" required><option value="">Selecione…</option>${groups.map((g) => html`<optgroup label="${g}">${list.filter((c) => (c.group_name || 'Outras') === g).map((c) => html`<option value="${c.id}" ${String(c.id) === String(value ?? '') ? raw('selected') : ''}>${c.name}</option>`)}</optgroup>`)}</select>`;
}
const partnerItems = (dir) => items(cat.parceiros.filter((p) => p.kind === 'ambos' || p.kind === (dir === 'pagar' ? 'fornecedor' : 'pagador')));

/* =========================================================================
   Entrada
   ========================================================================= */

export async function show(view, { id, params = {} }) {
  await loadCatalogs();
  const admin = state.user.role === 'admin';
  const mod = finModule();
  let tab = id || (admin && mod ? 'visao' : 'pagar');
  if (tab === 'visao' && !admin) tab = 'pagar';
  if (tab === 'cadastros' && !mod) tab = 'pagar';
  const tabs = [...(admin && mod ? [['#/financeiro', 'Visão geral', 'visao']] : []), ['#/financeiro/pagar', 'Contas a pagar', 'pagar'], ['#/financeiro/receber', 'Contas a receber', 'receber'], ...(mod ? [['#/financeiro/cadastros', 'Cadastros', 'cadastros']] : [])];
  render(view, html`<div class="page wide fin-page">
    <div class="page-head"><div><h1>Financeiro</h1><p class="muted">${mod ? 'Caixa da empresa: despesas, receitas, contas bancárias e cadastros.' : 'Lançamentos sob a sua responsabilidade: pague ou receba, anexe o comprovante e explique atrasos.'}</p></div></div>
    ${subnav(tabs, tab)}
    <div id="tab"></div></div>`);
  const box = fresh($('#tab', view));
  if (tab === 'visao') return overviewTab(box);
  if (tab === 'cadastros') return catalogTab(box, params);
  return listTab(box, tab, params);
}

/* =========================================================================
   Visão geral (somente administrador)
   ========================================================================= */

async function overviewTab(box) {
  box = fresh(box);
  const d = await get('/api/financeiro/visao-geral');
  const m = d.mes;
  const block = (dir) => {
    const s = d[dir];
    const cfg = DIR[dir];
    const row = (i, paid) => html`<li><a href="#" data-title="${i.title_id}"><strong>${i.description}</strong></a> <small class="muted">${i.code}${i.total_installments ? ` · ${i.number}/${i.total_installments}` : ''}</small>
      <span class="fin-mini-val">${fmtMoney(paid ? i.paid_amount : i.amount)}</span><br><small class="${!paid && i.situation === 'atrasado' ? 'danger-text' : 'muted'}">${paid ? `${cfg.settled.toLowerCase()} em ${fmtDate(i.paid_at)}` : `vence ${fmtDate(i.due_date)}${i.situation === 'atrasado' ? ` · ${i.days_late} dia(s) de atraso` : ''}`}${i.partner_name ? ` · ${i.partner_name}` : ''}</small></li>`;
    return html`<section class="card fin-block">
      <div class="section-head"><h3>${icon(dir === 'pagar' ? 'saida' : 'entrada', 18)} ${cfg.title}</h3><a class="btn small" href="#/financeiro/${dir}">Abrir ${cfg.title.toLowerCase()} ${icon('avancar', 14)}</a></div>
      <div class="fin-mini-kpis">
        <a href="#/financeiro/${dir}"><span>Até o fim do mês</span><strong>${fmtMoneyShort(s.ate_fim_mes.v)}</strong><small>${s.ate_fim_mes.n} lançamento(s) em aberto</small></a>
        <a href="#/financeiro/${dir}?status=atrasado" class="${s.atrasado.n ? 'late' : ''}"><span>Atrasado</span><strong>${fmtMoneyShort(s.atrasado.v)}</strong><small>${s.atrasado.n} lançamento(s)${s.atrasado.sem_motivo ? ` · ${s.atrasado.sem_motivo} sem motivo` : ''}</small></a>
        <a href="#/financeiro/${dir}"><span>Próximos 30 dias</span><strong>${fmtMoneyShort(s.proximos_30_dias)}</strong><small>7 dias: ${fmtMoneyShort(s.proximos_7_dias.v)}</small></a>
        <a href="#/financeiro/${dir}?status=pago"><span>${cfg.doneMonth}</span><strong>${fmtMoneyShort(s.realizado_mes.v)}</strong><small>previsto ${fmtMoneyShort(s.previsto_mes.v)}</small></a>
      </div>
      <div class="cols fin-lists">
        <div><h4>Próximos vencimentos</h4>${s.proximos.length ? html`<ul class="fin-mini">${s.proximos.map((i) => row(i, false))}</ul>` : empty('Nada em aberto.')}</div>
        <div><h4>Últimas operações</h4>${s.recentes.length ? html`<ul class="fin-mini">${s.recentes.map((i) => row(i, true))}</ul>` : empty(`Nenhum ${cfg.done} registrado.`)}</div>
      </div></section>`;
  };
  const maxCat = Math.max(1, ...d.despesas_por_categoria.map((c) => c.v));
  const lvlTag = { danger: ['Urgente', 'danger'], warn: ['Atenção', 'warn'], info: ['Aviso', ''], muted: ['Aviso', 'muted'] };
  render(box, html`
    <div class="kpis small fin-kpis">
      <div class="kpi"><div class="kpi-label">Saldo atual</div><div class="kpi-value ${d.saldo < 0 ? 'danger-text' : ''}">${fmtMoneyShort(d.saldo)}</div><div class="kpi-sub">${fmtMoney(d.saldo)} em ${d.accounts.length} conta(s)</div></div>
      <div class="kpi"><div class="kpi-label">Resultado do mês</div><div class="kpi-value ${m.resultado < 0 ? 'danger-text' : 'ok-text'}">${fmtMoneyShort(m.resultado)}</div><div class="kpi-sub">entradas ${fmtMoneyShort(m.entradas)} · saídas ${fmtMoneyShort(m.saidas)}</div></div>
      <a class="kpi" href="#/financeiro/pagar"><div class="kpi-label">A pagar até o fim do mês</div><div class="kpi-value">${fmtMoneyShort(d.pagar.ate_fim_mes.v)}</div><div class="kpi-sub">${d.pagar.atrasado.n ? html`<span class="danger-text">${fmtMoneyShort(d.pagar.atrasado.v)} atrasado</span> · ` : ''}${d.pagar.ate_fim_mes.n} lançamento(s)</div></a>
      <a class="kpi" href="#/financeiro/receber"><div class="kpi-label">A receber até o fim do mês</div><div class="kpi-value">${fmtMoneyShort(d.receber.ate_fim_mes.v)}</div><div class="kpi-sub">${d.receber.atrasado.n ? html`<span class="danger-text">${fmtMoneyShort(d.receber.atrasado.v)} atrasado</span> · ` : ''}${d.receber.ate_fim_mes.n} lançamento(s)</div></a>
      <div class="kpi ${d.saldo_projetado_30_dias < 0 ? 'alert-kpi' : ''}"><div class="kpi-label">Saldo projetado em 30 dias</div><div class="kpi-value">${fmtMoneyShort(d.saldo_projetado_30_dias)}</div><div class="kpi-sub">saldo + a receber − a pagar</div></div>
    </div>
    <div class="cols">
      <section class="card"><div class="section-head"><h3>Alertas financeiros</h3>${d.alerts.length ? html`<span class="count">${d.alerts.length} ${d.alerts.length === 1 ? 'item' : 'itens'}</span>` : ''}</div>
        ${d.alerts.length ? html`<ul class="actions-list">${d.alerts.slice(0, 12).map((a) => html`<li class="lvl-${a.level === 'muted' ? 'muted' : a.level}"><span class="dot"></span>
          <span class="grow">${a.title_id ? html`<a href="#" data-title="${a.title_id}">${a.text}</a>` : a.filter ? html`<a href="#/financeiro/${a.direction}?status=${a.filter}">${a.text}</a>` : a.text}${a.responsible ? html`<br><small class="muted">Responsável: ${a.responsible}</small>` : ''}${a.level === 'danger' && a.title_id ? html`<br><small class="${a.reason ? '' : 'warn-text'}">${a.reason ? `Motivo: ${a.reason}` : 'Motivo do atraso ainda não informado'}</small>` : ''}</span>
          ${badge(lvlTag[a.level][0], lvlTag[a.level][1])}</li>`)}</ul>` : empty('Nenhum alerta: contas em dia.')}</section>
      <section class="card"><h3>Contas bancárias</h3>
        <ul class="fin-accounts">${d.accounts.map((a) => html`<li><div><strong>${a.name}</strong><br><small class="muted">${a.bank || (a.type === 'caixa' ? 'Dinheiro em caixa' : '—')}</small></div><div class="num"><strong class="${a.saldo < 0 ? 'danger-text' : ''}">${fmtMoney(a.saldo)}</strong><br><small class="muted">+${fmtMoneyShort(a.entradas)} / −${fmtMoneyShort(a.saidas)}</small></div></li>`)}</ul>
        <h4>Últimos 6 meses (realizado)</h4>
        <table class="compact fin-months"><thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th></tr></thead>
          <tbody>${d.meses.map((x) => html`<tr><td>${monthName(x.month)}</td><td class="num">${fmtMoneyShort(x.entradas)}</td><td class="num">${fmtMoneyShort(x.saidas)}</td><td class="num ${x.resultado < 0 ? 'danger-text' : 'ok-text'}">${fmtMoneyShort(x.resultado)}</td></tr>`)}</tbody></table>
        ${d.despesas_por_categoria.length ? html`<h4>Despesas do mês por categoria</h4><div class="bars">${d.despesas_por_categoria.map((c) => html`<div class="bar-row"><span class="bar-label" title="${c.name}">${c.name || 'Sem categoria'}</span><span class="bar"><span class="bar-fill" style="width:${(c.v / maxCat) * 100}%"></span></span><span class="bar-val">${fmtMoneyShort(c.v)}</span></div>`)}</div>` : ''}
      </section>
    </div>
    ${block('pagar')}
    ${block('receber')}`);
  on(box, 'click', '[data-title]', (e, a) => {
    e.preventDefault();
    titleDetail(Number(a.dataset.title), () => overviewTab(box));
  });
}

/* =========================================================================
   Contas a pagar / a receber
   ========================================================================= */

const saved = { pagar: { status: 'pendentes' }, receber: { status: 'pendentes' } };

async function listTab(box, dir, params) {
  const cfg = DIR[dir];
  const mod = finModule();
  if (params.status) saved[dir] = { ...saved[dir], status: params.status };
  let view = params.visao === 'competencia' && dir === 'receber' ? 'competencia' : 'lista';
  const load = async () => {
    if (view === 'competencia') return competenceView(box);
    let d;
    try {
      d = await get('/api/financeiro/lancamentos', { direcao: dir, ...saved[dir] });
    } catch (e) {
      return render(box, html`<div class="alert danger">${e.message}</div>`);
    }
    const s = d.summary;
    const f = saved[dir];
    render(box, html`
      <div class="page-actions">${mod ? html`<button class="btn primary" data-act="new">${icon('adicionar', 16)}${cfg.new}</button>` : ''}${dir === 'receber' && mod ? html`<button class="btn" data-act="comp">Por competência (rateio)</button>` : ''}</div>
      <div class="kpis small">
        <a class="kpi" href="#" data-st="pendentes"><div class="kpi-label">${dir === 'pagar' ? 'A pagar' : 'A receber'} até o fim do mês</div><div class="kpi-value">${fmtMoneyShort(s.ate_fim_mes.v)}</div><div class="kpi-sub">${s.ate_fim_mes.n} lançamento(s) · ${fmtMoneyShort(s.aberto.v)} em aberto no total</div></a>
        <a class="kpi ${s.atrasado.n ? 'alert-kpi' : ''}" href="#" data-st="atrasado"><div class="kpi-label">Atrasado</div><div class="kpi-value">${fmtMoneyShort(s.atrasado.v)}</div><div class="kpi-sub">${s.atrasado.n} lançamento(s)${s.atrasado.sem_motivo ? ` · ${s.atrasado.sem_motivo} sem motivo` : ''}</div></a>
        <a class="kpi" href="#" data-st="aberto"><div class="kpi-label">Próximos 7 dias</div><div class="kpi-value">${fmtMoneyShort(s.proximos_7_dias.v)}</div><div class="kpi-sub">${s.proximos_7_dias.n} lançamento(s)</div></a>
        <a class="kpi" href="#" data-st="pago"><div class="kpi-label">${cfg.doneMonth}</div><div class="kpi-value">${fmtMoneyShort(s.realizado_mes.v)}</div><div class="kpi-sub">previsto no mês ${fmtMoneyShort(s.previsto_mes.v)}</div></a>
        <a class="kpi ${s.sem_comprovante ? 'alert-kpi' : ''}" href="#" data-st="sem_comprovante"><div class="kpi-label">Sem comprovante</div><div class="kpi-value">${s.sem_comprovante}</div><div class="kpi-sub">${cfg.settled.toLowerCase()}s sem arquivo</div></a>
      </div>
      <form class="filters" data-f>
        <label>Situação<select name="status">${selectOptions([{ value: 'pendentes', label: 'Atrasados e próximos 30 dias' }, { value: 'atrasado', label: 'Atrasados' }, { value: 'aberto', label: 'A vencer (todos)' }, { value: 'abertos', label: 'Todos em aberto' }, { value: 'pago', label: `${cfg.settled}s` }, { value: 'sem_comprovante', label: `${cfg.settled}s sem comprovante` }, { value: 'cancelado', label: 'Cancelados' }, { value: 'todos', label: 'Todos' }], f.status, { allowEmpty: false })}</select></label>
        <label>Categoria<select name="categoria">${selectOptions(items(cat.categorias.filter((c) => c.direction === dir)), f.categoria, { placeholder: 'Todas' })}</select></label>
        <label>Centro de custo<select name="centro">${selectOptions(items(cat.centros), f.centro, { placeholder: 'Todos' })}</select></label>
        <label>${cfg.partner}<select name="parceiro">${selectOptions(partnerItems(dir), f.parceiro, { placeholder: 'Todos' })}</select></label>
        ${mod ? html`<label>Responsável<select name="responsavel">${selectOptions(userItems(), f.responsavel, { placeholder: 'Todos' })}</select></label>` : ''}
        <label>Tipo<select name="tipo">${selectOptions(Object.entries(KINDS).map(([value, label]) => ({ value, label })), f.tipo, { placeholder: 'Todos' })}</select></label>
        <label>Mês<input type="month" name="mes" value="${f.mes || ''}"></label>
        <label class="grow">Buscar<input type="search" name="q" value="${f.q || ''}" placeholder="Descrição, código (${dir === 'pagar' ? 'CP' : 'CR'}-…), ${dir === 'pagar' ? 'fornecedor' : 'pagador'} ou nº da nota"></label>
      </form>
      <section class="card">${table(
        [
          { label: 'Vencimento', render: (i) => html`<strong class="${i.situation === 'atrasado' ? 'danger-text' : ''}">${fmtDate(i.due_date)}</strong>${i.situation === 'atrasado' ? html`<br><small class="danger-text">${i.days_late} dia(s) de atraso</small>` : i.situation === 'pago' ? html`<br><small class="muted">${cfg.settled.toLowerCase()} ${fmtDate(i.paid_at)}</small>` : html`<br><small class="muted">${relTime(`${i.due_date}T12:00:00`)}</small>`}` },
          { label: 'Descrição', cls: 'fin-desc', render: (i) => html`<a href="#" data-title="${i.title_id}" title="Abrir detalhes"><strong>${i.description}</strong></a><br><small class="muted">${i.code} · ${i.kind === 'parcelada' ? `parcela ${i.number}/${i.total_installments}` : i.kind === 'pontual' ? 'pontual' : `${KINDS[i.kind].toLowerCase()} ${i.periodicity || ''}`}${i.invoice_number ? ` · ${dir === 'pagar' ? 'doc.' : 'NF'} ${i.invoice_number}` : ''}${i.notes_count ? ` · ${i.notes_count} obs.` : ''}</small>` },
          { label: cfg.partner, render: (i) => i.partner_name || '—' },
          { label: 'Categoria', render: (i) => html`${i.category_name || '—'}${i.cost_center_name ? html`<br><small class="muted">${i.cost_center_name}</small>` : ''}` },
          { label: 'Forma / conta', render: (i) => html`${i.method_name || '—'}${i.account_name ? html`<br><small class="muted">${i.account_name}</small>` : ''}` },
          { label: 'Responsável', render: (i) => i.responsible_name || '—' },
          { label: 'Valor', cls: 'num', render: (i) => html`<strong>${fmtMoney(i.situation === 'pago' ? i.paid_amount : i.amount)}</strong>` },
          { label: 'Situação', render: (i) => html`${sitBadge(i, dir)}${i.situation === 'pago' ? (i.file_id ? html`<br><a href="#" class="small" data-file="${i.file_id}">${icon('anexo', 13)} comprovante</a>` : html`<br><small class="warn-text">sem comprovante</small>`) : ''}${i.situation === 'atrasado' ? (i.late_reason ? html`<br><small class="muted" title="${i.late_reason}">motivo informado</small>` : html`<br><small class="warn-text">sem motivo</small>`) : ''}` },
          {
            label: '',
            cls: 'fin-act',
            render: (i) => html`<div class="row-actions">${i.status === 'aberto' ? html`<button class="btn small primary" data-settle="${i.id}">${cfg.settle}</button>` : ''}${i.situation === 'atrasado' ? html`<button class="btn small" data-late="${i.id}">${i.late_reason ? 'Atualizar motivo' : 'Motivo do atraso'}</button>` : ''}${i.situation === 'pago' && !i.file_id ? html`<button class="btn small" data-proof="${i.id}" data-t="${i.title_id}">Anexar comprovante</button>` : ''}<button class="btn small ghost" data-title="${i.title_id}">Detalhes</button></div>`,
          },
        ],
        d.rows,
        { emptyMsg: f.status === 'pendentes' ? `Nenhuma ${cfg.one} atrasada ou vencendo nos próximos 30 dias.` : 'Nenhum lançamento com esses filtros.' },
      )}</section>
      ${dir === 'pagar' ? html`<p class="hint">Despesa pontual, parcelada (informe as parcelas e os valores), recorrente ou assinatura (mensal ou anual, com ciclo de renovação). Atrasos avisam o responsável e o administrador; o responsável informa o motivo.</p>` : html`<p class="hint">Informe a instituição pagadora, o motivo (comissão, intermediação, bonificação…) e a conta de entrada. Notas que pagam vários meses podem ser rateadas por competência em Detalhes › Rateio: o rateio só informa a competência, não altera o caixa nem meses fechados.</p>`}`);
    const form = $('[data-f]', box);
    let t;
    const read = () => (saved[dir] = Object.fromEntries(new FormData(form).entries()));
    form.addEventListener('change', (e) => e.target.name !== 'q' && (read(), load()));
    form.addEventListener('input', (e) => {
      if (e.target.name !== 'q') return;
      clearTimeout(t);
      t = setTimeout(() => (read(), load()), 300);
    });
    form.addEventListener('submit', (e) => e.preventDefault());
  };
  on(box, 'click', '[data-st]', (e, a) => {
    e.preventDefault();
    saved[dir] = { ...saved[dir], status: a.dataset.st };
    load();
  });
  on(box, 'click', '[data-act=new]', async () => (await titleForm(dir)) && load());
  on(box, 'click', '[data-act=comp]', () => ((view = 'competencia'), load()));
  on(box, 'click', '[data-act=back]', () => ((view = 'lista'), load()));
  on(box, 'click', '[data-title]', (e, a) => {
    e.preventDefault();
    titleDetail(Number(a.dataset.title), load);
  });
  on(box, 'click', '[data-file]', (e, a) => (e.preventDefault(), openFile(a.dataset.file)));
  on(box, 'click', '[data-settle]', async (e, b) => (await settleForm(Number(b.dataset.settle), dir)) && load());
  on(box, 'click', '[data-late]', async (e, b) => (await lateForm(Number(b.dataset.late))) && load());
  on(box, 'click', '[data-proof]', async (e, b) => (await uploadForm(Number(b.dataset.t), Number(b.dataset.proof), 'comprovante')) && load());
  await load();
}

/* ------------------------- Formulário do lançamento ------------------------- */

export function titleForm(dir, t = null) {
  const cfg = DIR[dir];
  const editing = !!t;
  const v = t || { kind: 'pontual', periodicity: 'mensal', auto_renew: 1, account_id: cat.contas[0]?.id, responsible_id: state.user.id, first_due: todayLocal() };
  const kindSeg = html`<div class="seg full" role="radiogroup" aria-label="Tipo">${Object.entries(KINDS).map(([k, l]) => html`<label><input type="radio" name="kind" value="${k}" ${v.kind === k ? raw('checked') : ''} ${editing ? raw('disabled') : ''}> ${l}</label>`)}</div>`;
  return modal({
    title: editing ? `Editar ${t.code}` : cfg.new,
    wide: true,
    body: html`${editing ? html`<p class="small muted">${KINDS[t.kind]}${t.periodicity ? ` ${t.periodicity}` : ''}. Valores e vencimentos de cada ocorrência são ajustados em Detalhes.</p>` : kindSeg}
      <div class="grid">
        ${field({ name: 'description', label: 'Descrição', value: v.description, required: true, full: true, placeholder: dir === 'pagar' ? 'ex.: Aluguel da sala comercial' : 'ex.: Comissões de setembro — Administradora X' })}
        ${field({ name: 'partner_id', label: cfg.partner, type: 'select', options: partnerItems(dir), value: v.partner_id, placeholder: 'Selecione ou cadastre em Cadastros' })}
        <div class="field"><label>${dir === 'pagar' ? 'Categoria da despesa' : 'Motivo (categoria)'} <span class="req">*</span></label>${categorySelect(dir, v.category_id)}</div>
        ${field({ name: 'cost_center_id', label: 'Centro de custo', type: 'select', options: items(cat.centros), value: v.cost_center_id })}
        ${field({ name: 'responsible_id', label: 'Responsável', type: 'select', options: userItems(), value: v.responsible_id, allowEmpty: false, help: 'Recebe os lembretes e os avisos de atraso.' })}
        ${field({ name: 'payment_method_id', label: 'Forma de pagamento', type: 'select', options: items(cat.formas), value: v.payment_method_id })}
        ${field({ name: 'account_id', label: cfg.account, type: 'select', options: items(cat.contas), value: v.account_id })}
        ${editing ? '' : html`
          <h4 class="full qual-form-title">Valor e vencimento<small data-kind-help></small></h4>
          <div class="cond" data-k="pontual">${field({ name: 'total_value', label: 'Valor (R$)', type: 'money', min: 0 })}</div>
          <div class="cond" data-k="parcelada">${field({ name: 'installments', label: 'Quantidade de parcelas', type: 'number', min: 2, step: 1 })}${field({ name: 'p_total_value', label: 'Valor total (R$)', type: 'money', min: 0, help: 'Dividido em parcelas iguais; a última ajusta os centavos.' })}${field({ name: 'values', label: 'Ou o valor de cada parcela (R$, separados por ;)', full: true, placeholder: 'ex.: 1500; 1500; 1200' })}</div>
          <div class="cond" data-k="recorrente,assinatura">${field({ name: 'installment_value', label: 'Valor de cada cobrança (R$)', type: 'money', min: 0 })}${field({ name: 'periodicity', label: 'Periodicidade', type: 'select', options: [{ value: 'mensal', label: 'Mensal' }, { value: 'anual', label: 'Anual' }], value: v.periodicity, allowEmpty: false })}</div>
          ${field({ name: 'first_due', label: 'Vencimento (primeiro, se parcelado ou recorrente)', type: 'date', value: v.first_due, required: true })}`}
        <div class="cond" data-k="recorrente">${field({ name: 'end_date', label: 'Data de fim (opcional)', type: 'date', value: v.end_date, help: 'Sem data de fim, as cobranças são geradas 12 meses à frente e renovadas automaticamente.' })}</div>
        <div class="cond" data-k="assinatura">${field({ name: 'renewal_date', label: 'Renovação / fim do ciclo', type: 'date', value: v.renewal_date, help: 'Em branco: 12 meses após o primeiro vencimento. Aviso 15 dias antes.' })}${field({ name: 'auto_renew', label: 'Renovação automática', type: 'select', options: [{ value: '1', label: 'Sim, renova sozinha' }, { value: '0', label: 'Não, termina na data' }], value: String(v.auto_renew ?? 1), allowEmpty: false })}</div>
        ${field({ name: 'invoice_number', label: dir === 'pagar' ? 'Nº do documento / boleto' : 'Nº da nota fiscal', value: v.invoice_number })}
        ${field({ name: 'invoice_date', label: dir === 'pagar' ? 'Data do documento' : 'Data de emissão da nota', type: 'date', value: v.invoice_date })}
        ${editing ? field({ name: 'notes', label: 'Observações gerais', type: 'textarea', value: v.notes, full: true }) : field({ name: 'note', label: 'Observação (fica no histórico)', type: 'textarea', full: true, rows: 2 })}
      </div>`,
    submitLabel: editing ? 'Salvar' : `Lançar ${cfg.one}`,
    onMount(form) {
      const sync = () => {
        const k = editing ? t.kind : form.querySelector('[name=kind]:checked')?.value;
        $$('[data-k]', form).forEach((el) => (el.hidden = !el.dataset.k.split(',').includes(k)));
        const help = $('[data-kind-help]', form);
        if (help) help.textContent = { pontual: 'Uma única cobrança.', parcelada: 'Parcelas mensais a partir do primeiro vencimento.', recorrente: 'Cobranças mensais ou anuais, com data de fim opcional.', assinatura: 'Cobrança mensal ou anual com ciclo de renovação.' }[k] || '';
      };
      form.addEventListener('change', sync);
      sync();
    },
    async onSubmit(d) {
      if (editing) {
        await patch(`/api/financeiro/titulos/${t.id}`, { ...d, kind: undefined });
        toast('Lançamento atualizado.');
        return true;
      }
      const body = { ...d, direction: dir };
      if (d.kind === 'parcelada') body.total_value = d.p_total_value;
      delete body.p_total_value;
      const r = await post('/api/financeiro/titulos', body);
      toast(`${r.code} lançado: ${r.installments} ocorrência(s).`);
      return r;
    },
  });
}

/* ------------------------- Baixa, atraso, arquivos ------------------------- */

async function settleForm(instId, dir, info = null) {
  const cfg = DIR[dir];
  const i = info || (await get('/api/financeiro/lancamentos', { direcao: dir, status: 'todos' })).rows.find((x) => x.id === instId);
  if (!i) return toastError(new Error('Ocorrência não encontrada.'));
  return modal({
    title: `${cfg.settle}: ${i.description}`,
    body: html`<p class="small muted">${i.code}${i.total_installments ? ` · parcela ${i.number}/${i.total_installments}` : ''} · vencimento ${fmtDate(i.due_date)} · ${fmtMoney(i.amount)}</p>
      <div class="grid">
        ${field({ name: 'paid_at', label: `Data do ${cfg.done}`, type: 'date', value: todayLocal(), required: true })}
        ${field({ name: 'paid_amount', label: 'Valor (R$)', type: 'money', value: i.amount, help: 'Ajuste se houve juros, multa ou desconto.' })}
        ${field({ name: 'account_id', label: cfg.account, type: 'select', options: items(cat.contas), value: i.account_id, allowEmpty: false })}
        ${field({ name: 'payment_method_id', label: 'Forma de pagamento', type: 'select', options: items(cat.formas), value: i.payment_method_id })}
        ${fileInput('file', 'Comprovante')}
        ${field({ name: 'notes', label: 'Observação', placeholder: 'ex.: pago com juros de 2 dias', full: true })}
      </div>${i.situation === 'atrasado' && !i.late_reason ? html`<p class="hint warn-text">Esta ocorrência está atrasada e sem motivo informado: use "Motivo do atraso" para registrar o que aconteceu.</p>` : ''}`,
    submitLabel: `Confirmar ${cfg.done}`,
    async onSubmit(d, form) {
      const file = await readFile(form.file);
      const r = await post(`/api/financeiro/parcelas/${instId}/baixa`, { ...d, file: undefined, ...file });
      toast(`${cfg.settled} registrado${r.file_id ? ' com comprovante' : ': lembre de anexar o comprovante'}.`);
      return true;
    },
  });
}

function lateForm(instId, current = '') {
  return modal({
    title: 'Motivo do atraso',
    body: html`<p class="small">O motivo fica no histórico do lançamento e é enviado ao administrador.</p>${field({ name: 'reason', label: 'O que aconteceu?', type: 'textarea', value: current, required: true, full: true, placeholder: 'ex.: boleto veio com data errada; solicitado novo boleto ao fornecedor' })}`,
    submitLabel: 'Enviar motivo',
    async onSubmit(d, form, err) {
      const id = instId;
      await post(`/api/financeiro/parcelas/${id}/atraso`, d);
      toast('Motivo registrado e enviado ao administrador.');
      return true;
    },
  });
}

function uploadForm(titleId, instId = null, kind = 'comprovante') {
  return modal({
    title: 'Anexar arquivo',
    body: html`<div class="grid">${field({ name: 'kind', label: 'Tipo', type: 'select', options: Object.entries(FILE_KIND).map(([value, label]) => ({ value, label })), value: kind, allowEmpty: false })}${fileInput('file', 'Arquivo', true)}</div>`,
    submitLabel: 'Anexar',
    async onSubmit(d, form) {
      const file = await readFile(form.file);
      if (!file.filename) throw new Error('Escolha o arquivo.');
      await post(`/api/financeiro/titulos/${titleId}/arquivos`, { kind: d.kind, installment_id: instId || undefined, ...file });
      toast('Arquivo anexado.');
      return true;
    },
  });
}

function editItemForm(i) {
  return modal({
    title: `Ocorrência ${i.number} — ${i.code}`,
    body: html`<div class="grid">${field({ name: 'due_date', label: 'Vencimento', type: 'date', value: i.due_date, required: true })}${field({ name: 'amount', label: 'Valor (R$)', type: 'money', value: i.amount, required: true })}
      ${field({ name: 'reason', label: 'Motivo da alteração', type: 'textarea', full: true, required: true, placeholder: 'ex.: novo boleto emitido em virtude de erro na data' })}</div>`,
    async onSubmit(d) {
      await patch(`/api/financeiro/parcelas/${i.id}`, d);
      toast('Ocorrência atualizada.');
      return true;
    },
  });
}

/* ------------------------- Detalhe do lançamento ------------------------- */

export async function titleDetail(id, onChange, dirty = false) {
  let t;
  try {
    t = await get(`/api/financeiro/titulos/${id}`);
  } catch (e) {
    return toastError(e);
  }
  const dir = t.direction;
  const cfg = DIR[dir];
  const mod = t.can_manage;
  const active = t.status === 'ativo';
  const kv = (l, v) => html`<div><dt>${l}</dt><dd>${v ?? html`<span class="muted">—</span>`}</dd></div>`;
  let reopened = false;
  let closeFn = null;
  // Recorrentes têm até 12 meses gerados à frente: mostra as 3 últimas baixas, os atrasos e os 3 próximos vencimentos
  const shown = new Set();
  if (t.items.length > 8) {
    t.items.filter((i) => i.status === 'pago').slice(-3).forEach((i) => shown.add(i.id));
    t.items.filter((i) => i.situation === 'atrasado').forEach((i) => shown.add(i.id));
    t.items.filter((i) => i.status === 'aberto' && i.situation !== 'atrasado').slice(0, 3).forEach((i) => shown.add(i.id));
  } else t.items.forEach((i) => shown.add(i.id));
  const hiddenCount = t.items.length - shown.size;
  const reopen = () => {
    reopened = true;
    closeFn?.(null);
    titleDetail(id, onChange, true);
  };
  await modal({
    title: `${t.code} · ${t.description}`,
    wide: true,
    body: html`
      <div class="qual-blocks fin-detail">
        <div class="qual-block"><h4>Lançamento</h4><dl>
          ${kv('Tipo', `${KINDS[t.kind]}${t.periodicity ? ` · ${t.periodicity}` : ''}${t.kind === 'parcelada' ? ` · ${t.installments}x` : ''}`)}
          ${kv(cfg.partner, t.partner_name)}${kv('Categoria', t.category_name ? `${t.category_group ? `${t.category_group} › ` : ''}${t.category_name}` : null)}${kv('Centro de custo', t.cost_center_name)}
          ${kv('Responsável', t.responsible_name)}${kv('Forma de pagamento', t.method_name)}${kv(cfg.account, t.account_name)}
          ${t.invoice_number ? kv(dir === 'pagar' ? 'Documento' : 'Nota fiscal', `${t.invoice_number}${t.invoice_date ? ` · ${fmtDate(t.invoice_date)}` : ''}`) : ''}
          ${t.kind === 'assinatura' ? kv('Renovação', t.renewal_date ? `${fmtDate(t.renewal_date)} · ${t.auto_renew ? 'automática' : 'sem renovação automática'}` : null) : ''}
          ${t.end_date ? kv('Fim', fmtDate(t.end_date)) : ''}
          ${kv('Situação', t.status === 'ativo' ? 'Ativo' : t.status === 'encerrado' ? 'Encerrado' : html`<span class="danger-text">Cancelado</span>`)}
          ${kv('Lançado por', `${t.created_by_name || '—'} em ${fmtDateTime(t.created_at)}`)}
        </dl></div>
        <div class="qual-block"><h4>Valores</h4><dl>
          ${kv(t.kind === 'recorrente' || t.kind === 'assinatura' ? 'Previsto (ocorrências geradas)' : 'Previsto', fmtMoney(t.totals.previsto))}${kv(cfg.settled, fmtMoney(t.totals.realizado))}${kv('Em aberto', fmtMoney(t.totals.em_aberto))}
          ${t.notes ? html`<div class="full"><dt>Observações gerais</dt><dd>${t.notes}</dd></div>` : ''}
        </dl></div>
      </div>
      ${t.cancel_reason ? html`<div class="alert warn small">${t.status === 'cancelado' ? 'Cancelado' : 'Encerrado'}: ${t.cancel_reason}</div>` : ''}
      <div class="section-head"><h4>Ocorrências (${t.items.length})</h4>${hiddenCount ? html`<button type="button" class="btn small ghost" data-act="all-items">Ver todas as ${t.items.length} ocorrências</button>` : ''}</div>
      ${table(
        [
          { label: '', render: (i) => `${i.number}ª` },
          { label: 'Vencimento', render: (i) => html`<span class="${i.situation === 'atrasado' ? 'danger-text' : ''}">${fmtDate(i.due_date)}</span>` },
          { label: 'Valor', cls: 'num', render: (i) => html`${fmtMoney(i.amount)}${i.paid_amount != null && Math.abs(i.paid_amount - i.amount) > 0.009 ? html`<br><small class="muted">${cfg.settled.toLowerCase()} ${fmtMoney(i.paid_amount)}</small>` : ''}` },
          { label: 'Situação', render: (i) => html`${sitBadge(i, dir)}${i.paid_at ? html`<br><small class="muted">${fmtDate(i.paid_at)}${i.paid_by_name ? ` · ${i.paid_by_name}` : ''}</small>` : ''}${i.late_reason ? html`<br><small title="${i.late_reason}">Motivo: ${i.late_reason.length > 60 ? `${i.late_reason.slice(0, 60)}…` : i.late_reason}</small>` : ''}` },
          { label: 'Comprovante', render: (i) => (i.file_id ? html`<a href="#" data-file="${i.file_id}">${icon('anexo', 13)} abrir</a>` : i.status === 'pago' ? html`<button type="button" class="btn small" data-up="${i.id}">Anexar</button>` : '—') },
          {
            label: '',
            render: (i) => html`<div class="row-actions">${i.status === 'aberto' ? html`<button type="button" class="btn small primary" data-settle="${i.id}">${cfg.settle}</button><button type="button" class="btn small" data-edit-item="${i.id}">Alterar</button>` : ''}${i.situation === 'atrasado' ? html`<button type="button" class="btn small" data-late="${i.id}">Motivo do atraso</button>` : ''}${i.status === 'pago' && mod ? html`<button type="button" class="btn small ghost" data-undo="${i.id}">Estornar</button>` : ''}</div>`,
          },
        ],
        t.items,
        { rowAttr: (i) => (shown.has(i.id) ? '' : 'class="fin-more" hidden') },
      )}
      ${dir === 'receber' && (t.kind === 'pontual' || t.kind === 'parcelada') ? html`<section class="card inner fin-alloc"><div class="section-head"><h4>Rateio por competência</h4>${mod && t.status !== 'cancelado' ? html`<button type="button" class="btn small" data-act="alloc">${t.allocations.length ? 'Editar rateio' : 'Fazer rateio'}</button>` : ''}</div>
        ${t.allocations.length ? html`<div class="quota-chips">${t.allocations.map((a) => html`<span class="chip-sm">${monthName(a.competence)} · ${fmtMoney(a.amount)}</span>`)}</div>` : html`<p class="small muted">Sem rateio: a competência é o mês ${t.invoice_date ? 'da nota' : 'do vencimento'}. Use o rateio quando a administradora paga, numa só nota, valores de meses diferentes.</p>`}</section>` : ''}
      <div class="cols">
        <section class="card inner"><div class="section-head"><h4>Observações e histórico</h4></div>
          <div class="fin-note-add"><textarea name="note_text" rows="2" data-nofocus placeholder="ex.: solicitado novo boleto por erro na data de vencimento"></textarea><button type="button" class="btn small" data-act="note">Adicionar observação</button></div>
          ${t.history.length ? html`<ul class="fin-notes">${t.history.map((n) => html`<li><span class="badge ${n.kind === 'atraso' ? 'danger' : n.kind === 'baixa' ? 'ok' : ''}">${NOTE_KIND[n.kind] || n.kind}</span> ${n.text}<br><small class="muted">${n.user_name || 'Sistema'} · ${fmtDateTime(n.created_at)}${n.installment_number ? ` · ocorrência ${n.installment_number}` : ''}</small></li>`)}</ul>` : empty('Sem observações.')}</section>
        <section class="card inner"><div class="section-head"><h4>Arquivos</h4><button type="button" class="btn small" data-act="upload">${icon('anexo', 14)} Anexar</button></div>
          ${t.files.length ? html`<ul class="fin-notes">${t.files.map((f) => html`<li><a href="#" data-file="${f.id}">${f.filename}</a> ${badge(FILE_KIND[f.kind] || f.kind)}<br><small class="muted">${f.uploaded_by_name || '—'} · ${fmtDateTime(f.created_at)}${f.installment_number ? ` · ocorrência ${f.installment_number}` : ''}</small></li>`)}</ul>` : empty('Nenhum arquivo. Anexe boletos, notas e comprovantes.')}</section>
      </div>
      ${mod && active ? html`<div class="inline-actions"><button type="button" class="btn small" data-act="edit">Editar lançamento</button><button type="button" class="btn small ghost danger" data-act="cancel">${t.items.some((i) => i.status === 'pago') ? 'Encerrar (cancelar o que está em aberto)' : 'Cancelar lançamento'}</button></div>` : ''}`,
    onMount(form, close) {
      closeFn = close;
      const item = (iid) => t.items.find((x) => x.id === Number(iid));
      on(form, 'click', '[data-file]', (e, a) => (e.preventDefault(), openFile(a.dataset.file)));
      on(form, 'click', '[data-act=all-items]', (e, b) => {
        $$('.fin-more', form).forEach((r) => (r.hidden = false));
        b.remove();
      });
      on(form, 'click', '[data-settle]', async (e, b) => (await settleForm(Number(b.dataset.settle), dir, item(b.dataset.settle))) && reopen());
      on(form, 'click', '[data-late]', async (e, b) => (await lateForm(Number(b.dataset.late), item(b.dataset.late)?.late_reason || '')) && reopen());
      on(form, 'click', '[data-edit-item]', async (e, b) => (await editItemForm(item(b.dataset.editItem))) && reopen());
      on(form, 'click', '[data-up]', async (e, b) => (await uploadForm(t.id, Number(b.dataset.up), 'comprovante')) && reopen());
      on(form, 'click', '[data-act=upload]', async () => (await uploadForm(t.id, null, dir === 'pagar' ? 'boleto' : 'nota_fiscal')) && reopen());
      on(form, 'click', '[data-act=edit]', async () => (await titleForm(dir, t)) && reopen());
      on(form, 'click', '[data-act=alloc]', async () => (await allocationForm(t)) && reopen());
      on(form, 'click', '[data-undo]', async (e, b) => {
        const ok = await modal({ title: 'Estornar a baixa', body: field({ name: 'reason', label: 'Motivo do estorno', type: 'textarea', required: true, full: true }), submitLabel: 'Estornar', danger: true, onSubmit: (d) => post(`/api/financeiro/parcelas/${b.dataset.undo}/estorno`, d) });
        if (ok) reopen();
      });
      on(form, 'click', '[data-act=cancel]', async () => {
        const ok = await modal({ title: `Cancelar ${t.code}`, body: html`<p class="small">As ocorrências em aberto são canceladas; as já ${cfg.settled.toLowerCase()}s ficam no histórico.</p>${field({ name: 'reason', label: 'Motivo', type: 'textarea', required: true, full: true })}`, submitLabel: 'Confirmar', danger: true, onSubmit: (d) => post(`/api/financeiro/titulos/${t.id}/cancelar`, d) });
        if (ok) reopen();
      });
      on(form, 'click', '[data-act=note]', async () => {
        const text = form.note_text.value.trim();
        if (!text) return;
        try {
          await post(`/api/financeiro/titulos/${t.id}/observacoes`, { text });
          toast('Observação registrada.');
          reopen();
        } catch (e) {
          toastError(e);
        }
      });
    },
  });
  if (dirty && !reopened) onChange?.();
}

/** Rateio de uma receita por mês de competência. */
function allocationForm(t) {
  const total = t.total_value ?? t.totals.previsto;
  const rows = t.allocations.length ? t.allocations : [{ competence: (t.invoice_date || t.first_due).slice(0, 7), amount: total }];
  const row = (a = {}) => html`<div class="quota-row alloc-row" data-alloc><label>Mês de competência<input type="month" data-a="competence" value="${a.competence || ''}" required></label><label>Valor (R$)<input type="text" inputmode="decimal" data-money data-a="amount" value="${fmtMoneyInput(a.amount)}" required></label><label>Observação<input data-a="notes" value="${a.notes || ''}"></label><button type="button" class="icon" data-a-del aria-label="Remover">×</button></div>`;
  return modal({
    title: `Rateio por competência — ${t.code}`,
    wide: true,
    body: html`<p class="small">Valor total: <strong>${fmtMoney(total)}</strong>. Distribua pelos meses a que o pagamento se refere (ex.: outubro R$ 40 mil, setembro R$ 30 mil…). O rateio não altera o caixa nem os meses já fechados: só informa a competência.</p>
      <div class="alloc-list">${rows.map(row)}</div><div class="inline-actions"><button type="button" class="btn small" data-a-add>+ Adicionar mês</button><span class="small" data-a-sum></span></div>`,
    submitLabel: 'Salvar rateio',
    onMount(form) {
      const list = $('.alloc-list', form);
      const sum = () => {
        const s = $$('[data-a=amount]', form).reduce((a, x) => a + moneyValue(x), 0);
        const diff = Math.round((total - s) * 100) / 100;
        $('[data-a-sum]', form).innerHTML = String(html`Soma ${fmtMoney(s)} ${diff ? html`<span class="warn-text">· falta ${fmtMoney(diff)}</span>` : html`<span class="ok-text">· fecha o total</span>`}`);
      };
      on(form, 'click', '[data-a-add]', () => {
        const tmp = document.createElement('div');
        tmp.innerHTML = String(row());
        list.appendChild(tmp.firstElementChild);
        sum();
      });
      on(form, 'click', '[data-a-del]', (e, b) => (b.closest('[data-alloc]').remove(), sum()));
      form.addEventListener('input', sum);
      sum();
    },
    async onSubmit(d, form) {
      const allocations = $$('[data-alloc]', form).map((r) => Object.fromEntries($$('[data-a]', r).map((x) => [x.dataset.a, x.dataset.money !== undefined ? moneyValue(x) : x.value])));
      await post(`/api/financeiro/titulos/${t.id}/rateio`, { allocations });
      toast('Rateio salvo.');
      return true;
    },
  });
}

/** Receitas por mês de competência (com o rateio das notas). */
async function competenceView(box) {
  const d = await get('/api/financeiro/competencia');
  render(box, html`<div class="page-actions"><button class="btn" data-act="back">← Voltar para a lista</button></div>
    <section class="card"><h3>Receitas por competência</h3><p class="hint">Últimos 12 meses. Notas sem rateio entram no mês de emissão (ou do primeiro vencimento); receitas recorrentes, no mês de cada vencimento. Esta visão não altera o caixa: é para saber a que mês cada receita se refere.</p>
    ${d.months.length ? d.months.map((m) => html`<details class="fin-comp" ${m === d.months[0] ? raw('open') : ''}><summary><strong>${monthName(m.competence)}</strong><span>${fmtMoney(m.total)}</span></summary>
      ${table([{ label: 'Lançamento', render: (i) => html`<a href="#" data-title="${i.title_id}">${i.code}</a> ${i.description}${i.invoice_number ? html`<br><small class="muted">NF ${i.invoice_number}</small>` : ''}` }, { label: 'Pagador', render: (i) => i.partner_name || '—' }, { label: 'Motivo', render: (i) => i.category_name || '—' }, { label: 'Valor', cls: 'num', render: (i) => html`${fmtMoney(i.amount)}${i.sem_rateio && i.kind !== 'recorrente' ? html`<br><small class="muted">sem rateio</small>` : ''}` }], m.items)}</details>`) : empty('Nenhuma receita no período.')}</section>`);
}

/* =========================================================================
   Cadastros
   ========================================================================= */

const CAT_TABS = [
  ['cat_pagar', 'Categorias de despesa'],
  ['cat_receber', 'Categorias de receita'],
  ['centros', 'Centros de custo'],
  ['parceiros', 'Parceiros'],
  ['contas', 'Contas bancárias'],
  ['formas', 'Formas de pagamento'],
];
const ACCOUNT_TYPES = { corrente: 'Conta corrente', poupanca: 'Poupança', pagamento: 'Conta de pagamento', investimento: 'Investimento', caixa: 'Caixa (dinheiro)' };
const PARTNER_KINDS = { fornecedor: 'Fornecedor (pagamos)', pagador: 'Pagador (recebemos)', ambos: 'Fornecedor e pagador' };

async function catalogTab(box, params) {
  box = fresh(box);
  let sub = CAT_TABS.some(([k]) => k === params.aba) ? params.aba : 'cat_pagar';
  let all, rows, type, dir;
  const title = () => CAT_TABS.find(([k]) => k === sub)[1];
  const draw = async () => {
    all = await get('/api/financeiro/cadastros', { todos: '1' });
    dir = sub === 'cat_receber' ? 'receber' : 'pagar';
    type = sub.startsWith('cat_') ? 'categorias' : sub;
    rows = sub.startsWith('cat_') ? all.categorias.filter((c) => c.direction === dir) : all[sub];
    const cols = {
      categorias: [{ label: 'Grupo', render: (r) => r.group_name || '—' }, { label: 'Categoria', render: (r) => html`<strong>${r.name}</strong>` }],
      centros: [{ label: 'Centro de custo', render: (r) => html`<strong>${r.name}</strong>` }, { label: 'Descrição', render: (r) => r.description || '—' }],
      parceiros: [{ label: 'Parceiro', render: (r) => html`<strong>${r.name}</strong>${r.doc ? html`<br><small class="muted">${r.doc}</small>` : ''}` }, { label: 'Tipo', render: (r) => PARTNER_KINDS[r.kind] }, { label: 'Contato', render: (r) => [r.email, r.phone].filter(Boolean).join(' · ') || '—' }, { label: 'Administradora', render: (r) => r.administrator_name || '—' }],
      contas: [{ label: 'Conta', render: (r) => html`<strong>${r.name}</strong><br><small class="muted">${ACCOUNT_TYPES[r.type] || r.type}</small>` }, { label: 'Banco', render: (r) => [r.bank, r.agency && `ag. ${r.agency}`, r.number && `cc ${r.number}`].filter(Boolean).join(' · ') || '—' }, { label: 'Pix', render: (r) => r.pix_key || '—' }, { label: 'Saldo inicial', cls: 'num', render: (r) => html`${fmtMoney(r.opening_balance)}${r.opening_date ? html`<br><small class="muted">em ${fmtDate(r.opening_date)}</small>` : ''}` }],
      formas: [{ label: 'Forma de pagamento', render: (r) => html`<strong>${r.name}</strong>` }],
    }[type];
    render(box, html`<nav class="tabs fin-cat-tabs">${CAT_TABS.map(([k, l]) => html`<a href="#" data-sub="${k}" class="${k === sub ? 'active' : ''}">${l}</a>`)}</nav>
      <section class="card"><div class="section-head"><h3>${title()}</h3><button class="btn primary" data-add>${icon('adicionar', 16)}Adicionar</button></div>
      ${table([...cols, { label: 'Situação', render: (r) => (r.active ? badge('Ativo', 'ok') : badge('Inativo', 'muted')) }, { label: '', render: (r) => html`<div class="row-actions"><button class="btn small" data-edit="${r.id}">Editar</button><button class="btn small ghost" data-toggle="${r.id}">${r.active ? 'Desativar' : 'Ativar'}</button></div>` }], rows, { emptyMsg: 'Nada cadastrado.' })}
      <p class="hint">${{ categorias: 'As categorias usuais do mercado de consórcios já vêm cadastradas. Desative as que não usar; o histórico é mantido.', centros: 'Centros de custo dizem qual área gerou a despesa (comercial, marketing, administrativo…).', parceiros: 'Fornecedores e instituições pagadoras usados com frequência: cadastre uma vez e escolha nos lançamentos.', contas: 'Saldo inicial e data de abertura: o saldo atual soma as entradas e desconta as saídas registradas a partir dessa data.', formas: 'Boleto, TED e dinheiro já vêm ativos; Pix, cartão e débito automático podem ser ativados aqui.' }[type]}</p></section>`);
  };
  const formFor = (r = {}) => {
    const f = {
      categorias: html`${field({ name: 'group_name', label: 'Grupo', value: r.group_name, placeholder: 'ex.: Tecnologia' })}${field({ name: 'name', label: 'Categoria', value: r.name, required: true })}`,
      centros: html`${field({ name: 'name', label: 'Nome', value: r.name, required: true })}${field({ name: 'description', label: 'Descrição', value: r.description })}`,
      parceiros: html`${field({ name: 'name', label: 'Nome', value: r.name, required: true })}${field({ name: 'kind', label: 'Tipo', type: 'select', options: Object.entries(PARTNER_KINDS).map(([value, label]) => ({ value, label })), value: r.kind || 'fornecedor', allowEmpty: false })}
        ${field({ name: 'doc', label: 'CNPJ ou CPF', value: r.doc })}${field({ name: 'email', label: 'E-mail', type: 'email', value: r.email })}${field({ name: 'phone', label: 'Telefone', value: r.phone })}
        ${field({ name: 'administrator_id', label: 'Administradora (se for uma)', type: 'select', options: items(all.administradoras), value: r.administrator_id, placeholder: 'Não se aplica' })}${field({ name: 'notes', label: 'Observações', type: 'textarea', value: r.notes, full: true })}`,
      contas: html`${field({ name: 'name', label: 'Nome da conta', value: r.name, required: true })}${field({ name: 'type', label: 'Tipo', type: 'select', options: Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label })), value: r.type || 'corrente', allowEmpty: false })}
        ${field({ name: 'bank', label: 'Banco', value: r.bank })}${field({ name: 'agency', label: 'Agência', value: r.agency })}${field({ name: 'number', label: 'Conta', value: r.number })}${field({ name: 'pix_key', label: 'Chave Pix', value: r.pix_key })}
        ${field({ name: 'opening_balance', label: 'Saldo inicial (R$)', type: 'money', value: r.opening_balance ?? 0 })}${field({ name: 'opening_date', label: 'Data do saldo inicial', type: 'date', value: r.opening_date, help: 'Em branco: considera todas as movimentações.' })}`,
      formas: field({ name: 'name', label: 'Nome', value: r.name, required: true }),
    }[type];
    return modal({
      title: r.id ? `Editar: ${r.name}` : `Adicionar — ${title()}`,
      body: html`<div class="grid">${f}</div>`,
      async onSubmit(d) {
        await post(`/api/financeiro/cadastros/${type}`, { ...d, id: r.id, direction: type === 'categorias' ? dir : undefined });
        toast('Cadastro salvo.');
        return true;
      },
    });
  };
  const after = async (ok) => ok && (await loadCatalogs(), draw());
  on(box, 'click', '[data-sub]', (e, a) => (e.preventDefault(), (sub = a.dataset.sub), draw()));
  on(box, 'click', '[data-add]', async () => after(await formFor()));
  on(box, 'click', '[data-edit]', async (e, b) => after(await formFor(rows.find((r) => r.id === Number(b.dataset.edit)))));
  on(box, 'click', '[data-toggle]', async (e, b) => {
    const r = rows.find((x) => x.id === Number(b.dataset.toggle));
    try {
      await post(`/api/financeiro/cadastros/${type}`, { id: r.id, active: !r.active });
      after(true);
    } catch (ex) {
      toastError(ex);
    }
  });
  await draw();
}
