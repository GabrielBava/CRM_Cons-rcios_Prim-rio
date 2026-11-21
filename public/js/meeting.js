// "Agendar R1" e "Agendar R2": o mesmo pop-up no pipeline (arrastar para R1/R2), no "Ganho" do painel lateral, na ficha
// do cliente e na Agenda. Cliente obrigatório (o e-mail dele recebe o convite), horário em passos de 15 minutos,
// título "[R1] Nome do cliente | Vero Consórcios"; com o Google Agenda conectado, o evento sai com Google Meet.
// Bloco de reuniões do painel: Concluir, Remarcar e Não compareceu (no-show → NS no cartão; remarcação → R).
import { get, post, patch, download } from './api.js';
import { html, raw, $, on, modal, field, opts, state, toast, toastError, fmtDateTime, badge } from './ui.js';

/** Etapas até a R1: o "Ganho" (agendar a R1 e levar o lead para a coluna R1) aparece nelas. */
export const R1_STAGES = ['prospect', 'lead', 'tentativa', 'qualificado'];
export const MEETING_LABEL = { r1: 'R1', r2: 'R2' };

const pad = (n) => String(n).padStart(2, '0');
const toHM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const fromHM = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
};
/** Horários de 15 em 15 minutos (06:00 a 22:45), como no Google Agenda. */
const SLOTS = Array.from({ length: (23 - 6) * 4 }, (_, i) => 6 * 60 + i * 15);
const timeSelect = (name, value, label, { min = null } = {}) => {
  const list = SLOTS.filter((m) => min == null || m > min);
  return html`<div class="field"><label>${label}</label><select name="${name}" data-nofocus>${list.map((m) => html`<option value="${toHM(m)}" ${toHM(m) === value ? raw('selected') : ''}>${toHM(m)}${min != null ? ` (${fmtDur(m - min)})` : ''}</option>`)}</select></div>`;
};
const fmtDur = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`);
const dateLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Próximo dia útil (amanhã, pulando o fim de semana). */
function nextBusinessDay() {
  const d = new Date(Date.now() + 86400000);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d;
}
const waLink = (n, text) => {
  const d = String(n || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}?text=${encodeURIComponent(text)}` : null;
};

/** Situação do Google no pop-up: com a agenda conectada, o Meet e o convite saem sozinhos no clique de "Agendar R1". */
const googleBanner = (g, K = 'R1') => html`<div class="r1-google ${g.connected ? 'ok' : ''}" data-google-banner>
  ${g.connected
    ? html`<strong>Google Agenda conectado${g.email ? html` · ${g.email}` : ''}</strong><small>Ao clicar em "Agendar ${K}", o evento entra na agenda do especialista com o link do Google Meet, o cliente recebe o convite por e-mail e o link fica salvo na ${K}.${g.needs_reconnect ? ' Reconecte em Meu cadastro para o CRM marcar "R1 feita" sozinho quando o cliente entrar no Meet.' : ''}</small>`
    : g.configured
      ? html`<strong>Conecte o seu Google Agenda para agendar com Meet automático</strong><small>Uma única vez: autorize o CRM a criar as reuniões na sua agenda. Depois disso, o link do Meet e o convite ao cliente saem sozinhos.</small>
        <span><button type="button" class="btn small primary" data-google-connect>Conectar Google Agenda</button></span>`
      : html`<strong>Google Agenda ainda não configurado</strong><small>A R1 fica salva no CRM e você abre o evento já preenchido no Google Agenda (o administrador ativa a integração em Configurações › Integrações).</small>`}
</div>`;

