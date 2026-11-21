// Abas do painel do lead da rodada 4: IA Vero (assistente comercial), Produtos (cross-sell/up-sell nas quatro áreas)
// e Diagnóstico financeiro (ferramenta da Vero Planejamento ligada ao CRM).
import { get, post, patch, put, del, download } from './api.js';
import { html, raw, esc, render, $, $$, on, modal, field, opts, optLabel, state, toast, toastError, fmtMoney, fmtDate, fmtDateTime, relTime, badge, empty, can, hasModule } from './ui.js';
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
const QUICK_ICON = { objecoes: 'seguros', proximo: 'bandeira', combinado: 'lista', mensagem: 'caneta' };
const SUBTABS = [['chat', 'Chat', 'chat'], ['analise', 'Análise', 'relatorios'], ['resumo', 'Resumo', 'propostas']];

/** Orbe animado da IA Vero (anel de luz girando e "respirando"). */
const orb = (size = '') => html`<div class="vai-orb ${size}" aria-hidden="true"><span></span><i></i></div>`;
const emptyChat = () => html`<div class="vai-empty">${orb()}<p class="vai-hello">Converse com a <b>IA Vero</b></p><p class="vai-sub-txt">Sua coach de vendas com IA para analisar esta negociação.</p></div>`;

/**
 * Aba IA Vero: Chat (conversa com a coach de vendas, com orbe animado, atalhos, histórico de conversas e fontes),
 * Análise (próximo passo, canal, BANT, SPIN, objeções, mensagens) e Resumo (o que se sabe do lead e do que foi combinado).
 */
export async function renderAiTab(box, ctx) {
  const { contact: c } = ctx;
  ctx.aiSub ||= 'chat';
  render(box, html`<div class="vai"><div class="vai-loading">${orb('sm')}<span>A IA Vero está analisando o lead…</span></div></div>`);
  let ins;
  let st = null;
  let hist = { threads: [], messages: [] };
  try {
    [ins, st] = await Promise.all([get(`/api/ia/leads/${c.id}`), get('/api/ia/status').catch(() => null)]);
    if (ctx.aiThread) hist = await get(`/api/ia/leads/${c.id}/conversa`, { thread: ctx.aiThread }).catch(() => hist);
  } catch (e) {
    render(box, html`<div class="alert danger">${e.message}</div>`);
    return;
  }
  if (!box.isConnected) return;
  ctx.ai = ins;
  ctx.aiStatus = st;
  const quick = st?.quick || [];
  render(box, html`<div class="vai">
    <nav class="vai-subtabs" role="tablist">${SUBTABS.map(([k, label, ic]) => html`<button type="button" role="tab" class="${ctx.aiSub === k ? 'active' : ''}" aria-selected="${ctx.aiSub === k}" data-vai-sub="${k}">${icon(ic, 14)} ${label}</button>`)}</nav>
    <section class="vai-chat" data-vai-pane="chat" ${ctx.aiSub === 'chat' ? '' : raw('hidden')}>
      <header class="vai-head"><span class="vai-title">${icon('ia', 14)} <strong data-vai-title>${hist.messages.length ? 'Conversa' : 'Nova conversa'}</strong></span><span class="grow"></span>
        <button type="button" class="vai-src" data-vai-sources title="Dados que a IA Vero consultou">${ins.sources.length} fontes</button>
        <button type="button" class="icon-btn" data-vai-hist title="Conversas anteriores" aria-label="Conversas anteriores">${icon('historico', 16)}</button>
        <button type="button" class="icon-btn" data-vai-new title="Nova conversa" aria-label="Nova conversa">${icon('editar', 16)}</button>
      </header>
      <div class="vai-pop" data-vai-popover hidden></div>
      <div class="vai-body" data-vai-body>${hist.messages.length ? hist.messages.map((m) => aiMsg(m)) : emptyChat()}</div>
      <div class="vai-quick">${quick.map((q) => html`<button type="button" class="vai-chip" data-ai-ask="${q.prompt}">${icon(QUICK_ICON[q.key] || 'ia', 13)} ${q.label}</button>`)}</div>
      <form class="vai-input" data-ai-form><textarea name="message" rows="1" placeholder="Pergunte algo sobre esta negociação…" maxlength="2000" aria-label="Pergunta para a IA Vero"></textarea><button class="vai-send" type="submit" aria-label="Enviar">${icon('enviar', 16)}</button></form>
      <small class="vai-foot">${st?.generative ? 'IA generativa' : 'IA Vero (motor interno)'} · Enter envia · Shift+Enter quebra linha</small>
    </section>
    <section data-vai-pane="analise" ${ctx.aiSub === 'analise' ? '' : raw('hidden')}>${analysisPane(ins, c)}</section>
    <section data-vai-pane="resumo" ${ctx.aiSub === 'resumo' ? '' : raw('hidden')}>${summaryPane(ins)}</section>
  </div>`);
  const body = $('[data-vai-body]', box);
  if (body) body.scrollTop = body.scrollHeight;
}

