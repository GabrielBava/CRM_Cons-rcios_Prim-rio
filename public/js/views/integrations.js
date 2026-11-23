// Integrações: cards por categoria (Mensageria, Voz, Marketing, Produtividade e Sistema). O especialista vê as de uso
// pessoal (WhatsApp Lite, Instagram, LinkedIn e Google Agenda); o líder e o administrador veem todas. O WhatsApp Lite
// abre a janela própria: números conectados por QR Code, nova instância, QR e acesso dos membros.
import { get, post, put, patch, del } from '../api.js';
import { html, render, on, state, toast, toastError, confirmDialog, $ } from '../ui.js';
import { icon } from '../icons.js';

const TONE = { ativo: 'ok', teste: 'warn', aguardando: 'warn', disponivel: 'idle', nao_configurado: 'off', erro: 'err', em_breve: 'off' };
const BRAND = { whatsapp: 'wa', instagram: 'ig', linkedin: 'li', meta: 'meta', google: 'gg', calendario: 'gcal', telefone: 'voz', email: 'mail', ia: 'ia', link: 'api', relatorios: 'bi' };

export async function show(view) {
  render(view, html`<div class="page"><div class="page-head"><div><h1>Integrações</h1><p class="muted">Carregando…</p></div></div></div>`);
  let d;
  try {
    d = await get('/api/integracoes/painel');
  } catch (e) {
    return render(view, html`<div class="page"><h1>Integrações</h1><p class="error">${e.message}</p></div>`);
  }
  render(view, html`<div class="page integ-page">
    <div class="page-head"><div><h1>Integrações</h1>
      <p class="muted">${d.role_scope === 'geral' ? 'Todas as conexões do CRM. As credenciais ficam com o administrador.' : 'Conecte o seu WhatsApp e a sua agenda ao CRM.'}</p></div></div>
    ${d.groups.map((g) => html`<section class="integ-group"><h2><span>${g.label}</span><small>${g.cards.length}</small><i></i></h2>
      <div class="integ-grid">${g.cards.map((c) => html`<article class="integ-card ${c.status === 'em_breve' ? 'soon' : ''}" data-int="${c.key}" ${c.status === 'em_breve' ? '' : 'tabindex="0" role="button"'} aria-label="${c.name}">
        <div class="integ-top"><span class="integ-logo brand-${BRAND[c.icon] || 'x'}">${icon(c.icon, 24)}</span><div><strong>${c.name}</strong><small>${c.sub}</small></div></div>
        <div class="integ-foot"><span class="integ-status tone-${TONE[c.status] || 'off'}"><i></i>${c.status === 'em_breve' ? html`${icon('historico', 13)} Em breve` : c.label}</span>
          <span class="integ-foot-r">${c.scope === 'usuario' && d.role_scope === 'geral' ? html`<span class="chip-sm muted" title="Cada usuário conecta o próprio">Usuário</span>` : ''}${c.status === 'em_breve' ? '' : html`<span class="integ-action">${c.action || 'Abrir'} →</span>`}</span></div>
      </article>`)}</div></section>`)}
  </div>`);
  const open = (key) => {
    const c = d.groups.flatMap((g) => g.cards).find((x) => x.key === key);
    if (!c || c.status === 'em_breve') return;
    if (key === 'whatsapp_lite') return liteManager(() => show(view));
    if (key === 'google_agenda') return googleDialog(c, () => show(view));
    if (key === 'wa_agent') return agentDialog(() => show(view));
    if (state.user.role === 'admin') {
      location.hash = '#/configuracoes/integracoes';
      return undefined;
    }
    return toast(`${c.name}: ${c.label}. A configuração é feita pelo administrador.`);
  };
  on(view, 'click', '[data-int]', (e, el) => open(el.dataset.int));
  on(view, 'keydown', '[data-int]', (e, el) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(el.dataset.int)));
  return undefined;
}

/* ------------------------- Janela própria (painel sobre a tela) ------------------------- */

function sheet(onClose) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = '<div class="modal wide int-sheet" role="dialog" aria-modal="true"></div>';
  document.body.appendChild(wrap);
  const box = wrap.firstChild;
  let timer = null;
  const close = () => {
    clearInterval(timer);
    wrap.remove();
    document.removeEventListener('keydown', escKey);
    onClose?.();
  };
  const escKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', escKey);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-x]')) close();
  });
  return { box, close, poll: (fn, ms) => { clearInterval(timer); timer = fn ? setInterval(fn, ms) : null; } };
}

