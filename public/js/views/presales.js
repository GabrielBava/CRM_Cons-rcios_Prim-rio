// 9. Pré-venda: do aceite da proposta ao boleto. Link de cadastro para o cliente, conferência, termo de adesão, contrato e boleto.
import { get, post } from '../api.js';
import { html, raw, render, $, on, state, selectOptions, userItems, table, badge, fmtMoney, fmtDate, fmtDateTime, relTime, modal, field, toast, toastError, empty, can, opts } from '../ui.js';

let saved = { status: 'ativas' };
const base = () => location.href.split('#')[0];

function stepper(steps, current) {
  const idx = steps.findIndex(([k]) => k === current);
  return html`<ol class="stepper">${steps.map(([k, label], i) => html`<li class="${current === 'cancelada' ? '' : i < idx || current === 'concluida' ? 'done' : i === idx ? 'current' : ''}">${label}</li>`)}</ol>`;
}
const miniSteps = (steps, r) => {
  const idx = r.status === 'cancelada' ? -1 : steps.findIndex(([k]) => k === r.status);
  return html`<div class="mini-steps" title="${r.status_label}">${steps.map((s, i) => html`<span class="${i <= idx ? 'on' : ''}"></span>`)}</div>`;
};

export async function show(view) {
  const load = async () => {
    let d;
    try {
      d = await get('/api/pre-vendas', saved);
    } catch (e) {
      render(view, html`<div class="page"><div class="alert danger">${e.message}</div></div>`);
      return;
    }
    const s = d.summary;
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Pré-venda</h1><p class="muted">Aberta automaticamente quando a proposta é aceita. Na primeira venda do cliente, é gerado o link do cadastro para adesão.</p></div>
        ${can.write() ? html`<div class="actions"><button class="btn" data-act="new">Abrir pré-venda manualmente</button></div>` : ''}</div>
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Geradas</div><div class="kpi-value">${s.geradas}</div></div>
        <div class="kpi"><div class="kpi-label">Enviadas ao cliente</div><div class="kpi-value">${s.enviadas}</div></div>
        <div class="kpi"><div class="kpi-label">Acessadas pelo cliente</div><div class="kpi-value">${s.acessadas}</div></div>
        <div class="kpi"><div class="kpi-label">Concluídas pelo cliente</div><div class="kpi-value">${s.concluidas_cliente}</div></div>
        <div class="kpi"><div class="kpi-label">Em adesão (termo → boleto)</div><div class="kpi-value">${s.em_andamento}</div></div>
        <div class="kpi ${s.paradas ? 'alert-kpi' : ''}"><div class="kpi-label">Paradas</div><div class="kpi-value">${s.paradas}</div><div class="kpi-sub">sem avanço há mais de ${state.meta.settings.presale_alert_hours} h</div></div>
      </div>
      <form class="filters" data-f>
        <label>Situação<select name="status">${selectOptions([{ value: 'ativas', label: 'Em andamento' }, ...d.steps.map(([value, label]) => ({ value, label })), { value: 'cancelada', label: 'Canceladas' }], saved.status, { placeholder: 'Todas' })}</select></label>
        ${can.manage() ? html`<label>Especialista<select name="owner_id">${selectOptions(userItems(), saved.owner_id, { placeholder: 'Todos' })}</select></label>` : ''}
        <label class="grow">Buscar<input type="search" name="q" value="${saved.q || ''}" placeholder="Cliente ou código (PV-…)"></label>
      </form>
      <section class="card">${table(
        [
          { label: 'Pré-venda', render: (r) => html`<a href="#" data-open="${r.id}"><strong>${r.code}</strong></a>${r.first_sale ? '' : html`<br><small class="muted">cliente já cadastrado</small>`}` },
          { label: 'Cliente', render: (r) => html`<a href="#/leads/${r.contact_id}/prevenda">${r.contact_name}</a><br><small>${r.contact_code}${r.proposal_code ? ` · ${r.proposal_code}` : ''}</small>` },
          { label: 'Crédito', render: (r) => html`${fmtMoney(r.credit_value)}${r.plan_name ? html`<br><small>${r.plan_name}</small>` : ''}`, cls: 'num' },
          { label: 'Andamento', render: (r) => html`${miniSteps(d.steps, r)}<small>${r.status_label}</small>${r.stale ? html` ${badge('Parada', 'danger')}` : ''}` },
          { label: 'Link do cliente', render: (r) => html`${r.sent_at ? html`enviado ${relTime(r.sent_at)}<br>` : r.first_sale ? html`<span class="warn-text">não enviado</span><br>` : ''}<small>${r.accessed_at ? `acessado ${fmtDateTime(r.accessed_at)}` : r.first_sale ? 'não acessado' : '—'}${r.completed_at && r.first_sale ? ` · concluído ${fmtDate(r.completed_at)}` : ''}</small>` },
          { label: 'Especialista', render: (r) => r.owner_name || '—' },
          { label: 'Venda', render: (r) => (r.sale_code ? html`<a href="#/vendas">${r.sale_code}</a><br><small>${r.sale_status === 'confirmada' ? 'confirmada' : r.sale_status === 'cancelada' ? 'cancelada' : 'aguardando pagamento'}</small>` : '—') },
          { label: '', render: (r) => html`<button class="btn small ${r.stale ? 'primary' : ''}" data-open="${r.id}">Abrir</button>` },
        ],
        d.rows,
        { emptyMsg: 'Nenhuma pré-venda com esses filtros.' },
      )}</section>
      <p class="hint">Se o cliente não acessar o link ou não concluir o cadastro em ${state.meta.settings.presale_alert_hours} horas, o CRM cria uma tarefa urgente "Revisar pré-venda" para o especialista.</p>
    </div>`);
    const f = $('[data-f]', view);
    f.addEventListener('change', () => ((saved = Object.fromEntries(new FormData(f).entries())), load()));
    let t;
    f.q.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => ((saved = Object.fromEntries(new FormData(f).entries())), load()), 350);
    });
    f.addEventListener('submit', (e) => e.preventDefault());
  };
  on(view, 'click', '[data-open]', (e, b) => {
    e.preventDefault();
    openPreSale(b.dataset.open, load).catch(toastError);
  });
  on(view, 'click', '[data-act=new]', () => newPreSale().then((ok) => ok && load()));
  await load();
}

async function newPreSale() {
  let chosen = null;
  return modal({
    title: 'Abrir pré-venda',
    body: html`<p class="hint">Normalmente a pré-venda abre sozinha no aceite da proposta. Use esta opção para casos excepcionais.</p>
      <div class="field full"><label>Cliente</label><input type="search" name="q" placeholder="Nome, telefone ou ID" autocomplete="off"></div><div class="pick-results"></div><div class="opp-pick"></div>`,
    submitLabel: 'Abrir',
    onMount(form) {
      let t;
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const rows = (await get('/api/busca', { q: form.q.value })).filter((r) => r.kind === 'contact');
          render($('.pick-results', form), rows.length ? html`${rows.map((r) => html`<label class="check"><input type="radio" name="pick" value="${r.id}"> ${r.title} <small>${r.code}</small></label>`)}` : empty('Nenhum cadastro.'));
        }, 250);
      });
      on(form, 'change', 'input[name=pick]', async (e, r) => {
        chosen = await get(`/api/cadastros/${r.value}`);
        const open = chosen.opportunities.filter((o) => o.status === 'aberta');
        render($('.opp-pick', form), open.length ? field({ name: 'opportunity_id', label: 'Negócio', type: 'select', options: open.map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` })), allowEmpty: false, full: true }) : html`<div class="alert warn">Sem negócio aberto.</div>`);
      });
    },
    async onSubmit(d) {
      if (!d.opportunity_id) throw new Error('Escolha o cliente e o negócio.');
      const r = await post('/api/pre-vendas', { opportunity_id: Number(d.opportunity_id) });
      toast(r.existing ? `Já existe a pré-venda ${r.code} em andamento.` : `Pré-venda ${r.code} aberta.`);
      return true;
    },
  });
}

