// Central de documentos da empresa (somente administrador): pastas como num OneDrive, envio de arquivos com número,
// órgão emissor, emissão e validade, novas versões com histórico e alertas de vencimento.
import { get, post, del, download } from '../api.js';
import { html, render, $, on, table, badge, field, modal, toast, toastError, fmtDate, fmtDateTime, confirmDialog, empty } from '../ui.js';
import { fileToBase64 } from './record-tabs.js';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.xml,.zip,.pfx,.p12';
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ext = (f) => (String(f).split('.').pop() || '').slice(0, 5);
const expiryBadge = (d) => (d.expiry === 'vencido' ? badge(`Vencido em ${fmtDate(d.expires_at)}`, 'danger') : d.expiry === 'vencendo' ? badge(`Vence em ${fmtDate(d.expires_at)}`, 'warn') : d.expires_at ? html`<small class="muted">válido até ${fmtDate(d.expires_at)}</small>` : '');

export async function show(view, { params }) {
  let folderId = params?.pasta ? Number(params.pasta) : null;
  let q = '';
  let d;
  const load = async () => {
    try {
      d = await get('/api/documentos', { pasta: folderId || '', q });
    } catch (e) {
      return toastError(e);
    }
    const inFolder = !!d.folder;
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Central de documentos</h1><p class="muted">Documentos da empresa: societários, fiscais e tributários, jurídicos, licenças e certidões, gestão, RH, financeiro e marca. Acesso exclusivo do administrador; cada download fica registrado.</p></div>
        <div class="actions">${inFolder ? html`<button class="btn" data-act="folder">+ Subpasta</button>` : html`<button class="btn" data-act="folder">+ Pasta</button>`}<button class="btn primary" data-act="upload">Enviar arquivos</button></div></div>
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Documentos</div><div class="kpi-value">${d.totals.n}</div><div class="kpi-sub">${size(d.totals.bytes)}</div></div>
        <div class="kpi ${d.alerts.length ? 'alert-kpi' : ''}"><div class="kpi-label">Vencidos ou vencendo (30 dias)</div><div class="kpi-value">${d.alerts.length}</div></div>
      </div>
      ${d.alerts.length && !inFolder && !q ? html`<section class="card"><h2>Atenção: validade</h2>${table([
        { label: 'Documento', render: (x) => html`<a href="#" data-open="${x.id}"><strong>${x.title}</strong></a><br><small>${x.folder_name}</small>` },
        { label: 'Validade', render: expiryBadge },
        { label: '', render: (x) => html`<button class="btn small" data-version="${x.id}">Enviar versão atualizada</button>` },
      ], d.alerts)}</section>` : ''}
      <section class="card">
        <div class="docs-toolbar">
          <nav class="docs-path" aria-label="Caminho"><a href="#" data-go="">Início</a>${d.path.map((p, i) => html` › ${i === d.path.length - 1 ? html`<strong>${p.name}</strong>` : html`<a href="#" data-go="${p.id}">${p.name}</a>`}`)}</nav>
          <form data-search><input type="search" name="q" value="${q}" placeholder="Buscar em todas as pastas (título, número, órgão, etiquetas)" aria-label="Buscar documentos"></form>
        </div>
        ${d.folder?.description ? html`<p class="muted small">${d.folder.description}</p>` : ''}
        ${!q && d.folders.length ? html`<div class="folder-grid">${d.folders.map((f) => html`<a class="folder-card" href="#" data-go="${f.id}">
            <span class="folder-icon" aria-hidden="true"></span><strong>${f.name}</strong>
            <small>${f.files} arquivo(s)${f.subfolders ? ` · ${f.subfolders} subpasta(s)` : ''}${f.bytes ? ` · ${size(f.bytes)}` : ''}</small>
            ${f.alerts ? html`<span class="alert-dot">${badge(`${f.alerts} vencendo`, 'warn')}</span>` : ''}</a>`)}</div>` : ''}
        ${inFolder || q ? table([
          { label: 'Documento', render: (x) => html`<div class="doc-name"><a href="#" data-open="${x.id}"><strong>${x.title}</strong></a><small class="muted"><span class="doc-ext">${ext(x.filename)}</span> ${x.filename} · ${size(x.size)}${x.version > 1 ? ` · versão ${x.version}` : ''}${q && x.folder_name ? ` · ${x.folder_name}` : ''}</small></div>` },
          { label: 'Número / órgão', render: (x) => html`${x.doc_number || '—'}${x.issuer ? html`<br><small>${x.issuer}</small>` : ''}` },
          { label: 'Emissão', render: (x) => fmtDate(x.issue_date) },
          { label: 'Validade', render: (x) => expiryBadge(x) || '—' },
          { label: 'Enviado', render: (x) => html`${fmtDateTime(x.updated_at)}<br><small>${x.uploaded_by_name || ''}</small>` },
          { label: '', render: (x) => html`<span class="inline-actions"><button class="btn small" data-dl="${x.id}">Baixar</button><button class="btn small ghost" data-open="${x.id}">Detalhes</button></span>` },
        ], d.documents, { emptyMsg: q ? 'Nenhum documento encontrado.' : 'Pasta vazia. Clique em "Enviar arquivos".' }) : empty('Escolha uma pasta para ver os documentos, ou use a busca.')}
        ${inFolder && !d.folder.system ? html`<p class="hint"><button class="btn small ghost" data-act="edit-folder">Renomear ou mover esta pasta</button> <button class="btn small ghost danger" data-act="del-folder">Excluir pasta</button></p>` : inFolder ? html`<p class="hint"><button class="btn small ghost" data-act="edit-folder">Editar descrição</button></p>` : ''}
      </section>
    </div>`);

  };
  const go = (id) => {
    folderId = id ? Number(id) : null;
    q = '';
    history.replaceState(null, '', `#/documentos${folderId ? `?pasta=${folderId}` : ''}`);
    load();
  };
  on(view, 'click', '[data-go]', (e, a) => {
    e.preventDefault();
    go(a.dataset.go);
  });
  on(view, 'submit', '[data-search]', (e, f) => {
    e.preventDefault();
    q = f.q.value.trim();
    load();
  });
  on(view, 'click', '[data-act=folder]', async () => (await folderForm({ parent_id: folderId }, d.all_folders)) && load());
  on(view, 'click', '[data-act=edit-folder]', async () => (await folderForm(d.folder, d.all_folders)) && load());
  on(view, 'click', '[data-act=del-folder]', async () => {
    if (!(await confirmDialog('Excluir pasta', `Excluir a pasta "${d.folder.name}"? Ela precisa estar vazia.`, { danger: true, confirmLabel: 'Excluir' }))) return;
    try {
      await del(`/api/documentos/pastas/${d.folder.id}`);
      toast('Pasta excluída.');
      go(d.folder.parent_id);
    } catch (e) {
      toastError(e);
    }
  });
  on(view, 'click', '[data-act=upload]', async () => (await uploadForm(folderId, d.all_folders)) && load());
  on(view, 'click', '[data-dl]', (e, b) => download(`/api/documentos/${b.dataset.dl}/arquivo`).catch(toastError));
  on(view, 'click', '[data-open]', async (e, a) => {
    e.preventDefault();
    if (await docDetail(Number(a.dataset.open), d.all_folders)) load();
  });
  on(view, 'click', '[data-version]', async (e, b) => (await versionForm(Number(b.dataset.version))) && load());
  await load();
}