const statusChip = (s) => html`<span class="lite-status st-${s}"><i></i>${{ conectado: 'Conectado', aguardando: 'Aguardando leitura', desconectado: 'Desconectado' }[s] || s}</span>`;

async function liteManager(onClose) {
  const sh = sheet(onClose);
  let data;
  const head = (sub) => html`<header class="int-head"><span class="integ-logo brand-wa">${icon('whatsapp', 26)}</span><div><h2>WhatsApp Lite</h2><small>${sub}</small></div><button type="button" class="icon" data-x aria-label="Fechar">×</button></header>`;

  async function list() {
    sh.poll(null);
    try {
      data = await get('/api/whatsapp/lite');
    } catch (e) {
      return render(sh.box, html`${head('')}<div class="int-body"><p class="error">${e.message}</p></div>`);
    }
    const admin = state.user.role === 'admin';
    render(sh.box, html`${head(html`<span class="dot-ok"></span> ${data.instances.length} instância(s) criada(s)${data.sandbox ? ' · modo de teste' : ''}`)}
      <div class="int-body">
        ${!data.can_create ? html`<div class="alert">O servidor do WhatsApp Lite ainda não foi configurado.${admin ? ' Preencha abaixo o endereço e a chave do servidor (Evolution API) ou ligue o modo de teste.' : ' Peça ao administrador para configurar.'}</div>` : ''}
        <div class="lite-bar"><span class="lite-count">Instâncias Lite · <b>${data.connected} conectada(s)</b></span>${data.can_create && state.user.role !== 'leitura' ? html`<button type="button" class="btn primary" data-a="new">${icon('adicionar', 16)} Nova instância</button>` : ''}</div>
        ${data.instances.length ? html`<div class="lite-list">${data.instances.map((i) => html`<div class="lite-row" data-id="${i.id}">
          <span class="avatar-ini">${i.initials}</span>
          <div class="lite-info"><strong>${i.name}</strong><small>${i.phone_label || 'Número ainda não conectado'}</small>
            <small class="muted">${i.only_known ? 'Só conversas com cadastros do CRM' : 'Todas as conversas'} · ${i.access_all !== 'nenhum' ? `Acesso para todos: ${i.access_all_label}` : `${i.members_with_access} membro(s) com acesso`}${i.owner_name ? ` · Dono: ${i.owner_name}` : ''}</small></div>
          ${statusChip(i.status)}
          ${i.can_manage ? html`<button type="button" class="btn" data-a="qr" data-id="${i.id}">${i.status === 'conectado' ? 'Reconectar' : 'Conectar'}</button>
            <div class="menu-wrap"><button type="button" class="icon" data-a="more" data-id="${i.id}" aria-label="Mais opções">${icon('pontos', 18)}</button>
              <div class="pop" hidden><button type="button" data-a="members" data-id="${i.id}">${icon('usuarios', 15)} Acesso dos membros</button>
              <button type="button" data-a="known" data-id="${i.id}">${icon('filtro', 15)} ${i.only_known ? 'Registrar todas as conversas' : 'Só cadastros do CRM'}</button>
              ${i.status === 'conectado' ? html`<button type="button" data-a="logout" data-id="${i.id}">${icon('sair', 15)} Desconectar</button>` : ''}
              <button type="button" class="danger" data-a="remove" data-id="${i.id}">${icon('lixeira', 15)} Excluir</button></div></div>` : html`<span class="chip-sm muted">${i.my_access === 'enviar' ? 'Ver e enviar' : 'Só ver'}</span>`}
        </div>`)}</div>` : html`<div class="empty">Nenhum número conectado. Clique em <strong>Nova instância</strong>, dê um nome e leia o QR Code com o WhatsApp do celular (Business ou pessoal).</div>`}
        ${admin ? html`<details class="lite-server" ${data.can_create ? '' : 'open'}><summary>Servidor do WhatsApp Lite (administrador)</summary>
          <form data-form="server" class="grid" novalidate>
            <div class="field full"><label>Endereço do servidor (Evolution API)</label><input name="url" value="${data.url || ''}" placeholder="https://whatsapp.suaempresa.com.br" ${data.from_env ? 'disabled' : ''}></div>
            <div class="field full"><label>Chave global (apikey)</label><input name="key" type="password" autocomplete="off" placeholder="${data.has_key ? '•••••••• (guardada; preencha só para trocar)' : 'Chave do servidor'}" ${data.from_env ? 'disabled' : ''}></div>
            <label class="check full"><input type="checkbox" name="sandbox" ${data.sandbox ? 'checked' : ''}> Modo de teste (sem servidor: QR ilustrativo e mensagens só no CRM)</label>
            <p class="hint full">Cada instância recebe as mensagens pelo webhook <code class="selectable">${data.webhook_base}&lt;segredo da instância&gt;</code>, configurado sozinho na criação.${data.from_env ? ' Endereço e chave vêm do config.env.' : ''}</p>
            <div class="full"><button type="submit" class="btn">Salvar servidor</button></div>
          </form></details>` : ''}
      </div>`);
    return undefined;
  }

  async function newInstance() {
    render(sh.box, html`<header class="int-head"><div><h2>Adicionar instância Lite</h2><small>A instância é criada no servidor do WhatsApp da Vero.</small></div><button type="button" class="icon" data-x aria-label="Fechar">×</button></header>
      <form class="int-body" data-form="create" novalidate>
        <div class="field full"><label>Nome da instância</label><input name="name" maxlength="60" required placeholder="Ex.: Meu WhatsApp, Time SDR Brasil" value="${data.instances.some((i) => i.owner_id === state.user.id) ? '' : `WhatsApp de ${String(state.user.name || '').split(' ')[0]}`}" autofocus></div>
        <label class="check full"><input type="checkbox" name="only_known" checked> Registrar só conversas com cadastros do CRM <small class="muted">(recomendado para número pessoal: conversas com amigos e família não entram no CRM)</small></label>
        <p class="hint">Depois de criar, o QR Code aparece para concluir o pareamento.</p>
        <footer class="int-foot"><button type="button" class="btn ghost" data-a="back">Voltar</button><button type="submit" class="btn primary">Criar instância</button></footer>
      </form>`);
    $('[name=name]', sh.box)?.focus();
  }

  async function qrView(id, first) {
    let r = first;
    const draw = () => render(sh.box, html`${head(r.name)}
      <div class="int-body lite-qr">
        ${r.status === 'conectado' ? html`<div class="qr-done">${icon('confirmar', 40)}<h3>Conectado</h3><p>${r.phone_label || ''} já está ligado ao CRM. As conversas aparecem em <a href="#/comunicacao/whatsapp" data-x>Comunicação › WhatsApp</a>.</p></div>`
          : html`<div class="qr-box">${r.qr ? html`<img src="${r.qr}" alt="QR Code para conectar o WhatsApp" width="240" height="240">` : html`<div class="qr-wait">Gerando o QR Code…</div>`}</div>
          <ol class="qr-steps"><li>Abra o <strong>WhatsApp</strong> no celular (Business ou pessoal).</li><li>Toque em <strong>Mais opções ⋮</strong> ou <strong>Configurações</strong> › <strong>Aparelhos conectados</strong>.</li><li>Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o QR Code.</li></ol>
          <p class="hint">A tela se atualiza sozinha quando o número conectar. O QR Code vence em cerca de 40 segundos: se vencer, gere outro.</p>
          ${r.sandbox ? html`<div class="alert">Modo de teste: este QR é ilustrativo. Use <strong>Simular leitura</strong> para continuar.</div>` : ''}`}
        <footer class="int-foot"><button type="button" class="btn ghost" data-a="back">Voltar</button>
          ${r.status !== 'conectado' ? html`<button type="button" class="btn" data-a="newqr" data-id="${id}">Gerar novo QR</button>${r.sandbox ? html`<button type="button" class="btn primary" data-a="simulate" data-id="${id}">Simular leitura</button>` : ''}` : html`<button type="button" class="btn primary" data-a="members" data-id="${id}">Acesso dos membros</button>`}</footer>
      </div>`);
    draw();
    sh.poll(async () => {
      try {
        const n = await get(`/api/whatsapp/lite/instancias/${id}`);
        const changed = n.status !== r.status || n.qr !== r.qr;
        r = n;
        if (changed) draw();
        if (n.status === 'conectado') sh.poll(null);
      } catch { /* mantém a tela */ }
    }, 3000);
  }

  async function membersView(id) {
    sh.poll(null);
    let m;
    try {
      m = await get(`/api/whatsapp/lite/instancias/${id}/acesso`);
    } catch (e) {
      return toastError(e);
    }
    let filter = '';
    const draw = () => {
      const rows = m.members.filter((x) => !filter || `${x.name} ${x.email}`.toLowerCase().includes(filter));
      render(sh.box, html`${head(html`<span class="dot-ok"></span> ${m.instance.name}`)}
        <div class="int-body">
          <div class="lite-sub"><button type="button" class="icon" data-a="back" aria-label="Voltar">${icon('voltar', 18)}</button><div><strong>Acesso dos membros</strong><small>${m.instance.name}${m.instance.phone_label ? ` · ${m.instance.phone_label}` : ''}</small></div></div>
          <div class="lite-search"><span>${icon('buscar', 16)}</span><input type="search" data-a="filter" placeholder="Buscar por nome ou e-mail" value="${filter}">
            <label class="lite-all">Acesso para todos <select data-a="all" data-id="${id}" ${m.instance.can_manage ? '' : 'disabled'}>${m.levels.map((l) => html`<option value="${l.key}" ${m.instance.access_all === l.key ? 'selected' : ''}>${l.label}</option>`)}</select></label></div>
          <div class="table-wrap"><table class="data lite-members"><thead><tr><th>Membro</th><th>Cargo</th><th>Acesso</th></tr></thead><tbody>
            ${rows.map((x) => html`<tr class="${x.fixed ? 'fixed' : ''}"><td data-label="Membro"><div class="lite-who"><span class="avatar-ini sm">${x.initials}</span><span><strong>${x.name}</strong><small class="muted">${x.email}</small></span></div></td>
              <td data-label="Cargo"><span class="chip-sm ${x.role_label === 'Proprietário' ? 'owner' : ''}">${x.role_label}</span></td>
              <td data-label="Acesso"><div class="seg" role="radiogroup" aria-label="Acesso de ${x.name}">${m.levels.map((l) => html`<button type="button" role="radio" aria-checked="${x.level === l.key}" class="${x.level === l.key ? 'on' : ''} lv-${l.key}" data-a="lv" data-id="${id}" data-user="${x.id}" data-lv="${l.key}" ${x.fixed || !m.instance.can_manage ? 'disabled' : ''} title="${x.fixed ? 'Dono, líder e administrador têm acesso completo' : ''}">${icon(l.key === 'nenhum' ? 'parar' : l.key === 'ver' ? 'olho' : 'enviar', 14)} ${l.label}</button>`)}</div></td></tr>`)}
          </tbody></table></div>
          <p class="hint">Só ver: lê as conversas deste número. Ver e enviar: também responde por ele. O dono, o líder e o administrador têm acesso completo.</p>
        </div>`);
    };
    draw();
    sh.box.oninput = (e) => {
      if (e.target.dataset.a === 'filter') {
        filter = e.target.value.toLowerCase();
        const pos = e.target.selectionStart;
        draw();
        const inp = $('[data-a=filter]', sh.box);
        inp.focus();
        inp.setSelectionRange(pos, pos);
      }
    };
    sh.box.onchange = async (e) => {
      if (e.target.dataset.a !== 'all') return;
      try {
        await patch(`/api/whatsapp/lite/instancias/${id}`, { access_all: e.target.value });
        m = await get(`/api/whatsapp/lite/instancias/${id}/acesso`);
        draw();
        toast('Acesso para todos atualizado.');
      } catch (ex) {
        toastError(ex);
      }
    };
    sh.box.onlevel = async (uid, lv) => {
      try {
        m = await put(`/api/whatsapp/lite/instancias/${id}/acesso`, { user_id: Number(uid), level: lv });
        draw();
      } catch (ex) {
        toastError(ex);
      }
    };
    return undefined;
  }

  sh.box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const id = Number(b.dataset.id);
    const a = b.dataset.a;
    try {
      if (a === 'new') return newInstance();
      if (a === 'back') return list();
      if (a === 'more') {
        const pop = b.parentElement.querySelector('.pop');
        sh.box.querySelectorAll('.pop').forEach((p) => p !== pop && (p.hidden = true));
        pop.hidden = !pop.hidden;
        return undefined;
      }
      if (a === 'qr') return qrView(id, await post(`/api/whatsapp/lite/instancias/${id}/reconectar`));
      if (a === 'newqr') return qrView(id, await post(`/api/whatsapp/lite/instancias/${id}/reconectar`));
      if (a === 'simulate') return qrView(id, await post(`/api/whatsapp/lite/instancias/${id}/simular-conexao`, {}));
      if (a === 'members') return membersView(id);
      if (a === 'lv') return sh.box.onlevel(b.dataset.user, b.dataset.lv);
      if (a === 'known') {
        const inst = data.instances.find((i) => i.id === id);
        await patch(`/api/whatsapp/lite/instancias/${id}`, { only_known: !inst.only_known });
        toast(inst.only_known ? 'A instância passa a registrar todas as conversas.' : 'A instância passa a registrar só conversas com cadastros do CRM.');
        return list();
      }
      if (a === 'logout') {
        if (!(await confirmDialog('Desconectar o número?', 'O número sai do CRM até ser conectado de novo pelo QR Code. As conversas ficam no histórico.', { confirmLabel: 'Desconectar' }))) return undefined;
        await post(`/api/whatsapp/lite/instancias/${id}/desconectar`);
        return list();
      }
      if (a === 'remove') {
        if (!(await confirmDialog('Excluir a instância?', 'A instância é apagada do servidor. As conversas já registradas continuam no histórico dos leads.', { danger: true, confirmLabel: 'Excluir' }))) return undefined;
        await del(`/api/whatsapp/lite/instancias/${id}`);
        toast('Instância excluída.');
        return list();
      }
    } catch (ex) {
      toastError(ex);
    }
    return undefined;
  });
  sh.box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.dataset.form === 'create') {
        const name = f.name.value.trim();
        if (!name) return toastError(new Error('Dê um nome para a instância.'));
        const btn = f.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Criando…';
        const r = await post('/api/whatsapp/lite/instancias', { name, only_known: f.only_known.checked });
        return qrView(r.id, r);
      }
      if (f.dataset.form === 'server') {
        const body = { url: f.url.value.trim(), sandbox: f.sandbox.checked };
        if (f.key.value) body.key = f.key.value;
        await put('/api/whatsapp/lite/config', body);
        toast('Servidor do WhatsApp Lite salvo.');
        return list();
      }
    } catch (ex) {
      toastError(ex);
      const btn = f.querySelector('[type=submit]');
      if (btn) {
        btn.disabled = false;
        btn.textContent = f.dataset.form === 'create' ? 'Criar instância' : 'Salvar servidor';
      }
    }
    return undefined;
  });
  list();
}

