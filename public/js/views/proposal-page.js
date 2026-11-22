// Proposta on-line: versão digital da proposta aberta pelo cliente (sem login) pelo link enviado no WhatsApp.
// Mostra as condições, explica como funciona e tem o botão "Quero avançar". O CRM registra cada abertura, o tempo na
// proposta, até onde o cliente rolou e as seções vistas. A visualização da equipe (?equipe=1) não conta como acesso.
import { get, post } from '../api.js';
import { html, render, $, $$, on, fmtMoney, fmtDate, fmtDateTime, toastError } from '../ui.js';
import { icon } from '../icons.js';

const pct = (v) => (v == null ? null : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const item = (label, value, hint) => (value == null || value === '' || value === false ? '' : html`<div class="pp-item"><span>${label}</span><strong>${value}</strong>${hint ? html`<small>${hint}</small>` : ''}</div>`);

/** Como funciona: o passo a passo de cada área, em linguagem do cliente. */
const HOW = {
  consorcio: [
    ['Adesão', 'Você entra no grupo com a carta de crédito escolhida e paga a primeira parcela.'],
    ['Assembleias', 'Todo mês o grupo se reúne: há contemplação por sorteio e por lance.'],
    ['Contemplação', 'Contemplado, você usa o crédito à vista para comprar o bem, com poder de negociação.'],
    ['Acompanhamento', 'Seu consultor acompanha as assembleias e a estratégia de lance com você.'],
  ],
  contemplada: [
    ['Escolha da carta', 'A carta já está contemplada: o crédito fica disponível depois da transferência.'],
    ['Entrada', 'Você paga a entrada (ágio) combinada e assume as parcelas restantes do grupo.'],
    ['Transferência', 'A administradora analisa o cadastro e transfere a cota para o seu nome.'],
    ['Uso do crédito', 'Crédito liberado para comprar o bem à vista, sem juros de financiamento.'],
  ],
  planejamento: [
    ['Diagnóstico', 'Entendemos sua renda, despesas, patrimônio, dívidas, proteção e objetivos.'],
    ['Plano de ação', 'Você recebe um plano estruturado, com prioridades, prazos e o porquê de cada passo.'],
    ['Implementação', 'Colocamos o plano em prática junto com você: reserva, investimentos, proteção e crédito.'],
    ['Acompanhamento', 'Revisões periódicas e painel de acompanhamento para manter o plano vivo.'],
  ],
};
const DELIVER = [
  'Diagnóstico financeiro completo (fluxo de caixa, patrimônio, dívidas e proteção)',
  'Estrela Vero: a nota da sua saúde financeira em cada pilar',
  'Plano de ação estruturado, com prioridades e prazos',
  'Recomendações de proteção, investimentos, crédito e sucessão',
  'Reuniões de apresentação e revisões do plano',
  'Painel de acompanhamento incluso',
];

function values(d) {
  const v = d.values;
  if (d.area === 'planejamento') {
    const pr = d.pricing || {};
    return html`${d.plan_model_label ? html`<section class="card pp-sec pp-model" data-sec="resumo"><span class="pp-kicker">Modelo</span><h2>${d.plan_model_label}</h2><p>${d.plan_model_resumo}</p></section>` : ''}
      <section class="card pp-sec" data-sec="investimento"><h2>O investimento no seu planejamento</h2>
      <div class="pp-price">
        ${pr.pix_total ? html`<div class="pp-price-card ${pr.condicao === 'pix' ? 'on' : ''}"><span>Pix ou boleto · à vista</span><strong>${fmtMoney(pr.pix_total)}</strong>${pr.valor > pr.pix_total ? html`<small>economia de ${fmtMoney(pr.valor - pr.pix_total)}</small>` : ''}</div>` : ''}
        ${pr.cartao_total ? html`<div class="pp-price-card ${pr.condicao === 'cartao' ? 'on' : ''}"><span>Cartão de crédito</span><strong>${pr.parcelas > 1 ? `${pr.parcelas}× ${fmtMoney(pr.parcela)}` : fmtMoney(pr.cartao_total)}</strong><small>total ${fmtMoney(pr.cartao_total)}</small></div>` : ''}
        ${!pr.pix_total && !pr.cartao_total ? html`<div class="pp-price-card on"><span>Valor do planejamento</span><strong>${fmtMoney(v.credit_value)}</strong></div>` : ''}
      </div>
      ${pr.observacoes ? html`<p class="muted">${pr.observacoes}</p>` : ''}</section>
      <section class="card pp-sec" data-sec="entrega"><h2>O que vamos entregar</h2><ul class="pp-list">${(d.plan_model_entregas || DELIVER).map((x) => html`<li>${icon('confirmar', 16)} ${x}</li>`)}</ul></section>`;
  }
  if (d.area !== 'consorcio') {
    return html`<section class="card pp-sec" data-sec="valores"><h2>O que está na proposta</h2>
      ${d.description ? html`<p class="pp-desc first">${d.description}</p>` : ''}
      ${v.initial_installment ? html`<div class="pp-grid">${item('Parcela', fmtMoney(v.initial_installment))}</div>` : ''}</section>`;
  }
  if (d.consortium_kind === 'contemplada') {
    return html`<section class="card pp-sec" data-sec="valores"><h2>Carta contemplada</h2><div class="pp-grid">
      ${item('Crédito disponível', fmtMoney(v.credit_value))}${item('Entrada (ágio)', v.entry_value != null ? fmtMoney(v.entry_value) : null)}
      ${item('Parcelas restantes', v.remaining_installments ? `${v.remaining_installments}× ${v.initial_installment ? fmtMoney(v.initial_installment) : ''}` : null)}
      ${item('Administradora', d.administrator)}${item('Categoria', d.category_label)}</div>
      ${d.description ? html`<p class="pp-desc">${d.description}</p>` : ''}</section>`;
  }
  const adhesion = v.has_adhesion && v.adhesion_pct ? `${pct(v.adhesion_pct)}${v.adhesion_months ? ` em ${v.adhesion_months}×` : ''}` : null;
  return html`<section class="card pp-sec" data-sec="valores"><h2>Sua carta de crédito</h2><div class="pp-grid">
      ${item('Crédito', fmtMoney(v.credit_value))}${item('Parcela inicial', v.initial_installment ? fmtMoney(v.initial_installment) : null, v.payment_modality)}
      ${item('Prazo', v.term_months ? `${v.term_months} meses` : null)}${item('Categoria', d.category_label)}
      ${item('Administradora', d.administrator)}${item('Plano', d.plan)}
      ${v.quotas > 1 ? item('Cotas', `${v.quotas}${v.quota_values ? ` (${v.quota_values.map((x) => fmtMoney(x)).join(' + ')})` : ''}`) : ''}</div></section>
    <section class="card pp-sec" data-sec="condicoes"><h2>Condições do plano</h2><div class="pp-grid">
      ${item('Taxa de administração', pct(v.admin_fee_pct))}${item('Fundo de reserva', pct(v.reserve_fund_pct))}${item('Seguro', pct(v.insurance_pct))}
      ${item('Adesão', adhesion)}${item('Reajuste anual', v.readjustment_index)}${item('Redutor de parcela', pct(v.reducer_pct))}</div></section>
    ${d.strategy || v.contemplation_month || v.embedded_bid_pct ? html`<section class="card pp-sec" data-sec="estrategia"><h2>Estratégia de contemplação</h2><div class="pp-grid">
      ${item('Estratégia', d.strategy)}${item('Mês de contemplação projetado', v.contemplation_month ? `${v.contemplation_month}º mês` : null)}
      ${item('Lance embutido', pct(v.embedded_bid_pct))}${item('Lance abate', v.bid_deduction === 'prazo' ? 'Prazo' : v.bid_deduction === 'parcela' ? 'Parcela' : null)}</div>
      <p class="muted small">Projeção para planejamento: a contemplação depende de sorteio ou lance nas assembleias do grupo.</p></section>` : ''}`;
}

function advanceBox(d) {
  if (d.accepted) return html`<section class="card pp-sec pp-cta ok" data-sec="avancar"><h2>Proposta aceita</h2><p>Obrigado pela confiança! Seu consultor vai seguir com você nos próximos passos.</p></section>`;
  if (d.closed) return '';
  if (d.advanced_at) return html`<section class="card pp-sec pp-cta ok" data-sec="avancar"><h2>Recebemos o seu "quero avançar"</h2><p>Em ${fmtDateTime(d.advanced_at)}. ${d.consultant ? `${d.consultant.name.split(' ')[0]} vai falar com você em instantes.` : 'Seu consultor vai falar com você em instantes.'}</p></section>`;
  return html`<section class="card pp-sec pp-cta" data-sec="avancar"><h2>Gostou da proposta?</h2>
    <p>Clique em <strong>Quero avançar</strong> e seu consultor entra em contato para os próximos passos. Se quiser, deixe uma mensagem.</p>
    <form data-adv><textarea name="note" rows="2" maxlength="500" placeholder="Mensagem para o consultor (opcional)"></textarea>
      <button class="btn primary big" ${d.team ? 'disabled title="Visualização da equipe"' : ''}>${icon('avancar', 18)} Quero avançar</button></form></section>`;
}

function page(d) {
  const how = HOW[d.area === 'consorcio' && d.consortium_kind === 'contemplada' ? 'contemplada' : d.area] || null;
  const wa = d.consultant?.whatsapp ? `https://wa.me/${String(d.consultant.whatsapp).replace(/\D/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')}` : null;
  return html`<div class="public-page proposal-page area-${d.area}">
    ${d.team ? html`<div class="alert info pp-team">${icon('olho', 16)} Visualização da equipe: esta abertura não conta como acesso do cliente.</div>` : ''}
    ${d.superseded_by ? html`<div class="alert warn">Esta proposta foi atualizada. <a href="#/proposta/${d.superseded_by}">Abrir a versão mais recente</a>.</div>` : d.closed ? html`<div class="alert warn">Esta proposta está ${String(d.status_label || '').toLowerCase()}. Fale com o seu consultor para uma nova condição.</div>` : ''}
    <header class="pp-head"><span class="brand-logo" role="img" aria-label="Vero"></span>
      <p class="pp-kicker">${d.brand} · Proposta ${d.code}${d.version > 1 ? ` · versão ${d.version}` : ''}</p>
      <h1>${d.client_first_name}, esta é a sua proposta de ${String(d.area_label).toLowerCase()}</h1>
      <p class="muted">Preparada em ${fmtDate(d.presented_at || d.created_at)}${d.valid_until ? html` · válida até <strong>${fmtDate(d.valid_until)}</strong>` : ''}</p></header>
    <section class="card pp-sec pp-hero" data-sec="resumo">
      <div><span>${d.area === 'planejamento' ? 'Investimento' : d.consortium_kind === 'contemplada' ? 'Crédito da carta contemplada' : d.area === 'consorcio' ? 'Carta de crédito' : 'Valor'}</span>
        <strong>${fmtMoney(d.area === 'planejamento' && d.pricing?.pix_total ? d.pricing.pix_total : d.values.credit_value)}</strong>
        ${d.area === 'planejamento' && d.pricing?.pix_total ? html`<small>à vista no Pix ou boleto${d.pricing.cartao_total ? ` · ou ${d.pricing.parcelas}× ${fmtMoney(d.pricing.parcela)} no cartão` : ''}</small>` : ''}
        ${d.area === 'consorcio' && d.values.initial_installment ? html`<small>parcela inicial de ${fmtMoney(d.values.initial_installment)}${d.values.term_months ? ` · ${d.values.term_months} meses` : ''}</small>` : ''}</div>
    </section>
    ${values(d)}
    ${how ? html`<section class="card pp-sec" data-sec="como_funciona"><h2>Como funciona</h2><ol class="pp-steps">${how.map(([t, x], i) => html`<li><span class="pp-n">${i + 1}</span><div><strong>${t}</strong><p>${x}</p></div></li>`)}</ol></section>` : ''}
    ${advanceBox(d)}
    ${d.consultant ? html`<section class="card pp-sec pp-consultant" data-sec="consultor"><div><span class="muted small">Seu consultor</span><strong>${d.consultant.name}</strong>${d.consultant.job_title ? html`<small>${d.consultant.job_title}</small>` : ''}</div>
      ${wa ? html`<a class="btn wa" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 16)} Falar no WhatsApp</a>` : ''}</section>` : ''}
    <footer class="pp-foot muted small"><p>Valores e condições sujeitos à confirmação da administradora/instituição na data da contratação. ${d.area === 'consorcio' ? 'Consórcio não tem juros; a contemplação ocorre por sorteio ou lance.' : ''}</p>
      <p>Esta página registra a abertura e o tempo de leitura para que seu consultor possa te atender melhor. Não coletamos outros dados. Dúvidas sobre privacidade: fale com o seu consultor.</p></footer>
  </div>`;
}

/** Rastreio: tempo com a página visível (a cada 15 s), rolagem máxima e seções que apareceram na tela. */
function track(token, viewId) {
  let last = Date.now();
  let maxScroll = 0;
  const seen = new Set();
  const pending = new Set();
  const visible = () => document.visibilityState === 'visible';
  const send = (final) => {
    const now = Date.now();
    const seconds = visible() || final ? Math.round((now - last) / 1000) : 0;
    last = now;
    const body = { token, view: viewId, seconds, scroll: maxScroll, sections: [...pending] };
    pending.clear();
    if (final) {
      try {
        fetch('/api/publico/proposta/evento', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm' }, body: JSON.stringify(body) });
      } catch {}
      return;
    }
    post('/api/publico/proposta/evento', body).catch(() => {});
  };
  const onScroll = () => {
    const h = document.documentElement;
    const p = Math.round(((h.scrollTop + window.innerHeight) / Math.max(1, h.scrollHeight)) * 100);
    if (p > maxScroll) maxScroll = Math.min(100, p);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      const k = e.target.dataset.sec;
      if (e.isIntersecting && !seen.has(k)) {
        seen.add(k);
        pending.add(k);
      }
    }), { threshold: 0.4 });
    $$('[data-sec]').forEach((el) => io.observe(el));
  }
  const timer = setInterval(() => (visible() ? send(false) : (last = Date.now())), 15000);
  document.addEventListener('visibilitychange', () => {
    if (!visible()) send(true);
    else last = Date.now();
  });
  window.addEventListener('pagehide', () => send(true));
  window.addEventListener('hashchange', () => {
    clearInterval(timer);
    send(true);
  }, { once: true });
}

