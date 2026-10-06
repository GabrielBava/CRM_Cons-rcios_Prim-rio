// Meu cadastro: dados do próprio usuário (foto, contato, cargo, apresentação, especialidades, PIX) e troca de senha.
import { get, post, patch } from '../api.js';
import { html, render, raw, $, $$, on, state, field, opts, modal, toast, toastError, avatar, fmtDateTime } from '../ui.js';

const refreshMeta = () => window.dispatchEvent(new Event('crm:refresh-meta'));

/** Reduz a foto no navegador: recorte quadrado central em 256×256, JPEG. */
function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Escolha uma imagem (JPG, PNG ou WebP).'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('Imagem maior que 10 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

export async function show(view) {
  const load = async () => {
    let p;
    let g = null;
    try {
      [p, g] = await Promise.all([get('/api/perfil'), get('/api/google/status').catch(() => null)]);
    } catch (e) {
      return toastError(e);
    }
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Meu cadastro</h1><p class="muted">Seus dados na plataforma. E-mail de acesso, perfil e equipe são definidos pelo administrador.</p></div></div>
      <div class="profile-grid">
        <section class="card profile-card">
          <div class="profile-photo">${avatar(p, 120)}</div>
          <h2>${p.name}</h2>
          <p class="muted">${p.job_title || p.role_label}${p.team_name ? ` · ${p.team_name}` : ''}</p>
          <div class="inline-actions center">
            <label class="btn small">Trocar foto<input type="file" accept="image/jpeg,image/png,image/webp" data-photo hidden></label>
            ${p.photo ? html`<button type="button" class="btn small ghost" data-act="photo-remove">Remover</button>` : ''}
          </div>
          <p class="hint">A foto aparece ao lado do seu nome no topo da tela. Use uma foto de rosto, com boa iluminação.</p>
          <dl class="kv-list">
            <div><dt>Perfil</dt><dd>${p.role_label}</dd></div>
            <div><dt>Equipe</dt><dd>${p.team_name || '—'}${p.leader_name ? html`<br><small>Líder: ${p.leader_name}</small>` : ''}</dd></div>
            <div><dt>Último acesso</dt><dd>${fmtDateTime(p.last_login_at)}</dd></div>
            <div><dt>Senha alterada em</dt><dd>${p.password_changed_at ? fmtDateTime(p.password_changed_at) : 'nunca'}</dd></div>
            <div><dt>Sessões ativas</dt><dd>${p.active_sessions}</dd></div>
          </dl>
          <button type="button" class="btn" data-act="pw">Alterar senha</button>
          <div class="google-box ${g?.connected ? 'ok' : ''}">
            <h3>Google Agenda</h3>
            ${!g ? html`<p class="muted small">Indisponível.</p>`
              : g.connected ? html`<p class="small">Conectado a <strong>${g.google_email || 'sua conta Google'}</strong> desde ${fmtDateTime(g.connected_at)}. Cada R1 agendada no CRM entra na sua agenda com link do Google Meet e convite para o cliente.</p>
                ${g.needs_reconnect ? html`<div class="alert warn small">Falta a permissão do Google Meet para o CRM registrar sozinho a "R1 feita" quando o cliente entrar na reunião. Clique em Reconectar e aceite todas as permissões.</div>
                  <button type="button" class="btn small primary" data-act="google-on">Reconectar</button>` : html`<p class="small muted">Presença automática ativa: quando alguém de fora da empresa entra no Meet da R1, a reunião é registrada como "R1 feita".</p>`}
                <button type="button" class="btn small ghost" data-act="google-off">Desconectar</button>`
              : g.configured ? html`<p class="small">Conecte sua agenda para que a R1 agendada no CRM crie o evento no seu Google Agenda, gere o link do Google Meet e envie o convite ao cliente.</p>
                <button type="button" class="btn small primary" data-act="google-on">Conectar meu Google Agenda</button>`
              : html`<p class="small muted">A integração com o Google Agenda ainda não foi ativada pelo administrador (Configurações › Integrações). Até lá, a R1 abre o evento já preenchido no Google Agenda para você salvar.</p>`}
          </div>
        </section>
        <form class="card" id="pf" novalidate>
          <h3>Dados pessoais</h3>
          <div class="grid">
            ${field({ name: 'name', label: 'Nome completo', value: p.name, required: true, full: true })}
            <div class="field"><label>E-mail de acesso</label><input value="${p.email}" disabled><small>Para trocar o e-mail, fale com o administrador.</small></div>
            ${field({ name: 'birth_date', label: 'Data de nascimento', type: 'date', value: p.birth_date, help: 'Aparece nos aniversariantes da equipe.' })}
            ${field({ name: 'phone', label: 'Telefone', type: 'tel', value: p.phone, placeholder: '(11) 99999-9999' })}
            ${field({ name: 'whatsapp', label: 'WhatsApp comercial', type: 'tel', value: p.whatsapp, placeholder: '(11) 99999-9999' })}
          </div>
          <h3>Dados profissionais</h3>
          <div class="grid">
            ${field({ name: 'job_title', label: 'Cargo', value: p.job_title, placeholder: 'Ex.: Especialista em consórcio imobiliário' })}
            ${field({ name: 'professional_reg', label: 'Registro ou certificação', value: p.professional_reg, placeholder: 'Ex.: certificação da administradora, CRECI, ANBIMA' })}
            <fieldset class="field full"><legend>Especialidades</legend>${opts('categoria_credito').map((o) => html`<label class="check inline"><input type="checkbox" data-spec="${o.value}" ${p.specialties.includes(o.value) ? raw('checked') : ''}> ${o.label}</label>`)}
              <small>Ajuda o líder a direcionar os leads de cada categoria.</small></fieldset>
            ${field({ name: 'bio', label: 'Apresentação para os clientes', type: 'textarea', rows: 3, value: p.bio, full: true, placeholder: 'Ex.: Há 5 anos ajudo famílias a conquistar o imóvel com planejamento, sem juros.', help: 'Até 500 caracteres.' })}
          </div>
          <h3>Comissões</h3>
          <div class="grid">
            ${field({ name: 'pix_key', label: 'Chave PIX para pagamento das comissões', value: p.pix_key, help: 'Visível apenas para você e para o administrador.' })}
          </div>
          <div class="modal-error" hidden></div>
          <div class="form-actions"><button class="btn primary" type="submit">Salvar meu cadastro</button></div>
        </form>
      </div></div>`);
  };
  on(view, 'submit', '#pf', async (e, f) => {
    e.preventDefault();
    const err = $('.modal-error', f);
    err.hidden = true;
    const d = Object.fromEntries(new FormData(f).entries());
    d.specialties = $$('[data-spec]:checked', f).map((c) => c.dataset.spec);
    try {
      await patch('/api/perfil', d);
      toast('Cadastro salvo.');
      refreshMeta();
      load();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    }
  });
  on(view, 'change', '[data-photo]', async (e, input) => {
    const file = input.files[0];
    if (!file) return;
    try {
      const photo = await resizePhoto(file);
      await post('/api/perfil/foto', { photo });
      toast('Foto atualizada.');
      refreshMeta();
      load();
    } catch (ex) {
      toastError(ex);
    }
  });
  on(view, 'click', '[data-act=photo-remove]', async () => {
    try {
      await post('/api/perfil/foto', { photo: null });
      refreshMeta();
      load();
    } catch (ex) {
      toastError(ex);
    }
  });
  on(view, 'click', '[data-act=pw]', () => changePasswordDialog().then((ok) => ok && load()));
  on(view, 'click', '[data-act=google-on]', async () => {
    if (window.CRM_PREVIEW) return toastError(new Error('Na versão de teste no navegador a conexão com o Google fica desativada. No CRM instalado ela funciona normalmente.'));
    try {
      const r = await post('/api/google/conectar');
      location.href = r.url;
    } catch (ex) {
      toastError(ex);
    }
  });
  on(view, 'click', '[data-act=google-off]', async () => {
    try {
      await post('/api/google/desconectar');
      toast('Google Agenda desconectado.');
      load();
    } catch (ex) {
      toastError(ex);
    }
  });
  // Volta do Google (OAuth): mensagem do resultado
  const back = new URLSearchParams(location.hash.split('?')[1] || '').get('google');
  if (back) {
    const msgs = { ok: 'Google Agenda conectado. As próximas R1 já entram na sua agenda com Google Meet.', cancelado: 'Conexão com o Google cancelada.', expirado: 'O pedido de conexão expirou. Tente de novo.', sem_permissao: 'O Google não devolveu a permissão de acesso contínuo. Tente de novo e aceite todas as permissões.', erro: 'Não foi possível conectar ao Google. Confira a configuração com o administrador.' };
    toast(msgs[back] || back, back === 'ok' ? 'ok' : 'error');
    // Conexão aberta pelo pop-up "Agendar R1": esta guia se fecha e o agendamento continua na guia original
    if (back === 'ok' && new URLSearchParams(location.hash.split('?')[1] || '').get('fechar') === '1') setTimeout(() => window.close(), 1200);
    history.replaceState(null, '', '#/meu-cadastro');
  }
  await load();
}

/* ------------------------- Alterar senha ------------------------- */

const pwField = (name, label, autocomplete) => html`<div class="field full pw-field"><label for="pw_${name}">${label} <span class="req">*</span></label>
  <div class="pw-wrap"><input id="pw_${name}" name="${name}" type="password" required autocomplete="${autocomplete}" spellcheck="false" autocapitalize="off">
  <button type="button" class="pw-eye" data-eye="${name}" aria-label="Mostrar senha" aria-pressed="false" title="Mostrar senha">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7Zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9Zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg></button></div></div>`;

/** Mesmas regras do servidor, para orientar enquanto a pessoa digita. */
function checks(pwd, confirm, current) {
  const u = state.user || {};
  const low = pwd.toLowerCase();
  const local = String(u.email || '').split('@')[0].toLowerCase();
  const first = String(u.name || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  return [
    ['Pelo menos 8 caracteres', pwd.length >= 8],
    ['Letras e números', /[a-zA-ZÀ-ÿ]/.test(pwd) && /\d/.test(pwd)],
    ['Sem o seu nome ou e-mail', !!pwd && !((local.length >= 4 && low.includes(local)) || (first.length >= 3 && low.includes(first)))],
    ['Diferente da senha atual', !!pwd && pwd !== current],
    ['Confirmação igual à nova senha', !!confirm && pwd === confirm],
  ];
}
function strength(pwd) {
  let s = 0;
  if (pwd.length >= 8) s++;
  if (pwd.length >= 12) s++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) s++;
  if (/\d/.test(pwd)) s++;
  if (/[^a-zA-Z0-9]/.test(pwd)) s++;
  return Math.min(4, s);
}
const STRENGTH = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'];

export function changePasswordDialog({ first = false } = {}) {
  return modal({
    title: first ? 'Criar minha senha' : 'Alterar senha',
    submitLabel: first ? 'Salvar e entrar' : 'Confirmar nova senha',
    body: html`<p class="hint">${first ? 'Informe a senha provisória que você recebeu e crie a sua senha pessoal.' : 'Por segurança, confirme a senha atual. Ao trocar, as sessões abertas em outros aparelhos são encerradas.'}</p>
      ${pwField('current', first ? 'Senha provisória (recebida do administrador)' : 'Senha atual', 'current-password')}
      ${pwField('password', 'Nova senha', 'new-password')}
      <div class="pw-meter" aria-live="polite"><span data-meter></span><small data-meter-label>Digite a nova senha</small></div>
      ${pwField('confirm', 'Confirmar nova senha', 'new-password')}
      <ul class="pw-rules" data-rules></ul>
      <p class="hint">Dica: use uma frase fácil de lembrar, com números e símbolos (ex.: <em>Casa-Propria-2027!</em>). Não reutilize senhas de outros sites.</p>`,
    onMount(form) {
      const sync = () => {
        const pwd = form.password.value;
        const list = checks(pwd, form.confirm.value, form.current.value);
        render($('[data-rules]', form), html`${list.map(([l, ok]) => html`<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${l}</li>`)}`);
        const st = strength(pwd);
        const bar = $('[data-meter]', form);
        bar.style.width = pwd ? `${(st + 1) * 20}%` : '0';
        bar.className = `lvl-${st}`;
        $('[data-meter-label]', form).textContent = pwd ? `Força: ${STRENGTH[st]}` : 'Digite a nova senha';
      };
      form.addEventListener('input', sync);
      sync();
      on(form, 'click', '[data-eye]', (e, b) => {
        const input = form[b.dataset.eye];
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.setAttribute('aria-pressed', String(show));
        b.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
        b.title = show ? 'Ocultar senha' : 'Mostrar senha';
        b.classList.toggle('on', show);
      });
    },
    async onSubmit(d) {
      const failed = checks(d.password, d.confirm, d.current).filter(([, ok]) => !ok);
      if (failed.length) throw new Error(`A nova senha precisa atender: ${failed.map(([l]) => l.toLowerCase()).join('; ')}.`);
      const r = await post('/api/me/senha', d);
      toast(r.sessions_ended ? `Senha alterada. ${r.sessions_ended} sessão(ões) em outros aparelhos ${r.sessions_ended === 1 ? 'foi encerrada' : 'foram encerradas'}.` : 'Senha alterada com sucesso.');
      return true;
    },
  });
}
