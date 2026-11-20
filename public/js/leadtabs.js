// Abas do painel do lead da rodada 4: IA Vero (assistente comercial), Produtos (cross-sell/up-sell nas quatro áreas)
// e Diagnóstico financeiro (ferramenta da Vero Planejamento ligada ao CRM).
import { get, post, patch, del } from './api.js';
import { html, raw, esc, render, $, on, modal, field, toast, toastError, fmtMoney, fmtDate, fmtDateTime, relTime, badge, empty, can, hasModule } from './ui.js';
import { icon } from './icons.js';

const AREA_ICON = { consorcio: 'consorcio', planejamento: 'planejamento', seguros: 'seguros', investimentos: 'investimentos' };

/* ------------------------- utilidades ------------------------- */

/** Copia o texto para a área de transferência (com alternativa para navegadores sem a API). */
export async function copyText(text, msg = 'Copiado.') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast(msg);
}

/** Markdown mínimo das respostas da IA (negrito, citação e listas), sempre escapado. */
function md(text) {
  const lines = String(text || '').split('\n');
  let out = '';
  let list = false;
  for (const ln of lines) {
    const li = /^\s*[-*] (.*)$/.exec(ln);
    if (li && !list) {
      out += '<ul>';
      list = true;
    }
    if (!li && list) {
      out += '</ul>';
      list = false;
    }
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (li) out += `<li>${inline(li[1])}</li>`;
    else if (/^> /.test(ln)) out += `<blockquote>${inline(ln.slice(2))}</blockquote>`;
    else if (ln.trim()) out += `<p>${inline(ln)}</p>`;
  }
  if (list) out += '</ul>';
  return raw(out);
}

/** Abre uma URL numa nova guia sem bloqueio de pop-up (a guia é aberta no clique e recebe o endereço depois). */
async function openInNewTab(getUrl) {
  const w = window.open('about:blank', '_blank');
  try {
    const url = await getUrl();
    if (w) w.location.href = url;
    else location.href = url;
    return url;
  } catch (e) {
    w?.close();
    toastError(e);
    return null;
  }
}
const absUrl = (u) => new URL(u, document.baseURI).href;

/* ------------------------- IA Vero ------------------------- */

const CHANNEL_ICON = { ligacao: 'telefone', whatsapp: 'whatsapp', email: 'email', direct: 'direct', linkedin: 'linkedin' };