function folderForm(f, folders) {
  return modal({
    title: f.id ? `Pasta: ${f.name}` : 'Nova pasta',
    body: html`<div class="grid">
      ${field({ name: 'name', label: 'Nome da pasta', value: f.name, required: true, full: true })}
      ${field({ name: 'description', label: 'Descrição', type: 'textarea', rows: 2, value: f.description, full: true })}
      ${f.system ? '' : field({ name: 'parent_id', label: 'Dentro de', type: 'select', value: f.parent_id, placeholder: 'Início (pasta principal)', options: folders.filter((x) => x.id !== f.id).map((x) => ({ value: x.id, label: x.name })), full: true })}
    </div>`,
    onSubmit: (d) => post('/api/documentos/pastas', { ...d, id: f.id, parent_id: f.system ? f.parent_id : d.parent_id }),
  });
}

const metaFields = (x = {}) => html`
  ${field({ name: 'doc_number', label: 'Número do documento', value: x.doc_number, placeholder: 'Ex.: nº da certidão, inscrição, contrato' })}
  ${field({ name: 'issuer', label: 'Órgão emissor / parte', value: x.issuer, placeholder: 'Receita Federal, SEFAZ-RS, Junta Comercial…' })}
  ${field({ name: 'issue_date', label: 'Data de emissão', type: 'date', value: x.issue_date })}
  ${field({ name: 'expires_at', label: 'Validade', type: 'date', value: x.expires_at, help: 'O sino avisa 30 dias antes do vencimento.' })}
  ${field({ name: 'tags', label: 'Etiquetas', value: x.tags, placeholder: 'cnpj, certidão, contrato social', full: true })}
  ${field({ name: 'description', label: 'Descrição', type: 'textarea', rows: 2, value: x.description, full: true })}`;

