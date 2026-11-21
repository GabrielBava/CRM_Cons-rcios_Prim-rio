// Ações da proposta usadas na guia Propostas, no painel do lead e no detalhe da proposta:
// link on-line rastreável para o cliente, PDF e modelo de mensagem do WhatsApp por passo da régua.
import { get, post } from './api.js';
import { html, render, $, on, modal, toast, toastError, fmtDateTime, can, badge, empty } from './ui.js';
import { icon } from './icons.js';

const base = (publicUrl) => (publicUrl ? `${String(publicUrl).replace(/\/$/, '')}/` : location.href.split('#')[0]);
export const linkUrl = (info, team = false) => (info?.token ? `${base(info.public_url)}#/proposta/${info.token}${team ? '?equipe=1' : ''}` : null);

/** Tempo de leitura em formato curto: 45 s, 3 min 20 s, 1 h 05 min. */
export function readTime(s) {
  s = Number(s) || 0;
  if (!s) return '—';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const LINK_STATUS = { sem_link: ['Link não gerado', ''], aguardando: ['Aguardando', 'warn'], lido: ['Lido', 'info'], avancar: ['Avançar', 'ok'] };
/** Situação do link do cliente: Aguardando, Lido (data e hora da primeira abertura) ou Avançar. */
export function linkBadge(p) {
  const st = p.link_status || (p.link_advanced_at ? 'avancar' : p.link_first_opened_at ? 'lido' : p.public_token ? 'aguardando' : 'sem_link');
  const [label, tone] = LINK_STATUS[st];
  if (st === 'sem_link') return html`<span class="muted small">${label}</span>`;
  const when = st === 'avancar' ? p.link_advanced_at : st === 'lido' ? p.link_first_opened_at : null;
  return html`<span class="link-st st-${st}">${badge(label, tone)}${when ? html`<small>${fmtDateTime(when)}</small>` : ''}</span>`;
}

const copy = async (text, msg) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast(msg || 'Copiado.');
};

const SECTION_LABEL = { resumo: 'Resumo', valores: 'Valores', condicoes: 'Condições', estrategia: 'Estratégia', entrega: 'Entregas', como_funciona: 'Como funciona', investimento: 'Investimento', consultor: 'Consultor', avancar: 'Avançar' };

