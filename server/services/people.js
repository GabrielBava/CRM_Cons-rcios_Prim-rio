'use strict';
/**
 * Colaboradores (RH): cadastro completo de quem trabalha na empresa.
 *
 *  - Identificação: nome completo, CPF, RG, nascimento, telefone, e-mails pessoal e corporativo, endereço e contato de emergência;
 *  - Organização: cargo, função, time, líder direto, centro de custo, data de entrada e situação
 *    (ativo, férias, afastado ou desligado, com a data e o motivo do desligamento);
 *  - Modelo contratual: CLT, PJ, estágio, prestador de serviços ou sócio, com os dados de cada um
 *    (razão social e CNPJ do PJ, instituição do estágio, participação do sócio) e os contratos anexados com vigência;
 *  - Jornada (CLT e estágio): escala, carga semanal e diária, intervalo e controle de ponto;
 *  - Remuneração fixa, variável ou híbrida, benefícios e descontos (modelo de mercado) e dados bancários;
 *  - Histórico de situação, cargo e remuneração.
 * Acesso: módulo "Colaboradores" (padrão só do administrador; pode ser liberado a um usuário de RH).
 */
const { audit } = require('../core');
const { requireModule } = require('../permissions');
const { tx, nextCode } = require('../db');
const { badRequest, notFound, clean: cleanRaw, nowIso, toDateOnly, toNumber, digits, isValidCPF, isValidCNPJ, normalizeEmail } = require('../util');
// Texto limpo ou null (o SQLite não aceita undefined)
const clean = (v) => cleanRaw(v) ?? null;

const STATUS = { ativo: 'Ativo', ferias: 'Férias', afastado: 'Afastado', desligado: 'Desligado' };
const CONTRACT_TYPES = { clt: 'CLT', pj: 'PJ', estagio: 'Estágio', prestador: 'Prestador de serviços', socio: 'Sócio' };
const PAY_MODELS = { fixa: 'Remuneração fixa', variavel: 'Remuneração variável', hibrida: 'Fixa + variável (híbrida)' };
const WORK_REGIMES = { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' };
const TERMINATION_TYPES = {
  sem_justa_causa: 'Dispensa sem justa causa', justa_causa: 'Dispensa por justa causa', pedido: 'Pedido de demissão',
  acordo: 'Acordo entre as partes', fim_contrato: 'Término de contrato', distrato: 'Distrato (PJ/prestador)', outro: 'Outro',
};
/** Benefícios e descontos mais usados no mercado (o tipo "outro" aceita qualquer descrição). */
const BENEFIT_TYPES = {
  vale_refeicao: 'Vale-refeição', vale_alimentacao: 'Vale-alimentação', vale_transporte: 'Vale-transporte', plano_saude: 'Plano de saúde',
  plano_odonto: 'Plano odontológico', seguro_vida: 'Seguro de vida', auxilio_home_office: 'Auxílio home office', auxilio_educacao: 'Auxílio educação',
  auxilio_creche: 'Auxílio creche', bem_estar: 'Bem-estar (academia/Wellhub)', plr: 'PLR / participação nos lucros', previdencia: 'Previdência privada',
  ajuda_custo: 'Ajuda de custo', outro: 'Outro benefício',
};
const DISCOUNT_TYPES = {
  inss: 'INSS', irrf: 'IRRF', desconto_vt: 'Vale-transporte (até 6%)', coparticipacao: 'Coparticipação do plano de saúde', dependentes_plano: 'Plano de dependentes',
  adiantamento: 'Adiantamento salarial', consignado: 'Empréstimo consignado', pensao: 'Pensão alimentícia', faltas: 'Faltas e atrasos', outro: 'Outro desconto',
};
const FILE_CATEGORIES = {
  identificacao: 'Documento de identificação', cpf: 'CPF', comprovante_endereco: 'Comprovante de endereço', ctps: 'Carteira de trabalho',
  aso: 'Exame admissional/periódico (ASO)', diploma: 'Diploma e certificados', cnpj: 'Cartão CNPJ (PJ)', foto: 'Foto', outro: 'Outro',
};
const FILE_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain' };
const MAX_FILE = 10 * 1024 * 1024;

const TEXT_FIELDS = [
  'full_name', 'social_name', 'rg', 'rg_issuer', 'sex', 'marital_status', 'nationality', 'mother_name', 'education', 'pis', 'ctps', 'ctps_series',
  'phone', 'cep', 'street', 'number', 'complement', 'district', 'city', 'state', 'emergency_name', 'emergency_relation', 'emergency_phone',
  'job_title', 'job_function', 'work_location', 'termination_reason', 'status_reason',
  'pj_company_name', 'pj_trade_name', 'pj_municipal_reg', 'pj_tax_regime', 'internship_institution', 'internship_course', 'internship_supervisor',
  'work_schedule', 'time_tracking', 'variable_description', 'bank_name', 'bank_agency', 'bank_account', 'bank_account_type', 'pix_key', 'notes',
];
const DATE_FIELDS = ['birth_date', 'admission_date', 'probation_end', 'termination_date', 'status_since', 'status_until'];
const NUM_FIELDS = ['partner_share_pct', 'weekly_hours', 'daily_hours', 'break_minutes', 'base_salary', 'variable_target', 'variable_cap', 'pay_day'];

const guard = (user) => requireModule(user, 'colaboradores');
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

function loadEmployee(db, id) {
  const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(id));
  if (!e) throw notFound('Colaborador não encontrado.');
  return e;
}

