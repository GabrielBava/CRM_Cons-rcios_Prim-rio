// Colaboradores (RH): lista com indicadores e a ficha completa do colaborador (identificação, organização,
// modelo contratual, jornada, remuneração, benefícios e descontos, contratos com anexo, documentos e histórico).
import { get, post, patch, del } from '../api.js';
import { html, render, $, $$, on, table, badge, field, modal, toast, toastError, fmtMoney, fmtDate, fmtDateTime, confirmDialog, empty } from '../ui.js';
import { fileToBase64, bindCepAutofill } from './record-tabs.js';

const STATUS_KIND = { ativo: 'ok', ferias: 'info', afastado: 'warn', desligado: 'muted' };
const items = (obj) => Object.entries(obj || {}).map(([value, label]) => ({ value, label }));
const list = (rows, label = (r) => r.name) => rows.map((r) => ({ value: r.id, label: label(r) }));
let cat = null;
let filters = { status: '', contrato: '', q: '' };

async function catalogs() {
  if (!cat) cat = await get('/api/colaboradores/cadastros');
  return cat;
}
const fmtCpf = (v) => (v && v.length === 11 ? `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}` : v || '—');
const fmtCnpj = (v) => (v && v.length === 14 ? `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}` : v || '—');
const yearsMonths = (from, to) => {
  if (!from) return '—';
  const a = new Date(`${from}T12:00:00`);
  const b = to ? new Date(`${to}T12:00:00`) : new Date();
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0);
  m = Math.max(0, m);
  return m < 12 ? `${m} mes(es)` : `${Math.floor(m / 12)} ano(s)${m % 12 ? ` e ${m % 12} mes(es)` : ''}`;
};
const dl = (pairs) => html`<dl class="kv">${pairs.filter(([, v]) => v !== false).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd></div>`)}</dl>`;

export async function show(view, { id }) {
  if (id) return detail(view, Number(id));
  return listView(view);
}

/* ------------------------- Lista ------------------------- */

async function listView(view) {
  const c = await catalogs();
  const load = async () => {
    let d;
    try {
      d = await get('/api/colaboradores', { ...filters, todos: filters.status === 'todos' ? '1' : '', status: filters.status === 'todos' ? '' : filters.status });
    } catch (e) {
      return toastError(e);
    }
    const s = d.summary;
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Colaboradores</h1><p class="muted">Cadastro completo da equipe: identificação, organização, contrato, jornada, remuneração, benefícios e documentos.</p></div>
        <div class="actions"><a class="btn ghost" href="#/relatorios/rh_quadro">Relatórios de RH</a><button class="btn primary" data-act="new">+ Novo colaborador</button></div></div>
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Ativos</div><div class="kpi-value">${s.ativos}</div></div>
        <div class="kpi"><div class="kpi-label">Em férias</div><div class="kpi-value">${s.ferias}</div></div>
        <div class="kpi"><div class="kpi-label">Afastados</div><div class="kpi-value">${s.afastados}</div></div>
        <div class="kpi"><div class="kpi-label">Desligados</div><div class="kpi-value">${s.desligados}</div></div>
        <div class="kpi"><div class="kpi-label">Custo mensal estimado</div><div class="kpi-value">${fmtMoney(s.custo_mensal)}</div><div class="kpi-sub">fixo + variável + benefícios</div></div>
      </div>
      <form class="card filters" data-filters>
        <div class="grid four">
          ${field({ name: 'q', label: 'Buscar', value: filters.q, placeholder: 'Nome, código, cargo, e-mail ou CPF' })}
          ${field({ name: 'status', label: 'Situação', type: 'select', value: filters.status, placeholder: 'Ativos, férias e afastados', options: [...items(c.status), { value: 'todos', label: 'Todos (inclui desligados)' }] })}
          ${field({ name: 'contrato', label: 'Modelo contratual', type: 'select', value: filters.contrato, placeholder: 'Todos', options: items(c.contract_types) })}
          ${field({ name: 'time', label: 'Time', type: 'select', value: filters.time, placeholder: 'Todos', options: list(c.teams) })}
        </div>
      </form>
      <section class="card">${table(
        [
          { label: 'Código', render: (e) => html`<a href="#/colaboradores/${e.id}"><strong>${e.code}</strong></a>` },
          { label: 'Colaborador', render: (e) => html`<a href="#/colaboradores/${e.id}"><strong>${e.full_name}</strong></a><br><small>${e.job_title || 'Cargo não informado'}${e.corporate_email ? ` · ${e.corporate_email}` : ''}</small>` },
          { label: 'Time e líder', render: (e) => html`${e.team_name || '—'}${e.leader_name ? html`<br><small>Líder: ${e.leader_name}</small>` : ''}` },
          { label: 'Contrato', render: (e) => html`${badge(c.contract_types[e.contract_type], 'info')}${e.contract?.end_date ? html`<br><small>vigência até ${fmtDate(e.contract.end_date)}</small>` : ''}` },
          { label: 'Entrada', render: (e) => html`${fmtDate(e.admission_date)}<br><small>${yearsMonths(e.admission_date, e.termination_date)}</small>` },
          { label: 'Situação', render: (e) => badge(c.status[e.status], STATUS_KIND[e.status]) },
          { label: 'Custo mensal', cls: 'num', render: (e) => fmtMoney(e.cost.total_cost) },
        ],
        d.rows,
        { emptyMsg: 'Nenhum colaborador encontrado. Cadastre o primeiro em "+ Novo colaborador".' },
      )}</section>
    </div>`);
    const f = $('[data-filters]', view);
    let t;
    f.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        filters = { q: f.q.value, status: f.status.value, contrato: f.contrato.value, time: f.time.value };
        load();
      }, 350);
    });
  };
  on(view, 'click', '[data-act=new]', async () => {
    const r = await employeeForm();
    if (r?.id) location.hash = `#/colaboradores/${r.id}`;
  });
  await load();
}