/** Análise: próximo passo, alertas, canal, BANT, score, oportunidades, SPIN, objeções e mensagens. */
function analysisPane(ins, c) {
  const scoreCls = ins.score.value == null ? '' : ins.score.value >= 70 ? 'hi' : ins.score.value >= 40 ? 'mid' : 'lo';
  const ch = Object.entries(ins.channels || {});
  return html`<div class="ai-tab">
    <section class="ai-hero"><div class="ai-hero-head">${icon('ia', 16)}<strong>Próximo passo</strong>${ins.score.value != null ? html`<span class="score s-${scoreCls}" title="Score do lead">${ins.score.value}</span>` : ''}</div>
      <p class="ai-next-txt">${ins.next}</p>
      ${ins.alerts.length ? html`<ul class="ai-alerts">${ins.alerts.map((a) => html`<li class="lv-${a.level}">${a.text}</li>`)}</ul>` : ''}</section>
    <div class="ai-grid">
      <section class="ai-card"><h4>${icon(CHANNEL_ICON[ins.canal.channel] || 'chat', 15)} Canal recomendado: ${ins.canal.label || '—'}</h4><p class="small">${ins.canal.reason}</p><p class="small muted">${ins.canal.hour}</p>
        ${ch.length ? html`<ul class="ai-chan">${ch.map(([k, v]) => html`<li>${icon(CHANNEL_ICON[k] || 'chat', 13)} ${v.label}: <strong>${v.out}</strong> enviada(s) · <strong>${v.in}</strong> resposta(s)${ins.team_rates?.[k] != null ? html` <small class="muted">· equipe ${Math.round(ins.team_rates[k] * 100)}%</small>` : ''}</li>`)}</ul>` : ''}</section>
      <section class="ai-card"><h4>Checklist BANT</h4><ul class="ai-bant">${ins.bant.map((b) => html`<li class="${b.ok ? 'ok' : ''}"><span class="bant-k">${b.key}</span><div><strong>${b.label}</strong>${b.ok ? html`<small>${b.value || 'Informado'}</small>` : html`<small>Pergunte: “${b.ask}”</small>`}</div></li>`)}</ul></section>
      <section class="ai-card"><h4>Score potencial</h4><p class="small">${ins.score.value != null ? html`<strong>${ins.score.value}</strong> de 100.` : 'Sem negócio aberto.'} ${ins.score.missing.length ? html`Para subir: ${ins.score.missing.join(', ')}.` : 'Informações principais completas.'}</p></section>
      <section class="ai-card"><h4>Oportunidades</h4><p class="small">Potencial mapeado: <strong>${fmtMoney(ins.products.potential)}</strong></p>${ins.cross_sell.length ? html`<ul class="small">${ins.cross_sell.map((x) => html`<li>${x}</li>`)}</ul>` : ''}</section>
    </div>
    <section class="ai-card wide"><h4>Perguntas para a próxima conversa (SPIN)</h4><ul class="ai-list">${ins.questions.map((q) => html`<li><span class="badge">${q.kind}</span> ${q.text} <button type="button" class="link-btn" data-copy="${q.text}" title="Copiar">${icon('copiar', 13)}</button></li>`)}</ul></section>
    <section class="ai-card wide"><h4>Objeções no WhatsApp</h4><div class="ai-obj">${ins.objections.map((o) => html`<details><summary>${o.title}</summary><blockquote>${o.response}</blockquote><small class="muted">${o.tip}</small>
      <div class="inline-actions"><button type="button" class="btn small" data-copy="${o.response}">${icon('copiar', 13)} Copiar</button>${hasModule('whatsapp') ? html`<a class="btn small ghost" href="#/comunicacao/whatsapp?contato=${c.id}&texto=${encodeURIComponent(o.response)}" data-close>${icon('whatsapp', 13)} Enviar pelo WhatsApp</a>` : ''}${o.kb_id ? html`<button type="button" class="link-btn" data-ai-kb="${o.kb_id}" data-rate="1" title="Ajudou">${icon('curtir', 14)}</button><button type="button" class="link-btn" data-ai-kb="${o.kb_id}" data-rate="-1" title="Não ajudou">${icon('descurtir', 14)}</button>` : ''}</div></details>`)}</div></section>
    <section class="ai-card wide"><h4>Mensagens prontas</h4><ul class="ai-list">${ins.messages.map((m) => html`<li><strong>${m.title}</strong><p class="small">${m.text}</p><button type="button" class="btn small" data-copy="${m.text}">${icon('copiar', 13)} Copiar</button></li>`)}</ul>
      ${ins.tips.length ? html`<h5>Dicas da equipe</h5><ul class="small">${ins.tips.map((t) => html`<li><strong>${t.title}:</strong> ${t.text}</li>`)}</ul>` : ''}</section>
  </div>`;
}