function history(db, empId, kind, text, user) {
  db.prepare('INSERT INTO employee_history (employee_id, kind, text, user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(empId, kind, text, user?.id ?? null, nowIso());
}

/** Valores de mercado para a folha: custo mensal estimado (fixo + benefícios pagos pela empresa). */
function monthlyCost(e, benefits) {
  const fixed = e.pay_model === 'variavel' ? 0 : Number(e.base_salary || 0);
  const variable = e.pay_model === 'fixa' ? 0 : Number(e.variable_target || 0);
  const ben = benefits.filter((b) => b.kind === 'beneficio' && b.active).reduce((t, b) => t + Number(b.company_cost ?? (b.value_type === 'valor' ? b.amount : 0) ?? 0), 0);
  const disc = benefits.filter((b) => b.kind === 'desconto' && b.active).reduce((t, b) => t + (b.value_type === 'percentual' ? (fixed * Number(b.amount || 0)) / 100 : Number(b.amount || 0)), 0);
  return { fixed, variable, benefits: Math.round(ben * 100) / 100, discounts: Math.round(disc * 100) / 100, total_cost: Math.round((fixed + variable + ben) * 100) / 100, net_estimate: Math.round((fixed + variable - disc) * 100) / 100 };
}

const LIST_SQL = `SELECT e.*, t.name AS team_name, l.full_name AS leader_name, cc.name AS cost_center_name, u.name AS user_name
  FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN employees l ON l.id = e.leader_id
  LEFT JOIN fin_cost_centers cc ON cc.id = e.cost_center_id LEFT JOIN users u ON u.id = e.user_id`;

function listEmployees(db, user, q = {}) {
  guard(user);
  const where = [];
  const params = [];
  if (q.status) {
    where.push('e.status = ?');
    params.push(q.status);
  } else if (q.todos !== '1') where.push("e.status != 'desligado'");
  if (q.contrato) {
    where.push('e.contract_type = ?');
    params.push(q.contrato);
  }
  if (q.time) {
    where.push('e.team_id = ?');
    params.push(Number(q.time));
  }
  if (q.q) {
    where.push('(e.full_name LIKE ? OR e.code LIKE ? OR e.job_title LIKE ? OR e.corporate_email LIKE ? OR e.cpf LIKE ?)');
    const like = `%${String(q.q).trim()}%`;
    params.push(like, like, like, like, `%${digits(q.q) || '#'}%`);
  }
  const rows = db.prepare(`${LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.full_name`).all(...params);
  const ben = db.prepare('SELECT * FROM employee_benefits WHERE employee_id = ?');
  const contracts = db.prepare("SELECT id, title, end_date FROM employee_contracts WHERE employee_id = ? AND status = 'vigente' ORDER BY end_date IS NULL, end_date LIMIT 1");
  const out = rows.map((e) => ({ ...publicRow(e), cost: monthlyCost(e, ben.all(e.id)), contract: contracts.get(e.id) || null }));
  const all = db.prepare('SELECT status, contract_type FROM employees').all();
  const count = (k, v) => all.filter((x) => x[k] === v).length;
  return {
    rows: out,
    summary: {
      ativos: count('status', 'ativo'), ferias: count('status', 'ferias'), afastados: count('status', 'afastado'), desligados: count('status', 'desligado'),
      por_contrato: Object.fromEntries(Object.keys(CONTRACT_TYPES).map((k) => [k, all.filter((x) => x.contract_type === k && x.status !== 'desligado').length])),
      custo_mensal: Math.round(out.filter((e) => e.status !== 'desligado').reduce((t, e) => t + e.cost.total_cost, 0) * 100) / 100,
    },
  };
}

const publicRow = (e) => ({ ...e });

function getEmployee(db, user, id) {
  guard(user);
  const e = db.prepare(`${LIST_SQL} WHERE e.id = ?`).get(Number(id));
  if (!e) throw notFound('Colaborador não encontrado.');
  const benefits = db.prepare('SELECT * FROM employee_benefits WHERE employee_id = ? ORDER BY kind, active DESC, id').all(e.id);
  return {
    ...e,
    benefits,
    cost: monthlyCost(e, benefits),
    contracts: db.prepare('SELECT id, contract_type, title, start_date, end_date, ended_at, status, monthly_value, notes, filename, size, created_at FROM employee_contracts WHERE employee_id = ? ORDER BY status = \'vigente\' DESC, start_date DESC').all(e.id),
    files: db.prepare('SELECT id, category, title, filename, size, created_at FROM employee_files WHERE employee_id = ? ORDER BY created_at DESC').all(e.id),
    history: db.prepare('SELECT h.*, u.name AS user_name FROM employee_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.employee_id = ? ORDER BY h.created_at DESC, h.id DESC LIMIT 100').all(e.id),
    reports_to_me: db.prepare("SELECT id, code, full_name, job_title FROM employees WHERE leader_id = ? AND status != 'desligado' ORDER BY full_name").all(e.id),
  };
}

/** Cria ou atualiza o colaborador (validações por modelo contratual e histórico das mudanças relevantes). */
function saveEmployee(db, user, data) {
  guard(user);
  const cur = data.id ? loadEmployee(db, data.id) : null;
  const row = {};
  for (const k of TEXT_FIELDS) if (data[k] !== undefined) row[k] = clean(data[k]);
  for (const k of DATE_FIELDS) if (data[k] !== undefined) row[k] = data[k] ? toDateOnly(data[k]) : null;
  for (const k of NUM_FIELDS) if (data[k] !== undefined) row[k] = data[k] === '' || data[k] == null ? null : toNumber(data[k]);
  const merged = { ...(cur || {}), ...row };
  if (!clean(merged.full_name)) throw badRequest('Informe o nome completo do colaborador.');
  if (data.cpf !== undefined) {
    const cpf = digits(data.cpf);
    if (cpf && !isValidCPF(cpf)) throw badRequest('CPF inválido.');
    if (cpf && db.prepare('SELECT 1 FROM employees WHERE cpf = ? AND id != ?').get(cpf, cur?.id ?? 0)) throw badRequest('Já existe um colaborador com este CPF.');
    row.cpf = cpf || null;
  }
  for (const k of ['personal_email', 'corporate_email']) {
    if (data[k] !== undefined) {
      const v = clean(data[k]);
      row[k] = v ? normalizeEmail(v) : null;
      if (v && !row[k]) throw badRequest(`E-mail ${k === 'personal_email' ? 'pessoal' : 'corporativo'} inválido.`);
    }
  }
  if (data.corporate_email && row.corporate_email && db.prepare('SELECT 1 FROM employees WHERE corporate_email = ? AND id != ?').get(row.corporate_email, cur?.id ?? 0)) throw badRequest('Este e-mail corporativo já está em uso por outro colaborador.');
  if (data.status !== undefined) {
    if (!STATUS[data.status]) throw badRequest('Situação inválida (ativo, férias, afastado ou desligado).');
    row.status = data.status;
  }
  if (data.contract_type !== undefined) {
    if (!CONTRACT_TYPES[data.contract_type]) throw badRequest('Modelo contratual inválido (CLT, PJ, estágio, prestador ou sócio).');
    row.contract_type = data.contract_type;
  }
  if (data.pay_model !== undefined) {
    if (!PAY_MODELS[data.pay_model]) throw badRequest('Modelo de remuneração inválido (fixa, variável ou híbrida).');
    row.pay_model = data.pay_model;
  }
  if (data.work_regime !== undefined) row.work_regime = WORK_REGIMES[data.work_regime] ? data.work_regime : null;
  if (data.termination_type !== undefined) row.termination_type = TERMINATION_TYPES[data.termination_type] ? data.termination_type : null;
  if (data.pj_cnpj !== undefined) {
    const c = digits(data.pj_cnpj);
    if (c && !isValidCNPJ(c)) throw badRequest('CNPJ da empresa PJ inválido.');
    row.pj_cnpj = c || null;
  }
  for (const [k, table, label] of [['team_id', 'teams', 'Time'], ['cost_center_id', 'fin_cost_centers', 'Centro de custo'], ['user_id', 'users', 'Usuário']]) {
    if (data[k] !== undefined) {
      row[k] = data[k] ? Number(data[k]) : null;
      if (row[k] && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(row[k])) throw badRequest(`${label} inválido.`);
    }
  }
  if (data.user_id && db.prepare('SELECT 1 FROM employees WHERE user_id = ? AND id != ?').get(Number(data.user_id), cur?.id ?? 0)) throw badRequest('Este usuário do CRM já está vinculado a outro colaborador.');
  if (data.leader_id !== undefined) {
    row.leader_id = data.leader_id ? Number(data.leader_id) : null;
    if (row.leader_id && cur && row.leader_id === cur.id) throw badRequest('O colaborador não pode ser líder de si mesmo.');
    if (row.leader_id && !db.prepare('SELECT 1 FROM employees WHERE id = ?').get(row.leader_id)) throw badRequest('Líder direto inválido.');
  }
  const m = { ...(cur || {}), ...row };
  // Regras por modelo contratual e situação
  if (m.contract_type === 'pj' && (!m.pj_company_name || !m.pj_cnpj)) throw badRequest('Para PJ, informe a razão social e o CNPJ da empresa.');
  if (m.contract_type === 'socio' && m.partner_share_pct != null && (m.partner_share_pct < 0 || m.partner_share_pct > 100)) throw badRequest('Participação do sócio entre 0% e 100%.');
  if (m.status === 'desligado' && !m.termination_date) throw badRequest('Informe a data do desligamento.');
  if (m.termination_date && m.admission_date && m.termination_date < m.admission_date) throw badRequest('A data do desligamento é anterior à data de entrada.');
  if (['ferias', 'afastado'].includes(m.status) && !m.status_since) row.status_since = toDateOnly(nowIso());
  if (m.pay_model !== 'variavel' && m.base_salary != null && m.base_salary < 0) throw badRequest('Remuneração fixa inválida.');
  if (m.pay_model !== 'fixa' && !clean(m.variable_description) && data.pay_model !== undefined) throw badRequest('Descreva a regra da remuneração variável (ex.: % sobre vendas, metas).');
  if (m.pay_day != null && (m.pay_day < 1 || m.pay_day > 31)) throw badRequest('Dia de pagamento entre 1 e 31.');
  if (m.weekly_hours != null && (m.weekly_hours <= 0 || m.weekly_hours > 60)) throw badRequest('Carga horária semanal entre 1 e 60 horas.');
  const now = nowIso();
  return tx(db, () => {
    if (!cur) {
      const ins = { code: nextCode(db, 'employee', 'COL'), status: 'ativo', contract_type: 'clt', pay_model: 'fixa', ...row, created_by: user.id, created_at: now, updated_at: now };
      const keys = Object.keys(ins);
      const id = Number(db.prepare(`INSERT INTO employees (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => ins[k] ?? null)).lastInsertRowid);
      history(db, id, 'admissao', `Cadastro criado: ${CONTRACT_TYPES[ins.contract_type]}${ins.job_title ? `, ${ins.job_title}` : ''}${ins.admission_date ? `, entrada em ${ins.admission_date.split('-').reverse().join('/')}` : ''}.`, user);
      audit(db, user, 'employee', id, 'criado', { nome: ins.full_name });
      return { id, code: ins.code };
    }
    const keys = Object.keys(row).filter((k) => String(row[k] ?? '') !== String(cur[k] ?? ''));
    if (!keys.length) return { id: cur.id, code: cur.code };
    db.prepare(`UPDATE employees SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => row[k] ?? null), now, cur.id);
    if (keys.includes('status')) history(db, cur.id, 'situacao', `Situação: ${STATUS[cur.status]} → ${STATUS[row.status]}${row.status === 'desligado' ? ` em ${String(m.termination_date).split('-').reverse().join('/')}${m.termination_reason ? ` (${m.termination_reason})` : ''}` : ''}${m.status_reason && row.status !== 'desligado' ? ` — ${m.status_reason}` : ''}.`, user);
    if (keys.includes('job_title') || keys.includes('job_function')) history(db, cur.id, 'cargo', `Cargo/função: ${cur.job_title || '—'} → ${m.job_title || '—'}${m.job_function ? ` (${m.job_function})` : ''}.`, user);
    if (keys.includes('base_salary') || keys.includes('pay_model') || keys.includes('variable_target')) history(db, cur.id, 'remuneracao', `Remuneração: ${PAY_MODELS[m.pay_model]}${m.pay_model !== 'variavel' ? `, fixo ${money(cur.base_salary)} → ${money(m.base_salary)}` : ''}${m.pay_model !== 'fixa' ? `, variável estimada ${money(m.variable_target)}` : ''}.`, user);
    if (keys.includes('contract_type')) history(db, cur.id, 'contrato', `Modelo contratual: ${CONTRACT_TYPES[cur.contract_type]} → ${CONTRACT_TYPES[m.contract_type]}.`, user);
    if (keys.includes('leader_id') || keys.includes('team_id')) history(db, cur.id, 'organizacao', 'Time ou líder direto alterado.', user);
    // Campos sensíveis (CPF, salário, conta) não vão em texto para a auditoria: só os nomes dos campos
    audit(db, user, 'employee', cur.id, 'alterado', { campos: keys });
    return { id: cur.id, code: cur.code };
  });
}

/* ------------------------- Benefícios e descontos ------------------------- */

function saveBenefit(db, user, empId, data) {
  guard(user);
  const e = loadEmployee(db, empId);
  const kind = data.kind === 'desconto' ? 'desconto' : 'beneficio';
  const types = kind === 'desconto' ? DISCOUNT_TYPES : BENEFIT_TYPES;
  if (!types[data.type]) throw badRequest(`Escolha o tipo de ${kind === 'desconto' ? 'desconto' : 'benefício'}.`);
  if (data.type === 'outro' && !clean(data.description)) throw badRequest('Descreva o item.');
  const valueType = data.value_type === 'percentual' ? 'percentual' : 'valor';
  const amount = data.amount === '' || data.amount == null ? null : toNumber(data.amount);
  if (amount != null && (amount < 0 || (valueType === 'percentual' && amount > 100))) throw badRequest('Valor inválido.');
  const row = {
    kind, type: data.type, description: clean(data.description), value_type: valueType, amount,
    company_cost: data.company_cost === '' || data.company_cost == null ? null : toNumber(data.company_cost),
    start_date: data.start_date ? toDateOnly(data.start_date) : null, end_date: data.end_date ? toDateOnly(data.end_date) : null,
    active: data.active === false || data.active === 'false' ? 0 : 1,
  };
  const now = nowIso();
  const label = `${types[row.type]}${row.description ? ` (${row.description})` : ''}`;
  if (data.id) {
    const b = db.prepare('SELECT * FROM employee_benefits WHERE id = ? AND employee_id = ?').get(Number(data.id), e.id);
    if (!b) throw notFound('Item não encontrado.');
    db.prepare('UPDATE employee_benefits SET kind = ?, type = ?, description = ?, value_type = ?, amount = ?, company_cost = ?, start_date = ?, end_date = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(row.kind, row.type, row.description, row.value_type, row.amount, row.company_cost, row.start_date, row.end_date, row.active, now, b.id);
    history(db, e.id, 'beneficio', `${kind === 'desconto' ? 'Desconto' : 'Benefício'} alterado: ${label}${row.active ? '' : ' (inativo)'}.`, user);
    return { id: b.id };
  }
  const id = Number(db.prepare('INSERT INTO employee_benefits (employee_id, kind, type, description, value_type, amount, company_cost, start_date, end_date, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.id, row.kind, row.type, row.description, row.value_type, row.amount, row.company_cost, row.start_date, row.end_date, row.active, now, now).lastInsertRowid);
  history(db, e.id, 'beneficio', `${kind === 'desconto' ? 'Desconto' : 'Benefício'} incluído: ${label}.`, user);
  return { id };
}

function deleteBenefit(db, user, empId, id) {
  guard(user);
  const b = db.prepare('SELECT * FROM employee_benefits WHERE id = ? AND employee_id = ?').get(Number(id), Number(empId));
  if (!b) throw notFound('Item não encontrado.');
  db.prepare('DELETE FROM employee_benefits WHERE id = ?').run(b.id);
  history(db, b.employee_id, 'beneficio', `${b.kind === 'desconto' ? 'Desconto' : 'Benefício'} removido: ${(b.kind === 'desconto' ? DISCOUNT_TYPES : BENEFIT_TYPES)[b.type] || b.type}.`, user);
  return { ok: true };
}

/* ------------------------- Arquivos: contratos e documentos ------------------------- */

function readFile(data, { required = true } = {}) {
  const filename = clean(data.filename);
  if (!filename) {
    if (required) throw badRequest('Escolha o arquivo.');
    return null;
  }
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!FILE_EXT[ext]) throw badRequest(`Tipo de arquivo não permitido (.${ext}). Envie PDF, imagem, Word ou Excel.`);
  const content = Buffer.from(String(data.content_base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!content.length) throw badRequest('Arquivo vazio.');
  if (content.length > MAX_FILE) throw badRequest('Arquivo maior que 10 MB.');
  return { filename: filename.slice(0, 200), mime: FILE_EXT[ext], size: content.length, content };
}

/** Contrato com vigência (início e, quando houver, término) e o arquivo anexo. */
function saveContract(db, user, empId, data) {
  guard(user);
  const e = loadEmployee(db, empId);
  const title = clean(data.title);
  if (!title) throw badRequest('Informe o título do contrato (ex.: Contrato de trabalho CLT, Contrato de prestação de serviços PJ, Aditivo).');
  const start = data.start_date ? toDateOnly(data.start_date) : null;
  const end = data.end_date ? toDateOnly(data.end_date) : null;
  if (!start) throw badRequest('Informe o início da vigência.');
  if (end && end < start) throw badRequest('O término da vigência é anterior ao início.');
  const type = CONTRACT_TYPES[data.contract_type] ? data.contract_type : e.contract_type;
  const status = ['vigente', 'encerrado', 'rascunho'].includes(data.status) ? data.status : 'vigente';
  const file = readFile(data, { required: false });
  const now = nowIso();
  const value = data.monthly_value === '' || data.monthly_value == null ? null : toNumber(data.monthly_value);
  if (data.id) {
    const c = db.prepare('SELECT * FROM employee_contracts WHERE id = ? AND employee_id = ?').get(Number(data.id), e.id);
    if (!c) throw notFound('Contrato não encontrado.');
    const endedAt = status === 'encerrado' ? c.ended_at || toDateOnly(data.ended_at || end || now) : null;
    db.prepare(`UPDATE employee_contracts SET contract_type = ?, title = ?, start_date = ?, end_date = ?, ended_at = ?, status = ?, monthly_value = ?, notes = ?, updated_at = ?${file ? ', filename = ?, mime = ?, size = ?, content = ?' : ''} WHERE id = ?`)
      .run(type, title, start, end, endedAt, status, value, clean(data.notes), now, ...(file ? [file.filename, file.mime, file.size, file.content] : []), c.id);
    if (status !== c.status) history(db, e.id, 'contrato', `Contrato "${title}": ${c.status} → ${status}${endedAt ? ` em ${endedAt.split('-').reverse().join('/')}` : ''}.`, user);
    else if (file) history(db, e.id, 'contrato', `Contrato "${title}": novo arquivo anexado (${file.filename}).`, user);
    return { id: c.id };
  }
  const id = Number(db.prepare('INSERT INTO employee_contracts (employee_id, contract_type, title, start_date, end_date, ended_at, status, monthly_value, notes, filename, mime, size, content, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.id, type, title, start, end, status === 'encerrado' ? end || toDateOnly(now) : null, status, value, clean(data.notes), file?.filename ?? null, file?.mime ?? null, file?.size ?? null, file?.content ?? null, user.id, now, now).lastInsertRowid);
  history(db, e.id, 'contrato', `Contrato incluído: ${title} (${CONTRACT_TYPES[type]}), vigência a partir de ${start.split('-').reverse().join('/')}${end ? ` até ${end.split('-').reverse().join('/')}` : ', prazo indeterminado'}.`, user);
  audit(db, user, 'employee', e.id, 'contrato_incluido', { contrato: title, arquivo: file?.filename || null });
  return { id };
}

function getContractFile(db, user, id) {
  guard(user);
  const c = db.prepare('SELECT * FROM employee_contracts WHERE id = ?').get(Number(id));
  if (!c?.content) throw notFound('Arquivo não encontrado.');
  audit(db, user, 'employee', c.employee_id, 'contrato_baixado', { contrato: c.title });
  return c;
}

function uploadFile(db, user, empId, data) {
  guard(user);
  const e = loadEmployee(db, empId);
  const f = readFile(data);
  const cat = FILE_CATEGORIES[data.category] ? data.category : 'outro';
  const id = Number(db.prepare('INSERT INTO employee_files (employee_id, category, title, filename, mime, size, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.id, cat, clean(data.title), f.filename, f.mime, f.size, f.content, user.id, nowIso()).lastInsertRowid);
  history(db, e.id, 'documento', `Documento anexado: ${FILE_CATEGORIES[cat]} (${f.filename}).`, user);
  return { id };
}

function getFile(db, user, id) {
  guard(user);
  const f = db.prepare('SELECT * FROM employee_files WHERE id = ?').get(Number(id));
  if (!f) throw notFound('Arquivo não encontrado.');
  audit(db, user, 'employee', f.employee_id, 'documento_baixado', { arquivo: f.filename });
  return f;
}

function deleteFile(db, user, id) {
  guard(user);
  const f = db.prepare('SELECT id, employee_id, filename FROM employee_files WHERE id = ?').get(Number(id));
  if (!f) throw notFound('Arquivo não encontrado.');
  db.prepare('DELETE FROM employee_files WHERE id = ?').run(f.id);
  history(db, f.employee_id, 'documento', `Documento removido: ${f.filename}.`, user);
  return { ok: true };
}

/** Listas para o formulário (modelos, tipos de benefício, times, centros de custo, líderes e usuários). */
function catalogs(db, user) {
  guard(user);
  return {
    status: STATUS, contract_types: CONTRACT_TYPES, pay_models: PAY_MODELS, work_regimes: WORK_REGIMES, termination_types: TERMINATION_TYPES,
    benefit_types: BENEFIT_TYPES, discount_types: DISCOUNT_TYPES, file_categories: FILE_CATEGORIES,
    teams: db.prepare('SELECT id, name FROM teams ORDER BY name').all(),
    cost_centers: db.prepare('SELECT id, name FROM fin_cost_centers WHERE active = 1 ORDER BY name').all(),
    leaders: db.prepare("SELECT id, full_name AS name, job_title FROM employees WHERE status != 'desligado' ORDER BY full_name").all(),
    users: db.prepare('SELECT id, name, email FROM users WHERE active = 1 ORDER BY name').all(),
  };
}

/** Contratos que vencem nos próximos dias (alerta no sino do administrador e de quem tem o módulo). */
function contractSweep(db) {
  const limit = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare("SELECT c.id, c.title, c.end_date, e.full_name FROM employee_contracts c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'vigente' AND c.end_date IS NOT NULL AND c.end_date <= ? AND e.status != 'desligado'").all(limit);
  if (!rows.length) return 0;
  const { userModules } = require('../permissions');
  const ids = db.prepare('SELECT * FROM users WHERE active = 1').all().filter((u) => userModules(u).includes('colaboradores')).map((u) => u.id);
  for (const r of rows) {
    require('./notifications').notify(db, ids, { kind: 'contrato_colaborador', level: 'warn', title: `Contrato vencendo: ${r.full_name}`, body: `${r.title} termina em ${r.end_date.split('-').reverse().join('/')}. Renove ou encerre o contrato.`, link: '#/colaboradores', dedupe: true });
  }
  return rows.length;
}

module.exports = {
  STATUS, CONTRACT_TYPES, PAY_MODELS, BENEFIT_TYPES, DISCOUNT_TYPES, FILE_CATEGORIES, WORK_REGIMES, TERMINATION_TYPES,
  listEmployees, getEmployee, saveEmployee, saveBenefit, deleteBenefit, saveContract, getContractFile, uploadFile, getFile, deleteFile, catalogs, contractSweep, monthlyCost,
};