/** Abre a autorização do Google numa nova guia e acompanha até a conta ficar conectada. */
async function connectFromDialog(form, K = 'R1') {
  if (window.CRM_PREVIEW) return toastError(new Error('Na versão de teste no navegador a conexão com o Google fica desativada. No CRM instalado ela funciona normalmente.'));
  const w = window.open('about:blank', '_blank');
  try {
    const r = await post('/api/google/conectar', { popup: true });
    if (w) w.location.href = r.url;
    else location.href = r.url;
  } catch (e) {
    w?.close();
    return toastError(e);
  }
  const banner = $('[data-google-banner]', form);
  banner.querySelector('[data-google-connect]').textContent = 'Aguardando autorização…';
  for (let i = 0; i < 90 && form.isConnected; i += 1) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const st = await get('/api/google/status').catch(() => null);
    if (st?.connected) {
      banner.outerHTML = String(googleBanner({ configured: true, connected: true, email: st.google_email, needs_reconnect: st.needs_reconnect }));
      toast(`Google Agenda conectado. Agora é só clicar em "Agendar ${K}".`);
      return;
    }
  }
}

/** Escolha do cliente (quando o agendamento começa pela Agenda): busca por nome, código, telefone ou e-mail. */
function pickContact(K = 'R1') {
  return modal({
    title: `Agendar ${K} — para qual cliente?`,
    body: html`<p class="hint">A reunião é sempre vinculada ao cadastro: o e-mail do cliente recebe o convite da reunião.</p>
      <div class="field full"><label>Buscar cadastro</label><input type="search" name="q" placeholder="Nome, código (C-…), telefone ou e-mail" autocomplete="off"></div>
      <div class="pick-list" role="listbox"></div>`,
    onMount(form, close) {
      let t;
      const box = $('.pick-list', form);
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = form.q.value.trim();
          if (q.length < 2) return (box.innerHTML = '');
          try {
            const r = await get('/api/cadastros', { q, limit: 8 });
            box.innerHTML = String(r.rows.length
              ? html`${r.rows.map((c) => html`<button type="button" class="pick-item" data-pick="${c.id}"><strong>${c.name}</strong><small>${c.code}${c.email ? ` · ${c.email}` : ''}${c.phone1 ? ` · ${c.phone1}` : ''}</small></button>`)}`
              : html`<p class="muted small">Nenhum cadastro encontrado.</p>`);
          } catch (e) {
            toastError(e);
          }
        }, 250);
      });
      on(form, 'click', '[data-pick]', (e, b) => close(Number(b.dataset.pick)));
    },
  });
}

/** Campos da qualificação mostrados no "Ganho" quando a qualificação ainda não foi concluída (basta um preenchido). */
const QUAL_FIELDS = [
  { name: 'objective_type', label: 'Objetivo', list: 'objetivo' },
  { name: 'credit_value', label: 'Valor estimado', type: 'money' },
  { name: 'urgency', label: 'Prioridade (quando quer)', list: 'urgencia' },
  { name: 'credit_category', label: 'Categoria (consórcio)', list: 'categoria_credito', consorcio: true },
];
/** Canal do contato que gerou o agendamento (vale como a tentativa de contato exigida pela etapa Tentativa). */
const ATTEMPT_TYPES = [
  { value: 'ligacao_realizada', label: 'Telefone (ligação)' }, { value: 'mensagem_enviada', label: 'WhatsApp' }, { value: 'email_enviado', label: 'E-mail' },
  { value: 'direct_enviado', label: 'Direct (Instagram)' }, { value: 'linkedin_enviado', label: 'LinkedIn (DM)' }, { value: 'conversa_presencial', label: 'Conversa presencial' },
];

/**
 * Abre o pop-up de agendamento da R1 ou da R2. opts: contactId (opcional: sem ele, pergunta o cliente), oppId, kind
 * ('r1' | 'r2'), moveTo (leva o negócio para a coluna da reunião), won (botão "Ganho": agendar a R1 é o ganho do
 * pré-vendas; os campos de qualificação que faltarem aparecem no próprio pop-up). Retorna o resultado ou null.
 */