/* ------------------------- Formulário do colaborador ------------------------- */

async function employeeForm(e = { status: 'ativo', contract_type: 'clt', pay_model: 'fixa', nationality: 'Brasileira' }) {
  const c = await catalogs();
  const leaders = c.leaders.filter((l) => l.id !== e.id);
  return modal({
    title: e.id ? `Editar ${e.full_name}` : 'Novo colaborador',
    wide: true,
    submitLabel: e.id ? 'Salvar alterações' : 'Cadastrar colaborador',
    body: html`
      <h4>Identificação</h4><div class="grid three">
        ${field({ name: 'full_name', label: 'Nome completo', value: e.full_name, required: true, full: true })}
        ${field({ name: 'social_name', label: 'Nome social', value: e.social_name })}
        ${field({ name: 'cpf', label: 'CPF', value: e.cpf ? fmtCpf(e.cpf) : '' })}
        ${field({ name: 'rg', label: 'RG', value: e.rg })}
        ${field({ name: 'rg_issuer', label: 'Órgão emissor', value: e.rg_issuer, placeholder: 'SSP/RS' })}
        ${field({ name: 'birth_date', label: 'Data de nascimento', type: 'date', value: e.birth_date })}
        ${field({ name: 'sex', label: 'Sexo', type: 'select', value: e.sex, options: [{ value: 'feminino', label: 'Feminino' }, { value: 'masculino', label: 'Masculino' }, { value: 'outro', label: 'Outro / prefiro não informar' }] })}
        ${field({ name: 'marital_status', label: 'Estado civil', type: 'select', value: e.marital_status, options: ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'].map((v) => ({ value: v, label: v })) })}
        ${field({ name: 'nationality', label: 'Nacionalidade', value: e.nationality })}
        ${field({ name: 'mother_name', label: 'Nome da mãe', value: e.mother_name })}
        ${field({ name: 'education', label: 'Escolaridade', type: 'select', value: e.education, options: ['Ensino médio', 'Técnico', 'Superior incompleto', 'Superior completo', 'Pós-graduação / MBA', 'Mestrado', 'Doutorado'].map((v) => ({ value: v, label: v })) })}
      </div>
      <h4>Contato</h4><div class="grid three">
        ${field({ name: 'phone', label: 'Telefone / WhatsApp', type: 'tel', value: e.phone })}
        ${field({ name: 'personal_email', label: 'E-mail pessoal', type: 'email', value: e.personal_email })}
        ${field({ name: 'corporate_email', label: 'E-mail corporativo (criado para o colaborador)', type: 'email', value: e.corporate_email, placeholder: 'nome@veroconsorciosbr.com.br' })}
      </div>
      <h4>Endereço</h4><div class="grid three">
        <div class="field"><label>CEP</label><input name="cep" value="${e.cep || ''}" inputmode="numeric" autocomplete="off" placeholder="00000-000"><small class="cep-msg"></small></div>
        ${field({ name: 'street', label: 'Logradouro', value: e.street })}
        ${field({ name: 'number', label: 'Número', value: e.number })}
        ${field({ name: 'complement', label: 'Complemento', value: e.complement })}
        ${field({ name: 'district', label: 'Bairro', value: e.district })}
        ${field({ name: 'city', label: 'Cidade', value: e.city })}
        ${field({ name: 'state', label: 'UF', value: e.state, maxlength: 2 })}
      </div>
      <h4>Contato de emergência</h4><div class="grid three">
        ${field({ name: 'emergency_name', label: 'Nome', value: e.emergency_name })}
        ${field({ name: 'emergency_relation', label: 'Parentesco', value: e.emergency_relation, placeholder: 'Cônjuge, pai, mãe…' })}
        ${field({ name: 'emergency_phone', label: 'Telefone', type: 'tel', value: e.emergency_phone })}
      </div>
      <h4>Organização</h4><div class="grid three">
        ${field({ name: 'job_title', label: 'Cargo', value: e.job_title, placeholder: 'Especialista em consórcios' })}
        ${field({ name: 'job_function', label: 'Função', value: e.job_function, placeholder: 'Atendimento e vendas consultivas' })}
        ${field({ name: 'team_id', label: 'Time', type: 'select', value: e.team_id, options: list(c.teams) })}
        ${field({ name: 'leader_id', label: 'Líder direto', type: 'select', value: e.leader_id, options: list(leaders, (l) => `${l.name}${l.job_title ? ` · ${l.job_title}` : ''}`) })}
        ${field({ name: 'cost_center_id', label: 'Centro de custo', type: 'select', value: e.cost_center_id, options: list(c.cost_centers) })}
        ${field({ name: 'user_id', label: 'Usuário do CRM (opcional)', type: 'select', value: e.user_id, options: list(c.users, (u) => `${u.name} · ${u.email}`) })}
        ${field({ name: 'admission_date', label: 'Data de entrada', type: 'date', value: e.admission_date })}
        ${field({ name: 'work_regime', label: 'Regime de trabalho', type: 'select', value: e.work_regime, options: items(c.work_regimes) })}
        ${field({ name: 'work_location', label: 'Local de trabalho', value: e.work_location, placeholder: 'Sede Porto Alegre' })}
      </div>
      <h4>Situação</h4><div class="grid three">
        ${field({ name: 'status', label: 'Situação', type: 'select', value: e.status, options: items(c.status), allowEmpty: false })}
        <div data-when-status="ferias afastado" class="grid-span">${field({ name: 'status_since', label: 'Desde', type: 'date', value: e.status_since })}</div>
        <div data-when-status="ferias afastado" class="grid-span">${field({ name: 'status_until', label: 'Retorno previsto', type: 'date', value: e.status_until })}</div>
        <div data-when-status="ferias afastado" class="grid-span full">${field({ name: 'status_reason', label: 'Motivo / observação', value: e.status_reason, full: true })}</div>
        <div data-when-status="desligado" class="grid-span">${field({ name: 'termination_date', label: 'Data do desligamento', type: 'date', value: e.termination_date })}</div>
        <div data-when-status="desligado" class="grid-span">${field({ name: 'termination_type', label: 'Tipo de desligamento', type: 'select', value: e.termination_type, options: items(c.termination_types) })}</div>
        <div data-when-status="desligado" class="grid-span full">${field({ name: 'termination_reason', label: 'Motivo do desligamento', value: e.termination_reason, full: true })}</div>
      </div>
      <h4>Modelo contratual</h4><div class="grid three">
        ${field({ name: 'contract_type', label: 'Modelo', type: 'select', value: e.contract_type, options: items(c.contract_types), allowEmpty: false })}
        ${field({ name: 'probation_end', label: 'Fim da experiência', type: 'date', value: e.probation_end, help: 'CLT: até 90 dias.' })}
      </div>
      <div class="grid three" data-when-contract="pj prestador">
        ${field({ name: 'pj_company_name', label: 'Razão social', value: e.pj_company_name })}
        ${field({ name: 'pj_trade_name', label: 'Nome fantasia', value: e.pj_trade_name })}
        ${field({ name: 'pj_cnpj', label: 'CNPJ', value: e.pj_cnpj ? fmtCnpj(e.pj_cnpj) : '' })}
        ${field({ name: 'pj_municipal_reg', label: 'Inscrição municipal', value: e.pj_municipal_reg })}
        ${field({ name: 'pj_tax_regime', label: 'Regime tributário', type: 'select', value: e.pj_tax_regime, options: ['MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real'].map((v) => ({ value: v, label: v })) })}
      </div>
      <div class="grid three" data-when-contract="estagio">
        ${field({ name: 'internship_institution', label: 'Instituição de ensino', value: e.internship_institution })}
        ${field({ name: 'internship_course', label: 'Curso', value: e.internship_course })}
        ${field({ name: 'internship_supervisor', label: 'Supervisor do estágio', value: e.internship_supervisor })}
      </div>
      <div class="grid three" data-when-contract="socio">
        ${field({ name: 'partner_share_pct', label: 'Participação societária (%)', type: 'number', min: 0, step: '0.01', value: e.partner_share_pct })}
      </div>
      <div class="grid three" data-when-contract="clt">
        ${field({ name: 'pis', label: 'PIS/PASEP', value: e.pis })}
        ${field({ name: 'ctps', label: 'CTPS (número)', value: e.ctps })}
        ${field({ name: 'ctps_series', label: 'CTPS (série)', value: e.ctps_series })}
      </div>
      <div data-when-contract="clt estagio">
        <h4>Jornada e carga horária</h4><div class="grid three">
          ${field({ name: 'work_schedule', label: 'Escala / jornada', value: e.work_schedule, placeholder: 'Segunda a sexta, 9h às 18h' })}
          ${field({ name: 'weekly_hours', label: 'Carga semanal (horas)', type: 'number', min: 1, step: '0.5', value: e.weekly_hours, help: 'CLT: até 44h. Estágio: até 30h.' })}
          ${field({ name: 'daily_hours', label: 'Carga diária (horas)', type: 'number', min: 1, step: '0.5', value: e.daily_hours })}
          ${field({ name: 'break_minutes', label: 'Intervalo (minutos)', type: 'number', min: 0, step: 5, value: e.break_minutes })}
          ${field({ name: 'time_tracking', label: 'Controle de ponto', type: 'select', value: e.time_tracking, options: ['Ponto eletrônico', 'Aplicativo', 'Manual', 'Isento (cargo de confiança)'].map((v) => ({ value: v, label: v })) })}
        </div>
      </div>
      <h4>Remuneração</h4><div class="grid three">
        ${field({ name: 'pay_model', label: 'Modelo de remuneração', type: 'select', value: e.pay_model, options: items(c.pay_models), allowEmpty: false })}
        <div data-when-pay="fixa hibrida" class="grid-span">${field({ name: 'base_salary', label: 'Remuneração fixa (mensal)', type: 'money', value: e.base_salary })}</div>
        ${field({ name: 'pay_day', label: 'Dia do pagamento', type: 'number', min: 1, step: 1, value: e.pay_day })}
      </div>
      <div class="grid three" data-when-pay="variavel hibrida">
        ${field({ name: 'variable_description', label: 'Regra da remuneração variável', type: 'textarea', rows: 2, value: e.variable_description, full: true, placeholder: 'Ex.: 0,6% sobre o crédito vendido, pago em parcelas conforme a tabela da administradora; bônus por meta trimestral.' })}
        ${field({ name: 'variable_target', label: 'Variável de referência (mensal)', type: 'money', value: e.variable_target, help: 'Valor médio/meta, usado na estimativa de custo.' })}
        ${field({ name: 'variable_cap', label: 'Teto da variável (opcional)', type: 'money', value: e.variable_cap })}
      </div>
      <h4>Dados bancários</h4><div class="grid three">
        ${field({ name: 'bank_name', label: 'Banco', value: e.bank_name })}
        ${field({ name: 'bank_agency', label: 'Agência', value: e.bank_agency })}
        ${field({ name: 'bank_account', label: 'Conta', value: e.bank_account })}
        ${field({ name: 'bank_account_type', label: 'Tipo de conta', type: 'select', value: e.bank_account_type, options: ['Corrente', 'Poupança', 'Salário', 'Pagamento'].map((v) => ({ value: v, label: v })) })}
        ${field({ name: 'pix_key', label: 'Chave Pix', value: e.pix_key })}
      </div>
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: e.notes, full: true })}
      ${e.id ? '' : html`<p class="hint">Depois de cadastrar, inclua o contrato (com o arquivo), os benefícios e descontos e os documentos na ficha do colaborador.</p>`}`,
    onMount(form) {
      bindCepAutofill(form, (cep) => get(`/api/cep/${cep}`));
      const sync = () => {
        $$('[data-when-contract]', form).forEach((el) => (el.hidden = !el.dataset.whenContract.split(' ').includes(form.contract_type.value)));
        $$('[data-when-pay]', form).forEach((el) => (el.hidden = !el.dataset.whenPay.split(' ').includes(form.pay_model.value)));
        $$('[data-when-status]', form).forEach((el) => (el.hidden = !el.dataset.whenStatus.split(' ').includes(form.status.value)));
      };
      ['contract_type', 'pay_model', 'status'].forEach((n) => form[n].addEventListener('change', sync));
      sync();
    },
    async onSubmit(d, form) {
      // Campos escondidos (de outro modelo contratual) não são enviados
      const hidden = new Set($$('[hidden] [name]', form).map((el) => el.name));
      const body = Object.fromEntries(Object.entries(d).filter(([k]) => !hidden.has(k)));
      return e.id ? patch(`/api/colaboradores/${e.id}`, body) : post('/api/colaboradores', body);
    },
  });
}

