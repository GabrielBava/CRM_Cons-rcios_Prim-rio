// Funil de pós-venda (farm): linha do tempo D+N de cada cliente, com marcar como feita ou "não se aplica".
import { post } from './api.js';
import { html, raw, on, badge, fmtDate, fmtDateTime, relTime, modal, field, toast, toastError } from './ui.js';

export const PS_STATUS = {
  feito: ['Feito', 'ok'],
  nao_se_aplica: ['Não se aplica', 'muted'],
  pendente: ['No prazo', ''],
  atrasado: ['Atrasado', 'danger'],
  aguardando_nps: ['Aguarda o NPS', 'warn'],
};
export const psBadge = (s) => badge(PS_STATUS[s]?.[0] || s, PS_STATUS[s]?.[1] || '');

/** Linha do tempo: etapa, D+N, data limite, situação e quem fez. */
export function timelineList(items, { w = false } = {}) {
  return html`<ol class="ps-timeline">${items.map((p) => html`<li class="ps-${p.status}">
    <span class="ps-day">D+${p.days}</span>
    <div class="ps-body">
      <div class="ps-title"><strong>${p.label}</strong> ${psBadge(p.status)}</div>
      <small class="muted">${p.done_at ? html`${p.skipped ? 'Dispensada' : 'Feita'} em ${fmtDate(p.done_at)}${p.done_by_name ? ` · ${p.done_by_name}` : ''}${p.notes ? ` · ${p.notes}` : ''}` : p.status === 'aguardando_nps' ? 'Só é pedida depois do NPS, para clientes promotores.' : p.due_at ? html`Até ${fmtDate(p.due_at)} · ${relTime(p.due_at)}` : 'Começa na confirmação da venda.'}</small>
    </div>
    ${w ? html`<div class="ps-actions">${p.done_at
      ? html`<button type="button" class="btn small ghost" data-ps-undo="${p.item}">Reabrir</button>`
      : html`<button type="button" class="btn small primary" data-ps-done="${p.item}" ${p.status === 'aguardando_nps' ? raw('disabled') : ''}>Feito</button><button type="button" class="btn small ghost" data-ps-skip="${p.item}">Não se aplica</button>`}</div>` : ''}
  </li>`)}</ol>`;
}

/** Liga os botões da linha do tempo de um cliente. */
export function bindTimeline(box, contactId, items, onChange) {
  const label = (item) => items().find((i) => i.item === item)?.label || item;
  on(box, 'click', '[data-ps-done]', async (e, b) => {
    const notes = await modal({
      title: `Pós-venda: ${label(b.dataset.psDone)}`,
      body: field({ name: 'notes', label: 'Observação (vai para o histórico do cliente)', type: 'textarea', rows: 2, full: true }),
      submitLabel: 'Marcar como feita',
      onSubmit: (d) => d.notes || ' ',
    });
    if (!notes) return;
    try {
      await post(`/api/cadastros/${contactId}/pos-venda`, { item: b.dataset.psDone, done: true, notes: notes.trim() || undefined });
      toast('Etapa concluída. A tarefa da próxima etapa foi criada.');
      onChange?.();
    } catch (ex) {
      toastError(ex);
    }
  });
  on(box, 'click', '[data-ps-skip]', async (e, b) => {
    const notes = await modal({
      title: `Não se aplica: ${label(b.dataset.psSkip)}`,
      body: field({ name: 'notes', label: 'Por que esta etapa não se aplica?', type: 'textarea', rows: 2, required: true, full: true }),
      submitLabel: 'Dispensar etapa',
      onSubmit: (d) => d.notes,
    });
    if (!notes) return;
    try {
      await post(`/api/cadastros/${contactId}/pos-venda`, { item: b.dataset.psSkip, skip: true, notes });
      toast('Etapa dispensada.');
      onChange?.();
    } catch (ex) {
      toastError(ex);
    }
  });
  on(box, 'click', '[data-ps-undo]', async (e, b) => {
    try {
      await post(`/api/cadastros/${contactId}/pos-venda`, { item: b.dataset.psUndo, done: false });
      toast('Etapa reaberta.');
      onChange?.();
    } catch (ex) {
      toastError(ex);
    }
  });
}

export const nextLabel = (items) => {
  const n = items.find((i) => !i.done_at);
  return n ? html`<strong>${n.label}</strong> <small class="muted">D+${n.days}${n.due_at ? ` · ${fmtDateTime(n.due_at).slice(0, 10)}` : ''}</small> ${psBadge(n.status)}` : html`<span class="ok-text">Funil concluído</span>`;
};