export async function renderAiTab(box, ctx) {
  const { contact: c } = ctx;
  render(box, html`<p class="muted small">A IA Vero está analisando o lead…</p>`);
  let ins;
  let hist = [];
  let st = null;
  try {
    [ins, hist, st] = await Promise.all([get(`/api/ia/leads/${c.id}`), get(`/api/ia/leads/${c.id}/conversa`).catch(() => []), get('/api/ia/status').catch(() => null)]);
  } catch (e) {
    render(box, html`<div class="alert danger">${e.message}</div>`);
    return;
  }
  if (!box.isConnected) return;
  ctx.ai = ins;
  const scoreCls = ins.score.value == null ? '' : ins.score.value >= 70 ? 'hi' : ins.score.value >= 40 ? 'mid' : 'lo';
  const ch = Object.entries(ins.channels || {});
  render(box, html`
    <div class="ai-tab">
      <section class="ai-hero">
        <div class="ai-hero-head">${icon('ia', 18)}<strong>IA Vero</strong><small class="muted">${st?.generative ? 'IA generativa ligada' : 'motor interno da plataforma'}</small>${ins.score.value != null ? html`<span class="score s-${scoreCls}" title="Score do lead">${ins.score.value}</span>` : ''}</div>
        <p class="ai-resumo">${ins.resumo}</p>
        <div class="ai-next"><small>Próximo passo</small><p>${ins.next}</p></div>
        ${ins.alerts.length ? html`<ul class="ai-alerts">${ins.alerts.map((a) => html`<li class="lv-${a.level}">${a.text}</li>`)}</ul>` : ''}
      </section>

      <section class="ai-chat" aria-label="Pergunte à IA">
        <div class="ai-chips">${(st?.suggestions || []).map((q) => html`<button type="button" class="chip" data-ai-ask="${q}">${q}</button>`)}</div>
        <div class="ai-msgs" data-ai-msgs>${hist.map((m) => aiMsg(m))}</div>
        <form class="ai-input" data-ai-form><input name="message" placeholder="Pergunte sobre este lead (ex.: como responder 'vou pensar'?)" autocomplete="off" maxlength="2000" required><button class="btn small primary" type="submit">${icon('enviar', 14)} Perguntar</button></form>
      </section>

      <div class="ai-grid">
        <section class="ai-card"><h4>${icon(CHANNEL_ICON[ins.canal.channel] || 'chat', 15)} Canal recomendado: ${ins.canal.label || '—'}</h4><p class="small">${ins.canal.reason}</p><p class="small muted">${ins.canal.hour}</p>
          ${ch.length ? html`<ul class="ai-chan">${ch.map(([k, v]) => html`<li>${icon(CHANNEL_ICON[k] || 'chat', 13)} ${v.label}: <strong>${v.out}</strong> enviada(s) · <strong>${v.in}</strong> resposta(s)${ins.team_rates?.[k] != null ? html` <small class="muted">· equipe ${Math.round(ins.team_rates[k] * 100)}% de resposta</small>` : ''}</li>`)}</ul>` : ''}</section>
        <section class="ai-card"><h4>Checklist BANT</h4><ul class="ai-bant">${ins.bant.map((b) => html`<li class="${b.ok ? 'ok' : ''}"><span class="bant-k">${b.key}</span><div><strong>${b.label}</strong>${b.ok ? html`<small>${b.value || 'informado'}</small>` : html`<small>Pergunte: “${b.ask}”</small>`}</div></li>`)}</ul></section>
        <section class="ai-card"><h4>Score potencial</h4><p class="small">${ins.score.value != null ? html`<strong>${ins.score.value}</strong> de 100.` : 'Sem negócio aberto.'} ${ins.score.missing.length ? html`Para subir: ${ins.score.missing.join(', ')}.` : 'Informações principais completas.'}</p>
          ${ins.open_items.length ? html`<h5>Em aberto</h5><ul class="small">${ins.open_items.map((x) => html`<li>${x}</li>`)}</ul>` : ''}</section>
        <section class="ai-card"><h4>Oportunidades (cross-sell)</h4><p class="small">Potencial mapeado: <strong>${fmtMoney(ins.products.potential)}</strong></p>${ins.cross_sell.length ? html`<ul class="small">${ins.cross_sell.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="small muted">Nenhuma sugestão nova. Registre em Produtos o que identificar.</p>`}</section>
      </div>

      <section class="ai-card wide"><h4>Perguntas para a próxima conversa (SPIN)</h4><ul class="ai-list">${ins.questions.map((q) => html`<li><span class="badge">${q.kind}</span> ${q.text} <button type="button" class="link-btn" data-copy="${q.text}" title="Copiar">${icon('copiar', 13)}</button></li>`)}</ul></section>

      <section class="ai-card wide"><h4>Objeções no WhatsApp</h4><div class="ai-obj">${ins.objections.map((o) => html`<details><summary>${o.title}</summary><blockquote>${o.response}</blockquote><small class="muted">${o.tip}</small>
        <div class="inline-actions"><button type="button" class="btn small" data-copy="${o.response}">${icon('copiar', 13)} Copiar</button>${hasModule('whatsapp') ? html`<a class="btn small ghost" href="#/comunicacao/whatsapp?contato=${c.id}&texto=${encodeURIComponent(o.response)}" data-close>${icon('whatsapp', 13)} Enviar pelo WhatsApp da empresa</a>` : ''}${o.kb_id ? html`<button type="button" class="link-btn" data-ai-kb="${o.kb_id}" data-rate="1" title="Ajudou">${icon('curtir', 14)}</button><button type="button" class="link-btn" data-ai-kb="${o.kb_id}" data-rate="-1" title="Não ajudou">${icon('descurtir', 14)}</button>` : ''}</div></details>`)}</div></section>

      <section class="ai-card wide"><h4>Mensagens prontas</h4><ul class="ai-list">${ins.messages.map((m) => html`<li><strong>${m.title}</strong><p class="small">${m.text}</p><button type="button" class="btn small" data-copy="${m.text}">${icon('copiar', 13)} Copiar</button></li>`)}</ul>
        ${ins.tips.length ? html`<h5>Dicas da equipe</h5><ul class="small">${ins.tips.map((t) => html`<li><strong>${t.title}:</strong> ${t.text}</li>`)}</ul>` : ''}</section>
      <p class="hint">A IA Vero usa os dados do CRM (etapa, atividades, qualificação, propostas, produtos e diagnóstico) e a base de conhecimento da equipe, que cresce com os 👍/👎 e com o que a liderança cadastra em Ferramentas › Base da IA Vero.</p>
    </div>`);
  const msgs = $('[data-ai-msgs]', box);
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

const aiMsg = (m) => html`<div class="ai-msg ${m.role}" data-mid="${m.id || ''}">${m.role === 'assistant' ? html`<div class="ai-msg-body">${md(m.content)}</div>
  <div class="ai-msg-actions"><small class="muted">${m.engine === 'claude' ? 'IA generativa' : 'IA Vero'}</small><button type="button" class="link-btn" data-copy="${m.content.replace(/\*\*/g, '').replace(/^> /gm, '')}" title="Copiar">${icon('copiar', 13)}</button>${m.id ? html`<button type="button" class="link-btn ${m.rating === 1 ? 'on' : ''}" data-ai-rate="${m.id}" data-rate="1" title="Ajudou">${icon('curtir', 13)}</button><button type="button" class="link-btn ${m.rating === -1 ? 'on' : ''}" data-ai-rate="${m.id}" data-rate="-1" title="Não ajudou">${icon('descurtir', 13)}</button>` : ''}</div>` : html`<p>${m.content}</p>`}</div>`;

async function ask(el, ctx, question) {
  const box = $('[data-ai-msgs]', el);
  if (!box || !question) return;
  box.insertAdjacentHTML('beforeend', String(aiMsg({ role: 'user', content: question })));
  box.insertAdjacentHTML('beforeend', '<div class="ai-msg assistant typing"><p>…</p></div>');
  box.scrollTop = box.scrollHeight;
  try {
    const r = await post(`/api/ia/leads/${ctx.contact.id}/conversa`, { message: question });
    box.querySelector('.typing')?.remove();
    box.insertAdjacentHTML('beforeend', String(aiMsg({ id: r.id, role: 'assistant', content: r.answer, engine: r.engine })));
    if (r.note) toast(r.note);
  } catch (e) {
    box.querySelector('.typing')?.remove();
    toastError(e);
  }
  box.scrollTop = box.scrollHeight;
}

/* ------------------------- Produtos (cross-sell / up-sell) ------------------------- */

export async function renderProductsTab(box, ctx) {
  const { contact: c } = ctx;
  render(box, html`<p class="muted small">Carregando os produtos…</p>`);
  let r;
  try {
    r = await get(`/api/cadastros/${c.id}/produtos`);
  } catch (e) {
    render(box, html`<div class="alert danger">${e.message}</div>`);
    return;
  }
  if (!box.isConnected) return;
  ctx.products = r;
  const w = can.write();
  render(box, html`
    <div class="prod-summary"><div><small>Potencial mapeado (cross-sell e up-sell)</small><strong>${fmtMoney(r.potential)}</strong></div>
      ${Object.entries(r.areas).map(([k, a]) => html`<div class="prod-kpi area-${k}">${icon(AREA_ICON[k], 16)}<span><strong>${r.totals[k].count}</strong><small>${a.label}</small></span></div>`)}</div>
    <div class="prod-areas">${Object.entries(r.areas).map(([k, a]) => {
      const items = r.rows.filter((p) => p.area === k);
      return html`<section class="prod-area area-${k}"><header>${icon(AREA_ICON[k], 20)}<div class="grow"><h4>${a.label}</h4><small class="muted">${a.hint}</small></div>${w ? html`<button type="button" class="btn small" data-prod-new="${k}">${icon('adicionar', 13)} Adicionar</button>` : ''}</header>
        ${items.length ? html`<ul class="prod-list">${items.map((p) => html`<li class="st-${p.status}"><div class="grow"><strong>${a.subs[p.sub_type] || p.sub_type}</strong> ${badge(r.status[p.status], { potencial: '', em_andamento: 'warn', convertido: 'ok', descartado: 'muted' }[p.status])}
          <small class="muted">${p.value ? fmtMoney(p.value) : ''}${p.value && p.value_range ? ' · ' : ''}${p.value_range ? a.ranges?.[p.value_range] : ''}</small>
          ${p.description ? html`<p class="small">${p.description}</p>` : ''}${p.notes ? html`<p class="small muted">${p.notes}</p>` : ''}</div>
          ${w ? html`<div class="prod-actions"><button type="button" class="link-btn" data-prod-edit="${p.id}">Editar</button><button type="button" class="link-btn danger" data-prod-del="${p.id}">Excluir</button></div>` : ''}</li>`)}</ul>` : html`<p class="small muted">Nenhuma oportunidade mapeada.</p>`}</section>`;
    })}</div>`);
}

function productForm(ctx, area, p = null) {
  const { areas, status } = ctx.products;
  const a = areas[area];
  return modal({
    title: `${p ? 'Editar' : 'Nova'} oportunidade — ${a.label}`,
    wide: true,
    body: html`<div class="grid">
      ${field({ name: 'sub_type', label: 'Oportunidade', type: 'select', options: Object.entries(a.subs).map(([value, label]) => ({ value, label })), value: p?.sub_type, required: true, allowEmpty: false, full: true })}
      ${field({ name: 'description', label: `Descrição (${a.descLabel.toLowerCase()})`, type: 'textarea', rows: 2, value: p?.description, full: true })}
      ${a.ranges ? field({ name: 'value_range', label: 'Volume estimado de captação', type: 'select', options: Object.entries(a.ranges).map(([value, label]) => ({ value, label })), value: p?.value_range }) : ''}
      ${field({ name: 'value', label: a.valueLabel, type: 'money', value: p?.value })}
      ${field({ name: 'status', label: 'Situação', type: 'select', options: Object.entries(status).map(([value, label]) => ({ value, label })), value: p?.status || 'potencial', allowEmpty: false })}
      ${field({ name: 'notes', label: 'Observação', type: 'textarea', rows: 2, value: p?.notes, full: true })}
    </div>`,
    async onSubmit(d) {
      if (p) await patch(`/api/produtos-lead/${p.id}`, d);
      else await post('/api/produtos-lead', { ...d, area, contact_id: ctx.contact.id, opportunity_id: ctx.opp?.id });
      toast('Oportunidade salva.');
      return true;
    },
  });
}

/* ------------------------- Diagnóstico financeiro ------------------------- */

export async function renderDiagTab(box, ctx) {
  const { contact: c } = ctx;
  render(box, html`<p class="muted small">Carregando o diagnóstico…</p>`);
  let r;
  try {
    r = await get(`/api/cadastros/${c.id}/diagnostico`);
  } catch (e) {
    render(box, html`<div class="alert danger">${e.message}</div>`);
    return;
  }
  if (!box.isConnected) return;
  const d = r.current;
  const s = d?.summary;
  const w = can.write();
  render(box, html`
    <section class="diag-head">
      <div class="diag-logo"><img src="img/vero-planejamento-dark.png" alt="Vero Planejamento" class="logo-dark"><img src="img/vero-planejamento-light.png" alt="Vero Planejamento" class="logo-light"></div>
      <div class="grow"><h4>Diagnóstico financeiro</h4>
        <p class="small">${!d ? 'Ainda não realizado para este lead.' : d.status === 'concluido' ? html`${badge('Concluído', 'ok')} em ${fmtDate(d.completed_at || d.updated_at)} · ${d.created_by_name || ''}` : html`${badge('Em andamento', 'warn')} · atualizado ${relTime(d.updated_at)}`}</p></div>
    </section>
    <div class="inline-actions diag-actions">
      ${!d && w ? html`<button type="button" class="btn primary" data-diag-start>${icon('diagnostico', 15)} Realizar diagnóstico financeiro</button>` : ''}
      ${d && d.status !== 'concluido' && w ? html`<button type="button" class="btn primary" data-diag-open="${d.id}">${icon('externo', 14)} Continuar diagnóstico</button><button type="button" class="btn" data-diag-done="${d.id}">Marcar como concluído</button>` : ''}
      ${d && d.status === 'concluido' ? html`<button type="button" class="btn primary" data-diag-open="${d.id}">${icon('externo', 14)} Abrir diagnóstico completo</button>${w ? html`<button type="button" class="btn ghost" data-diag-start="new">Novo diagnóstico</button>` : ''}` : ''}
    </div>
    <p class="hint">O diagnóstico abre em uma nova guia, já com o nome, e-mail, telefone, nascimento e profissão do cliente. Tudo o que for preenchido volta para o CRM automaticamente (abre de qualquer computador).</p>
    ${s ? html`<section class="diag-sum">
      <div class="diag-kpis"><div><strong>${s.objetivos.length}</strong><small>objetivos</small></div><div><strong>${s.plano.length}</strong><small>ações no plano</small></div><div><strong>${s.patrimonio_itens}</strong><small>bens</small></div><div><strong>${s.dividas_itens}</strong><small>dívidas</small></div><div><strong>${s.dependentes}</strong><small>dependentes</small></div></div>
      ${s.objetivos.length ? html`<h5>Objetivos</h5><ul class="small">${s.objetivos.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
      ${s.plano.length ? html`<h5>Plano de ação</h5><ol class="small">${s.plano.map((x) => html`<li>${x.titulo}${x.prazo ? html` <small class="muted">· ${x.prazo}</small>` : ''}</li>`)}</ol>` : ''}
      <div class="diag-future"><div><strong>Estrela Vero</strong><small>${s.estrela ? Object.entries(s.estrela).map(([k, v]) => `${k}: ${v}`).join(' · ') : 'Notas por pilar: entram aqui quando o diagnóstico enviar a estrela.'}</small></div><div><strong>Matriz de oportunidades</strong><small>Cruza o diagnóstico com Produtos (consórcio, seguros, investimentos, planejamento).</small></div></div>
    </section>` : ''}
    ${r.history.length ? html`<h5>Diagnósticos anteriores</h5><ul class="feed">${r.history.map((h) => html`<li><div>${badge(h.status === 'concluido' ? 'Concluído' : 'Em andamento', h.status === 'concluido' ? 'ok' : 'warn')} <small class="muted">${fmtDateTime(h.created_at)} · ${h.created_by_name || ''}</small> <button type="button" class="link-btn" data-diag-open="${h.id}">abrir</button></div></li>`)}</ul>` : ''}`);
}

/** Abre a ferramenta do diagnóstico para o cliente (retoma o que está em andamento ou cria um novo). */
export function startDiagnostic(contactId, { opportunityId = null, fresh = false } = {}) {
  return openInNewTab(async () => {
    const r = await post('/api/diagnosticos', { contact_id: contactId, opportunity_id: opportunityId, new: fresh });
    return absUrl(r.url);
  });
}
export const openDiagnostic = (id) => window.open(absUrl(`ferramentas/diagnostico-financeiro.html?crm=${id}#/clientes/crm-${id}`), '_blank', 'noopener');

/* ------------------------- eventos ------------------------- */

/** Liga os eventos das três abas no painel (delegação no elemento do painel). */
export function bindLeadTabs(el, getCtx, { redraw }) {
  on(el, 'click', '[data-copy]', (e, b) => copyText(b.dataset.copy));
  on(el, 'click', '[data-ai-ask]', (e, b) => ask(el, getCtx(), b.dataset.aiAsk));
  on(el, 'submit', '[data-ai-form]', (e, f) => {
    e.preventDefault();
    const q = f.message.value.trim();
    f.message.value = '';
    ask(el, getCtx(), q);
  });
  on(el, 'click', '[data-ai-rate]', async (e, b) => {
    try {
      await post('/api/ia/avaliar', { message_id: Number(b.dataset.aiRate), rating: Number(b.dataset.rate) });
      b.parentElement.querySelectorAll('[data-ai-rate]').forEach((x) => x.classList.toggle('on', x === b));
      toast('Obrigado: a avaliação ajuda a IA Vero a melhorar.');
    } catch (ex) {
      toastError(ex);
    }
  });
  on(el, 'click', '[data-ai-kb]', async (e, b) => {
    try {
      await post('/api/ia/avaliar', { kb_id: Number(b.dataset.aiKb), rating: Number(b.dataset.rate) });
      b.classList.add('on');
      toast('Avaliação registrada na base da equipe.');
    } catch (ex) {
      toastError(ex);
    }
  });
  on(el, 'click', '[data-prod-new]', async (e, b) => {
    if (await productForm(getCtx(), b.dataset.prodNew)) redraw('produtos');
  });
  on(el, 'click', '[data-prod-edit]', async (e, b) => {
    const ctx = getCtx();
    const p = ctx.products.rows.find((x) => x.id === Number(b.dataset.prodEdit));
    if (p && (await productForm(ctx, p.area, p))) redraw('produtos');
  });
  on(el, 'click', '[data-prod-del]', async (e, b) => {
    if (!window.confirm('Excluir esta oportunidade?')) return;
    try {
      await del(`/api/produtos-lead/${b.dataset.prodDel}`);
      redraw('produtos');
    } catch (ex) {
      toastError(ex);
    }
  });
  on(el, 'click', '[data-diag-start]', async (e, b) => {
    const ctx = getCtx();
    if (await startDiagnostic(ctx.contact.id, { opportunityId: ctx.opp?.id, fresh: b.dataset.diagStart === 'new' })) setTimeout(() => redraw('diagnostico'), 800);
  });
  on(el, 'click', '[data-diag-open]', (e, b) => openDiagnostic(Number(b.dataset.diagOpen)));
  on(el, 'click', '[data-diag-done]', async (e, b) => {
    try {
      await post(`/api/diagnosticos/${b.dataset.diagDone}/concluir`, {});
      toast('Diagnóstico concluído.');
      redraw('diagnostico');
    } catch (ex) {
      toastError(ex);
    }
  });
}