/** Formulário da próxima etapa, conforme a situação atual. */
function nextStepForm(ps) {
  const plans = state.meta.products.filter((p) => p.active);
  switch (ps.status) {
    case 'link_gerado':
    case 'acessado':
    case 'preenchido':
      return {
        step: 'conferido',
        label: 'Marcar como conferido',
        body: html`<p class="small">${ps.status === 'preenchido' ? 'O cliente concluiu o cadastro.' : 'O cliente ainda não concluiu o cadastro pelo link.'} Confira dados e documentos (aprovar os anexos em Documentos) antes de seguir para o termo de adesão.</p>`,
      };
    case 'conferido':
      return {
        step: 'termo_adesao',
        label: 'Registrar termo de adesão',
        body: html`<p class="small">Com os dados conferidos, preencha o termo de adesão no portal da administradora e registre aqui.</p><div class="grid">
          ${field({ name: 'plan_id', label: 'Plano', type: 'select', options: plans.map((p) => ({ value: p.id, label: `${p.name}${p.administrator ? ` · ${p.administrator}` : ''}` })), value: ps.plan_id, required: true, full: true })}
          ${field({ name: 'credit_value', label: 'Crédito (R$)', type: 'money', value: ps.credit_value, required: true })}
          ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', value: ps.term_months })}
          ${field({ name: 'installment_value', label: 'Parcela (R$)', type: 'money', value: ps.installment_value })}
          ${field({ name: 'adhesion_number', label: 'Nº da proposta/adesão na administradora', value: ps.adhesion_number })}
          ${field({ name: 'adhesion_at', label: 'Data da adesão', type: 'date', value: new Date().toISOString().slice(0, 10) })}
          <p class="small muted full credit-hint"></p></div>`,
      };
    case 'termo_adesao':
      return { step: 'contrato_enviado', label: 'Contrato enviado ao cliente', body: field({ name: 'date', label: 'Data do envio', type: 'date', value: new Date().toISOString().slice(0, 10) }) };
    case 'contrato_enviado':
      return { step: 'contrato_assinado', label: 'Contrato assinado', body: field({ name: 'date', label: 'Data da assinatura', type: 'date', value: new Date().toISOString().slice(0, 10) }) };
    case 'contrato_assinado':
      return {
        step: 'boleto_emitido',
        label: 'Registrar boleto e criar a venda',
        body: html`<p class="small">Com o boleto emitido, a venda é registrada em Vendas com o status "aguardando pagamento".</p><div class="grid">
          ${field({ name: 'boleto_value', label: 'Valor do boleto (R$)', type: 'money', value: ps.installment_value, required: true })}
          ${field({ name: 'boleto_due', label: 'Vencimento', type: 'date', required: true })}</div>`,
      };
    default:
      return null;
  }
}