/* ------------------------- Google Agenda (cada usuário conecta a sua) ------------------------- */

async function googleDialog(card, onClose) {
  let g;
  try {
    g = await get('/api/google/status');
  } catch (e) {
    return toastError(e);
  }
  const sh = sheet(onClose);
  render(sh.box, html`<header class="int-head"><span class="integ-logo brand-gcal">${icon('calendario', 26)}</span><div><h2>Google Agenda</h2><small>${card.label}</small></div><button type="button" class="icon" data-x aria-label="Fechar">×</button></header>
    <div class="int-body">
      ${g.connected ? html`<p>Sua agenda está conectada${g.google_email ? html` como <strong>${g.google_email}</strong>` : ''}. As R1 e R2 agendadas no CRM entram na sua agenda com o link do Google Meet.</p>
        ${g.needs_reconnect ? html`<div class="alert">Reconecte para liberar a presença automática pelo Google Meet.</div>` : ''}`
        : g.configured ? html`<p>Conecte a sua conta Google: as reuniões agendadas no CRM vão para a sua agenda com o link do Meet, e o convite vai para o cliente.</p>`
          : html`<div class="alert">O Google Agenda ainda não foi configurado pelo administrador (Configurações › Integrações).</div>`}
      <footer class="int-foot"><button type="button" class="btn ghost" data-x>Fechar</button>
        ${g.configured ? html`${g.connected ? html`<button type="button" class="btn" data-g="off">Desconectar</button>` : ''}<button type="button" class="btn primary" data-g="on">${g.connected ? 'Reconectar' : 'Conectar Google Agenda'}</button>` : ''}
        ${state.user.role === 'admin' ? html`<a class="btn" href="#/configuracoes/integracoes" data-x>Configurar (administrador)</a>` : ''}</footer>
    </div>`);
  sh.box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    try {
      if (b.dataset.g === 'on') {
        if (window.CRM_PREVIEW) throw new Error('Na versão de teste no navegador a conexão com o Google fica desativada.');
        const r = await post('/api/google/conectar');
        location.href = r.url;
      } else {
        await post('/api/google/desconectar');
        toast('Google Agenda desconectado.');
        sh.close();
      }
    } catch (ex) {
      toastError(ex);
    }
  });
  return undefined;
}

