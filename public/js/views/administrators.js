// 14. Administradoras (administrador): identificação, contatos, portal, política de repasse e tabela de comissão.
import { get, post } from '../api.js';
import { html, render, $, $$, on, table, badge, field, modal, toast, toastError } from '../ui.js';

const fmtP = (v) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;

/** Editor de tabela em parcelas (comissão ou repasse): mês, % do crédito e carência para liberar. */
export function scheduleEditor(name, rows = [], { title, help } = {}) {
  const line = (r = {}, i = 0) => html`<tr data-row>
    <td class="num">${i + 1}ª</td>
    <td><input type="number" min="0" max="120" step="1" data-k="month_offset" value="${r.month_offset ?? i}" aria-label="Mês"></td>
    <td><input type="number" min="0" max="100" step="0.0001" data-k="pct" value="${r.pct ?? ''}" aria-label="Percentual"></td>
    <td><input type="number" min="0" max="365" step="1" data-k="release_after_days" value="${r.release_after_days ?? 0}" aria-label="Carência em dias"></td>
    <td><button type="button" class="icon" data-sch-del aria-label="Remover parcela">×</button></td></tr>`;
  return html`<div class="field full schedule" data-schedule="${name}">
    <label>${title}</label>
    <table class="compact"><thead><tr><th>Parcela</th><th>Mês (0 = mês da venda)</th><th>% do crédito</th><th>Liberar após (dias sem cancelamento)</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => line(r, i))}</tbody>
      <tfoot><tr><td colspan="2"><button type="button" class="btn small" data-sch-add>+ Parcela</button></td><td colspan="3"><strong data-sch-total>Total: ${fmtP(rows.reduce((t, r) => t + Number(r.pct || 0), 0))}</strong></td></tr></tfoot></table>
    ${help ? html`<small>${help}</small>` : ''}
    <template data-sch-tpl>${line({}, 0)}</template></div>`;
}

/** Liga os botões dos editores de tabela dentro de um formulário. */
export function bindSchedules(form) {
  const total = (box) => {
    const t = $$('[data-k=pct]', box).reduce((s, i) => s + Number(i.value || 0), 0);
    $('[data-sch-total]', box).textContent = `Total: ${fmtP(t)}`;
    $$('tbody tr', box).forEach((tr, i) => (tr.firstElementChild.textContent = `${i + 1}ª`));
  };
  on(form, 'click', '[data-sch-add]', (e, b) => {
    const box = b.closest('[data-schedule]');
    const tb = $('tbody', box);
    tb.insertAdjacentHTML('beforeend', $('template', box).innerHTML);
    const last = tb.lastElementChild;
    $('[data-k=month_offset]', last).value = tb.children.length - 1;
    total(box);
  });
  on(form, 'click', '[data-sch-del]', (e, b) => {
    const box = b.closest('[data-schedule]');
    b.closest('tr').remove();
    total(box);
  });
  on(form, 'input', '[data-schedule] input', (e, i) => total(i.closest('[data-schedule]')));
}

export const readSchedule = (form, name) =>
  $$(`[data-schedule="${name}"] tbody tr`, form)
    .map((tr) => Object.fromEntries($$('[data-k]', tr).map((i) => [i.dataset.k, i.value])))
    .filter((r) => r.pct !== '');

export const scheduleText = (s) => (s?.length ? s.map((r) => fmtP(r.pct)).join(' + ') : '—');

