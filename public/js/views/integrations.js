// Integrações: cards por categoria (Mensageria, Voz, Marketing, Produtividade e Sistema). O especialista vê as de uso
// pessoal (WhatsApp Lite, Instagram, LinkedIn e Google Agenda); o líder e o administrador veem todas. O WhatsApp Lite
// abre a janela própria: números conectados por QR Code, nova instância, QR e acesso dos membros.
import { get, post, put, patch, del } from '../api.js';
import { html, render, on, state, toast, toastError, confirmDialog, modal, relTime, fmtPhone, $ } from '../ui.js';
import { icon } from '../icons.js';

const TONE = { ativo: 'ok', teste: 'warn', aguardando: 'warn', disponivel: 'idle', nao_configurado: 'off', erro: 'err', em_breve: 'off' };
const BRAND = { sino: 'wa', whatsapp: 'wa', instagram: 'ig', linkedin: 'li', meta: 'meta', google: 'gg', calendario: 'gcal', telefone: 'voz', email: 'mail', ia: 'ia', link: 'api', relatorios: 'bi' };

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
    if (key === 'wa_avisos') return noticesDialog(() => show(view));
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
            <small class="muted">${i.only_known ? 'Só conversas com cadastros do CRM' : 'Todas as conversas'} · ${i.access_all !== 'nenhum' ? `Acesso para todos: ${i.access_all_label}` : `${i.members_with_access} membro(s) com acesso`}${i.owner_name ? ` · Dono: ${i.owner_name}` : ''}</small>
            ${i.ignored_count ? html`<small class="lite-warn">${i.ignored_count} mensagem(ns) recebida(s) não entraram no CRM · última ${relTime(i.ignored_at)} · <button type="button" class="link" data-a="check" data-id="${i.id}">ver por quê</button></small>` : ''}</div>
          ${statusChip(i.status)}
          ${i.can_manage ? html`<button type="button" class="btn" data-a="qr" data-id="${i.id}">${i.status === 'conectado' ? 'Reconectar' : 'Conectar'}</button>
            <div class="menu-wrap"><button type="button" class="icon" data-a="more" data-id="${i.id}" aria-label="Mais opções">${icon('pontos', 18)}</button>
              <div class="pop" hidden>${data.sandbox ? '' : html`<button type="button" data-a="check" data-id="${i.id}">${icon('confirmar', 15)} Conferir recebimento</button>`}
              <button type="button" data-a="members" data-id="${i.id}">${icon('usuarios', 15)} Acesso dos membros</button>
              <button type="button" data-a="known" data-id="${i.id}">${icon('filtro', 15)} ${i.only_known ? 'Registrar todas as conversas' : 'Só cadastros do CRM'}</button>
              ${i.status === 'conectado' ? html`<button type="button" data-a="logout" data-id="${i.id}">${icon('sair', 15)} Desconectar</button>` : ''}
              <button type="button" class="danger" data-a="remove" data-id="${i.id}">${icon('lixeira', 15)} Excluir</button></div></div>` : html`<span class="chip-sm muted">${i.my_access === 'enviar' ? 'Ver e enviar' : 'Só ver'}</span>`}
        </div>`)}</div>` : html`<div class="empty">Nenhum número conectado. Clique em <strong>Nova instância</strong>, dê um nome e leia o QR Code com o WhatsApp do celular (Business ou pessoal).</div>`}
        ${admin ? html`<details class="lite-server" ${data.can_create ? '' : 'open'}><summary>Servidor do WhatsApp Lite (administrador)</summary>
          <form data-form="server" class="grid" novalidate>
            <div class="field full"><label>Endereço do servidor (Evolution API)</label><input name="url" value="${data.url || ''}" placeholder="https://whatsapp.suaempresa.com.br" ${data.from_env ? 'disabled' : ''}></div>
            <div class="field full"><label>Endereço do CRM para o webhook (opcional)</label><input name="webhook_base" value="${data.webhook_base_custom || ''}" placeholder="Padrão: o endereço público do CRM"><small class="hint">Só mude se o conector enxergar o CRM por outro endereço (ex.: teste no computador com Docker: http://crm.vero.test:3000).</small></div>
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

  /** Resultado de "Conferir recebimento": cada etapa do caminho conector → CRM, com o que fazer. */
  async function checkView(r) {
    const i = r.instance;
    const rows = [
      [r.state === 'open', r.state === 'open' ? 'Número conectado ao WhatsApp.' : `Número não está conectado (${r.state || 'sem resposta do conector'}). Clique em Reconectar e leia o QR Code.`],
      [true, r.fixed ? `Endereço de aviso do conector corrigido (antes: ${r.previous}).` : 'Endereço de aviso do conector está certo.'],
      [r.crm_ok, r.crm_ok ? 'O CRM recebe os avisos do conector pelo endereço público.' : r.crm_message],
      [!!i.last_event_at, i.last_event_at ? `Último aviso do conector: ${relTime(i.last_event_at)}.` : 'O conector ainda não mandou nenhum aviso deste número.'],
    ];
    if (r.sync_ok === false) rows.push([false, `O CRM não conseguiu buscar as mensagens no conector (${r.sync_message}).`]);
    else if (r.sync_ok) rows.push([true, `O CRM busca as mensagens direto no conector${r.sync_new ? `: ${r.sync_new} mensagem(ns) que faltavam entraram agora` : ''}.`]);
    if (r.webhook_late) rows.push([false, 'O conector não está conseguindo avisar o CRM na hora: o último aviso é mais antigo que a última mensagem. As respostas aparecem assim mesmo, buscadas a cada poucos segundos com a tela do WhatsApp aberta; para as notificações e o agente de IA responderem na hora, rode o diagnóstico na VPS (vero-whatsapp diagnostico).']);
    if (i.ignored_count) rows.push([false, `${i.ignored_count} mensagem(ns) recebida(s) não entraram no CRM. A última, ${relTime(i.ignored_at)}, de ${i.ignored_who}: ${i.ignored_label}.`]);
    const offerAll = i.only_known && i.ignored_reason === 'fora_do_crm';
    await modal({
      title: `Conferir recebimento · ${i.name}`,
      body: html`<ul class="lite-check">${rows.map(([ok, text]) => html`<li class="${ok ? 'ok' : 'bad'}"><span>${icon(ok ? 'confirmar' : 'parar', 16)}</span>${text}</li>`)}</ul>
        <p class="hint">Para testar, peça para alguém mandar uma mensagem para este número e clique em Conferir recebimento de novo: o "Último aviso" deve mudar para "agora".${offerAll ? ' Para receber mensagens de leads novos (números que ainda não estão no CRM), registre todas as conversas deste número.' : ''}</p>`,
      ...(offerAll ? {
        submitLabel: 'Registrar todas as conversas',
        cancelLabel: 'Fechar',
        onSubmit: async () => {
          await patch(`/api/whatsapp/lite/instancias/${i.id}`, { only_known: false });
          toast('O número passa a registrar todas as conversas.');
          return true;
        },
      } : {}),
    });
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
      if (a === 'check') {
        b.disabled = true;
        const prev = b.innerHTML;
        b.textContent = 'Conferindo…';
        try {
          await checkView(await post(`/api/whatsapp/lite/instancias/${id}/conferir`));
        } finally {
          b.disabled = false;
          b.innerHTML = prev;
        }
        return list();
      }
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
        const body = { url: f.url.value.trim(), sandbox: f.sandbox.checked, webhook_base: f.webhook_base.value.trim() };
        if (f.key.value) body.key = f.key.value;
        const r = await put('/api/whatsapp/lite/config', body);
        if (r?.check && !r.check.ok) toast(`Salvo, mas o conector não confirmou: ${r.check.message}`, 'error');
        else toast(r?.check?.ok ? 'Servidor do WhatsApp Lite salvo: conector respondendo e chave aceita.' : 'Servidor do WhatsApp Lite salvo.');
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

/** Avisos por WhatsApp para o responsável: novo lead e R1 agendada, com modelos editáveis. */
async function noticesDialog(onClose) {
  let d;
  try {
    d = await get('/api/whatsapp/avisos');
  } catch (e) {
    return toastError(e);
  }
  const sh = sheet(onClose);
  const vars = (kind, target) => html`<div class="notice-vars">${d.vars[kind].map(([k, l]) => html`<button type="button" class="chip-sm" data-var="{{${k}}}" data-target="${target}" title="Inserir: ${l}" ${d.can_edit ? '' : 'disabled'}>{{${k}}}</button>`)}</div>`;
  const draw = () => {
    const c = d.config;
    const ro = d.can_edit ? '' : 'disabled';
    render(sh.box, html`<header class="int-head"><span class="integ-logo brand-wa">${icon('sino', 26)}</span><div><h2>Avisos por WhatsApp</h2>
        <small>${c.enabled ? html`<span class="dot-ok"></span> Ligado${d.sender ? ` · envia pelo número ${d.sender.name}` : ''}` : 'Desligado'}</small></div><button type="button" class="icon" data-x aria-label="Fechar">×</button></header>
      <div class="int-body">
        <p class="small muted">O responsável recebe no WhatsApp dele um aviso quando chega um <strong>novo lead</strong> para ele (cadastro, landing page, roleta ou agente de IA) e quando uma <strong>R1 é agendada</strong>. O aviso sai pelo número do WhatsApp Lite escolhido e vai para o WhatsApp cadastrado em Meu perfil.</p>
        ${!d.instances.length ? html`<div class="alert">Conecte primeiro um número no <strong>WhatsApp Lite</strong> (QR Code): é por ele que os avisos saem.</div>` : d.sender && !d.sender.connected ? html`<div class="alert">O número ${d.sender.name} está desconectado: os avisos ficam na fila até ele voltar (ou escolha outro número).</div>` : ''}
        ${d.users_without_number.length ? html`<div class="alert small">Sem WhatsApp no perfil (não recebem os avisos): <strong>${d.users_without_number.map((u) => u.name).join(', ')}</strong>. Cada um cadastra em Meu perfil › WhatsApp comercial.</div>` : ''}
        ${d.recipients.some((u) => u.same_as_sender) ? html`<div class="alert small">${d.recipients.filter((u) => u.same_as_sender).map((u) => u.name).join(', ')}: o WhatsApp do perfil é o mesmo número que envia os avisos. O aviso chega na conversa "Você" (consigo mesmo), e o WhatsApp não mostra notificação. Para receber como mensagem normal, use outro número para enviar os avisos ou cadastre outro WhatsApp no perfil.</div>` : ''}
        <form data-form="notices" class="grid" novalidate>
          <label class="check full"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''} ${ro}> <strong>Ligar os avisos por WhatsApp</strong></label>
          <div class="field"><label>Número que envia os avisos</label><select name="instance_id" ${ro}><option value="">Automático (número central do agente ou o primeiro conectado)</option>${d.instances.map((i) => html`<option value="${i.id}" ${Number(c.instance_id) === i.id ? 'selected' : ''}>${i.label}</option>`)}</select></div>
          <label class="check"><input type="checkbox" name="skip_self" ${c.skip_self ? 'checked' : ''} ${ro}> Não avisar quando o próprio responsável cadastrou o lead ou agendou a reunião</label>
          <fieldset class="full notice-box"><legend><label class="check"><input type="checkbox" name="new_enabled" ${c.new_lead.enabled ? 'checked' : ''} ${ro}> Novo lead no CRM</label></legend>
            <textarea name="new_template" rows="6" maxlength="1000" ${ro}>${c.new_lead.template}</textarea>${vars('novo_lead', 'new_template')}
            ${d.can_edit ? html`<div class="notice-acts"><button type="button" class="btn small" data-test="novo_lead">Enviar teste para mim</button><button type="button" class="btn small ghost" data-reset="new_template">Voltar ao modelo padrão</button></div>` : ''}</fieldset>
          <fieldset class="full notice-box"><legend><label class="check"><input type="checkbox" name="r1_enabled" ${c.r1.enabled ? 'checked' : ''} ${ro}> R1 agendada</label></legend>
            <textarea name="r1_template" rows="7" maxlength="1000" ${ro}>${c.r1.template}</textarea>${vars('r1_agendada', 'r1_template')}
            <label class="check"><input type="checkbox" name="r1_r2" ${c.r1.r2 ? 'checked' : ''} ${ro}> Avisar também quando a R2 for agendada (o modelo serve para as duas; use {{tipo_reuniao}} para mostrar R1 ou R2)</label>
            ${d.can_edit ? html`<div class="notice-acts"><button type="button" class="btn small" data-test="r1_agendada">Enviar teste para mim</button><button type="button" class="btn small ghost" data-reset="r1_template">Voltar ao modelo padrão</button></div>` : ''}</fieldset>
          <p class="hint full">Use *texto* para negrito no WhatsApp. As variáveis entre {{chaves}} são trocadas pelos dados do lead e da reunião.</p>
          ${d.can_edit ? html`<div class="full"><button type="submit" class="btn primary">Salvar</button></div>` : html`<p class="hint full">Só o administrador altera estas configurações.</p>`}
        </form>
        <h3 class="agent-h">Quem recebe</h3>
        <ul class="notice-who">${d.recipients.map((u) => html`<li><strong>${u.name}</strong><small class="${u.number ? 'muted' : 'warn-text'}">${u.number ? `${fmtPhone(u.number)} · ${u.source}` : 'Sem WhatsApp no perfil'}${u.same_as_sender ? ' · mesmo número que envia' : ''}</small></li>`)}</ul>
        ${d.recent.length ? html`<h3 class="agent-h">Últimos avisos</h3><ul class="agent-log">${d.recent.map((r) => html`<li><span><b>${r.kind_label}</b>${r.contact_name ? ` · ${r.contact_name}` : ''} → ${r.user_name || '—'} <small class="muted">· ${r.status_label}${r.error ? ` (${r.error})` : ''}</small></span><small class="muted">${new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></li>`)}</ul>` : ''}
      </div>`);
  };
  draw();
  const form = () => sh.box.querySelector('[data-form=notices]');
  sh.box.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-var]');
    if (v) {
      const ta = form()[v.dataset.target];
      const at = ta.selectionStart ?? ta.value.length;
      ta.value = `${ta.value.slice(0, at)}${v.dataset.var}${ta.value.slice(ta.selectionEnd ?? at)}`;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = at + v.dataset.var.length;
      return;
    }
    const rs = e.target.closest('[data-reset]');
    if (rs) {
      form()[rs.dataset.reset].value = rs.dataset.reset === 'r1_template' ? d.defaults.r1 : d.defaults.new_lead;
      return;
    }
    const t = e.target.closest('[data-test]');
    if (!t) return;
    t.disabled = true;
    try {
      const r = await post('/api/whatsapp/avisos/teste', { kind: t.dataset.test, template: form()[t.dataset.test === 'r1_agendada' ? 'r1_template' : 'new_template'].value });
      toast(r.simulated ? 'Teste registrado (WhatsApp Lite em modo de teste: nada foi enviado de verdade).' : 'Teste enviado para o seu WhatsApp.');
      d = await get('/api/whatsapp/avisos');
      draw();
    } catch (ex) {
      toastError(ex);
    } finally {
      t.disabled = false;
    }
  });
  sh.box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      d = await put('/api/whatsapp/avisos', {
        enabled: f.enabled.checked, skip_self: f.skip_self.checked, instance_id: f.instance_id.value ? Number(f.instance_id.value) : null,
        new_lead: { enabled: f.new_enabled.checked, template: f.new_template.value },
        r1: { enabled: f.r1_enabled.checked, r2: f.r1_r2.checked, template: f.r1_template.value },
      });
      toast(d.config.enabled ? 'Avisos por WhatsApp ligados.' : 'Avisos por WhatsApp desligados.');
      draw();
    } catch (ex) {
      toastError(ex);
    }
  });
  return undefined;
}

async function agentDialog(onClose) {
  let d;
  try {
    d = await get('/api/whatsapp/agente');
  } catch (e) {
    return toastError(e);
  }
  const sh = sheet(onClose);
  // Token do n8n recém-gerado: aparece uma vez só (o CRM guarda apenas o hash)
  let n8nToken = '';
  const draw = () => {
    const c = d.config;
    const st = d.stats;
    const ro = d.can_edit ? '' : 'disabled';
    const prov = c.provider || 'gemini';
    const gem = prov === 'gemini';
    const isN8n = prov === 'n8n';
    const nn = d.n8n || {};
    const [pi, po] = PRICE[c.model] || PRICE['claude-opus-5-5'];
    const cost = (st.tokens_in * pi + st.tokens_out * po) / 1e6;
    const pv = d.providers || { gemini: {}, claude: {} };
    const target = c.channel === 'oficial' ? 'oficial' : c.instance_id ? `lite:${c.instance_id}` : '';
    render(sh.box, html`<header class="int-head"><span class="integ-logo brand-ia">${icon('ia', 26)}</span><div><h2>Agente de IA no WhatsApp</h2>
        <small>${d.ready ? html`<span class="dot-ok"></span> Atendendo no ${c.channel === 'oficial' ? 'número oficial' : 'número central'}${isN8n ? ' pelo n8n' : ''}` : c.enabled ? 'Ligado, mas falta configurar (veja abaixo)' : 'Desligado'}</small></div><button type="button" class="icon" data-x aria-label="Fechar">×</button></header>
      <div class="int-body">
        <p class="small muted">Quando um lead escreve no número central, a IA responde na hora, faz a triagem (as 6 perguntas da aba Qualificação), registra no CRM e, se houver fit, agenda a R1 na agenda do especialista. Depois passa a conversa para ele. O especialista pode assumir a qualquer momento.</p>
        ${isN8n && !nn.has_token ? html`<div class="alert">Falta gerar o <strong>token do n8n</strong> (abaixo) e colocar no fluxo do n8n na VPS.</div>` : ''}
        ${isN8n && nn.has_token && !nn.last_call_at ? html`<div class="alert small">O n8n ainda não falou com o CRM. Rode o instalador do n8n na VPS com este token (guia em <code>deploy/n8n/LEIA-ME.md</code>).</div>` : ''}
        ${!isN8n && !d.llm.has_key ? html`<div class="alert">Falta a chave do ${gem ? 'Gemini' : 'Claude'}: informe abaixo${gem ? html` (crie grátis em <strong>Google AI Studio › Get API key</strong>)` : ' (console da Anthropic)'} ou em <a href="#/configuracoes/integracoes" data-x>Configurações › Integrações › IA generativa</a>.</div>` : ''}
        ${prov === 'claude' && !d.llm.sdk ? html`<div class="alert">A biblioteca da Anthropic não está instalada no servidor (<code>npm install</code>).</div>` : ''}
        ${gem && pv.gemini.note ? html`<div class="alert small">${pv.gemini.note}</div>` : ''}
        ${!d.instances.length && !d.official.configured && !d.official.sandbox ? html`<div class="alert">Conecte primeiro o número central em <strong>WhatsApp Lite</strong> (QR Code) ou o número oficial.</div>` : ''}
        <div class="agent-stats">${[['Atendidas', st.atendidas], ['Novos leads', st.novos_leads], ['Triagens', st.qualificados], ['R1 agendadas', st.r1_agendadas], ['Transferidas', st.transferidas], ['Sem fit', st.sem_fit], ['IA atendendo agora', st.ativas]]
          .map(([l, v]) => html`<div><b>${v}</b><small>${l}</small></div>`)}</div>
        <p class="hint">Últimos 30 dias. Uso da IA: ${Math.round(st.tokens_in / 1000)} mil tokens de entrada e ${Math.round(st.tokens_out / 1000)} mil de saída${isN8n ? ' (informado pelo fluxo do n8n; a cobrança é a do provedor configurado no n8n)' : gem ? ' · no plano gratuito do Gemini não há cobrança (há limite de pedidos por minuto e por dia)' : `, cerca de US$ ${cost.toFixed(2)} no modelo escolhido (estimativa; o cache reduz o valor)`}.</p>
        <form data-form="agent" class="grid" novalidate>
          <label class="check full"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''} ${ro}> <strong>Ligar o agente de IA</strong></label>
          <div class="field"><label>Número central atendido pela IA</label><select name="target" ${ro}>
            <option value="">Escolha…</option>
            ${d.instances.map((i) => html`<option value="lite:${i.id}" ${target === `lite:${i.id}` ? 'selected' : ''}>WhatsApp Lite · ${i.label}</option>`)}
            ${d.official.configured || d.official.sandbox ? html`<option value="oficial" ${target === 'oficial' ? 'selected' : ''}>Número oficial (API do WhatsApp Business)</option>` : ''}</select></div>
          <div class="field"><label>Nome da assistente</label><input name="name" maxlength="40" value="${c.name}" ${ro}></div>
          <div class="field"><label>Provedor de IA</label><select name="provider" ${ro}><option value="gemini" ${gem ? 'selected' : ''}>Google Gemini (tem plano gratuito)</option><option value="claude" ${prov === 'claude' ? 'selected' : ''}>Anthropic Claude</option><option value="n8n" ${isN8n ? 'selected' : ''}>Fluxo do n8n na VPS (24 horas)</option></select></div>
          <div class="field full n8n-box" data-prov="n8n" ${isN8n ? '' : 'hidden'}>
            <p class="small muted">A IA roda no <strong>n8n</strong>, na VPS do WhatsApp, com o modelo e a base de conhecimento configurados lá. O CRM continua mandando: ligar e desligar, Assumir/Devolver, modo de teste, triagem, agenda da R1 e o envio das mensagens.</p>
            <dl class="n8n-info">
              <dt>Endereço do CRM</dt><dd><code>${nn.crm_url || ''}</code> <button type="button" class="btn small ghost" data-copy="${nn.crm_url || ''}">Copiar</button></dd>
              <dt>Token do n8n</dt><dd>${nn.has_token ? `Gerado (termina em ${nn.hint})` : 'Ainda não gerado'}${d.can_edit ? html` <button type="button" class="btn small" data-a="n8ntoken">${nn.has_token ? 'Gerar outro token' : 'Gerar token'}</button>` : ''}</dd>
              <dt>Último contato do n8n</dt><dd>${nn.last_call_at ? new Date(nn.last_call_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nenhum ainda'}</dd>
            </dl>
            ${n8nToken ? html`<div class="alert small n8n-token"><span>Copie agora (não aparece de novo): <code>${n8nToken}</code></span> <button type="button" class="btn small" data-copy="${n8nToken}">Copiar token</button></div>` : ''}
            <label class="check"><input type="checkbox" name="n8n_transcripts" ${c.n8n_transcripts ? 'checked' : ''} ${ro}> Mandar as transcrições das R1 para a base de conhecimento do n8n (sem nome, telefone, e-mail e CPF do cliente)</label>
          </div>
          <div class="field" data-prov="gemini n8n" ${gem || isN8n ? '' : 'hidden'}><label>Modelo do Gemini${isN8n ? ' (usado pelo n8n)' : ''}</label><input name="gemini_model" value="${c.gemini_model || 'gemini-3.8-flash'}" list="agent-gemini-models" ${ro}><datalist id="agent-gemini-models"></datalist>${d.can_edit ? html`<small class="hint"><a href="#" data-a="gmodels">Buscar os modelos da conta</a></small>` : ''}</div>
          <div class="field" data-prov="claude" ${prov === 'claude' ? '' : 'hidden'}><label>Modelo do Claude</label><select name="model" ${ro}>${d.models.map((m) => html`<option value="${m.value}" ${c.model === m.value ? 'selected' : ''}>${m.label}</option>`)}</select></div>
          ${d.can_edit ? html`<div class="field" data-prov="gemini" ${gem ? '' : 'hidden'}><label>Chave da API do Gemini</label><input type="password" name="gemini_api_key" autocomplete="off" placeholder="${pv.gemini.has_key ? '•••••••• (salva; preencha só para trocar)' : 'AIza… (Google AI Studio › Get API key)'}" ${pv.gemini.from_env ? 'disabled' : ''}></div>
          <div class="field" data-prov="claude" ${prov === 'claude' ? '' : 'hidden'}><label>Chave da API da Anthropic</label><input type="password" name="api_key" autocomplete="off" placeholder="${pv.claude.has_key ? '•••••••• (salva; preencha só para trocar)' : 'sk-ant-…'}" ${pv.claude.from_env ? 'disabled' : ''}></div>` : ''}
          <div class="field"><label>Duração da R1</label><select name="r1_minutes" ${ro}>${[30, 45, 60, 90].map((m) => html`<option value="${m}" ${c.r1_minutes === m ? 'selected' : ''}>${m} minutos</option>`)}</select></div>
          <div class="field full"><label>Dias para a R1</label><div class="agent-days">${DAYS.map(([v, l]) => html`<label class="chip-check"><input type="checkbox" name="day" value="${v}" ${c.days.includes(v) ? 'checked' : ''} ${ro}> ${l}</label>`)}</div></div>
          <div class="field"><label>Das</label><input type="time" name="start" value="${c.start}" ${ro}></div>
          <div class="field"><label>Até</label><input type="time" name="end" value="${c.end}" ${ro}></div>
          <div class="field"><label>Antecedência mínima (horas)</label><input type="number" name="notice_hours" min="0" max="72" value="${c.notice_hours}" ${ro}></div>
          <div class="field full"><label>Critério de fit</label><textarea name="fit" rows="3" ${ro}>${c.fit}</textarea><small class="hint">Quem tem fit é convidado para a R1; quem não tem é passado ao especialista (nutrição ou perdido).</small></div>
          <div class="field full"><label>Orientações extras para a IA (opcional)</label><textarea name="instructions" rows="3" placeholder="Ex.: campanhas do mês, administradoras parceiras, como chamar a reunião…" ${ro}>${c.instructions}</textarea></div>
          <div class="field"><label>Especialista padrão para leads novos</label><select name="default_owner_id" ${ro}><option value="">Distribuição (roleta)</option>${(d.users || []).map((u) => html`<option value="${u.id}" ${Number(c.default_owner_id) === u.id ? 'selected' : ''}>${u.name}</option>`)}</select><small class="hint">Usado quando a roleta não define ninguém: a IA agenda a R1 na agenda dele.</small></div>
          <div class="field"><label>Modo de teste: atender só estes números</label><textarea name="test_numbers" rows="2" placeholder="Ex.: 51 99999-0000 (um por linha)" ${ro}>${c.test_numbers || ''}</textarea><small class="hint">${d.test_mode ? html`<b>Modo de teste ligado:</b> a IA ignora quem não está na lista.` : 'Vazio: a IA atende todos que escreverem para o número central.'}</small></div>
          ${d.can_edit ? html`<div class="full"><button type="submit" class="btn primary">Salvar</button></div>` : html`<p class="hint full">Só o administrador altera estas configurações.</p>`}
        </form>
        ${d.recent.length ? html`<h3 class="agent-h">Últimas ações da IA</h3><ul class="agent-log">${d.recent.map((r) => html`<li><a href="#/comunicacao/whatsapp/${r.conversation_id}" data-x><b>${ACTION[r.action] || r.action}</b> · ${r.contact_name || 'Conversa'}${r.detail ? html` <small class="muted">· ${r.detail}</small>` : ''}</a><small class="muted">${new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></li>`)}</ul>` : ''}
      </div>`);
  };
  draw();
  // Troca de provedor na tela: mostra o modelo e a chave do escolhido
  sh.box.addEventListener('change', (e) => {
    if (e.target.name !== 'provider') return;
    sh.box.querySelectorAll('[data-prov]').forEach((el) => { el.hidden = !el.dataset.prov.split(' ').includes(e.target.value); });
  });
  sh.box.addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try {
        await navigator.clipboard.writeText(cp.dataset.copy);
        toast('Copiado.');
      } catch {
        toast('Selecione o texto e copie com Ctrl+C.');
      }
      return undefined;
    }
    const tk = e.target.closest('[data-a=n8ntoken]');
    if (tk) {
      if (d.n8n?.has_token && !(await confirmDialog('Gerar outro token?', 'O token atual para de funcionar na hora. Atualize a credencial "CRM Vero" no n8n (ou rode o instalador de novo) com o novo token.', { confirmLabel: 'Gerar outro' }))) return undefined;
      try {
        n8nToken = (await post('/api/whatsapp/agente/n8n/token', {})).token;
        d = await get('/api/whatsapp/agente');
        draw();
      } catch (ex) {
        toastError(ex);
      }
      return undefined;
    }
    const a = e.target.closest('[data-a=gmodels]');
    if (!a) return;
    e.preventDefault();
    try {
      const r = await get('/api/ia/modelos-gemini');
      if (r.error || !r.models.length) return toastError(new Error(r.error || 'Salve a chave do Gemini e tente de novo.'));
      const dl = sh.box.querySelector('#agent-gemini-models');
      dl.innerHTML = '';
      for (const m of r.models) {
        const o = document.createElement('option');
        o.value = m.value;
        o.label = m.label;
        dl.appendChild(o);
      }
      toast(`${r.models.length} modelo(s) disponível(is) na conta.`);
    } catch (ex) {
      toastError(ex);
    }
    return undefined;
  });
  sh.box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const t = f.target.value;
    const body = {
      enabled: f.enabled.checked, name: f.name.value.trim(), provider: f.provider.value, model: f.model.value, gemini_model: f.gemini_model.value.trim() || undefined,
      ...(f.gemini_api_key?.value ? { gemini_api_key: f.gemini_api_key.value } : {}), ...(f.api_key?.value ? { api_key: f.api_key.value } : {}),
      r1_minutes: Number(f.r1_minutes.value),
      days: [...f.querySelectorAll('[name=day]:checked')].map((x) => Number(x.value)), start: f.start.value, end: f.end.value,
      notice_hours: Number(f.notice_hours.value), fit: f.fit.value, instructions: f.instructions.value,
      test_numbers: f.test_numbers.value, default_owner_id: f.default_owner_id.value ? Number(f.default_owner_id.value) : null,
      n8n_transcripts: !!f.n8n_transcripts?.checked,
      ...(t === 'oficial' ? { channel: 'oficial' } : t ? { channel: 'lite', instance_id: Number(t.split(':')[1]) } : {}),
    };
    try {
      d = await put('/api/whatsapp/agente', body);
      const pname = { gemini: 'Gemini', claude: 'Claude', n8n: 'n8n' }[d.llm.provider] || d.llm.provider;
      toast(d.config.enabled ? (d.ready ? `Agente de IA ligado (${pname}).` : d.llm.provider === 'n8n' ? 'Configuração salva. Falta gerar o token do n8n.' : `Configuração salva. Falta a chave do ${pname}.`) : 'Agente de IA desligado.');
      draw();
    } catch (ex) {
      toastError(ex);
    }
  });
  return undefined;
}