async function openPreSale(id, reload) {
  const ps = await get(`/api/pre-vendas/${id}`, { base: base() });
  const next = can.write() ? nextStepForm(ps) : null;
  const msg = ps.message;
  const missing = ps.checklist.items.filter((i) => !i.ok);
  const r = await modal({
    title: `Pré-venda ${ps.code} — ${ps.contact_name}`,
    wide: true,
    body: html`${stepper(ps.steps || [], ps.status)}
      ${ps.status === 'cancelada' ? html`<div class="alert danger">Cancelada em ${fmtDateTime(ps.cancelled_at)}: ${ps.cancel_reason}</div>` : ''}
      <div class="kv">
        <div><span>Cliente</span><a href="#/leads/${ps.contact_id}/prevenda">${ps.contact_code} — ${ps.contact_name}</a></div>
        <div><span>Proposta</span>${ps.proposal_code || '—'}</div>
        <div><span>Primeira venda do cliente</span>${ps.first_sale ? 'Sim (cadastro completo pelo link)' : 'Não (dados já cadastrados)'}</div>
        <div><span>Especialista</span>${ps.owner_name || '—'}</div>
        <div><span>Plano</span>${ps.plan_name ? `${ps.plan_name}${ps.administrator_name ? ` · ${ps.administrator_name}` : ''}` : '—'}</div>
        <div><span>Crédito</span>${fmtMoney(ps.credit_value)}</div>
        ${ps.adhesion_number ? html`<div><span>Nº da adesão</span>${ps.adhesion_number}</div>` : ''}
        ${ps.boleto_due ? html`<div><span>Boleto</span>${fmtMoney(ps.boleto_value)} · vence ${fmtDate(ps.boleto_due)}</div>` : ''}
        ${ps.sale_code ? html`<div><span>Venda</span><a href="#/vendas">${ps.sale_code}</a></div>` : ''}
      </div>
      ${ps.link_url && ps.first_sale && ['link_gerado', 'acessado', 'preenchido'].includes(ps.status) ? html`<section class="card inner"><h4>Link do cadastro para o cliente</h4>
        <p class="small">O cliente recebe o link com as instruções de preenchimento e o aviso de privacidade (LGPD). Acesso: ${ps.accessed_at ? `primeiro acesso em ${fmtDateTime(ps.accessed_at)}` : 'ainda não acessado'} · ${ps.link_access_count || 0} acesso(s).</p>
        <div class="inline-actions">
          ${msg?.whatsapp_url ? html`<a class="btn small primary" href="${msg.whatsapp_url}" target="_blank" rel="noopener noreferrer" data-sent="whatsapp">Enviar por WhatsApp</a>` : ''}
          ${msg?.email_url ? html`<a class="btn small" href="${msg.email_url}" data-sent="email">Enviar por e-mail</a>` : html`<span class="small muted">Sem e-mail no cadastro.</span>`}
          <button type="button" class="btn small" data-copy-msg>Copiar mensagem</button>
          ${window.CRM_PREVIEW ? html`<a class="btn small" href="${ps.link_url.slice(ps.link_url.indexOf('#'))}">Testar como cliente</a>` : ''}
        </div>
        <pre class="code msg-preview">${msg?.text || ''}</pre>
        <p class="hint">O envio automático por e-mail (sem abrir o seu programa de e-mail) é uma integração pendente: depende de configurar um serviço de envio (SMTP).</p></section>` : ''}
      ${missing.length && !['concluida', 'cancelada', 'boleto_emitido'].includes(ps.status) ? html`<div class="alert warn"><strong>Pendências da ficha (${missing.length}):</strong> ${missing.slice(0, 8).map((m) => m.label).join('; ')}${missing.length > 8 ? '…' : ''}</div>` : ''}
      ${next ? html`<section class="card inner next-step"><h4>Próxima etapa: ${next.label}</h4>${next.body}</section>` : ''}
      <details><summary>Histórico</summary><ul class="audit">${ps.history.map((h) => html`<li>${fmtDateTime(h.created_at)} · ${h.user_name || 'Cliente/sistema'} · ${h.action}</li>`)}</ul></details>
      ${can.write() && !['concluida', 'cancelada'].includes(ps.status) ? html`<p><button type="button" class="btn small ghost" data-cancel>Cancelar pré-venda</button></p>` : ''}`,
    submitLabel: next?.label || 'Fechar',
    onSubmit: next
      ? async (d) => {
          const res = await post(`/api/pre-vendas/${ps.id}/avancar`, { step: next.step, ...d });
          toast(res.sale ? `Venda ${res.sale.code} registrada, aguardando pagamento.` : 'Etapa registrada.');
          return 'changed';
        }
      : undefined,
    onMount(form, close) {
      on(form, 'click', '[data-sent]', (e, a) => post(`/api/pre-vendas/${ps.id}/enviado`, { via: a.dataset.sent }).catch(() => {}));
      on(form, 'click', '[data-copy-msg]', async () => {
        try {
          await navigator.clipboard.writeText(msg.text);
          toast('Mensagem copiada.');
        } catch {
          toast('Selecione o texto da mensagem e copie (Ctrl+C).');
        }
        post(`/api/pre-vendas/${ps.id}/enviado`, { via: 'copiado' }).catch(() => {});
      });
      on(form, 'click', '[data-cancel]', async () => {
        const reason = await modal({ title: 'Cancelar pré-venda', body: field({ name: 'reason', label: 'Motivo', type: 'textarea', required: true, full: true }), submitLabel: 'Cancelar pré-venda', cancelLabel: 'Voltar', danger: true, onSubmit: (v) => v.reason });
        if (!reason) return;
        try {
          await post(`/api/pre-vendas/${ps.id}/cancelar`, { reason });
          toast('Pré-venda cancelada.');
          close('changed');
        } catch (e) {
          toastError(e);
        }
      });
      // Confere a faixa de crédito do plano enquanto digita
      const hint = form.querySelector('.credit-hint');
      if (hint && form.plan_id) {
        const check = async () => {
          if (!form.plan_id.value || !form.credit_value.value) return (hint.textContent = '');
          const r2 = await get(`/api/planos/${form.plan_id.value}/verificar-credito`, { valor: form.credit_value.value });
          hint.textContent = r2.error || 'Crédito dentro da faixa do plano.';
          hint.className = `small full credit-hint ${r2.error ? 'warn-text' : 'ok-text'}`;
        };
        form.plan_id.addEventListener('change', check);
        form.credit_value.addEventListener('change', check);
        check();
      }
    },
  });
  if (r === 'changed' || r === true) reload();
}