let cur = null;
let bound = false;

export async function show(app, token, params = new URLSearchParams()) {
  const team = params.get('equipe') === '1';
  document.title = 'Proposta · Vero';
  // Não indexar a página da proposta
  if (!document.querySelector('meta[name=robots]')) {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex, nofollow';
    document.head.appendChild(m);
  }
  render(app, html`<div class="public-page"><p class="muted">Carregando a proposta…</p></div>`);
  let d;
  try {
    d = await get('/api/publico/proposta', { token, equipe: team ? '1' : '', device: matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop' });
  } catch (e) {
    return render(app, html`<div class="public-page verify-page"><header><span class="brand-logo" role="img" aria-label="Vero"></span><h1>Proposta indisponível</h1></header>
      <p class="muted">${e.message}</p></div>`);
  }
  d.team = team;
  cur = { token, d, team };
  render(app, page(d));
  if (d.view_id) track(token, d.view_id);
  if (bound) return params.get('imprimir') === '1' && setTimeout(() => window.print(), 500);
  bound = true;
  on(app, 'submit', '[data-adv]', async (e, f) => {
    e.preventDefault();
    const { token, d, team } = cur;
    if (team) return;
    const btn = $('button', f);
    btn.disabled = true;
    try {
      const r = await post('/api/publico/proposta/avancar', { token, note: f.note.value });
      d.advanced_at = r.advanced_at || new Date().toISOString();
      render(app, page(d));
    } catch (ex) {
      btn.disabled = false;
      toastError(ex);
    }
  });
  if (params.get('imprimir') === '1') setTimeout(() => window.print(), 500);
}