/* ------------------------- Ficha do colaborador ------------------------- */

async function detail(view, id) {
  const c = await catalogs();
  let e;
  const load = async () => {
    try {
      e = await get(`/api/colaboradores/${id}`);
    } catch (err) {
      return render(view, html`<div class="page"><div class="alert danger">${err.message}</div><a class="btn" href="#/colaboradores">Voltar</a></div>`);
    }
    const ct = e.contract_type;
    const ben = e.benefits.filter((b) => b.kind === 'beneficio');
    const dis = e.benefits.filter((b) => b.kind === 'desconto');
    const val = (b) => (b.value_type === 'percentual' ? `${Number(b.amount || 0).toLocaleString('pt-BR')}%` : fmtMoney(b.amount));
    render(view, html`<div class="page">
      <div class="page-head"><div><a class="muted small" href="#/colaboradores">← Colaboradores</a>
        <h1>${e.full_name} ${badge(c.status[e.status], STATUS_KIND[e.status])}</h1>
        <p class="muted">${e.code} · ${e.job_title || 'Cargo não informado'} · ${c.contract_types[ct]}${e.team_name ? ` · ${e.team_name}` : ''}${e.admission_date ? ` · ${yearsMonths(e.admission_date, e.termination_date)} de empresa` : ''}</p></div>
        <div class="actions"><button class="btn primary" data-act="edit">Editar cadastro</button></div></div>
      ${e.status === 'desligado' ? html`<div class="alert warn">Desligado em ${fmtDate(e.termination_date)}${e.termination_type ? ` · ${c.termination_types[e.termination_type]}` : ''}${e.termination_reason ? ` · ${e.termination_reason}` : ''}.</div>` : ''}
      ${['ferias', 'afastado'].includes(e.status) ? html`<div class="alert">${c.status[e.status]} desde ${fmtDate(e.status_since)}${e.status_until ? `, retorno previsto em ${fmtDate(e.status_until)}` : ''}${e.status_reason ? ` · ${e.status_reason}` : ''}.</div>` : ''}
      <div class="cols">
        <section class="card"><h2>Identificação</h2>${dl([
          ['Nome completo', e.full_name], ['Nome social', e.social_name || false], ['CPF', fmtCpf(e.cpf)], ['RG', e.rg ? `${e.rg}${e.rg_issuer ? ` · ${e.rg_issuer}` : ''}` : null],
          ['Nascimento', e.birth_date ? `${fmtDate(e.birth_date)} (${yearsMonths(e.birth_date).replace(/ e .*/, '')})` : null], ['Estado civil', e.marital_status], ['Escolaridade', e.education],
          ['Telefone', e.phone], ['E-mail pessoal', e.personal_email], ['E-mail corporativo', e.corporate_email],
          ['Endereço', e.street ? `${e.street}, ${e.number || 's/n'}${e.complement ? ` · ${e.complement}` : ''} · ${e.district || ''} · ${e.city || ''}/${e.state || ''} · CEP ${e.cep || ''}` : null],
          ['Contato de emergência', e.emergency_name ? `${e.emergency_name}${e.emergency_relation ? ` (${e.emergency_relation})` : ''} · ${e.emergency_phone || ''}` : null],
        ])}</section>
        <section class="card"><h2>Organização</h2>${dl([
          ['Cargo', e.job_title], ['Função', e.job_function], ['Time', e.team_name], ['Líder direto', e.leader_name ? html`<a href="#/colaboradores/${e.leader_id}">${e.leader_name}</a>` : null],
          ['Centro de custo', e.cost_center_name], ['Data de entrada', fmtDate(e.admission_date)], ['Fim da experiência', e.probation_end ? fmtDate(e.probation_end) : false],
          ['Regime', c.work_regimes[e.work_regime]], ['Local de trabalho', e.work_location], ['Usuário do CRM', e.user_name || false],
          ['Lidera', e.reports_to_me.length ? html`${e.reports_to_me.map((r, i) => html`${i ? ', ' : ''}<a href="#/colaboradores/${r.id}">${r.full_name}</a>`)}` : false],
        ])}</section>
        <section class="card"><h2>Modelo contratual${['clt', 'estagio'].includes(ct) ? ' e jornada' : ''}</h2>${dl([
          ['Modelo', c.contract_types[ct]],
          ...(ct === 'pj' || ct === 'prestador' ? [['Razão social', e.pj_company_name], ['Nome fantasia', e.pj_trade_name || false], ['CNPJ', fmtCnpj(e.pj_cnpj)], ['Inscrição municipal', e.pj_municipal_reg || false], ['Regime tributário', e.pj_tax_regime]] : []),
          ...(ct === 'estagio' ? [['Instituição', e.internship_institution], ['Curso', e.internship_course], ['Supervisor', e.internship_supervisor]] : []),
          ...(ct === 'socio' ? [['Participação', e.partner_share_pct != null ? `${Number(e.partner_share_pct).toLocaleString('pt-BR')}%` : null]] : []),
          ...(ct === 'clt' ? [['PIS', e.pis], ['CTPS', e.ctps ? `${e.ctps}${e.ctps_series ? ` série ${e.ctps_series}` : ''}` : null]] : []),
          ...(['clt', 'estagio'].includes(ct) ? [['Jornada', e.work_schedule], ['Carga horária', e.weekly_hours ? `${e.weekly_hours}h semanais${e.daily_hours ? ` · ${e.daily_hours}h/dia` : ''}${e.break_minutes ? ` · intervalo ${e.break_minutes} min` : ''}` : null], ['Controle de ponto', e.time_tracking]] : []),
        ])}</section>
        <section class="card"><h2>Remuneração</h2>${dl([
          ['Modelo', c.pay_models[e.pay_model]],
          ['Fixa', e.pay_model !== 'variavel' ? fmtMoney(e.base_salary) : false],
          ['Variável', e.pay_model !== 'fixa' ? html`${e.variable_description || '—'}${e.variable_target ? html`<br><small>Referência ${fmtMoney(e.variable_target)}${e.variable_cap ? ` · teto ${fmtMoney(e.variable_cap)}` : ''}</small>` : ''}` : false],
          ['Dia do pagamento', e.pay_day ? `dia ${e.pay_day}` : null],
          ['Benefícios (custo empresa)', fmtMoney(e.cost.benefits)], ['Descontos', fmtMoney(e.cost.discounts)],
          ['Líquido estimado', html`<strong>${fmtMoney(e.cost.net_estimate)}</strong>`], ['Custo mensal estimado', html`<strong>${fmtMoney(e.cost.total_cost)}</strong>`],
          ['Dados bancários', e.bank_name || e.pix_key ? `${e.bank_name || ''}${e.bank_agency ? ` ag. ${e.bank_agency}` : ''}${e.bank_account ? ` c/${e.bank_account_type ? ` ${e.bank_account_type.toLowerCase()}` : ''} ${e.bank_account}` : ''}${e.pix_key ? ` · Pix ${e.pix_key}` : ''}` : null],
        ])}<p class="hint">Estimativa mensal sem encargos (INSS patronal, FGTS, férias e 13º).</p></section>
      </div>
      <section class="card"><div class="section-head"><h2>Contratos</h2><button class="btn small primary" data-act="contract">+ Contrato</button></div>
        ${table([
          { label: 'Contrato', render: (k) => html`<strong>${k.title}</strong><br><small>${c.contract_types[k.contract_type] || ''}${k.notes ? ` · ${k.notes}` : ''}</small>` },
          { label: 'Vigência', render: (k) => html`${fmtDate(k.start_date)} até ${k.end_date ? fmtDate(k.end_date) : 'prazo indeterminado'}${k.ended_at ? html`<br><small>encerrado em ${fmtDate(k.ended_at)}</small>` : ''}` },
          { label: 'Situação', render: (k) => badge(k.status === 'vigente' ? (k.end_date && k.end_date < new Date().toISOString().slice(0, 10) ? 'Vencido' : 'Vigente') : k.status === 'encerrado' ? 'Encerrado' : 'Rascunho', k.status === 'vigente' ? 'ok' : 'muted') },
          { label: 'Valor mensal', cls: 'num', render: (k) => fmtMoney(k.monthly_value) },
          { label: 'Arquivo', render: (k) => (k.filename ? html`<a href="/api/colaboradores-contratos/${k.id}/arquivo" data-dl>${k.filename}</a>` : html`<span class="muted">sem arquivo</span>`) },
          { label: '', render: (k) => html`<button class="btn small" data-contract="${k.id}">Editar</button>` },
        ], e.contracts, { emptyMsg: 'Nenhum contrato anexado. Inclua o contrato com a vigência e o arquivo.' })}
      </section>
      <section class="card"><div class="section-head"><h2>Benefícios e descontos</h2><div class="inline-actions"><button class="btn small" data-act="benefit" data-kind="beneficio">+ Benefício</button><button class="btn small" data-act="benefit" data-kind="desconto">+ Desconto</button></div></div>
        <div class="cols">
          <div><h3>Benefícios</h3>${ben.length ? table([
            { label: 'Benefício', render: (b) => html`${c.benefit_types[b.type]}${b.description ? html`<br><small>${b.description}</small>` : ''}${b.active ? '' : html` ${badge('Inativo', 'muted')}`}` },
            { label: 'Valor', cls: 'num', render: val },
            { label: 'Custo empresa', cls: 'num', render: (b) => fmtMoney(b.company_cost ?? (b.value_type === 'valor' ? b.amount : null)) },
            { label: '', render: (b) => html`<button class="btn small ghost" data-benefit="${b.id}">Editar</button>` },
          ], ben) : empty('Nenhum benefício cadastrado.')}</div>
          <div><h3>Descontos</h3>${dis.length ? table([
            { label: 'Desconto', render: (b) => html`${c.discount_types[b.type]}${b.description ? html`<br><small>${b.description}</small>` : ''}${b.active ? '' : html` ${badge('Inativo', 'muted')}`}` },
            { label: 'Valor', cls: 'num', render: val },
            { label: '', render: (b) => html`<button class="btn small ghost" data-benefit="${b.id}">Editar</button>` },
          ], dis) : empty('Nenhum desconto cadastrado.')}</div>
        </div>
      </section>
      <section class="card"><div class="section-head"><h2>Documentos do colaborador</h2><button class="btn small" data-act="file">+ Documento</button></div>
        ${table([
          { label: 'Documento', render: (f) => html`<strong>${c.file_categories[f.category]}</strong>${f.title ? html`<br><small>${f.title}</small>` : ''}` },
          { label: 'Arquivo', render: (f) => html`<a href="/api/colaboradores-arquivos/${f.id}" data-dl>${f.filename}</a> <small class="muted">${Math.max(1, Math.round(f.size / 1024))} KB</small>` },
          { label: 'Enviado em', render: (f) => fmtDateTime(f.created_at) },
          { label: '', render: (f) => html`<button class="btn small ghost" data-del-file="${f.id}">Remover</button>` },
        ], e.files, { emptyMsg: 'Nenhum documento. Anexe RG, CPF, comprovante de endereço, ASO, diplomas…' })}
      </section>
      <section class="card"><h2>Histórico</h2>
        ${e.history.length ? html`<ul class="timeline">${e.history.map((h) => html`<li><small class="muted">${fmtDateTime(h.created_at)}${h.user_name ? ` · ${h.user_name}` : ''}</small><br>${h.text}</li>`)}</ul>` : empty('Sem histórico.')}
      </section>
    </div>`);

  };
  on(view, 'click', '[data-act=edit]', async () => (await employeeForm(e)) && load());
  on(view, 'click', '[data-act=contract]', async () => (await contractForm(e)) && load());
  on(view, 'click', '[data-contract]', async (ev, b) => (await contractForm(e, e.contracts.find((k) => k.id === Number(b.dataset.contract)))) && load());
  on(view, 'click', '[data-act=benefit]', async (ev, b) => (await benefitForm(e, { kind: b.dataset.kind, active: 1, value_type: 'valor' })) && load());
  on(view, 'click', '[data-benefit]', async (ev, b) => (await benefitForm(e, e.benefits.find((x) => x.id === Number(b.dataset.benefit)))) && load());
  on(view, 'click', '[data-act=file]', async () => (await fileForm(e)) && load());
  on(view, 'click', '[data-del-file]', async (ev, b) => {
    if (!(await confirmDialog('Remover documento', 'O arquivo será excluído da ficha do colaborador.', { danger: true, confirmLabel: 'Remover' }))) return;
    try {
      await del(`/api/colaboradores-arquivos/${b.dataset.delFile}`);
      load();
    } catch (err) {
      toastError(err);
    }
  });
  await load();
}