/** Link da proposta: endereço para o cliente, "Ver como o cliente", acessos registrados e troca do link. */
export async function proposalLinkDialog(p, onChange) {
  let info;
  try {
    if (can.write()) await post(`/api/propostas/${p.id}/link`, {});
    info = await get(`/api/propostas/${p.id}/link`);
  } catch (e) {
    return toastError(e);
  }
  const body = (i) => html`<p class="hint">Versão on-line da proposta para o cliente abrir no celular. O CRM registra cada abertura (data e hora), o tempo na proposta, até onde ele leu e o clique em "Quero avançar".</p>
    ${i.token ? html`<div class="link-row"><input readonly value="${linkUrl(i)}" aria-label="Link da proposta" data-nofocus>
      <button type="button" class="btn primary" data-copy-link>${icon('copiar', 16)} Copiar link</button>
      <a class="btn" href="${linkUrl(i, true)}" target="_blank" rel="noopener">${icon('olho', 16)} Ver como o cliente</a></div>` : html`<div class="alert warn">O link ainda não foi gerado para esta proposta.</div>`}
    <div class="kpis small link-kpis">
      <div class="kpi"><div class="kpi-label">Status do link</div><div class="kpi-value">${linkBadge({ link_status: i.status, link_first_opened_at: i.first_opened_at, link_advanced_at: i.advanced_at })}</div></div>
      <div class="kpi"><div class="kpi-label">Acessos</div><div class="kpi-value">${i.views}</div><div class="kpi-sub">${i.last_opened_at ? `último ${fmtDateTime(i.last_opened_at)}` : 'nenhum ainda'}</div></div>
      <div class="kpi"><div class="kpi-label">Tempo na proposta</div><div class="kpi-value">${readTime(i.seconds)}</div><div class="kpi-sub">somando os acessos</div></div>
      <div class="kpi"><div class="kpi-label">Leitura</div><div class="kpi-value">${i.max_scroll != null ? `${i.max_scroll}%` : '—'}</div><div class="kpi-sub">até onde rolou a página</div></div>
    </div>
    ${i.advanced_note ? html`<div class="alert ok">Mensagem do cliente ao avançar: “${i.advanced_note}”</div>` : ''}
    <h3 class="sub-h">Acessos do cliente</h3>
    ${i.views_list.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th>Abertura</th><th>Tempo</th><th>Leitura</th><th>O que viu</th><th>Aparelho</th></tr></thead><tbody>
      ${i.views_list.map((v) => html`<tr><td>${fmtDateTime(v.started_at)}</td><td>${readTime(v.seconds)}</td><td>${v.max_scroll}%</td><td class="small">${v.sections.map((x) => SECTION_LABEL[x] || x).join(', ') || '—'}</td><td>${v.device === 'mobile' ? 'Celular' : v.device === 'desktop' ? 'Computador' : '—'}</td></tr>`)}
    </tbody></table></div>` : empty('O cliente ainda não abriu o link.')}
    ${can.write() && i.token ? html`<p class="small"><button type="button" class="btn ghost small" data-renew>Gerar novo link</button> <span class="muted">o link atual deixa de abrir (use se foi enviado para a pessoa errada).</span></p>` : ''}`;
  await modal({
    title: `Link da proposta ${String(p.code).replace(/-v\d+$/, '')}`,
    wide: true,
    body: body(info),
    onMount(form) {
      on(form, 'click', '[data-copy-link]', () => copy(linkUrl(info), 'Link da proposta copiado.'));
      on(form, 'click', '[data-renew]', async () => {
        try {
          await post(`/api/propostas/${p.id}/link`, { renew: true });
          info = await get(`/api/propostas/${p.id}/link`);
          render($('.modal-body', form.closest('.modal')), body(info));
          toast('Novo link gerado. O anterior não abre mais.');
          onChange?.();
        } catch (e) {
          toastError(e);
        }
      });
    },
  });
  onChange?.();
}

/** PDF: o PDF gerado no simulador (quando existe) ou a versão on-line pronta para imprimir/salvar em PDF. */
export async function proposalPdf(p) {
  if (p.pdf_attachment_id && !window.CRM_PREVIEW) return window.open(`/api/anexos/${p.pdf_attachment_id}`, '_blank', 'noopener');
  const w = window.open('about:blank', '_blank');
  try {
    if (can.write()) await post(`/api/propostas/${p.id}/link`, {});
    const info = await get(`/api/propostas/${p.id}/link`);
    if (!info.token) throw new Error('Gere o link da proposta para montar o PDF.');
    const url = `${linkUrl(info)}?equipe=1&imprimir=1`;
    if (w) w.location.href = url;
    else window.open(url, '_blank');
  } catch (e) {
    w?.close();
    toastError(e);
  }
}

/** Modelo de mensagem do WhatsApp do passo da régua, com o link da proposta; envia pelo WhatsApp Web ou copia. */
export async function proposalWhatsapp(p, onChange) {
  let t;
  let info = null;
  try {
    if (can.write() && p.status !== 'substituida') info = await post(`/api/propostas/${p.id}/link`, {});
    t = await get(`/api/propostas/${p.id}/whatsapp`);
    info = info || t.link;
  } catch (e) {
    return toastError(e);
  }
  const url = linkUrl(info);
  const textOf = (step) => (t.steps.find((x) => x.step === step)?.text || '').replace(/\{link\}/g, url || '(link da proposta)').replace(/\\n/g, '\n');
  const draft = p.status === 'rascunho';
  const phone = t.phone.length >= 10 && t.phone.length <= 11 ? `55${t.phone}` : t.phone;
  const ok = await modal({
    title: 'Mensagem para o WhatsApp',
    wide: true,
    body: html`<div class="form-grid">
      <div class="field"><label>Passo da régua</label><select name="step">${t.steps.map((x) => html`<option value="${x.step}" ${x.step === t.current ? 'selected' : ''}>${x.title}</option>`)}</select></div>
      <div class="field"><label>Para</label><input value="${phone ? `+${phone}` : 'Cliente sem WhatsApp/telefone no cadastro'}" readonly data-nofocus></div>
      <div class="field full"><label>Mensagem</label><textarea name="text" rows="6">${textOf(t.current)}</textarea><small class="muted">Edite à vontade antes de enviar. O link abre a proposta on-line e registra a leitura.</small></div>
      ${draft && can.write() ? html`<label class="check full"><input type="checkbox" name="mark_sent" value="1" ${t.current === 'D0' ? 'checked' : ''}> Marcar como enviada ao cliente e iniciar a régua de follow-up (Dia 0 a Dia 21)</label>` : ''}
    </div>
    <p class="small"><button type="button" class="btn ghost small" data-copy-msg>${icon('copiar', 14)} Copiar mensagem</button></p>`,
    submitLabel: phone ? 'Abrir no WhatsApp' : 'Copiar e fechar',
    onMount(form) {
      form.step.addEventListener('change', () => (form.text.value = textOf(form.step.value)));
      on(form, 'click', '[data-copy-msg]', () => copy(form.text.value, 'Mensagem copiada.'));
    },
    async onSubmit(d) {
      // Abre o WhatsApp ainda dentro do clique (evita o bloqueio de janelas do navegador)
      if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(d.text)}`, '_blank', 'noopener');
      else await copy(d.text, 'Mensagem copiada.');
      if (d.mark_sent) {
        await post(`/api/propostas/${p.id}/status`, { status: 'apresentada', sent_channel: 'whatsapp' });
        toast('Proposta marcada como enviada: a régua de follow-up foi criada na agenda.');
      }
      return true;
    },
  });
  if (ok) onChange?.();
}

/** Botões de opções (Link, PDF e WhatsApp) para listas e cartões. */
export const optionButtons = (p) => html`<span class="prop-opts">
  <button type="button" class="icon-btn" data-p-link="${p.id}" title="Link da proposta (rastreável)" aria-label="Link da proposta">${icon('link', 16)}</button>
  <button type="button" class="icon-btn" data-p-pdf="${p.id}" title="Gerar PDF" aria-label="Gerar PDF">${icon('pdf', 16)}</button>
  <button type="button" class="icon-btn wa" data-p-wa="${p.id}" title="Modelo de mensagem do WhatsApp" aria-label="Mensagem do WhatsApp">${icon('whatsapp', 16)}</button>
</span>`;

/** Liga os botões de opções de uma área da tela. find(id) devolve a proposta da lista atual. */
export function bindOptionButtons(root, find, onChange) {
  on(root, 'click', '[data-p-link]', (e, b) => {
    e.stopPropagation();
    const p = find(Number(b.dataset.pLink));
    if (p) proposalLinkDialog(p, onChange);
  });
  on(root, 'click', '[data-p-pdf]', (e, b) => {
    e.stopPropagation();
    const p = find(Number(b.dataset.pPdf));
    if (p) proposalPdf(p);
  });
  on(root, 'click', '[data-p-wa]', (e, b) => {
    e.stopPropagation();
    const p = find(Number(b.dataset.pWa));
    if (p) proposalWhatsapp(p, onChange);
  });
}