/* ------------------------- Agente de IA no WhatsApp ------------------------- */

const PRICE = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const DAYS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [0, 'Dom']];
const ACTION = { qualificou: 'Triagem concluída', agendou_r1: 'R1 agendada', transferiu: 'Transferida ao especialista', sem_fit: 'Sem fit', erro: 'Erro', novo_lead: 'Novo lead' };

async function agentDialog(onClose) {
  let d;
  try {
    d = await get('/api/whatsapp/agente');
  } catch (e) {
    return toastError(e);
  }
  const sh = sheet(onClose);
  const draw = () => {
    const c = d.config;
    const st = d.stats;
    const ro = d.can_edit ? '' : 'disabled';
    const [pi, po] = PRICE[c.model] || PRICE['claude-opus-5-5'];
    const cost = (st.tokens_in * pi + st.tokens_out * po) / 1e6;
    const target = c.channel === 'oficial' ? 'oficial' : c.instance_id ? `lite:${c.instance_id}` : '';
    render(sh.box, html`<header class="int-head"><span class="integ-logo brand-ia">${icon('ia', 26)}</span><div><h2>Agente de IA no WhatsApp</h2>
        <small>${d.ready ? html`<span class="dot-ok"></span> Atendendo no ${c.channel === 'oficial' ? 'número oficial' : 'número central'}` : c.enabled ? 'Ligado, mas falta configurar (veja abaixo)' : 'Desligado'}</small></div><button type="button" class="icon" data-x aria-label="Fechar">×</button></header>
      <div class="int-body">
        <p class="small muted">Quando um lead escreve no número central, a IA responde na hora, faz a triagem (as 6 perguntas da aba Qualificação), registra no CRM e, se houver fit, agenda a R1 na agenda do especialista. Depois passa a conversa para ele. O especialista pode assumir a qualquer momento.</p>
        ${!d.llm.has_key ? html`<div class="alert">Falta a chave da API da Anthropic: cadastre em <a href="#/configuracoes/integracoes" data-x>Configurações › Integrações › IA generativa</a> (ou <code>ANTHROPIC_API_KEY</code> no servidor).</div>` : ''}
        ${!d.llm.sdk ? html`<div class="alert">A biblioteca da Anthropic não está instalada no servidor (<code>npm install</code>).</div>` : ''}
        ${!d.instances.length && !d.official.configured && !d.official.sandbox ? html`<div class="alert">Conecte primeiro o número central em <strong>WhatsApp Lite</strong> (QR Code) ou o número oficial.</div>` : ''}
        <div class="agent-stats">${[['Atendidas', st.atendidas], ['Novos leads', st.novos_leads], ['Triagens', st.qualificados], ['R1 agendadas', st.r1_agendadas], ['Transferidas', st.transferidas], ['Sem fit', st.sem_fit], ['IA atendendo agora', st.ativas]]
          .map(([l, v]) => html`<div><b>${v}</b><small>${l}</small></div>`)}</div>
        <p class="hint">Últimos 30 dias. Uso da IA: ${Math.round(st.tokens_in / 1000)} mil tokens de entrada e ${Math.round(st.tokens_out / 1000)} mil de saída, cerca de US$ ${cost.toFixed(2)} no modelo escolhido (estimativa; o cache reduz o valor).</p>
        <form data-form="agent" class="grid" novalidate>
          <label class="check full"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''} ${ro}> <strong>Ligar o agente de IA</strong></label>
          <div class="field"><label>Número central atendido pela IA</label><select name="target" ${ro}>
            <option value="">Escolha…</option>
            ${d.instances.map((i) => html`<option value="lite:${i.id}" ${target === `lite:${i.id}` ? 'selected' : ''}>WhatsApp Lite · ${i.label}</option>`)}
            ${d.official.configured || d.official.sandbox ? html`<option value="oficial" ${target === 'oficial' ? 'selected' : ''}>Número oficial (API do WhatsApp Business)</option>` : ''}</select></div>
          <div class="field"><label>Nome da assistente</label><input name="name" maxlength="40" value="${c.name}" ${ro}></div>
          <div class="field"><label>Modelo de IA</label><select name="model" ${ro}>${d.models.map((m) => html`<option value="${m.value}" ${c.model === m.value ? 'selected' : ''}>${m.label}</option>`)}</select></div>
          <div class="field"><label>Duração da R1</label><select name="r1_minutes" ${ro}>${[30, 45, 60, 90].map((m) => html`<option value="${m}" ${c.r1_minutes === m ? 'selected' : ''}>${m} minutos</option>`)}</select></div>
          <div class="field full"><label>Dias para a R1</label><div class="agent-days">${DAYS.map(([v, l]) => html`<label class="chip-check"><input type="checkbox" name="day" value="${v}" ${c.days.includes(v) ? 'checked' : ''} ${ro}> ${l}</label>`)}</div></div>
          <div class="field"><label>Das</label><input type="time" name="start" value="${c.start}" ${ro}></div>
          <div class="field"><label>Até</label><input type="time" name="end" value="${c.end}" ${ro}></div>
          <div class="field"><label>Antecedência mínima (horas)</label><input type="number" name="notice_hours" min="0" max="72" value="${c.notice_hours}" ${ro}></div>
          <div class="field full"><label>Critério de fit</label><textarea name="fit" rows="3" ${ro}>${c.fit}</textarea><small class="hint">Quem tem fit é convidado para a R1; quem não tem é passado ao especialista (nutrição ou perdido).</small></div>
          <div class="field full"><label>Orientações extras para a IA (opcional)</label><textarea name="instructions" rows="3" placeholder="Ex.: campanhas do mês, administradoras parceiras, como chamar a reunião…" ${ro}>${c.instructions}</textarea></div>
          ${d.can_edit ? html`<div class="full"><button type="submit" class="btn primary">Salvar</button></div>` : html`<p class="hint full">Só o administrador altera estas configurações.</p>`}
        </form>
        ${d.recent.length ? html`<h3 class="agent-h">Últimas ações da IA</h3><ul class="agent-log">${d.recent.map((r) => html`<li><a href="#/comunicacao/whatsapp/${r.conversation_id}" data-x><b>${ACTION[r.action] || r.action}</b> · ${r.contact_name || 'Conversa'}${r.detail ? html` <small class="muted">· ${r.detail}</small>` : ''}</a><small class="muted">${new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></li>`)}</ul>` : ''}
      </div>`);
  };
  draw();
  sh.box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const t = f.target.value;
    const body = {
      enabled: f.enabled.checked, name: f.name.value.trim(), model: f.model.value, r1_minutes: Number(f.r1_minutes.value),
      days: [...f.querySelectorAll('[name=day]:checked')].map((x) => Number(x.value)), start: f.start.value, end: f.end.value,
      notice_hours: Number(f.notice_hours.value), fit: f.fit.value, instructions: f.instructions.value,
      ...(t === 'oficial' ? { channel: 'oficial' } : t ? { channel: 'lite', instance_id: Number(t.split(':')[1]) } : {}),
    };
    try {
      d = await put('/api/whatsapp/agente', body);
      toast(d.config.enabled ? (d.ready ? 'Agente de IA ligado.' : 'Configuração salva. Falta a chave ou a biblioteca da IA.') : 'Agente de IA desligado.');
      draw();
    } catch (ex) {
      toastError(ex);
    }
  });
  return undefined;
}

