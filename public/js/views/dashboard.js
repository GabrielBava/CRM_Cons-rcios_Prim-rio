// 1. Painel inicial: visão do dia do especialista (ou consolidada para líder e administrador) e ações sugeridas.
import { get } from '../api.js';
import { html, render, $, on, state, selectOptions, userItems, fmtMoney, fmtDateTime, fmtDate, relTime, badge, empty, toastError, K, monthLabel } from '../ui.js';

const LEVEL = { alta: ['Alta', 'ok'], media: ['Média', 'warn'], baixa: ['Baixa', 'danger'] };
export const probBadge = (p) => badge(`${LEVEL[p.level]?.[0] || '—'} · ${p.probability}%`, LEVEL[p.level]?.[1] || '');
const pctBar = (pct) => html`<div class="progress-bar goal"><span style="width:${Math.min(100, pct || 0)}%"></span></div>`;

let selected = '';

export async function show(view) {
  const manager = ['admin', 'gestor', 'leitura'].includes(state.user.role);
  const load = async () => {
    let d;
    try {
      d = await get('/api/inicio', selected ? { user_id: selected } : {});
    } catch (e) {
      toastError(e);
      return;
    }
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const g = d.goal;
    const maxFunnel = Math.max(1, ...d.funnel.map((f) => f.count));
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>${hello}, ${state.user.name.split(' ')[0]}!</h1><p class="muted">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${d.scope.name ? `visão de ${d.scope.name}` : d.scope.all ? 'visão de toda a empresa' : 'visão da sua equipe'}</p></div>
        ${manager ? html`<label class="inline">Ver<select data-user>${selectOptions(userItems(), selected, { placeholder: state.user.role === 'admin' ? 'Toda a empresa' : 'Minha equipe' })}</select></label>` : ''}</div>

      <div class="kpis home-kpis">
        <a class="kpi" href="#/leads"><div class="kpi-label">Leads recebidos no mês</div><div class="kpi-value">${d.leads.mes}</div><div class="kpi-sub">${d.leads.hoje} hoje${d.no_contact ? html` · <span class="overdue">${d.no_contact} sem contato</span>` : ''}</div></a>
        <a class="kpi" href="#/propostas"><div class="kpi-label">Propostas em andamento</div><div class="kpi-value">${d.proposals.em_andamento}</div><div class="kpi-sub">${fmtMoney(d.proposals.valor_andamento)} · ponderado ${fmtMoney(d.proposals.potencial_ponderado)}</div></a>
        <a class="kpi" href="#/vendas"><div class="kpi-label">Vendas no mês</div><div class="kpi-value">${d.sales.mes}</div><div class="kpi-sub">${fmtMoney(d.sales.credito_mes)} em crédito${d.sales.aguardando ? ` · ${d.sales.aguardando} aguardando pagamento` : ''}</div></a>
        <a class="kpi" href="#/comissoes"><div class="kpi-label">Comissões a receber no mês</div><div class="kpi-value">${fmtMoney(d.commissions.a_receber_mes)}</div><div class="kpi-sub">liberado ${fmtMoney(d.commissions.liberado_mes)} · próximos 3 meses ${fmtMoney(d.commissions.previsto_3_meses)}</div></a>
        <a class="kpi" href="#/metas"><div class="kpi-label">Meta do mês</div><div class="kpi-value">${g.pct_credit != null ? `${g.pct_credit}%` : '—'}</div>${pctBar(g.pct_credit)}<div class="kpi-sub">${g.target_credit ? `${fmtMoney(g.realized_credit)} de ${fmtMoney(g.target_credit)}` : 'Meta não cadastrada'}</div></a>
        <a class="kpi ${d.agenda.atrasadas ? 'alert-kpi' : ''}" href="#/agenda"><div class="kpi-label">Agenda de hoje</div><div class="kpi-value">${d.agenda.hoje}</div><div class="kpi-sub">${d.agenda.atrasadas} atrasada(s) · ${d.agenda.urgentes} urgente(s) · ${d.agenda.r1_semana} R1 na semana</div></a>
      </div>

      <div class="cols">
        <section class="card"><h3>Ações sugeridas para hoje</h3>
          ${d.actions.length ? html`<ul class="actions-list">${d.actions.map((a) => html`<li class="lvl-${a.level}"><span class="dot"></span>${a.href ? html`<a href="${a.href}">${a.text}</a>` : a.text}</li>`)}</ul>` : empty('Tudo em dia. Aproveite para prospectar e pedir indicações.')}
        </section>
        <section class="card"><div class="section-head"><h3>Meta de ${monthLabel(d.month)}</h3><a href="#/metas" class="small">detalhes</a></div>
          ${g.target_credit || g.target_sales
            ? html`<div class="goal-row"><span>Crédito vendido</span><strong>${fmtMoney(g.realized_credit)} / ${fmtMoney(g.target_credit)}</strong></div>${pctBar(g.pct_credit)}
              <div class="goal-row"><span>Vendas</span><strong>${g.realized_sales} / ${g.target_sales ?? '—'}</strong></div>${pctBar(g.pct_sales)}
              <div class="kv">${html`<div><span>Falta</span>${g.missing_credit != null ? fmtMoney(g.missing_credit) : '—'}</div><div><span>Ritmo necessário</span>${g.daily_needed ? `${fmtMoney(g.daily_needed)} por dia útil` : '—'}</div><div><span>Dias úteis restantes</span>${g.business_days_left}</div>`}${d.position ? html`<div><span>Ranking do mês</span>${d.position.position}º de ${d.position.of}</div>` : ''}</div>`
            : html`<p class="muted">Nenhuma meta cadastrada para este mês. O administrador cadastra as metas em Metas.</p>`}
        </section>
      </div>

      <section class="card"><div class="section-head"><h3>Funil de vendas</h3><a href="#/funil" class="small">abrir o CRM</a></div>
        <div class="bars">${d.funnel.map((f) => html`<a class="bar-row" href="#/funil"><span class="bar-label">${f.name}</span><span class="bar"><span class="bar-fill ${f.kind === 'ganho' ? 'won' : f.kind === 'perdido' ? 'stalled' : ''}" style="width:${(f.count / maxFunnel) * 100}%"></span></span><span class="bar-val">${f.count}${f.value ? ` · ${fmtMoney(f.value)}` : ''}</span></a>`)}</div>
        ${d.rotting ? html`<p class="small warn-text">${d.rotting} negócio(s) parado(s) além do prazo da etapa.</p>` : ''}
      </section>

      <div class="cols">
        <section class="card"><div class="section-head"><h3>Agenda de hoje</h3><a href="#/agenda" class="small">ver agenda</a></div>
          ${d.agenda.lista.length ? html`<ul class="task-list">${d.agenda.lista.map((t) => html`<li class="${new Date(t.due_at) < new Date() ? 'overdue' : ''}">${t.priority === 'urgente' ? badge('Urgente', 'danger') : ''} <strong>${t.title}</strong><br><small>${K('task_types', t.type)} · ${fmtDateTime(t.due_at)}${t.contact_name ? html` · <a href="#/leads/${t.contact_id}">${t.contact_name}</a>` : ''}</small></li>`)}</ul>` : empty('Nenhuma tarefa para hoje.')}
        </section>
        <section class="card"><div class="section-head"><h3>Propostas que pedem atenção</h3><a href="#/propostas" class="small">ver propostas</a></div>
          ${d.proposals.lista.length ? html`<ul class="task-list">${d.proposals.lista.map((p) => html`<li><a href="#/leads/${p.contact_id}/propostas"><strong>${p.contact_name}</strong></a> · ${fmtMoney(p.credit_value)} ${probBadge(p)}<br><small>${p.code}${p.next_followup ? ` · próximo: ${p.next_followup.title.replace(/ \(PR-\d+\)$/, '')} ${relTime(p.next_followup.due_at)}` : ''}</small>${p.alerts.length ? html`<br><small class="warn-text">${p.alerts.join(' · ')}</small>` : ''}</li>`)}</ul>` : empty('Nenhuma proposta com alerta.')}
        </section>
      </div>

      <div class="cols">
        ${d.ranking.length ? html`<section class="card"><h3>Ranking do mês</h3><ol class="ranking">${d.ranking.slice(0, 10).map((r) => html`<li><span>${r.name}</span><span>${r.vendas} venda(s) · ${fmtMoney(r.credito)}</span></li>`)}</ol></section>` : ''}
        <section class="card"><h3>Relacionamento e capacitação</h3>
          ${d.birthdays.length ? html`<h4>Aniversariantes da semana</h4><ul class="task-list">${d.birthdays.map((b) => html`<li><a href="#/clientes/${b.id}">${b.name}</a> <small class="muted">${b.birth_date.slice(8, 10)}/${b.birth_date.slice(5, 7)}</small></li>`)}</ul>` : ''}
          ${d.trainings.length ? html`<h4>Treinamentos obrigatórios pendentes</h4><ul class="task-list">${d.trainings.map((t) => html`<li><a href="#/treinamentos?id=${t.id}">${t.title}</a>${t.overdue ? html` ${badge('Atrasado', 'danger')}` : t.due_at ? html` <small class="muted">até ${fmtDate(t.due_at)}</small>` : ''}</li>`)}</ul>` : ''}
          ${!d.birthdays.length && !d.trainings.length ? html`<p class="muted">Nenhum aniversariante nesta semana e nenhum treinamento obrigatório pendente.</p>` : ''}
          <p class="small muted">Pré-vendas: ${d.presales.geradas} geradas · ${d.presales.concluidas_cliente} concluídas pelo cliente · ${d.presales.paradas} parada(s).</p>
        </section>
      </div>
    </div>`);
    const sel = $('[data-user]', view);
    if (sel) sel.addEventListener('change', () => ((selected = sel.value), load()));
  };
  await load();
}