/** Resumo: quem é o lead, em que pé está, o que foi combinado, o que está em aberto e as oportunidades. */
function summaryPane(ins) {
  const bantOk = ins.bant.filter((b) => b.ok).map((b) => b.label.split(' ')[0]);
  const bantMiss = ins.bant.filter((b) => !b.ok).map((b) => b.label.split(' ')[0]);
  return html`<div class="vai-resumo">
    <section><h5>Quem é</h5><p>${ins.resumo}</p></section>
    <section><h5>Em que pé está</h5><p>${ins.stage ? html`<strong>${ins.stage.name}</strong> há ${ins.stage.days} dia(s). ` : ''}${ins.next}</p>${ins.r1_deadline ? html`<p class="small muted">Prazo da cadência (R1): ${fmtDate(ins.r1_deadline)}</p>` : ''}</section>
    <section><h5>O que foi combinado</h5>${ins.agreed.length ? html`<ul>${ins.agreed.map((x) => html`<li>${x.text} <small class="muted">${fmtDate(x.at)}</small></li>`)}</ul>` : html`<p class="muted small">Ainda não há anotações de reunião ou de conversa.</p>`}</section>
    <section><h5>Em aberto</h5>${ins.open_items.length ? html`<ul>${ins.open_items.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="muted small">Nada pendente.</p>`}</section>
    <section><h5>Qualificação (BANT)</h5><p>${bantOk.length ? html`Levantado: ${bantOk.join(', ')}. ` : ''}${bantMiss.length ? html`Falta: ${bantMiss.join(', ')}.` : 'Completa.'}</p></section>
    <section><h5>Oportunidades</h5><p>Potencial mapeado: <strong>${fmtMoney(ins.products.potential)}</strong>${ins.diagnostic ? html` · Diagnóstico ${ins.diagnostic.status === 'concluido' ? 'concluído' : 'em andamento'}` : ''}</p>${ins.cross_sell.length ? html`<ul>${ins.cross_sell.map((x) => html`<li>${x}</li>`)}</ul>` : ''}</section>
    <p class="hint">Fontes: ${ins.sources.map((x) => x.label).join(' · ')}.</p>
  </div>`;
}

const aiMsg = (m) => html`<div class="ai-msg ${m.role}" data-mid="${m.id || ''}">${m.role === 'assistant' ? html`<span class="ai-msg-ava">${orb('xs')}</span><div class="ai-msg-main"><div class="ai-msg-body">${md(m.content)}</div>
  <div class="ai-msg-actions"><small class="muted">${m.engine === 'claude' ? 'IA generativa' : 'IA Vero'}</small><button type="button" class="link-btn" data-copy="${m.content.replace(/\*\*/g, '').replace(/^> /gm, '')}" title="Copiar">${icon('copiar', 13)}</button>${m.id ? html`<button type="button" class="link-btn ${m.rating === 1 ? 'on' : ''}" data-ai-rate="${m.id}" data-rate="1" title="Ajudou">${icon('curtir', 13)}</button><button type="button" class="link-btn ${m.rating === -1 ? 'on' : ''}" data-ai-rate="${m.id}" data-rate="-1" title="Não ajudou">${icon('descurtir', 13)}</button>` : ''}</div></div>` : html`<p>${m.content}</p>`}</div>`;

async function ask(el, ctx, question) {
  const box = $('[data-vai-body]', el);
  if (!box || !question) return;
  $('.vai-empty', box)?.remove();
  box.insertAdjacentHTML('beforeend', String(aiMsg({ role: 'user', content: question })));
  box.insertAdjacentHTML('beforeend', String(html`<div class="ai-msg assistant typing"><span class="ai-msg-ava">${orb('xs think')}</span><div class="ai-msg-main"><p class="muted">Analisando a negociação…</p></div></div>`));
  box.scrollTop = box.scrollHeight;
  const title = $('[data-vai-title]', el);
  if (title) title.textContent = 'Conversa';
  try {
    const r = await post(`/api/ia/leads/${ctx.contact.id}/conversa`, { message: question, thread: ctx.aiThread || undefined });
    ctx.aiThread = r.thread;
    box.querySelector('.typing')?.remove();
    box.insertAdjacentHTML('beforeend', String(aiMsg({ id: r.id, role: 'assistant', content: r.answer, engine: r.engine })));
    if (r.note) toast(r.note);
  } catch (e) {
    box.querySelector('.typing')?.remove();
    toastError(e);
  }
  box.scrollTop = box.scrollHeight;
}

async function showHistory(el, ctx) {
  const pop = $('[data-vai-popover]', el);
  if (!pop) return;
  if (!pop.hidden && pop.dataset.kind === 'hist') return (pop.hidden = true);
  pop.dataset.kind = 'hist';
  pop.hidden = false;
  render(pop, html`<p class="muted small">Carregando…</p>`);
  try {
    const r = await get(`/api/ia/leads/${ctx.contact.id}/conversa`);
    render(pop, html`<strong>Conversas anteriores</strong>${r.threads.length ? html`<ul>${r.threads.map((t) => html`<li><button type="button" data-vai-open="${t.thread}"><span>${t.first || 'Conversa'}</span><small>${fmtDateTime(t.last_at)} · ${Math.ceil(t.n / 2)} pergunta(s)</small></button></li>`)}</ul>` : html`<p class="muted small">Nenhuma conversa ainda.</p>`}`);
  } catch (e) {
    render(pop, html`<p class="danger-text small">${e.message}</p>`);
  }
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
  const SHORT = { consorcio: 'Consórcio', planejamento: 'Planejamento', seguros: 'Seguros', investimentos: 'Investimentos' };
  render(box, html`
    <div class="prod-total"><span>Potencial mapeado</span><strong>${fmtMoney(r.potential)}</strong></div>
    <div class="prod-kpis">${Object.keys(r.areas).map((k) => html`<div class="prod-kpi area-${k}"><span class="pk-title">${icon(AREA_ICON[k], 14)} ${SHORT[k]}</span><small>Potencial mapeado</small><strong>${fmtMoney(r.totals[k].potential)}</strong></div>`)}</div>
    <div class="prod-areas">${Object.entries(r.areas).map(([k, a]) => {
      const items = r.rows.filter((p) => p.area === k);
      return html`<section class="prod-area area-${k}"><header>${icon(AREA_ICON[k], 18)}<h4 class="grow">${a.label}</h4>${w ? html`<button type="button" class="btn small" data-prod-new="${k}">${icon('adicionar', 13)} Adicionar</button>` : ''}</header>
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

/* ------------------------- Arquivos do lead ------------------------- */

const EXT_ICON = (name) => (/\.(png|jpe?g|webp|gif|heic)$/i.test(name) ? 'anexo' : /\.(xlsx?|csv|ods)$/i.test(name) ? 'relatorios' : 'propostas');
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function fileToBase64(file) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => fail(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

/** Arquivos do cliente: extratos, apólices, carteiras, contratos... com descrição, objetivo, observações e vínculo ao negócio. */
export async function renderFilesTab(box, ctx) {
  const { contact: c } = ctx;
  render(box, html`<p class="muted small">Carregando os arquivos…</p>`);
  let rows;
  try {
    rows = await get(`/api/cadastros/${c.id}/anexos`);
  } catch (e) {
    render(box, html`<div class="alert danger">${e.message}</div>`);
    return;
  }
  if (!box.isConnected) return;
  ctx.files = rows;
  const w = can.write();
  render(box, html`<div class="section-head"><h4>Arquivos do cliente</h4>${w ? html`<button type="button" class="btn small primary" data-file-new>${icon('anexo', 14)} Anexar arquivo</button>` : ''}</div>
    <p class="hint">Extratos, apólices, carteira de investimentos, contratos de outras instituições e outros documentos do cliente. Formatos: PDF, imagem, Word, Excel ou CSV (até 8 MB).</p>
    ${rows.length ? html`<ul class="file-list">${rows.map((a) => html`<li><span class="file-ico">${icon(EXT_ICON(a.filename), 18)}</span>
      <div class="grow"><strong>${a.description || a.filename}</strong> <span class="badge">${optLabel('tipo_documento', a.doc_type) || 'Outro'}</span>${a.source === 'cliente' ? html` <span class="badge info">Enviado pelo cliente</span>` : ''}
        ${a.purpose ? html`<p class="small"><span class="muted">Objetivo:</span> ${a.purpose}</p>` : ''}${a.notes ? html`<p class="small muted">${a.notes}</p>` : ''}
        <small class="muted">${a.filename} · ${fmtSize(a.size)} · ${fmtDateTime(a.created_at)} · ${a.uploaded_by_name || 'Cliente'}${a.opportunity_ids.length ? ` · negócio ${a.opportunity_ids.map((id) => (c.opportunities || []).find((o) => o.id === id)?.code || id).join(', ')}` : ''}</small></div>
      <div class="file-actions"><button type="button" class="link-btn" data-file-dl="${a.id}">Baixar</button>${w ? html`<button type="button" class="link-btn" data-file-edit="${a.id}">Editar</button>` : ''}${w && (can.manage() || (a.source === 'equipe' && a.uploaded_by === state.user.id)) ? html`<button type="button" class="link-btn danger" data-file-del="${a.id}">Remover</button>` : ''}</div></li>`)}</ul>`
    : html`<div class="empty-files">${icon('anexo', 26)}<p>Nenhum arquivo anexado.</p></div>`}`);
}

function fileForm(ctx, a = null) {
  const c = ctx.contact;
  const opps = (c.opportunities || []).map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` }));
  return modal({
    title: a ? 'Editar arquivo' : `Anexar arquivo — ${c.name}`,
    wide: true,
    submitLabel: a ? 'Salvar' : 'Anexar',
    body: html`<div class="grid">
      ${a ? html`<p class="full small muted">Arquivo: <strong>${a.filename}</strong></p>` : html`<div class="field full"><label>Arquivo <span class="req">*</span></label><input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,.odt,.ods"></div>`}
      ${field({ name: 'doc_type', label: 'Tipo de arquivo', type: 'select', options: opts('tipo_documento'), value: a?.doc_type || 'extrato', allowEmpty: false })}
      ${opps.length ? field({ name: 'opportunity_id', label: 'Vincular ao negócio', type: 'select', options: opps, value: a?.opportunity_ids?.[0] || ctx.opp?.id, placeholder: 'Só ao cliente' }) : ''}
      ${field({ name: 'description', label: 'Descrição do arquivo', value: a?.description, full: true, required: true, placeholder: 'Ex.: Extrato da carteira de investimentos — Banco X, outubro/2026' })}
      ${field({ name: 'purpose', label: 'Objetivo', value: a?.purpose, full: true, placeholder: 'Ex.: Avaliar a migração da carteira; base para o diagnóstico financeiro' })}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', rows: 2, value: a?.notes, full: true })}
    </div>`,
    async onSubmit(d, form) {
      const link = d.opportunity_id ? [Number(d.opportunity_id)] : [];
      if (a) {
        await patch(`/api/anexos/${a.id}`, { doc_type: d.doc_type, description: d.description, purpose: d.purpose, notes: d.notes, opportunity_ids: link });
        toast('Arquivo atualizado.');
        return true;
      }
      const f = form.file.files[0];
      if (!f) throw new Error('Escolha o arquivo.');
      if (f.size > 8 * 1024 * 1024) throw new Error('Arquivo maior que 8 MB.');
      await post(`/api/cadastros/${c.id}/anexos`, { filename: f.name, mime: f.type, content_base64: await fileToBase64(f), doc_type: d.doc_type, description: d.description, purpose: d.purpose, notes: d.notes, opportunity_ids: link });
      toast('Arquivo anexado.');
      return true;
    },
  });
}

/* ------------------------- Recomendações (indicações) ------------------------- */

const MIN_REF_ROWS = 5;
const REF_FIELDS = [['name', 'Nome'], ['phone', 'Telefone'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['recommended_by', 'Quem recomendou']];

/** Recomendações do lead: 5 linhas (ou mais), salvas automaticamente; "+" cadastra a indicação no pipeline. */
export async function renderReferralsTab(box, ctx) {
  const { contact: c } = ctx;
  render(box, html`<p class="muted small">Carregando as recomendações…</p>`);
  let r;
  try {
    r = await get(`/api/cadastros/${c.id}/recomendacoes`);
  } catch (e) {
    render(box, html`<div class="alert danger">${e.message}</div>`);
    return;
  }
  if (!box.isConnected) return;
  ctx.referrals = r.rows;
  const w = can.write();
  const rows = [...r.rows];
  while (rows.length < MIN_REF_ROWS) rows.push({});
  const filled = r.rows.filter((x) => x.name).length;
  render(box, html`
    <section class="ref-head"><div><strong>Recomendações deste lead</strong><small>Preencha as indicações com nome, telefone, WhatsApp, e-mail e quem recomendou. Clique em <b>+</b> para cadastrar a indicação no seu pipeline.</small></div>
      <span class="ref-count"><strong>${filled}</strong> / ${rows.length}</span></section>
    ${r.imported ? html`<div class="alert ok-alert small">${r.imported} indicação(ões) trazida(s) do diagnóstico financeiro.</div>` : ''}
    <form class="ref-list" data-ref-form>${rows.map((x, i) => refRow(x, i, w))}</form>
    ${w ? html`<div class="inline-actions"><button type="button" class="btn small" data-ref-add>${icon('adicionar', 13)} Adicionar recomendação</button><small class="muted" data-ref-status></small></div>` : ''}`);
}

function refRow(x, i, w) {
  const done = !!x.lead_contact_id;
  return html`<fieldset class="ref-row ${done ? 'done' : ''}" data-ref-row="${i}" ${x.id ? raw(`data-id="${x.id}"`) : ''}>
    <legend><span class="ref-n">${i + 1}</span> Recomendação ${i + 1}${x.source === 'diagnostico' ? html` <span class="badge info">do diagnóstico</span>` : ''}
      ${done ? html`<a class="badge ok ref-ok" href="#/leads/${x.lead_contact_id}" data-drawer="${x.lead_contact_id}">✓ Cadastrado no CRM · ${x.lead_code}</a>` : ''}</legend>
    <div class="ref-fields">${REF_FIELDS.map(([k, label]) => html`<input name="${k}" value="${x[k] || ''}" placeholder="${label}" aria-label="${label} da recomendação ${i + 1}" ${!w || done ? raw('readonly') : ''} ${k === 'phone' || k === 'whatsapp' ? raw('inputmode="tel"') : k === 'email' ? raw('type="email"') : ''}>`)}
      ${w && !done ? html`<button type="button" class="ref-plus" data-ref-register="${i}" title="Cadastrar esta indicação no pipeline" aria-label="Cadastrar a recomendação ${i + 1} no pipeline">${icon('adicionar', 16)}</button>` : html`<span class="ref-plus-placeholder"></span>`}</div>
  </fieldset>`;
}

const readRefRows = (el) => $$('[data-ref-row]', el).map((f) => ({
  id: f.dataset.id ? Number(f.dataset.id) : undefined,
  ...Object.fromEntries(REF_FIELDS.map(([k]) => [k, f.querySelector(`[name=${k}]`).value.trim()])),
}));

async function saveRefs(el, ctx) {
  const st = $('[data-ref-status]', el);
  if (st) st.textContent = 'Salvando…';
  try {
    const r = await put(`/api/cadastros/${ctx.contact.id}/recomendacoes`, { rows: readRefRows(el) });
    ctx.referrals = r.rows;
    // Liga as linhas novas aos ids criados (mesma ordem das linhas preenchidas)
    const filledRows = $$('[data-ref-row]', el).filter((f) => f.querySelector('[name=name]').value.trim() || f.querySelector('[name=phone]').value.trim() || f.querySelector('[name=whatsapp]').value.trim() || f.querySelector('[name=email]').value.trim());
    filledRows.forEach((f, i) => r.rows[i] && (f.dataset.id = r.rows[i].id));
    const cnt = $('.ref-count strong', el);
    if (cnt) cnt.textContent = r.rows.filter((x) => x.name).length;
    if (st) st.textContent = 'Salvo';
    return r;
  } catch (e) {
    if (st) st.textContent = '';
    toastError(e);
    return null;
  }
}

/* ------------------------- eventos ------------------------- */

/** Liga os eventos das três abas no painel (delegação no elemento do painel). */
export function bindLeadTabs(el, getCtx, { redraw }) {
  on(el, 'click', '[data-copy]', (e, b) => copyText(b.dataset.copy));
  on(el, 'click', '[data-ai-ask]', (e, b) => ask(el, getCtx(), b.dataset.aiAsk));
  on(el, 'submit', '[data-ai-form]', (e, f) => {
    e.preventDefault();
    const q = f.message.value.trim();
    f.message.value = '';
    f.message.style.height = '';
    ask(el, getCtx(), q);
  });
  // Enter envia; Shift+Enter quebra a linha; o campo cresce com o texto
  on(el, 'keydown', '[data-ai-form] textarea', (e, t) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      t.form.requestSubmit();
    }
  });
  on(el, 'input', '[data-ai-form] textarea', (e, t) => {
    t.style.height = '';
    t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
  });
  on(el, 'click', '[data-vai-sub]', (e, b) => {
    const ctx = getCtx();
    ctx.aiSub = b.dataset.vaiSub;
    $$('[data-vai-sub]', el).forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    $$('[data-vai-pane]', el).forEach((p) => (p.hidden = p.dataset.vaiPane !== ctx.aiSub));
  });
  on(el, 'click', '[data-vai-new]', () => {
    const ctx = getCtx();
    ctx.aiThread = null;
    const body = $('[data-vai-body]', el);
    if (body) render(body, emptyChat());
    const t = $('[data-vai-title]', el);
    if (t) t.textContent = 'Nova conversa';
    const pop = $('[data-vai-popover]', el);
    if (pop) pop.hidden = true;
    $('[data-ai-form] textarea', el)?.focus();
  });
  on(el, 'click', '[data-vai-hist]', () => showHistory(el, getCtx()));
  on(el, 'click', '[data-vai-sources]', () => {
    const ctx = getCtx();
    const pop = $('[data-vai-popover]', el);
    if (!pop || !ctx.ai) return;
    if (!pop.hidden && pop.dataset.kind === 'src') return (pop.hidden = true);
    pop.dataset.kind = 'src';
    pop.hidden = false;
    render(pop, html`<strong>Fontes consultadas</strong><ul>${ctx.ai.sources.map((x) => html`<li class="src-item"><span>${x.label}</span><small>${x.n}</small></li>`)}</ul>`);
  });
  on(el, 'click', '[data-vai-open]', async (e, b) => {
    const ctx = getCtx();
    try {
      const r = await get(`/api/ia/leads/${ctx.contact.id}/conversa`, { thread: b.dataset.vaiOpen });
      ctx.aiThread = b.dataset.vaiOpen === 'anterior' ? null : b.dataset.vaiOpen;
      const body = $('[data-vai-body]', el);
      render(body, html`${r.messages.map((m) => aiMsg(m))}`);
      body.scrollTop = body.scrollHeight;
      $('[data-vai-title]', el).textContent = 'Conversa';
      $('[data-vai-popover]', el).hidden = true;
    } catch (ex) {
      toastError(ex);
    }
  });
  // Recomendações: salvamento automático ao sair do campo; "+" cadastra a indicação no pipeline
  let refTimer;
  on(el, 'change', '[data-ref-form] input', () => {
    clearTimeout(refTimer);
    refTimer = setTimeout(() => saveRefs(el, getCtx()), 300);
  });
  on(el, 'click', '[data-ref-add]', () => {
    const list = $('[data-ref-form]', el);
    const n = $$('[data-ref-row]', el).length;
    if (n >= 30) return toast('Até 30 recomendações por lead.');
    list.insertAdjacentHTML('beforeend', String(refRow({}, n, true)));
    list.lastElementChild.querySelector('input')?.focus();
  });
  on(el, 'click', '[data-ref-register]', async (e, b) => {
    const ctx = getCtx();
    const row = b.closest('[data-ref-row]');
    const val = (k) => row.querySelector(`[name=${k}]`).value.trim();
    if (!val('name')) return toastError(new Error('Informe o nome da recomendação antes de cadastrar.'));
    clearTimeout(refTimer);
    const saved = await saveRefs(el, ctx);
    if (!saved) return;
    const ref = saved.rows.find((x) => x.id === Number(row.dataset.id)) || saved.rows.find((x) => x.name === val('name'));
    if (!ref) return toastError(new Error('Não foi possível salvar a recomendação.'));
    const { quickCreateContact } = await import('./forms.js');
    await quickCreateContact({
      name: ref.name, phone1: ref.phone || ref.whatsapp, whatsapp: ref.whatsapp && ref.whatsapp !== ref.phone ? ref.whatsapp : '', email: ref.email,
      referral_id: ref.id, referral_from: ctx.contact.name, recommended_by: ref.recommended_by, relationship: 'lead',
      after: () => {
        // Cadastrou: vai para o kanban do pipeline (o cartão traz a etiqueta "Indicação")
        document.querySelector('.drawer-wrap [data-close]')?.click();
        location.hash = '#/funil';
      },
    });
  });
  on(el, 'click', '[data-file-new]', async () => {
    if (await fileForm(getCtx())) redraw('arquivos');
  });
  on(el, 'click', '[data-file-edit]', async (e, b) => {
    const ctx = getCtx();
    const a = ctx.files?.find((x) => x.id === Number(b.dataset.fileEdit));
    if (a && (await fileForm(ctx, a))) redraw('arquivos');
  });
  on(el, 'click', '[data-file-dl]', (e, b) => download(`/api/anexos/${b.dataset.fileDl}`).catch(toastError));
  on(el, 'click', '[data-file-del]', async (e, b) => {
    if (!window.confirm('Remover este arquivo do cadastro?')) return;
    try {
      await patch(`/api/anexos/${b.dataset.fileDel}`, { status: 'removido' });
      toast('Arquivo removido.');
      redraw('arquivos');
    } catch (ex) {
      toastError(ex);
    }
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