/** Envio de um ou mais arquivos para a pasta: cada arquivo vira um documento (o título vem do nome do arquivo). */
function uploadForm(folderId, folders) {
  return modal({
    title: 'Enviar arquivos',
    wide: true,
    submitLabel: 'Enviar',
    body: html`<div class="grid">
      ${field({ name: 'folder_id', label: 'Pasta', type: 'select', value: folderId, required: true, options: folders.map((x) => ({ value: x.id, label: x.name })), full: true })}
      <div class="field full"><label>Arquivos <span class="req">*</span></label><input type="file" name="files" multiple accept="${ACCEPT}"><small>PDF, imagens, Word, Excel, PowerPoint, XML, ZIP ou certificado digital (.pfx). Até 20 MB por arquivo.</small></div>
      ${field({ name: 'title', label: 'Título (só quando enviar um arquivo)', full: true, placeholder: 'Ex.: Cartão CNPJ, Contrato social – 3ª alteração' })}
      ${metaFields()}
    </div>`,
    async onSubmit(d, form) {
      const files = [...form.files.files];
      if (!files.length) throw new Error('Escolha pelo menos um arquivo.');
      for (const f of files) {
        if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name}: arquivo maior que 20 MB.`);
        await post('/api/documentos', { ...d, title: files.length === 1 ? d.title : '', filename: f.name, content_base64: await fileToBase64(f) });
      }
      toast(`${files.length} arquivo(s) enviado(s).`);
      return true;
    },
  });
}

function versionForm(id) {
  return modal({
    title: 'Enviar versão atualizada',
    body: html`<p class="small muted">A versão atual fica guardada no histórico do documento.</p><div class="grid">
      <div class="field full"><label>Arquivo <span class="req">*</span></label><input type="file" name="file" accept="${ACCEPT}"></div>
      ${field({ name: 'issue_date', label: 'Nova data de emissão', type: 'date' })}
      ${field({ name: 'expires_at', label: 'Nova validade', type: 'date' })}
    </div>`,
    async onSubmit(d, form) {
      const f = form.file.files[0];
      if (!f) throw new Error('Escolha o arquivo.');
      await post('/api/documentos', { id, ...d, filename: f.name, content_base64: await fileToBase64(f) });
      toast('Nova versão enviada.');
      return true;
    },
  });
}

async function docDetail(id, folders) {
  let x;
  try {
    x = await get(`/api/documentos/${id}`);
  } catch (e) {
    toastError(e);
    return false;
  }
  const canView = /^(application\/pdf|image\/)/.test(x.mime || '') && !window.CRM_PREVIEW;
  return modal({
    title: x.title,
    wide: true,
    submitLabel: 'Salvar dados',
    body: html`<p class="small muted">${x.path.map((p) => p.name).join(' › ')} · ${x.filename} · ${size(x.size)} · versão ${x.version} · enviado por ${x.uploaded_by_name || '—'} em ${fmtDateTime(x.created_at)} ${expiryBadge(x)}</p>
      <div class="inline-actions"><button type="button" class="btn small primary" data-dl-doc="${x.id}">Baixar</button>${canView ? html`<a class="btn small" href="/api/documentos/${x.id}/arquivo?ver=1" target="_blank" rel="noopener">Visualizar</a>` : ''}<button type="button" class="btn small" data-new-version>Enviar nova versão</button><button type="button" class="btn small ghost" data-archive>Arquivar</button><button type="button" class="btn small ghost danger" data-delete>Excluir definitivamente</button></div>
      <div class="grid">
        ${field({ name: 'title', label: 'Título', value: x.title, required: true, full: true })}
        ${field({ name: 'folder_id', label: 'Pasta', type: 'select', value: x.folder_id, allowEmpty: false, options: folders.map((f) => ({ value: f.id, label: f.name })), full: true })}
        ${metaFields(x)}
      </div>
      ${x.versions.length ? html`<h4>Versões anteriores</h4>${table([
        { label: 'Versão', render: (v) => `v${v.version}` },
        { label: 'Arquivo', render: (v) => html`${v.filename} <small class="muted">${size(v.size)}</small>` },
        { label: 'Validade', render: (v) => fmtDate(v.expires_at) },
        { label: 'Enviada em', render: (v) => fmtDateTime(v.created_at) },
        { label: '', render: (v) => html`<button type="button" class="btn small ghost" data-dl-doc="${v.id}">Baixar</button>` },
      ], x.versions)}` : ''}`,
    onMount(form, close) {
      on(form, 'click', '[data-dl-doc]', (e, b) => download(`/api/documentos/${b.dataset.dlDoc}/arquivo`).catch(toastError));
      on(form, 'click', '[data-new-version]', async () => {
        if (await versionForm(x.id)) close(true);
      });
      on(form, 'click', '[data-archive]', async () => {
        try {
          await del(`/api/documentos/${x.id}`);
          toast('Documento arquivado (sai da pasta e fica guardado no banco).');
          close(true);
        } catch (e) {
          toastError(e);
        }
      });
      on(form, 'click', '[data-delete]', async () => {
        if (!(await confirmDialog('Excluir definitivamente', `Excluir "${x.title}" e todas as versões anteriores? Não é possível desfazer.`, { danger: true, confirmLabel: 'Excluir' }))) return;
        try {
          await del(`/api/documentos/${x.id}?definitivo=1`);
          toast('Documento excluído.');
          close(true);
        } catch (e) {
          toastError(e);
        }
      });
    },
    onSubmit: (d) => post('/api/documentos', { ...d, id: x.id }),
  });
}