export async function scheduleMeetingDialog({ contactId = null, oppId = null, kind = 'r1', moveTo = false, won = false } = {}) {
  const K = MEETING_LABEL[kind] || 'R1';
  if (!contactId) contactId = await pickContact(K);
  if (!contactId) return null;
  let ctx;
  try {
    ctx = await get('/api/r1/contexto', { contact_id: contactId, kind });
  } catch (e) {
    toastError(e);
    return null;
  }
  const c = ctx.contact;
  const dur = ctx.duration_min || (kind === 'r2' ? 60 : 30);
  const day = nextBusinessDay();
  const start = 14 * 60;
  const g = ctx.google;
  const opp = ctx.opportunities.find((o) => o.id === Number(oppId)) || ctx.opportunities[0];
  const target = state.meta.stages.find((st) => st.key === kind);
  const canMove = opp && opp.status === 'aberta' && target && opp.stage_key !== kind && (opp.stage_position ?? 0) < target.position;
  // Ganho (ou arrastar para a R1) antes da hora: o pop-up pede o que falta das etapas anteriores — o canal do contato
  // (Tentativa) e a qualificação (Qualificação); ao agendar, a atividade é registrada e a qualificação concluída.
  const gate = !!opp && opp.status === 'aberta' && (won || (moveTo && kind === 'r1')) && ['prospect', 'lead', 'tentativa', 'qualificado'].includes(opp.stage_key);
  const needAttempt = gate && !c.contact_attempted;
  const qual = gate && !opp.qualified_at ? QUAL_FIELDS.filter((f) => !f.consorcio || (opp.business_area || 'consorcio') === 'consorcio') : [];
  const result = await modal({
    title: won ? `Ganho — agendar a R1 de ${c.name}` : `Agendar ${K} — ${c.name}`,
    wide: true,
    body: html`
      ${won ? html`<div class="alert ok-alert small"><strong>Ganho do pré-vendas:</strong> com a R1 agendada, o lead vai para a coluna R1 do pipeline.</div>` : ''}
      ${googleBanner(g, K)}
      ${ctx.pending.length ? html`<div class="alert warn small">Já existe ${K} pendente: ${ctx.pending.map((t) => html`${t.title} em ${fmtDateTime(t.due_at)}`)}. Para mudar o horário use "Remarcar" no bloco da reunião.</div>` : ''}
      <div class="grid">
        <div class="field full"><label>Cliente</label><div class="r1-client"><strong>${c.name}</strong> <small class="muted">${c.code}${c.phone ? ` · ${c.phone}` : ''}</small></div></div>
        ${ctx.opportunities.length > 1 ? field({ name: 'opportunity_id', label: 'Negócio', type: 'select', options: ctx.opportunities.map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` })), value: opp?.id, allowEmpty: false, full: true }) : ''}
        ${field({ name: 'email', label: 'E-mail do cliente (recebe o convite)', type: 'email', value: c.email || '', required: true, full: true, help: c.email ? '' : 'O cadastro ainda não tem e-mail: o informado aqui é salvo no cadastro.' })}
        ${field({ name: 'date', label: 'Data', type: 'date', value: dateLocal(day), required: true })}
        <div class="r1-times">${timeSelect('start', toHM(start), 'Início')}${timeSelect('end', toHM(start + dur), 'Término', { min: start })}</div>
        ${field({ name: 'title', label: 'Título da reunião', value: ctx.title, required: true, full: true })}
        ${field({ name: 'video', label: 'Videoconferência (Google Meet) e convite por e-mail para o cliente', type: 'checkbox', value: true, full: true })}
        ${canMove && !won ? field({ name: 'move_to_stage', label: `Mover o negócio ${opp.code} de "${opp.stage_name}" para "${target.name}"`, type: 'checkbox', value: moveTo, full: true }) : ''}
        ${needAttempt ? html`<fieldset class="full qual-inline"><legend>Tentativa de contato</legend><p class="hint">Ainda não há contato registrado com o lead. Informe como foi o contato que gerou o agendamento (fica em Atividades).</p><div class="grid">
          ${field({ name: 'attempt_type', label: 'Canal do contato', type: 'select', options: ATTEMPT_TYPES, required: true, full: true })}</div></fieldset>` : ''}
        ${qual.length ? html`<fieldset class="full qual-inline"><legend>Concluir a qualificação</legend><p class="hint">Para entrar na R1 o lead precisa da qualificação concluída. Preencha ao menos um campo: ao agendar, a qualificação é concluída.</p><div class="grid">
          ${qual.map((f) => (f.list ? field({ name: f.name, label: f.label, type: 'select', options: opts(f.list), value: opp[f.name] }) : field({ name: f.name, label: f.label, type: f.type, value: opp[f.name] })))}</div></fieldset>` : ''}
        ${field({ name: 'notes', label: 'Observações (vão na descrição do evento)', type: 'textarea', rows: 2, full: true })}
      </div>`,
    submitLabel: won ? 'Agendar R1 (ganho)' : `Agendar ${K}`,
    onMount(form) {
      on(form, 'click', '[data-google-connect]', () => connectFromDialog(form, K));
      bindTimes(form, start);
    },
    async onSubmit(d) {
      const startAt = new Date(`${d.date}T${d.start}:00`);
      const endAt = new Date(`${d.date}T${d.end}:00`);
      if (endAt <= startAt) throw new Error('O término precisa ser depois do início.');
      const oppIdSel = Number(d.opportunity_id) || opp?.id;
      const q = Object.fromEntries(qual.map((f) => [f.name, d[f.name]]).filter(([, v]) => v != null && v !== ''));
      if (qual.length && !Object.keys(q).length) throw new Error('Preencha ao menos um campo da qualificação para concluir.');
      if (needAttempt) await post('/api/atividades', { contact_id: c.id, opportunity_id: oppIdSel, type: d.attempt_type, notes: `Contato que gerou o agendamento da ${K}.`, occurred_at: new Date().toISOString() });
      if (qual.length && oppIdSel) await post(`/api/oportunidades/${oppIdSel}/concluir-qualificacao`, { fields: q });
      return post('/api/reunioes/agendar', {
        kind, contact_id: c.id, opportunity_id: oppIdSel, email: d.email, title: d.title, notes: d.notes,
        start_at: startAt.toISOString(), end_at: endAt.toISOString(), video: d.video,
        move_to_stage: canMove && (won || !!d.move_to_stage),
        logo_url: new URL('img/vero-logo-dark.png', document.baseURI).href,
      });
    },
  });
  if (!result) return null;
  await r1Done(result, c);
  return result;
}

/** Compatibilidade: telas antigas chamam o agendamento da R1 por este nome. */
export const scheduleR1Dialog = ({ moveToR1, ...o } = {}) => scheduleMeetingDialog({ ...o, kind: 'r1', moveTo: !!moveToR1 });

/** Ao mudar o início, o término acompanha mantendo a duração escolhida. */
function bindTimes(form, start) {
  const box = $('.r1-times', form);
  form.start.addEventListener('change', () => {
    const oldStart = fromHM(form.dataset.start || toHM(start));
    const keep = Math.max(15, fromHM(form.end.value) - oldStart);
    const s = fromHM(form.start.value);
    form.dataset.start = form.start.value;
    box.children[1].outerHTML = String(timeSelect('end', toHM(Math.min(s + keep, SLOTS[SLOTS.length - 1])), 'Término', { min: s }));
  });
}

/* ------------------------- Bloco R1 / R2 (painel do lead) ------------------------- */

const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const STATE_LABEL = { agendada: 'Agendada', remarcada: 'Remarcada', realizada: 'Concluída', no_show: 'Não participou (NS)', cancelada: 'Cancelada' };
const STATE_TONE = { agendada: 'info', remarcada: 'rm', realizada: 'ok', no_show: 'ns', cancelada: 'muted' };

/**
 * Bloco de uma reunião no painel do lead. m = opp.meetings.r1 | r2. Sem reunião: botão "Agendar". Agendada: data,
 * horário, como (Meet) e os botões Concluir (destaque), Remarcar e Não compareceu. Indicadores de remarcações e NS.
 */
export function meetingCard(kind, m, { canSchedule = true, write = true } = {}) {
  const K = MEETING_LABEL[kind];
  const pending = m && ['agendada', 'remarcada'].includes(m.state);
  return html`<section class="mt-card ${m ? `st-${m.state}` : 'st-none'}" data-meeting="${kind}">
    <header><strong>${K}</strong>${m ? html`<span class="badge ${STATE_TONE[m.state] || ''}">${STATE_LABEL[m.state] || m.state}</span>` : html`<span class="badge muted">${kind === 'r2' && !canSchedule ? 'Bloqueada' : 'Não agendada'}</span>`}</header>
    ${m && m.at ? html`<div class="mt-when">${icon_cal()}<span><strong>${dayLabel(m.at)}</strong> · ${hm(m.at)}${m.ends_at ? ` às ${hm(m.ends_at)}` : ''}</span></div>` : ''}
    ${pending ? html`<div class="mt-how">${m.meeting_url ? html`<a href="${m.meeting_url}" target="_blank" rel="noopener">Google Meet</a>` : html`<span class="muted">Sem link de vídeo</span>`}${m.confirmed ? html` · <span class="ok-text">presença confirmada</span>` : ''}</div>` : ''}
    ${m && (m.no_shows || m.reschedules) ? html`<div class="mt-stats">${m.no_shows ? html`<span class="badge ns" title="Não compareceu">NS ${m.no_shows}</span>` : ''}${m.reschedules ? html`<span class="badge rm" title="Remarcações">R ${m.reschedules}</span>` : ''}</div>` : ''}
    ${write ? html`<div class="mt-actions">
      ${pending ? html`<button type="button" class="btn small primary" data-mt="done" data-task="${m.task_id}">Concluir</button>
        <button type="button" class="btn small" data-mt="resched" data-task="${m.task_id}">Remarcar</button>
        <button type="button" class="btn small warn" data-mt="noshow" data-task="${m.task_id}">Não compareceu</button>
        ${m.confirmed ? '' : html`<button type="button" class="btn small ghost" data-mt="confirm" data-task="${m.task_id}" title="O cliente confirmou que vai participar">Confirmar presença</button>`}`
        : m?.state === 'no_show' ? html`<button type="button" class="btn small primary" data-mt="resched" data-task="${m.task_id}">Remarcar ${K}</button>`
          : canSchedule && (!m || m.state === 'cancelada') ? html`<button type="button" class="btn small primary" data-mt="new" data-kind="${kind}">Agendar ${K}</button>`
            : kind === 'r2' && !m ? html`<button type="button" class="btn small" disabled title="A R2 é liberada depois que a R1 for agendada e concluída">Agendar R2</button><small class="muted mt-lock">Liberada após concluir a R1.</small>` : ''}
      ${m?.task_id ? html`<button type="button" class="btn small ghost" data-r1-model="task_id=${m.task_id}">Modelo da R1</button>` : ''}
    </div>` : ''}
  </section>`;
}
const icon_cal = () => raw('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>');

/** Novo horário para a reunião (remarcação ou depois de um no-show). */
export async function rescheduleDialog(taskId, kind = 'r1') {
  const K = MEETING_LABEL[kind] || 'R1';
  const day = nextBusinessDay();
  const start = 14 * 60;
  const dur = kind === 'r2' ? 60 : 30;
  const r = await modal({
    title: `Remarcar ${K}`,
    body: html`<p class="hint">A reunião atual fica registrada como remarcada (marca R no pipeline). O mesmo link do Meet e o mesmo evento do Google Agenda passam para o novo horário, e o cliente recebe o aviso.</p>
      <div class="grid">${field({ name: 'date', label: 'Nova data', type: 'date', value: dateLocal(day), required: true })}
      <div class="r1-times">${timeSelect('start', toHM(start), 'Início')}${timeSelect('end', toHM(start + dur), 'Término', { min: start })}</div>
      ${field({ name: 'reason', label: 'Motivo (opcional)', type: 'textarea', rows: 2, full: true })}</div>`,
    submitLabel: 'Remarcar',
    onMount(form) {
      bindTimes(form, start);
    },
    async onSubmit(d) {
      const startAt = new Date(`${d.date}T${d.start}:00`);
      const endAt = new Date(`${d.date}T${d.end}:00`);
      if (endAt <= startAt) throw new Error('O término precisa ser depois do início.');
      return post(`/api/reunioes/${taskId}/remarcar`, { start_at: startAt.toISOString(), end_at: endAt.toISOString(), reason: d.reason, logo_url: new URL('img/vero-logo-dark.png', document.baseURI).href });
    },
  });
  if (r) toast(`${K} remarcada para ${dayLabel(r.start_at)} às ${hm(r.start_at)}.${r.confirmation?.sent ? ' O cliente recebeu o novo horário por e-mail.' : ''}`);
  return r;
}

/** Concluir (reunião realizada) ou Não compareceu (no-show), com observação opcional. */
async function meetingResultDialog(taskId, kind, result) {
  const K = MEETING_LABEL[kind] || 'R1';
  const done = result === 'realizada';
  const r = await modal({
    title: done ? `Concluir ${K}` : `${K}: cliente não compareceu`,
    body: html`<p>${done ? html`Registrar a ${K} como <strong>realizada</strong>.${kind === 'r2' ? ' O negócio segue para Negociação.' : ' O próximo passo é agendar a R2.'}` : html`O cartão fica com a marca <span class="badge ns">NS</span> na coluna ${K} até a reunião ser remarcada.`}</p>
      ${field({ name: 'notes', label: done ? 'Resumo da reunião (opcional)' : 'Observação (opcional)', type: 'textarea', rows: 3, full: true })}`,
    submitLabel: done ? 'Concluir' : 'Registrar no-show',
    danger: !done,
    onSubmit: (d) => post(`/api/reunioes/${taskId}/resultado`, { result, notes: d.notes }),
  });
  if (r) {
    toast(done ? `${K} concluída.${r.moved === 'negociacao' ? ' Negócio movido para Negociação.' : ''}` : `No-show registrado na ${K}.`);
    if (r.move_error) toast(r.move_error, 'error');
  }
  return r;
}

/**
 * Liga os botões dos blocos de reunião dentro de root. ctx: contactId, oppId, onChange (recarregar a tela),
 * oppStage (chave da etapa atual, para mover junto ao agendar).
 */
export function bindMeetingCards(root, getCtx) {
  on(root, 'click', '[data-mt]', async (e, b) => {
    const ctx = getCtx();
    const kind = b.closest('[data-meeting]')?.dataset.meeting || b.dataset.kind || 'r1';
    let ok = null;
    b.disabled = true;
    try {
      const act = b.dataset.mt;
      if (act === 'new') ok = await scheduleMeetingDialog({ contactId: ctx.contactId, oppId: ctx.oppId, kind, moveTo: true });
      else if (act === 'done') ok = await meetingResultDialog(b.dataset.task, kind, 'realizada');
      else if (act === 'noshow') ok = await meetingResultDialog(b.dataset.task, kind, 'nao_compareceu');
      else if (act === 'resched') ok = await rescheduleDialog(b.dataset.task, kind);
      else if (act === 'confirm') {
        ok = await post(`/api/reunioes/${b.dataset.task}/confirmar`, {});
        toast('Presença confirmada pelo cliente.');
      }
    } catch (err) {
      toastError(err);
    } finally {
      b.disabled = false;
    }
    if (ok) ctx.onChange?.();
  });
}

/** Depois de agendar: link do Meet já salvo na R1, modelo da R1 liberado para baixar e confirmação pelo WhatsApp. */
async function r1Done(r, c) {
  const when = `${new Date(r.start_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}, das ${new Date(r.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} às ${new Date(r.end_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const first = String(c.name).split(' ')[0];
  const msg = `Olá, ${first}! Aqui é ${state.user.name}, da ${state.meta.settings.company_name || 'Vero Consórcios'}. ${r.kind === 'r2' ? 'Nossa segunda reunião (apresentação da proposta)' : 'Nossa reunião de apresentação'} está confirmada para ${when}.${r.meeting_url ? ` Link da videochamada (Google Meet): ${r.meeting_url}` : ''}${r.email ? ` O convite também foi enviado para ${r.email}.` : ''} Até lá!`;
  const wa = waLink(c.phone, msg);
  const conf = r.confirmation || {};
  const K = MEETING_LABEL[r.kind] || 'R1';
  toast(r.google.synced ? `${K} agendada: evento com Google Meet criado e link salvo na ${K}.` : `${K} agendada no CRM.`);
  if (r.moved === false && r.move_error) toast(`O negócio não foi movido para ${K}: ${r.move_error}`, 'error');
  await modal({
    title: `${K} agendada`,
    body: html`<p><strong>${r.title}</strong><br>${when}</p>
      ${r.google.synced
        ? html`<div class="alert ok-alert small">Evento criado na ${r.google.calendar === 'agendador' ? 'sua agenda Google (o especialista foi convidado)' : 'agenda Google do especialista'}${r.google.invited ? html` e convite do Google enviado para <strong>${r.email}</strong>` : ''}. O link da reunião já está salvo na ${K}.</div>
          ${r.meeting_url ? html`<p class="r1-link"><span>Link da reunião (Google Meet)</span><a href="${r.meeting_url}" target="_blank" rel="noopener">${r.meeting_url}</a></p>` : ''}`
        : html`<div class="alert warn small">${r.google.reason === 'erro' ? html`O Google Agenda não aceitou o evento (${r.google.error}). ` : r.google.reason === 'nao_conectado' ? 'O Google Agenda do especialista não está conectado (Meu cadastro). ' : ''}Abra o evento já preenchido no Google Agenda, adicione o Google Meet e salve; depois cole aqui o link da reunião.</div>
          <p><a class="btn primary" href="${r.calendar_link}" target="_blank" rel="noopener">Abrir no Google Agenda</a></p>
          <div class="field full"><label>Link da reunião (Meet)</label><div class="inline-actions"><input type="url" name="meeting_url" placeholder="https://meet.google.com/…"><button type="button" class="btn small" data-save-link>Salvar link</button></div></div>`}
      ${conf.sent ? html`<p class="small muted">E-mail de confirmação enviado para ${conf.to} (remetente ${conf.from}).</p>`
        : conf.reason === 'erro' ? html`<p class="small warn-text">O e-mail de confirmação não foi enviado: ${conf.error}</p>` : ''}
      <div class="r1-done-actions">
        <button type="button" class="btn primary" data-r1-download="task_id=${r.task_id}">Baixar modelo da R1</button>
        <button type="button" class="btn" data-r1-model="task_id=${r.task_id}">Abrir modelo da R1</button>
        ${wa ? html`<a class="btn" href="${wa}" target="_blank" rel="noopener">Confirmar pelo WhatsApp</a>` : ''}
      </div>
      <p class="hint">O modelo da R1 já vem com o nome, a foto e o contato do especialista (Meu cadastro) e o nome do cliente.${r.meeting_url ? ' Quando o cliente entrar no Meet, a reunião é registrada sozinha como "R1 feita".' : ''}</p>`,
    onMount(form) {
      on(form, 'click', '[data-save-link]', async () => {
        try {
          await patch(`/api/tarefas/${r.task_id}/link`, { meeting_url: form.meeting_url.value });
          toast('Link da reunião salvo no CRM.');
        } catch (e) {
          toastError(e);
        }
      });
    },
  });
}

/** Ações de uma tarefa de reunião (link do Meet e modelo da R1), para listas de tarefas e agenda. */
export const meetingLinks = (t) =>
  t.type === 'reuniao'
    ? html`<span class="meeting-links">${t.status === 'pendente' && t.meeting_url ? html`<a class="btn small" href="${t.meeting_url}" target="_blank" rel="noopener">Entrar na reunião</a>` : ''}<button type="button" class="btn small ghost" data-r1-model="task_id=${t.id}">Modelo da R1</button><button type="button" class="btn small ghost" data-r1-download="task_id=${t.id}" title="Baixar o modelo da R1 preenchido (HTML)">Baixar</button>${attendanceBadge(t)}</span>`
    : '';

/** Presença no Google Meet: "R1 feita" (com o horário), aguardando o cliente ou cliente não entrou. */
export function attendanceBadge(t) {
  if (t.type !== 'reuniao') return '';
  const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (t.status === 'concluida' && t.outcome === 'realizada') return badge(`R1 feita${t.attended_at ? ` · ${hm(t.attended_at)}` : ''}${t.attendance_status === 'r1_feita' ? ' (Meet)' : ''}`, 'ok');
  if (t.status !== 'pendente') return '';
  if (t.attendance_status === 'sem_cliente') return html`${badge('Cliente não entrou no Meet', 'danger')}`;
  if (t.calendar_status === 'google' && /meet\.google\.com/.test(t.meeting_url || '')) {
    const started = Date.parse(t.due_at) <= Date.now();
    return html`${badge(started ? 'Aguardando o cliente no Meet' : 'Google Meet', started ? 'warn' : 'ok')}${started ? html`<button type="button" class="btn small ghost" data-check-attendance="${t.id}">Verificar presença</button>` : ''}`;
  }
  return t.calendar_status === 'google' ? badge('Google Agenda', 'ok') : '';
}

/** Baixa o modelo da R1 já preenchido (arquivo HTML). */
export async function downloadR1Model(query) {
  if (!window.CRM_PREVIEW) {
    await download('/api/r1/modelo', { ...Object.fromEntries(new URLSearchParams(query)), baixar: 1 }).catch(toastError);
    return;
  }
  try {
    const logo = new URL('img/vero-logo-dark.webp', document.baseURI).href;
    const r = await get(`/api/r1/modelo?${query}&formato=json&logo=${encodeURIComponent(logo)}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
    a.download = `R1 - ${r.contact || 'Cliente'}.html`;
    document.body.append(a);
    a.click();
    a.remove();
  } catch (e) {
    toastError(e);
  }
}

/**
 * Abre o modelo da R1 (HTML) com os dados do especialista e do cliente. No CRM instalado abre o endereço do servidor;
 * na versão de teste no navegador, o HTML é montado pela API local e aberto numa nova guia.
 */
export async function openR1Model(query) {
  if (!window.CRM_PREVIEW) {
    window.open(`/api/r1/modelo?${query}`, '_blank', 'noopener');
    return;
  }
  const w = window.open('about:blank', '_blank');
  try {
    const logo = new URL('img/vero-logo-dark.webp', document.baseURI).href;
    const r = await get(`/api/r1/modelo?${query}&formato=json&logo=${encodeURIComponent(logo)}`);
    const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
    if (w) w.location.href = url;
    else window.open(url, '_blank');
  } catch (e) {
    if (w) w.close();
    toastError(e);
  }
}
if (typeof document !== 'undefined' && !window.__r1ModelLinks) {
  window.__r1ModelLinks = true;
  document.addEventListener('click', async (e) => {
    const d = e.target.closest?.('[data-r1-download]');
    if (d) {
      e.preventDefault();
      return downloadR1Model(d.dataset.r1Download);
    }
    const chk = e.target.closest?.('[data-check-attendance]');
    if (chk) {
      e.preventDefault();
      chk.disabled = true;
      try {
        const r = await post(`/api/tarefas/${chk.dataset.checkAttendance}/presenca`);
        const names = (r.participants || []).map((p) => `${p.name}${p.internal ? ' (empresa)' : ' (cliente)'}`).join(', ');
        if (r.status === 'r1_feita') toast(`R1 feita: o cliente entrou no Meet às ${new Date(r.attended_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`);
        else if (r.message) toast(r.message, 'error');
        else toast(names ? `Ainda sem cliente na sala. Participantes: ${names}.` : 'Ninguém entrou na sala do Meet ainda.', 'error');
        if (r.status === 'r1_feita') window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        toastError(err);
      } finally {
        chk.disabled = false;
      }
      return undefined;
    }
    const b = e.target.closest?.('[data-r1-model]');
    if (!b) return undefined;
    e.preventDefault();
    return openR1Model(b.dataset.r1Model);
  });
}