/* ------------------------- Contratos, benefícios e documentos ------------------------- */

const fileField = (label, help) => html`<div class="field full"><label>${label}</label><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt">${help ? html`<small>${help}</small>` : ''}</div>`;
async function readFileInput(form) {
  const f = form.querySelector('input[type=file]')?.files?.[0];
  if (!f) return {};
  if (f.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB.');
  return { filename: f.name, content_base64: await fileToBase64(f) };
}

async function contractForm(e, k = null) {
  const c = await catalogs();
  return modal({
    title: k ? `Contrato: ${k.title}` : `Novo contrato · ${e.full_name}`,
    wide: true,
    body: html`<div class="grid three">
      ${field({ name: 'title', label: 'Título', value: k?.title || (e.contract_type === 'clt' ? 'Contrato de trabalho CLT' : e.contract_type === 'pj' ? 'Contrato de prestação de serviços (PJ)' : e.contract_type === 'estagio' ? 'Termo de compromisso de estágio' : ''), required: true, full: true })}
      ${field({ name: 'contract_type', label: 'Modelo', type: 'select', value: k?.contract_type || e.contract_type, options: items(c.contract_types), allowEmpty: false })}
      ${field({ name: 'start_date', label: 'Início da vigência', type: 'date', value: k?.start_date || e.admission_date, required: true })}
      ${field({ name: 'end_date', label: 'Término da vigência', type: 'date', value: k?.end_date, help: 'Em branco: prazo indeterminado.' })}
      ${field({ name: 'status', label: 'Situação', type: 'select', value: k?.status || 'vigente', options: [{ value: 'vigente', label: 'Vigente' }, { value: 'encerrado', label: 'Encerrado' }, { value: 'rascunho', label: 'Rascunho (em negociação)' }], allowEmpty: false })}
      ${field({ name: 'monthly_value', label: 'Valor mensal do contrato', type: 'money', value: k?.monthly_value })}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', rows: 2, value: k?.notes, full: true })}
      ${fileField(k?.filename ? `Arquivo (atual: ${k.filename}; envie outro para substituir)` : 'Arquivo do contrato (PDF, Word ou imagem)', 'Até 10 MB.')}
    </div>`,
    async onSubmit(d, form) {
      const file = await readFileInput(form);
      return post(`/api/colaboradores/${e.id}/contratos`, { ...d, id: k?.id, ...file });
    },
  });
}

async function benefitForm(e, b) {
  const c = await catalogs();
  const isDisc = b.kind === 'desconto';
  return modal({
    title: `${b.id ? 'Editar' : 'Novo'} ${isDisc ? 'desconto' : 'benefício'} · ${e.full_name}`,
    body: html`<div class="grid">
      ${field({ name: 'type', label: isDisc ? 'Desconto' : 'Benefício', type: 'select', value: b.type, options: items(isDisc ? c.discount_types : c.benefit_types), required: true, full: true })}
      ${field({ name: 'description', label: 'Descrição / operadora', value: b.description, full: true, placeholder: isDisc ? 'Ex.: 6% do salário-base' : 'Ex.: Unimed, plano enfermaria; cartão VR' })}
      ${field({ name: 'value_type', label: 'Tipo de valor', type: 'select', value: b.value_type, allowEmpty: false, options: [{ value: 'valor', label: 'Valor em R$ (mensal)' }, { value: 'percentual', label: 'Percentual (%) do fixo' }] })}
      ${field({ name: 'amount', label: 'Valor ou percentual', type: 'number', min: 0, step: '0.01', value: b.amount })}
      ${isDisc ? '' : field({ name: 'company_cost', label: 'Custo para a empresa (mensal)', type: 'money', value: b.company_cost, help: 'Em branco: usa o valor do benefício.' })}
      ${field({ name: 'start_date', label: 'Início', type: 'date', value: b.start_date })}
      ${field({ name: 'end_date', label: 'Fim', type: 'date', value: b.end_date })}
      ${field({ name: 'active', label: 'Ativo', type: 'checkbox', value: b.active })}
    </div>
    ${b.id ? html`<p><button type="button" class="btn small danger ghost" data-del-benefit>Excluir este item</button></p>` : ''}`,
    onMount(form, close) {
      on(form, 'click', '[data-del-benefit]', async () => {
        try {
          await del(`/api/colaboradores/${e.id}/beneficios/${b.id}`);
          toast('Item excluído.');
          close(true);
        } catch (err) {
          toastError(err);
        }
      });
    },
    onSubmit: (d) => post(`/api/colaboradores/${e.id}/beneficios`, { ...d, kind: b.kind, id: b.id }),
  });
}

async function fileForm(e) {
  const c = await catalogs();
  return modal({
    title: `Anexar documento · ${e.full_name}`,
    body: html`<div class="grid">
      ${field({ name: 'category', label: 'Tipo de documento', type: 'select', options: items(c.file_categories), required: true, full: true })}
      ${field({ name: 'title', label: 'Descrição (opcional)', full: true })}
      ${fileField('Arquivo (PDF, imagem, Word ou Excel)', 'Até 10 MB.')}
    </div>`,
    async onSubmit(d, form) {
      const file = await readFileInput(form);
      if (!file.filename) throw new Error('Escolha o arquivo.');
      return post(`/api/colaboradores/${e.id}/arquivos`, { ...d, ...file });
    },
  });
}

// Download dos arquivos (contratos e documentos) pela sessão do usuário
if (typeof document !== 'undefined' && !window.__peopleDl) {
  window.__peopleDl = true;
  document.addEventListener('click', async (ev) => {
    const a = ev.target.closest?.('a[data-dl]');
    if (!a) return;
    ev.preventDefault();
    try {
      const { download } = await import('../api.js');
      await download(a.getAttribute('href'));
    } catch (err) {
      toastError(err);
    }
  });
}