export async function show(view) {
  let rows = [];
  const load = async () => {
    try {
      rows = await get('/api/administradoras');
    } catch (e) {
      return toastError(e);
    }
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Administradoras</h1><p class="muted">Contatos, acesso ao portal, política de repasse e tabela de comissão de cada administradora. Visível só para o administrador.</p></div>
        <div class="actions"><button class="btn primary" data-act="new">+ Nova administradora</button></div></div>
      <section class="card">${table(
        [
          { label: 'ID', render: (a) => html`<strong>${a.code}</strong>` },
          { label: 'Administradora', render: (a) => html`<a href="#" data-edit="${a.id}"><strong>${a.name}</strong></a>${a.active ? '' : html` ${badge('Inativa', 'muted')}`}${a.cnpj ? html`<br><small>CNPJ ${a.cnpj}</small>` : ''}` },
          { label: 'Portal', render: (a) => html`${a.portal_url ? html`<a href="${a.portal_url}" target="_blank" rel="noopener noreferrer">abrir portal</a>` : '—'}${a.portal_login ? html`<br><small>usuário: ${a.portal_login}</small>` : ''}${a.portal_password_set ? html`<br><button class="btn small ghost" data-pass="${a.id}">Ver senha</button>` : ''}` },
          { label: 'Contatos', render: (a) => html`${a.commercial_name ? html`Comercial: ${a.commercial_name}<br>` : ''}${a.manager_name ? html`Gerente de conta: ${a.manager_name}` : ''}${!a.commercial_name && !a.manager_name ? '—' : ''}` },
          { label: 'Repasse', render: (a) => html`${a.payout_day ? `dia ${a.payout_day}` : '—'}${a.payout_method ? html`<br><small>${a.payout_method}</small>` : ''}` },
          { label: 'Comissão', render: (a) => html`${scheduleText(a.commission_schedule)}<br><small>total ${fmtP(a.commission_total)}</small>` },
          { label: 'Planos', key: 'plans', cls: 'num' },
          { label: 'Vendas', key: 'sales', cls: 'num' },
          { label: '', render: (a) => html`<button class="btn small" data-edit="${a.id}">Editar</button> <a class="btn small ghost" href="#/planos?administradora=${a.id}">Planos</a>` },
        ],
        rows,
        { emptyMsg: 'Nenhuma administradora cadastrada. Cadastre a primeira para vincular planos e comissões.' },
      )}</section>
      <p class="hint">A senha do portal fica cifrada no banco e só o administrador consegue vê-la (cada consulta fica registrada na auditoria).</p>
    </div>`);
  };

  const form = (a = { commission_schedule: [{ month_offset: 0, pct: 0.3, release_after_days: 7 }, { month_offset: 1, pct: 0.1 }, { month_offset: 2, pct: 0.1 }, { month_offset: 3, pct: 0.1 }], payout_schedule: [], chargeback_policy: { estornar_pagas: true, ate_dias: 365 } }) =>
    modal({
      title: a.id ? `Editar ${a.name}` : 'Nova administradora',
      wide: true,
      body: html`<h4>Identificação</h4><div class="grid">
          ${field({ name: 'name', label: 'Nome', value: a.name, required: true })}
          ${field({ name: 'cnpj', label: 'CNPJ', value: a.cnpj })}
          ${field({ name: 'website', label: 'Site', value: a.website })}
          ${a.id ? field({ name: 'active', label: 'Ativa', type: 'checkbox', value: a.active }) : ''}
        </div>
        <h4>Contatos</h4><div class="grid three">
          ${field({ name: 'direct_name', label: 'Contato direto', value: a.direct_name })}
          ${field({ name: 'direct_phone', label: 'Telefone', type: 'tel', value: a.direct_phone })}
          ${field({ name: 'direct_email', label: 'E-mail', type: 'email', value: a.direct_email })}
          ${field({ name: 'commercial_name', label: 'Comercial', value: a.commercial_name })}
          ${field({ name: 'commercial_phone', label: 'Telefone', type: 'tel', value: a.commercial_phone })}
          ${field({ name: 'commercial_email', label: 'E-mail', type: 'email', value: a.commercial_email })}
          ${field({ name: 'manager_name', label: 'Gerente de conta', value: a.manager_name })}
          ${field({ name: 'manager_phone', label: 'Telefone', type: 'tel', value: a.manager_phone })}
          ${field({ name: 'manager_email', label: 'E-mail', type: 'email', value: a.manager_email })}
        </div>
        <h4>Acesso ao portal</h4><div class="grid">
          ${field({ name: 'portal_url', label: 'Endereço do portal', value: a.portal_url })}
          ${field({ name: 'portal_login', label: 'Usuário de acesso', value: a.portal_login })}
          <div class="field"><label for="portal_password">Senha de acesso</label><div class="pass-input"><input id="portal_password" type="password" name="portal_password" autocomplete="new-password" placeholder="${a.portal_password_set ? '•••••••• (cadastrada: em branco mantém a atual)' : 'Senha do portal'}"><button type="button" class="btn small ghost" data-toggle-pass>Mostrar</button></div><small>Guardada cifrada. Visível só para o administrador.</small></div>
          ${a.portal_password_set ? field({ name: 'portal_password_clear', label: 'Remover a senha cadastrada', type: 'checkbox' }) : ''}
        </div>
        <h4>Repasse</h4><div class="grid">
          ${field({ name: 'payout_day', label: 'Dia do repasse', type: 'number', min: 1, value: a.payout_day, help: 'Dia do mês em que a administradora paga as comissões.' })}
          ${field({ name: 'payout_method', label: 'Forma de repasse', value: a.payout_method, placeholder: 'Ex.: TED para a conta PJ, nota fiscal até o dia 20' })}
          ${field({ name: 'payout_policy', label: 'Regras do repasse', type: 'textarea', value: a.payout_policy, full: true, placeholder: 'Ex.: paga após a 1ª parcela quitada pelo cliente; estorna se a cota cancelar em até 12 meses.' })}
          ${scheduleEditor('payout_schedule', a.payout_schedule, { title: 'Tabela de repasse da administradora para a empresa (opcional)' })}
        </div>
        <h4>Comissão do especialista</h4>
        ${scheduleEditor('commission_schedule', a.commission_schedule, {
          title: 'Parcelas da comissão (% do crédito vendido)',
          help: 'Ex.: 0,3% no mês da venda, liberado se a cota não for cancelada em 7 dias, depois 0,1% + 0,1% + 0,1% nos meses seguintes = 0,6%. Um plano pode ter tabela própria.',
        })}
        <div class="grid">
          ${field({ name: 'estornar_pagas', label: 'Estornar parcelas já pagas quando a cota for cancelada', type: 'checkbox', value: a.chargeback_policy?.estornar_pagas !== false })}
          ${field({ name: 'ate_dias', label: 'Estornar cancelamentos ocorridos até (dias após a venda)', type: 'number', min: 0, value: a.chargeback_policy?.ate_dias ?? 365 })}
        </div>
        ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: a.notes, full: true })}`,
      onMount(f) {
        bindSchedules(f);
        on(f, 'click', '[data-toggle-pass]', (e, b) => {
          const i = f.portal_password;
          i.type = i.type === 'password' ? 'text' : 'password';
          b.textContent = i.type === 'password' ? 'Mostrar' : 'Ocultar';
        });
      },
      async onSubmit(d, f) {
        const { estornar_pagas, ate_dias, ...rest } = d;
        await post('/api/administradoras', {
          ...rest,
          id: a.id,
          commission_schedule: readSchedule(f, 'commission_schedule'),
          payout_schedule: readSchedule(f, 'payout_schedule'),
          chargeback_policy: { estornar_pagas, ate_dias },
        });
        toast('Administradora salva.');
        window.dispatchEvent(new Event('crm:refresh-meta'));
        return true;
      },
    });
  on(view, 'click', '[data-act=new]', async () => (await form()) && load());
  on(view, 'click', '[data-pass]', async (e, b) => {
    const a = rows.find((x) => x.id === Number(b.dataset.pass));
    try {
      const r = await post(`/api/administradoras/${a.id}/senha`);
      await modal({
        title: `Acesso ao portal — ${a.name}`,
        body: html`<div class="kv"><div><span>Portal</span>${a.portal_url ? html`<a href="${a.portal_url}" target="_blank" rel="noopener noreferrer">${a.portal_url}</a>` : '—'}</div><div><span>Usuário</span>${a.portal_login || '—'}</div><div><span>Senha</span><code class="secret">${r.password}</code> <button type="button" class="btn small" data-copy>Copiar</button></div></div><p class="hint">Esta consulta foi registrada na auditoria.</p>`,
        onMount(f) {
          on(f, 'click', '[data-copy]', async (ev, btn) => {
            try {
              await navigator.clipboard.writeText(r.password);
              btn.textContent = 'Copiada';
            } catch {
              btn.textContent = 'Selecione e copie';
            }
          });
        },
      });
    } catch (ex) {
      toastError(ex);
    }
  });
  on(view, 'click', '[data-edit]', async (e, b) => {
    e.preventDefault();
    if (await form(rows.find((a) => a.id === Number(b.dataset.edit)))) load();
  });
  await load();
}
