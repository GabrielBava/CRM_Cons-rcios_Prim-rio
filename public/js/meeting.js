// "Agendar R1": o mesmo pop-up no funil (Lead qualificado → R1), no painel lateral, na ficha do cliente e na Agenda.
// Cliente obrigatório (o e-mail dele recebe o convite), horário em passos de 15 minutos, 30 minutos por padrão,
// título "[R1] Nome do cliente / Vero Consórcios"; com o Google Agenda conectado, o evento sai com Google Meet.
import { get, post, patch } from './api.js';
import { html, raw, $, on, modal, field, state, toast, toastError, fmtDateTime, badge } from './ui.js';

/** Etapas em que o botão "Agendar R1" aparece em destaque (da prospecção até R1 bolo). */
export const R1_STAGES = ['prospect', 'lead', 'tentativa', 'qualificado', 'r1', 'r1_bolo'];

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

/** Escolha do cliente (quando o agendamento começa pela Agenda): busca por nome, código, telefone ou e-mail. */
function pickContact() {
  return modal({
    title: 'Agendar R1 — para qual cliente?',
    body: html`<p class="hint">A R1 é sempre vinculada ao cadastro: o e-mail do cliente recebe o convite da reunião.</p>
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

/**
 * Abre o pop-up de agendamento. opts: contactId (opcional: sem ele, pergunta o cliente), oppId, moveToR1 (move o negócio
 * para "R1" ao salvar). Retorna o resultado do agendamento ou null.
 */
export async function scheduleR1Dialog({ contactId = null, oppId = null, moveToR1 = false } = {}) {
  if (!contactId) contactId = await pickContact();
  if (!contactId) return null;
  let ctx;
  try {
    ctx = await get('/api/r1/contexto', { contact_id: contactId });
  } catch (e) {
    toastError(e);
    return null;
  }
  const c = ctx.contact;
  const dur = ctx.duration_min || 30;
  const day = nextBusinessDay();
  const start = 14 * 60;
  const g = ctx.google;
  const opp = ctx.opportunities.find((o) => o.id === Number(oppId)) || ctx.opportunities[0];
  const canMove = opp && ['prospect', 'lead', 'tentativa', 'qualificado', 'r1_bolo'].includes(opp.stage_key);
  const result = await modal({
    title: `Agendar R1 — ${c.name}`,
    wide: true,
    body: html`
      <div class="r1-google ${g.connected ? 'ok' : ''}">
        ${g.connected
          ? html`<strong>Google Agenda conectado</strong><small>O evento entra na agenda de ${g.email || 'sua conta Google'} com link do Google Meet, e o cliente recebe o convite por e-mail.</small>`
          : g.configured
            ? html`<strong>Seu Google Agenda não está conectado</strong><small>A R1 fica salva no CRM e, em seguida, você abre o evento já preenchido no Google Agenda. Para criar o Meet e enviar o convite automaticamente, <a href="#/meu-cadastro" data-close>conecte sua agenda em Meu cadastro</a>.</small>`
            : html`<strong>Google Agenda ainda não configurado</strong><small>A R1 fica salva no CRM e você abre o evento já preenchido no Google Agenda (o administrador pode ativar a integração em Configurações › Integrações).</small>`}
      </div>
      ${ctx.pending.length ? html`<div class="alert warn small">Já existe R1 pendente: ${ctx.pending.map((t) => html`${t.title} em ${fmtDateTime(t.due_at)}`)}. Reagende pela tarefa se for a mesma reunião.</div>` : ''}
      <div class="grid">
        <div class="field full"><label>Cliente</label><div class="r1-client"><strong>${c.name}</strong> <small class="muted">${c.code}${c.phone ? ` · ${c.phone}` : ''}</small></div></div>
        ${ctx.opportunities.length > 1 ? field({ name: 'opportunity_id', label: 'Negócio', type: 'select', options: ctx.opportunities.map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` })), value: opp?.id, allowEmpty: false, full: true }) : ''}
        ${field({ name: 'email', label: 'E-mail do cliente (recebe o convite)', type: 'email', value: c.email || '', required: true, full: true, help: c.email ? '' : 'O cadastro ainda não tem e-mail: o informado aqui é salvo no cadastro.' })}
        ${field({ name: 'date', label: 'Data', type: 'date', value: dateLocal(day), required: true })}
        <div class="r1-times">${timeSelect('start', toHM(start), 'Início')}${timeSelect('end', toHM(start + dur), 'Término', { min: start })}</div>
        ${field({ name: 'title', label: 'Título da reunião', value: ctx.title, required: true, full: true })}
        ${field({ name: 'video', label: 'Videoconferência (Google Meet) e convite por e-mail para o cliente', type: 'checkbox', value: true, full: true })}
        ${canMove ? field({ name: 'move_to_r1', label: `Mover o negócio ${opp.code} de "${opp.stage_name}" para "R1"`, type: 'checkbox', value: moveToR1 || ['qualificado', 'r1_bolo'].includes(opp.stage_key), full: true }) : ''}
        ${field({ name: 'notes', label: 'Observações (vão na descrição do evento)', type: 'textarea', rows: 2, full: true })}
      </div>`,
    submitLabel: 'Agendar R1',
    onMount(form) {
      // Ao mudar o início, o término acompanha mantendo a duração escolhida
      const box = $('.r1-times', form);
      form.start.addEventListener('change', () => {
        const oldStart = fromHM(form.dataset.start || toHM(start));
        const keep = Math.max(15, fromHM(form.end.value) - oldStart);
        const s = fromHM(form.start.value);
        form.dataset.start = form.start.value;
        const endWrap = box.children[1];
        endWrap.outerHTML = String(timeSelect('end', toHM(Math.min(s + keep, SLOTS[SLOTS.length - 1])), 'Término', { min: s }));
      });
    },
    async onSubmit(d) {
      const startAt = new Date(`${d.date}T${d.start}:00`);
      const endAt = new Date(`${d.date}T${d.end}:00`);
      if (endAt <= startAt) throw new Error('O término precisa ser depois do início.');
      return post('/api/r1/agendar', {
        contact_id: c.id, opportunity_id: d.opportunity_id || opp?.id, email: d.email, title: d.title, notes: d.notes,
        start_at: startAt.toISOString(), end_at: endAt.toISOString(), video: d.video, move_to_r1: !!d.move_to_r1,
      });
    },
  });
  if (!result) return null;
  await r1Done(result, c);
  return result;
}

/** Depois de agendar: link do Meet, abrir no Google Agenda, confirmação por WhatsApp e modelo da R1. */
async function r1Done(r, c) {
  const when = `${new Date(r.start_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}, das ${new Date(r.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} às ${new Date(r.end_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const first = String(c.name).split(' ')[0];
  const msg = `Olá, ${first}! Aqui é ${state.user.name}, da ${state.meta.settings.company_name || 'Vero Consórcios'}. Nossa reunião de diagnóstico (R1) está confirmada para ${when}.${r.meeting_url ? ` Link da videochamada: ${r.meeting_url}` : ''}${r.email ? ` O convite também foi enviado para ${r.email}.` : ''} Até lá!`;
  const wa = waLink(c.phone, msg);
  toast(r.google.synced ? 'R1 agendada no CRM e no Google Agenda.' : 'R1 agendada no CRM.');
  if (r.moved === false && r.move_error) toast(`O negócio não foi movido para R1: ${r.move_error}`, 'error');
  await modal({
    title: 'R1 agendada',
    body: html`<p><strong>${r.title}</strong><br>${when}</p>
      ${r.google.synced
        ? html`<div class="alert ok-alert small">Evento criado no seu Google Agenda${r.google.invited ? html` e convite enviado para <strong>${r.email}</strong>` : ''}.</div>
          ${r.meeting_url ? html`<p class="r1-link"><span>Link da reunião</span><a href="${r.meeting_url}" target="_blank" rel="noopener">${r.meeting_url}</a></p>` : ''}`
        : html`<div class="alert warn small">${r.google.reason === 'erro' ? html`O Google Agenda não aceitou o evento (${r.google.error}). ` : ''}Abra o evento já preenchido no Google Agenda, adicione o Google Meet e salve: o Google envia o convite ao cliente. Depois, cole aqui o link da reunião.</div>
          <p><a class="btn primary" href="${r.calendar_link}" target="_blank" rel="noopener">Abrir no Google Agenda</a></p>
          <div class="field full"><label>Link da reunião (Meet)</label><div class="inline-actions"><input type="url" name="meeting_url" placeholder="https://meet.google.com/…"><button type="button" class="btn small" data-save-link>Salvar link</button></div></div>`}
      <div class="r1-done-actions">
        <button type="button" class="btn" data-r1-model="task_id=${r.task_id}">Abrir modelo da R1</button>
        ${wa ? html`<a class="btn" href="${wa}" target="_blank" rel="noopener">Confirmar pelo WhatsApp</a>` : ''}
      </div>
      <p class="hint">O modelo da R1 abre com o seu nome, foto e contato (Meu cadastro) e o nome do cliente. É o roteiro único de reunião da ${state.meta.settings.company_name || 'Vero Consórcios'}.</p>`,
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
    ? html`<span class="meeting-links">${t.meeting_url ? html`<a class="btn small" href="${t.meeting_url}" target="_blank" rel="noopener">Entrar na reunião</a>` : ''}<button type="button" class="btn small ghost" data-r1-model="task_id=${t.id}">Modelo da R1</button>${t.calendar_status === 'google' ? badge('Google Agenda', 'ok') : ''}</span>`
    : '';

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
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-r1-model]');
    if (!b) return;
    e.preventDefault();
    openR1Model(b.dataset.r1Model);
  });
}
