import { post } from '../api.js';
import { html, render, $, on, state, field, opts, userItems, table, badge, can, toastError, formData, empty } from '../ui.js';

const FIELD_LABELS = {
  name: 'Nome', kind: 'Tipo (PF/PJ)', phone1: 'Telefone principal', phone2: 'Telefone secundário', whatsapp: 'WhatsApp', email: 'E-mail',
  city: 'Cidade', state: 'UF', doc: 'CPF/CNPJ', trade_name: 'Empresa / nome fantasia', legal_name: 'Razão social', contact_name: 'Contato principal (PJ)',
  profession: 'Profissão', origin: 'Origem', campaign: 'Campanha', initial_notes: 'Observações', owner_email: 'E-mail do responsável',
  platform_lead_id: 'ID do lead na plataforma', campaign_id: 'ID da campanha', adset_id: 'ID do conjunto de anúncios', ad_id: 'ID do anúncio',
  utm_source: 'utm_source', utm_medium: 'utm_medium', utm_campaign: 'utm_campaign', utm_content: 'utm_content', utm_term: 'utm_term', received_at: 'Data de recebimento',
};

export async function show(view) {
  if (!can.write()) {
    render(view, html`<div class="page"><div class="alert">Seu perfil não permite importar dados.</div></div>`);
    return;
  }
  let csv = '';
  let filename = '';
  let preview = null;
  render(view, html`<div class="page">
    <div class="page-head"><div><div class="crumbs"><a href="#/leads">Prospects e leads</a> / Importar</div><h1>Importar leads (CSV)</h1></div></div>
    <section class="card">
      <p>Envie um arquivo <strong>CSV</strong> (separado por ponto e vírgula ou vírgula, com cabeçalho na primeira linha). Planilhas do Excel podem ser salvas como "CSV UTF-8". Máximo de 5.000 linhas por importação.</p>
      <form id="opts" class="grid">
        <div class="field full"><label>Arquivo</label><input type="file" name="file" accept=".csv,text/csv,text/plain" required></div>
        ${field({ name: 'origin', label: 'Origem padrão (se a planilha não informar)', type: 'select', options: opts('origem'), value: 'importacao', allowEmpty: false })}
        ${field({ name: 'campaign', label: 'Campanha (se a planilha não informar)' })}
        ${field({ name: 'platform', label: 'Plataforma dos IDs de lead', placeholder: 'ex.: meta_ads', help: 'Usada para evitar reimportar o mesmo ID de lead.' })}
        ${field({ name: 'owner_id', label: 'Responsável padrão', type: 'select', options: userItems(), value: state.user.id, allowEmpty: false, disabled: !can.manage() })}
        ${field({ name: 'duplicate_policy', label: 'Quando houver duplicidade', type: 'select', options: [{ value: 'ignorar', label: 'Ignorar a linha' }, { value: 'adicionar_origem', label: 'Não duplicar; registrar a nova origem no cadastro existente' }], allowEmpty: false })}
        ${field({ name: 'create_opportunity', label: 'Criar oportunidade no funil para cada novo cadastro', type: 'checkbox', value: true, full: true })}
      </form>
    </section>
    <div id="step"></div></div>`);
  const optsForm = $('#opts', view);
  const params = () => {
    const d = formData(optsForm);
    delete d.file;
    if (!can.manage()) delete d.owner_id;
    return d;
  };
  const runPreview = async (mapping) => {
    try {
      preview = await post('/api/importacao/previa', { csv, filename, mapping, ...params() });
      drawPreview();
    } catch (e) {
      toastError(e);
    }
  };
  optsForm.file.addEventListener('change', () => {
    const f = optsForm.file.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toastError({ message: 'Arquivo maior que 10 MB.' });
    filename = f.name;
    const reader = new FileReader();
    reader.onload = () => {
      csv = String(reader.result);
      runPreview();
    };
    reader.readAsText(f, 'utf-8');
  });
  optsForm.addEventListener('change', (e) => {
    if (e.target.name !== 'file' && csv) runPreview(preview?.mapping);
  });
  const drawPreview = () => {
    const p = preview;
    render($('#step', view), html`<section class="card">
      <h3>1. Mapeamento de colunas</h3>
      <p class="hint">Sugestão automática pelo nome das colunas. Ajuste se necessário.</p>
      <form id="map" class="grid three">${p.fields.map((f) => html`<div class="field"><label>${FIELD_LABELS[f] || f}</label><select name="${f}"><option value="">— não importar —</option>${p.headers.map((h) => html`<option value="${h}" ${p.mapping[f] === h ? 'selected' : ''}>${h}</option>`)}</select></div>`)}</form>
    </section>
    <section class="card">
      <h3>2. Prévia</h3>
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Linhas</div><div class="kpi-value">${p.total}</div></div>
        <div class="kpi"><div class="kpi-label">Prontas para criar</div><div class="kpi-value">${p.valid}</div></div>
        <div class="kpi"><div class="kpi-label">Duplicadas</div><div class="kpi-value">${p.duplicates}</div></div>
        <div class="kpi"><div class="kpi-label">Com erro</div><div class="kpi-value">${p.errors}</div></div>
      </div>
      ${table(
        [
          { label: 'Linha', key: 'line' },
          { label: 'Nome', render: (r) => r.name || '—' },
          { label: 'Tipo', key: 'kind' },
          { label: 'Telefone', render: (r) => r.phone1 || '—' },
          { label: 'E-mail', render: (r) => r.email || '—' },
          { label: 'Cidade/UF', render: (r) => [r.city, r.state].filter(Boolean).join('/') || '—' },
          { label: 'Situação', render: (r) => (r.errors.length ? html`${badge('Erro', 'danger')}<br><small>${r.errors.join(' ')}</small>` : r.duplicate ? html`${badge('Duplicado', 'warn')}<br><small>${r.duplicate.code}${r.duplicate.name ? ` — ${r.duplicate.name}` : ' (outro responsável)'} · ${(r.duplicate.reasons || []).join(', ')}</small>` : r.duplicate_in_file ? html`${badge('Repetido no arquivo', 'warn')}<br><small>igual à linha ${r.duplicate_in_file}</small>` : badge('OK', 'ok')) },
        ],
        p.sample,
      )}
      ${p.total > p.sample.length ? html`<p class="muted small">Exibindo as primeiras ${p.sample.length} linhas.</p>` : ''}
      ${p.row_errors.length ? html`<details><summary>Erros por linha (${p.row_errors.length})</summary><ul>${p.row_errors.map((e) => html`<li>Linha ${e.line}: ${e.errors.join(' ')}</li>`)}</ul></details>` : ''}
      <p><button class="btn primary" data-act="commit" ${p.valid || p.duplicates ? '' : 'disabled'}>Importar ${p.valid} cadastro(s)</button></p>
    </section>`);
    $('#map', view).addEventListener('change', (e) => {
      runPreview(Object.fromEntries(new FormData(e.currentTarget).entries()));
    });
  };
  on(view, 'click', '[data-act=commit]', async (e, b) => {
    b.disabled = true;
    try {
      const r = await post('/api/importacao', { csv, filename, mapping: preview.mapping, ...params() });
      render($('#step', view), html`<section class="card">
        <h3>Importação #${r.import_id} concluída</h3>
        <div class="kpis small">
          <div class="kpi"><div class="kpi-label">Criados</div><div class="kpi-value">${r.created}</div></div>
          <div class="kpi"><div class="kpi-label">Duplicados (não criados)</div><div class="kpi-value">${r.duplicates}</div></div>
          <div class="kpi"><div class="kpi-label">Origens adicionadas</div><div class="kpi-value">${r.origins_added}</div></div>
          <div class="kpi"><div class="kpi-label">Erros</div><div class="kpi-value">${r.errors.length}</div></div>
        </div>
        ${r.errors.length ? html`<h4>Erros por linha</h4><ul>${r.errors.map((x) => html`<li>Linha ${x.line}: ${x.message}</li>`)}</ul>` : empty('Nenhum erro.')}
        <p><a class="btn" href="#/leads">Ver cadastros</a></p></section>`);
    } catch (ex) {
      b.disabled = false;
      toastError(ex);
    }
  });
}
