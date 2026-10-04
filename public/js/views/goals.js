// 8. Metas: metas mensais de crédito vendido e número de vendas por especialista e por equipe.
import { get, post } from '../api.js';
import { html, render, $, $$, on, state, fmtMoney, toast, toastError, empty, monthLabel, fmtMoneyInput, moneyValue } from '../ui.js';

let month = new Date().toISOString().slice(0, 7);
const bar = (pct) => html`<div class="progress-bar goal ${pct >= 100 ? 'done' : ''}"><span style="width:${Math.min(100, pct || 0)}%"></span></div>`;
const shift = (m, n) => {
  const d = new Date(`${m}-15T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 7);
};

export async function show(view) {
  const load = async () => {
    let d;
    try {
      d = await get('/api/metas', { month });
    } catch (e) {
      return toastError(e);
    }
    const t = d.total;
    const edit = d.can_edit;
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Metas</h1><p class="muted">Crédito vendido e número de vendas com pagamento confirmado no mês.</p></div>
        <div class="actions"><button class="btn small" data-shift="-1">◀</button><strong class="month-label">${monthLabel(month)}</strong><button class="btn small" data-shift="1">▶</button>
        ${edit ? html`<button class="btn" data-act="copy">Copiar metas do mês anterior</button>` : ''}</div></div>
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Crédito vendido</div><div class="kpi-value">${fmtMoney(t.realized_credit)}</div>${bar(t.pct_credit)}<div class="kpi-sub">${t.target_credit ? `${t.pct_credit}% de ${fmtMoney(t.target_credit)}` : 'sem meta'}</div></div>
        <div class="kpi"><div class="kpi-label">Vendas</div><div class="kpi-value">${t.realized_sales}</div>${bar(t.pct_sales)}<div class="kpi-sub">${t.target_sales ? `${t.pct_sales}% de ${t.target_sales}` : 'sem meta'}</div></div>
        <div class="kpi"><div class="kpi-label">Falta para a meta</div><div class="kpi-value">${t.missing_credit != null ? fmtMoney(t.missing_credit) : '—'}</div><div class="kpi-sub">${t.daily_needed ? `${fmtMoney(t.daily_needed)} por dia útil (${t.business_days_left} restantes)` : `${t.business_days_left} dia(s) útil(eis) restante(s)`}</div></div>
      </div>
      ${d.teams.length ? html`<section class="card"><h3>Equipes</h3>
        <table><thead><tr><th>Equipe</th><th>Líder</th><th class="num">Meta de crédito</th><th class="num">Realizado</th><th>Progresso</th><th class="num">Vendas</th></tr></thead><tbody>
        ${d.teams.map((tm) => html`<tr><td><strong>${tm.name}</strong>${tm.explicit ? '' : html`<br><small class="muted">soma das metas individuais</small>`}</td><td>${tm.leader_name || '—'}</td>
          <td class="num">${edit ? html`<input type="text" inputmode="decimal" data-money data-team-credit="${tm.id}" value="${tm.explicit ? fmtMoneyInput(tm.target_credit) : ''}" placeholder="${fmtMoneyInput(tm.target_credit)}">` : fmtMoney(tm.target_credit)}</td>
          <td class="num">${fmtMoney(tm.realized_credit)}</td><td>${bar(tm.pct_credit)}<small>${tm.pct_credit != null ? `${tm.pct_credit}%` : '—'}</small></td>
          <td class="num">${edit ? html`<input type="number" min="0" data-team-sales="${tm.id}" value="${tm.explicit ? tm.target_sales ?? '' : ''}" placeholder="${tm.target_sales ?? ''}"> ` : ''}${tm.realized_sales}${tm.target_sales ? ` / ${tm.target_sales}` : ''}</td></tr>`)}
        </tbody></table></section>` : ''}
      <section class="card"><div class="section-head"><h3>Especialistas</h3>${edit ? html`<button class="btn primary" data-act="save">Salvar metas</button>` : ''}</div>
        ${d.people.length ? html`<table><thead><tr><th>Especialista</th><th>Equipe</th><th class="num">Meta de crédito (R$)</th><th class="num">Meta de vendas</th><th class="num">Realizado</th><th>Progresso</th><th class="num">Falta</th><th class="num">Ritmo/dia útil</th></tr></thead><tbody>
          ${d.people.map((p) => html`<tr><td><strong>${p.name}</strong></td><td>${p.team_name || '—'}</td>
            <td class="num">${edit ? html`<input type="text" inputmode="decimal" data-money data-credit="${p.id}" value="${fmtMoneyInput(p.target_credit)}">` : fmtMoney(p.target_credit)}</td>
            <td class="num">${edit ? html`<input type="number" min="0" data-sales="${p.id}" value="${p.target_sales ?? ''}">` : p.target_sales ?? '—'}</td>
            <td class="num">${fmtMoney(p.realized_credit)}<br><small>${p.realized_sales} venda(s)</small></td>
            <td>${bar(p.pct_credit)}<small>${p.pct_credit != null ? `${p.pct_credit}%` : '—'}</small></td>
            <td class="num">${p.missing_credit != null ? fmtMoney(p.missing_credit) : '—'}</td><td class="num">${p.daily_needed ? fmtMoney(p.daily_needed) : '—'}</td></tr>`)}
          </tbody></table>` : empty('Nenhum especialista ativo.')}
        ${edit ? html`<p class="hint">A meta da equipe, quando não informada, é a soma das metas dos especialistas. O realizado considera a data de pagamento das vendas confirmadas.</p>` : ''}
      </section>
    </div>`);
  };
  on(view, 'click', '[data-shift]', (e, b) => ((month = shift(month, Number(b.dataset.shift))), load()));
  on(view, 'click', '[data-act=save]', async () => {
    const items = [
      ...$$('[data-credit]', view).map((i) => ({ scope: 'user', user_id: Number(i.dataset.credit), target_credit: i.value ? moneyValue(i) : '', target_sales: $(`[data-sales="${i.dataset.credit}"]`, view).value })),
      ...$$('[data-team-credit]', view).map((i) => ({ scope: 'team', team_id: Number(i.dataset.teamCredit), target_credit: i.value ? moneyValue(i) : '', target_sales: $(`[data-team-sales="${i.dataset.teamCredit}"]`, view).value })),
    ];
    try {
      await post('/api/metas', { month, items });
      toast('Metas salvas.');
      load();
    } catch (e) {
      toastError(e);
    }
  });
  on(view, 'click', '[data-act=copy]', async () => {
    try {
      const r = await post('/api/metas/copiar', { from: shift(month, -1), to: month });
      toast(`${r.copied} meta(s) copiada(s).`);
      load();
    } catch (e) {
      toastError(e);
    }
  });
  await load();
}
