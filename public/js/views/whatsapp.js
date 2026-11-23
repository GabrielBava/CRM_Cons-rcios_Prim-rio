// Comunicação › WhatsApp: todas as conversas com clientes (número oficial da empresa e números conectados pelo
// WhatsApp Lite), no jeito do WhatsApp: lista com filtros (Todas, Não lidas, Minhas), responsável pelas iniciais,
// cabeçalho com a etapa do lead no pipeline, fotos, documentos, áudio gravado, emojis e o painel "Ver" com o histórico
// do lead, a IA Vero e as ações que convertem a conversa (reunião, proposta e fechamento).
import { get, post, patch } from '../api.js';
import { html, raw, render, $, $$, on, state, modal, field, toast, toastError, empty, can, fmtDateTime, K } from '../ui.js';
import { icon } from '../icons.js';
import { quickCreateContact, newProposalFlow } from '../forms.js';
import { openLeadDrawer } from '../drawer.js';
import { scheduleMeetingDialog } from '../meeting.js';

const TICK = { pendente: '🕓', simulada: '✓', enviada: '✓', entregue: '✓✓', lida: '✓✓', falhou: '!' };
const EMOJIS = '😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😍 🥰 😘 😎 🤩 🤔 🤗 🙏 👍 👎 👏 🙌 💪 🤝 👋 ✌️ 👌 ✅ ❌ ⭐ 🔥 🎉 🎯 💰 💵 🏠 🚗 📈 📅 ⏰ 📞 💬 📄 ✍️ ❤️ 💙 😢 😮 😴 🤞 🙋 👀'.split(' ');
const KIND_PREFIX = { image: '📷 ', video: '🎥 ', audio: '🎤 ', document: '📄 ', sticker: '🏷️ ', location: '📍 ', contact: '👤 ', template: '📋 ' };
const saved = { filtro: '', q: '', canal: '' };

const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Hoje';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
};
const shortWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 86400000);
  if (d.toDateString() === new Date().toDateString()) return hm(iso);
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'ontem';
  return days < 7 ? d.toLocaleDateString('pt-BR', { weekday: 'long' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const initials = (n) => String(n || '?').replace(/^\+/, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
const hue = (s) => [...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const ava = (name, size = 44) => html`<span class="wa-ava" style="--h:${hue(name)};width:${size}px;height:${size}px">${initials(name)}<i class="wa-ava-badge">${icon('whatsapp', 11)}</i></span>`;
const counts = () => window.dispatchEvent(new Event('crm:comm-counts'));
const toB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => rej(new Error('Não foi possível ler o arquivo.'));
  r.readAsDataURL(blob);
});

const AI_NAME = 'IA Vero';

export async function whatsapp(view, openId, params, tabs) {
  let status = null;
  let lite = null;
  try {
    [status, lite] = await Promise.all([get('/api/whatsapp/status'), get('/api/whatsapp/lite').catch(() => null)]);
  } catch (e) {
    return render(view, html`<div class="page">${tabs}<div class="alert danger">${e.message}</div></div>`);
  }
  const officialReady = status.configured || status.sandbox;
  let liteInst = lite?.instances || [];
  const sendable = liteInst.filter((i) => i.my_access === 'enviar' && (i.status === 'conectado' || lite.sandbox));
  const nothing = !officialReady && !liteInst.length;
  // Como no WhatsApp Web: o usuário liga o próprio WhatsApp ao CRM lendo o QR Code com o celular
  const canLink = !!lite?.can_create && state.user.role !== 'leitura';
  const myLinked = () => liteInst.find((i) => i.owner_id === state.user.id && i.status === 'conectado');
  const welcome = () => {
    const mine = myLinked();
    const linkBox = mine
      ? html`<div class="wa-linked">${icon('confirmar', 18)}<span>Seu WhatsApp está conectado${mine.phone_label ? html` · <strong>${mine.phone_label}</strong>` : ''}</span></div>
        <button type="button" class="btn ghost small" data-act="link-wa">${icon('qrcode', 15)} Conectar outro número</button>`
      : canLink ? html`<button type="button" class="btn primary" data-act="link-wa">${icon('qrcode', 17)} Conectar meu WhatsApp</button>
        <small class="muted">Igual ao WhatsApp Web: aparece um QR Code e você lê com o celular (Business ou pessoal).</small>`
        : lite && !lite.can_create ? html`<div class="alert">O conector do WhatsApp Lite ainda não foi configurado.${state.user.role === 'admin' ? html` Configure em <a href="#/integracoes">Integrações › WhatsApp Lite</a>.` : ' Peça ao administrador.'}</div>` : '';
    return html`<div class="wa-empty">${icon('whatsapp', 56)}<h3>WhatsApp no CRM</h3>
      <p>Todas as conversas com clientes ficam aqui: o número oficial da empresa e o WhatsApp de cada especialista conectado por QR Code.</p>
      ${linkBox}
      <small class="muted">As mensagens entram no histórico do lead. O ícone do WhatsApp aparece no card do Pipeline de quem tem conversa.</small></div>`;
  };
  render(view, html`<div class="page wide comm-page wa-page">${tabs}
    ${nothing && !canLink ? html`<div class="alert warn"><strong>Nenhum WhatsApp conectado ainda.</strong> ${state.user.role === 'admin' ? html`Configure o conector do WhatsApp Lite em <a href="#/integracoes">Integrações › WhatsApp Lite</a> ou o número oficial da empresa em <a href="#/configuracoes/integracoes">Configurações › Integrações</a>.` : 'Peça ao administrador para configurar o conector do WhatsApp Lite.'}</div>` : ''}
    <div class="wa-shell" data-shell>
      <aside class="wa-list">
        <div class="wa-list-head"><h2>Conversas</h2><span class="grow"></span>${canLink ? html`<button type="button" class="icon" data-act="link-wa" title="Conectar meu WhatsApp (QR Code)" aria-label="Conectar meu WhatsApp pelo QR Code">${icon('qrcode', 19)}</button>` : ''}<button type="button" class="icon" data-act="new" title="Nova conversa" aria-label="Nova conversa">${icon('adicionar', 20)}</button></div>
        <label class="wa-search">${icon('buscar', 16)}<input type="search" placeholder="Buscar conversas e mensagens…" data-q value="${saved.q}" aria-label="Buscar conversas e mensagens"></label>
        <div class="wa-chips">${[['', 'Todas'], ['nao_lidas', 'Não lidas'], ['minhas', 'Minhas']].map(([k, l]) => html`<button type="button" class="wa-chip ${saved.filtro === k ? 'on' : ''}" data-wf="${k}">${l}</button>`)}
          <span class="grow"></span><button type="button" class="icon ${saved.canal ? 'on' : ''}" data-act="filters" title="Filtrar por número" aria-label="Filtrar por número">${icon('filtro', 17)}</button></div>
        <div class="wa-numbers" data-numbers ${saved.canal ? '' : 'hidden'}><select data-canal aria-label="Número">
          <option value="">Todos os números</option>${officialReady ? html`<option value="oficial" ${saved.canal === 'oficial' ? 'selected' : ''}>WhatsApp oficial${status.display_number ? ` · ${status.display_number}` : ''}</option>` : ''}
          ${liteInst.map((i) => html`<option value="i${i.id}" ${saved.canal === `i${i.id}` ? 'selected' : ''}>Lite · ${i.name}${i.phone_label ? ` · ${i.phone_label}` : ''}</option>`)}</select></div>
        <div class="wa-items" data-items><p class="muted small pad">Carregando…</p></div>
      </aside>
      <section class="wa-main" data-main>${welcome()}</section>
      <aside class="wa-side" data-side hidden></aside>
    </div></div>`);

  let list = [];
  let conv = null;
  let convData = null;
  let lastId = 0;
  let timer = null;
  let listTimer = null;
  let rec = null;
  let linkTimer = null;
  const shell = $('[data-shell]', view);

  /* ---------- Conectar o WhatsApp pelo QR Code (como no WhatsApp Web) ---------- */
  const stopLink = () => {
    clearInterval(linkTimer);
    linkTimer = null;
  };
  const showWelcome = () => {
    stopLink();
    render($('[data-main]', view), welcome());
  };
  const drawLink = (r) => render($('[data-main]', view), html`<div class="wa-link">
    <header class="wa-link-head"><button type="button" class="icon wa-back" data-act="back" aria-label="Voltar">${icon('voltar', 20)}</button><strong>Conectar meu WhatsApp</strong><span class="grow"></span><button type="button" class="icon" data-act="link-cancel" aria-label="Fechar">×</button></header>
    ${r.status === 'conectado' ? html`<div class="wa-link-done">${icon('confirmar', 44)}<h3>WhatsApp conectado</h3><p>${r.phone_label || r.name} está ligado ao CRM. As conversas com os seus clientes aparecem na lista ao lado.</p>
        <button type="button" class="btn primary" data-act="link-cancel">Ver conversas</button></div>`
    : html`<div class="wa-link-body">
      <div class="wa-link-steps"><h3>Use o seu WhatsApp no CRM</h3>
        <ol><li>Abra o <strong>WhatsApp</strong> no celular (Business ou pessoal).</li>
          <li>Toque em <strong>Mais opções ⋮</strong> (Android) ou <strong>Configurações</strong> (iPhone) e depois em <strong>Aparelhos conectados</strong>.</li>
          <li>Toque em <strong>Conectar um aparelho</strong> e aponte o celular para esta tela para ler o QR Code.</li></ol>
        <label class="check wa-link-known"><input type="checkbox" data-known ${r.only_known === false ? '' : 'checked'}><span>Registrar só conversas com clientes do CRM<small class="muted">Amigos e família do número pessoal ficam fora.</small></span></label>
        <p class="wa-link-mobile alert">No celular, abra esta tela no computador: o QR Code precisa ser lido por outro aparelho.</p>
        <p class="small muted">O celular continua funcionando normalmente. Para desligar: no celular, em Aparelhos conectados, ou em Integrações › WhatsApp Lite.</p></div>
      <div class="wa-link-qr"><div class="qr-box">${r.qr ? html`<img src="${r.qr}" alt="QR Code para conectar o WhatsApp" width="264" height="264">` : html`<div class="qr-wait">Gerando o QR Code…</div>`}</div>
        <button type="button" class="btn ghost small" data-act="link-newqr">${icon('historico', 14)} Gerar outro QR Code</button>
        ${r.sandbox ? html`<div class="alert">Modo de teste: o QR Code é ilustrativo. <button type="button" class="btn small primary" data-act="link-sim">Simular leitura</button></div>` : ''}</div>
    </div>`}</div>`);
  let linking = null;
  const linkWa = async (fresh = false) => {
    shell.classList.add('has-conv');
    stopLink();
    clearInterval(timer);
    conv = null;
    drawList();
    render($('[data-main]', view), html`<div class="wa-empty"><div class="qr-wait">Gerando o QR Code…</div></div>`);
    try {
      // Reaproveita a conexão do próprio usuário que ainda não terminou de parear
      const pending = !fresh && ((linking && linking.status !== 'conectado' && linking) || liteInst.find((i) => i.owner_id === state.user.id && i.status !== 'conectado'));
      const first = String(state.user.name || '').split(' ')[0];
      linking = pending
        ? await post(`/api/whatsapp/lite/instancias/${pending.id}/reconectar`)
        : await post('/api/whatsapp/lite/instancias', { name: myLinked() ? `WhatsApp ${liteInst.filter((i) => i.owner_id === state.user.id).length + 1} de ${first}` : `WhatsApp de ${first}`, only_known: true });
    } catch (e) {
      toastError(e);
      return showWelcome();
    }
    if (!liteInst.some((i) => i.id === linking.id)) liteInst = [...liteInst, linking];
    drawLink(linking);
    linkTimer = setInterval(async () => {
      if (!view.isConnected) return stopLink();
      try {
        const n = await get(`/api/whatsapp/lite/instancias/${linking.id}`);
        const changed = n.status !== linking.status || n.qr !== linking.qr;
        linking = { ...linking, ...n };
        if (changed) drawLink(linking);
        if (n.status === 'conectado') linked();
      } catch { /* mantém a tela */ }
      return undefined;
    }, 3000);
    return undefined;
  };
  const linked = async () => {
    stopLink();
    toast('WhatsApp conectado ao CRM.');
    try {
      lite = await get('/api/whatsapp/lite');
      liteInst = lite.instances || [];
    } catch { /* segue com a lista atual */ }
    loadList();
  };

  /* ---------- Lista ---------- */
  const preview = (c) => {
    const txt = c.last_body ? `${KIND_PREFIX[c.last_kind] || ''}${c.last_body}` : 'Sem mensagens';
    return html`${c.last_direction === 'out' ? html`<span class="tick ${c.last_status}">${TICK[c.last_status] || ''}</span> ` : ''}${txt}`;
  };
  const drawList = () => render($('[data-items]', view), list.length ? html`${list.map((c) => html`<button type="button" class="wa-item ${conv?.id === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''}" data-wc="${c.id}">
      ${ava(c.name)}
      <span class="wa-item-body"><span class="wa-item-top"><strong>${c.name}</strong><small>${shortWhen(c.last_message_at || c.created_at)}</small></span>
        <span class="wa-item-last"><span>${preview(c)}</span>
          <span class="wa-item-tags">${c.unread ? html`<b class="wa-unread">${c.unread}</b>` : ''}${c.owner_initials ? html`<i class="wa-owner" title="Responsável: ${c.owner_name}">${c.owner_initials}</i>` : ''}</span></span>
        <span class="wa-item-meta">${c.stage ? html`<span class="wa-stage st-${c.stage.key || 'x'}">${c.stage.name}</span>` : !c.contact_id ? html`<span class="wa-stage none">Sem cadastro</span>` : ''}${c.ai_status === 'ativa' ? html`<span class="wa-ai-tag" title="IA atendendo">${icon('ia', 11)} IA</span>` : ''}<small>${c.channel === 'lite' ? c.instance_name || 'Lite' : 'Oficial'}</small></span></span>
    </button>`)}` : empty(saved.filtro === 'minhas' ? 'Nenhuma conversa com clientes seus.' : saved.filtro === 'nao_lidas' ? 'Tudo lido por aqui.' : 'Nenhuma conversa ainda.'));
  const loadList = async () => {
    const q = { filtro: saved.filtro, q: saved.q };
    if (saved.canal === 'oficial') q.canal = 'oficial';
    else if (saved.canal.startsWith('i')) q.instancia = saved.canal.slice(1);
    try {
      list = await get('/api/whatsapp/conversas', q);
    } catch (e) {
      return toastError(e);
    }
    drawList();
    return list;
  };

  /* ---------- Mensagens ---------- */
  const media = (m) => {
    if (!m.media_url) return '';
    if (m.kind === 'image' || m.kind === 'sticker') return html`<a href="${m.media_url}" target="_blank" rel="noopener" class="wa-img ${m.kind}"><img src="${m.media_url}" alt="${m.kind === 'sticker' ? 'Figurinha' : 'Foto'}" loading="lazy"></a>`;
    if (m.kind === 'audio') return html`<div class="wa-audio">${icon('microfone', 16)}<audio controls preload="none" src="${m.media_url}"></audio>${m.duration ? html`<small>${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}</small>` : ''}</div>`;
    if (m.kind === 'video') return html`<video class="wa-video" controls preload="metadata" src="${m.media_url}"></video>`;
    return html`<a class="wa-doc" href="${m.media_url}" target="_blank" rel="noopener">${icon('documentos', 22)}<span><strong>${m.filename || 'Documento'}</strong><small>${(m.media_mime || '').split('/')[1]?.toUpperCase() || 'Arquivo'}</small></span>${icon('baixar', 16)}</a>`;
  };
  const showText = (m) => m.body && !(m.media_url && (m.body === m.filename || ['Foto', 'Áudio', 'Vídeo', 'Figurinha', 'Documento'].includes(m.body)));
  const msgHtml = (m, prev) => {
    const sep = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString() ? html`<div class="wa-day"><span>${dayLabel(m.created_at)}</span></div>` : '';
    if (m.system) return html`${sep}<div class="wa-sys">${m.text} · ${m.by} · ${hm(m.created_at)}</div>`;
    const mine = m.direction === 'out';
    return html`${sep}<div class="wa-row ${mine ? 'mine' : ''}" data-mid="${m.id}"><div class="wa-bubble ${m.kind} ${m.status === 'falhou' ? 'failed' : ''}">
      ${mine && m.user_name ? html`<b class="wa-by">${m.user_name}</b>` : ''}
      ${m.kind === 'template' ? html`<small class="muted">Modelo aprovado</small>` : ''}
      ${media(m)}
      ${showText(m) ? html`<p>${m.body}</p>` : ''}
      ${m.error ? html`<small class="danger-text">${m.error}</small>` : ''}
      <small class="wa-time">${hm(m.created_at)}${mine ? html` <span class="tick ${m.status}" data-st="${m.id}" title="${m.status}">${TICK[m.status] || ''}</span>` : ''}</small></div></div>`;
  };
  const timeline = (d) => [...d.messages, ...(d.events || []).map((e) => ({ system: true, created_at: e.at, text: e.text, by: e.by }))]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const header = (c) => html`<header class="wa-head"><button type="button" class="icon wa-back" data-act="back" aria-label="Voltar">${icon('voltar', 20)}</button>
      ${ava(c.name, 40)}
      <button type="button" class="wa-head-who" data-act="side" title="Ver detalhes do lead"><strong>${c.name}</strong><small>${c.phone}${c.profile_name && c.contact_name && c.profile_name !== c.contact_name ? ` · no WhatsApp: ${c.profile_name}` : ''}</small></button>
      ${c.stage ? html`<button type="button" class="wa-stage-pill st-${c.stage.key || 'x'}" data-act="lead" title="Etapa no pipeline — abrir o lead"><i></i>${c.stage.name}</button>` : c.contact_id ? html`<span class="wa-stage-pill none"><i></i>Sem negócio aberto</span>` : html`<button type="button" class="wa-stage-pill none" data-act="link"><i></i>Sem cadastro · vincular</button>`}
      ${c.owner_initials ? html`<i class="wa-owner lg" title="Responsável: ${c.owner_name}">${c.owner_initials}</i>` : ''}
      <span class="grow"></span>
      <small class="wa-channel">${c.channel_label}</small>
      <a class="icon" href="tel:+${String(c.phone).replace(/\D/g, '')}" title="Ligar" aria-label="Ligar">${icon('telefone', 18)}</a>
      <button type="button" class="icon" data-act="close" title="${c.status === 'encerrada' ? 'Reabrir conversa' : 'Arquivar (encerrar) conversa'}" aria-label="Arquivar">${icon(c.status === 'encerrada' ? 'entrada' : 'cadastros', 18)}</button>
      <button type="button" class="icon wa-ver" data-act="side" title="Ver: histórico do lead, IA Vero e conversão" aria-label="Ver">${icon('historico', 18)}<span>Ver</span></button>
      <button type="button" class="icon wa-ia" data-act="ia" title="Perguntar à IA Vero" aria-label="IA Vero">${icon('ia', 18)}</button>
      <div class="menu-wrap"><button type="button" class="icon" data-act="more" aria-label="Mais opções">${icon('pontos', 18)}</button>
        <div class="pop" hidden>${c.contact_id ? html`<button type="button" data-act="lead">${icon('leads', 15)} Abrir lead</button>` : html`<button type="button" data-act="link">${icon('link', 15)} Vincular cadastro</button><button type="button" data-act="create">${icon('adicionar', 15)} Criar lead</button>`}
          ${can.manage() ? html`<button type="button" data-act="assign">${icon('usuarios', 15)} Responsável</button>` : ''}
          ${c.contact_id ? html`<button type="button" data-act="unlink">${icon('link', 15)} Trocar cadastro</button>` : ''}</div></div>
    </header>
    ${c.channel === 'oficial' && !c.window_open ? html`<div class="wa-window closed">Fora da janela de 24 horas da API oficial: envie o modelo aprovado (botão + › Modelo aprovado). Quando o cliente responder, a conversa reabre.</div>` : ''}`;

  // Agente de IA do número central: quem está atendendo e o botão para assumir ou devolver
  const aiBar = (d) => {
    const a = d.agent;
    if (!a || (!a.handles && !a.status)) return '';
    if (a.status === 'ativa') {
      return html`<div class="wa-aibar on" data-aibar>${icon('ia', 16)}<span><b>IA atendendo</b> · a ${AI_NAME} conversa, qualifica e agenda a R1. Se você responder, a IA para.</span>
        ${a.can_control ? html`<button type="button" class="btn small" data-act="ai-take">Assumir conversa</button>` : ''}</div>`;
    }
    return html`<div class="wa-aibar" data-aibar>${icon('ia', 16)}<span><b>${a.label || 'Com o especialista'}</b>${a.reason ? ` · ${a.reason}` : ''}</span>
      ${a.can_control && a.handles ? html`<button type="button" class="btn small ghost" data-act="ai-give">Devolver para a IA</button>` : ''}</div>`;
  };

  const composer = (d) => {
    const c = d.conversation;
    const canType = d.can_send && c.window_open;
    if (!d.can_send) return html`<div class="wa-compose readonly">${icon('olho', 16)} ${c.channel === 'lite' ? 'Seu acesso a este número é "Só ver".' : 'Você não pode enviar por este número.'}</div>`;
    return html`<form class="wa-compose" data-compose>
      <div class="menu-wrap up"><button type="button" class="icon" data-act="plus" aria-label="Anexar">${icon('adicionar', 20)}</button>
        <div class="pop" hidden><button type="button" data-act="pick-image">${icon('imagem', 15)} Foto ou vídeo</button><button type="button" data-act="pick-doc">${icon('documentos', 15)} Documento</button>
          ${c.channel === 'oficial' ? html`<button type="button" data-act="template">${icon('lista', 15)} Modelo aprovado</button>` : ''}</div></div>
      <button type="button" class="icon" data-act="pick-doc" title="Anexar arquivo (até ${d.max_file_mb} MB)" aria-label="Anexar arquivo">${icon('anexo', 19)}</button>
      <input type="file" data-file="image" accept="image/*,video/*" hidden><input type="file" data-file="doc" hidden>
      <div class="wa-input"><textarea name="body" rows="1" ${canType ? '' : raw('disabled')} placeholder="${canType ? 'Mensagem' : 'Fora da janela de 24 horas: use o modelo aprovado'}" aria-label="Mensagem"></textarea>
        <button type="button" class="icon" data-act="emoji" aria-label="Emojis">${icon('emoji', 19)}</button>
        <div class="wa-emojis" data-emojis hidden>${EMOJIS.map((e) => html`<button type="button" data-emoji="${e}">${e}</button>`)}</div></div>
      <button type="submit" class="wa-send" data-sendbtn hidden aria-label="Enviar">${icon('enviar', 18)}</button>
      <button type="button" class="wa-mic" data-act="mic" ${canType ? '' : raw('disabled')} title="${c.channel === 'oficial' ? 'Gravar áudio (no número oficial, o navegador precisa gravar em OGG)' : 'Gravar áudio'}" aria-label="Gravar áudio">${icon('microfone', 19)}</button>
    </form>`;
  };

  const openConv = async (id, { silent = false } = {}) => {
    clearInterval(timer);
    stopLink();
    let d;
    try {
      d = await get(`/api/whatsapp/conversas/${id}`);
    } catch (e) {
      return toastError(e);
    }
    convData = d;
    conv = d.conversation;
    if (!silent) history.replaceState(null, '', `#/comunicacao/whatsapp/${id}`);
    shell.classList.add('has-conv');
    const items = timeline(d);
    lastId = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
    render($('[data-main]', view), html`${header(conv)}${aiBar(d)}
      <div class="wa-msgs" data-msgs>${items.length ? items.map((m, i) => msgHtml(m, items[i - 1])) : html`<p class="wa-sys">Nenhuma mensagem ainda. Diga olá!</p>`}</div>
      ${composer(d)}`);
    const box = $('[data-msgs]', view);
    box.scrollTop = box.scrollHeight;
    const row = list.find((x) => x.id === conv.id);
    if (row) row.unread = conv.unread || 0;
    drawList();
    counts();
    if (!$('[data-side]', view).hidden) drawSide();
    timer = setInterval(poll, 5000);
    return d;
  };
  const poll = async () => {
    if (!conv || !view.isConnected) return;
    let d;
    try {
      d = await get(`/api/whatsapp/conversas/${conv.id}`, { after_id: lastId });
    } catch {
      return;
    }
    const box = $('[data-msgs]', view);
    if (!box) return;
    for (const s of d.statuses) {
      const el = box.querySelector(`[data-st="${s.id}"]`);
      if (el && !el.classList.contains(s.status)) {
        el.className = `tick ${s.status}`;
        el.textContent = TICK[s.status] || '';
      }
    }
    if (d.conversation.window_open !== conv.window_open || (d.agent?.status || null) !== (convData?.agent?.status || null)) return openConv(conv.id, { silent: true });
    if (!d.messages.length) return;
    let prev = { created_at: d.messages[0].created_at };
    const last = box.querySelector('[data-mid]:last-of-type');
    if (last) prev = { created_at: new Date().toISOString() };
    for (const m of d.messages) {
      if (!box.querySelector(`[data-mid="${m.id}"]`)) box.insertAdjacentHTML('beforeend', String(msgHtml(m, prev)));
      prev = m;
    }
    lastId = d.messages[d.messages.length - 1].id;
    box.scrollTop = box.scrollHeight;
    loadList();
  };
  const append = (m) => {
    const box = $('[data-msgs]', view);
    if (!box) return;
    box.querySelector(':scope > .wa-sys:only-child')?.remove();
    box.insertAdjacentHTML('beforeend', String(msgHtml(m, { created_at: new Date().toISOString() })));
    lastId = Math.max(lastId, m.id);
    box.scrollTop = box.scrollHeight;
  };
  const send = async (payload) => {
    try {
      const m = await post(`/api/whatsapp/conversas/${conv.id}/mensagens`, payload);
      append(m);
      loadList();
      return m;
    } catch (e) {
      toastError(e);
      if (conv) openConv(conv.id, { silent: true });
      return null;
    }
  };

  /* ---------- Anexos e áudio ---------- */
  const sendFile = async (file) => {
    if (!file) return;
    const max = (convData?.max_file_mb || 3) * 1024 * 1024;
    if (file.size > max) return toastError(new Error(`"${file.name}" passa de ${convData?.max_file_mb || 3} MB.`));
    const isImg = /^image\//.test(file.type);
    const url = isImg ? URL.createObjectURL(file) : null;
    const r = await modal({
      title: 'Enviar arquivo',
      body: html`<div class="wa-preview">${isImg ? html`<img src="${url}" alt="">` : html`<div class="wa-doc">${icon('documentos', 24)}<span><strong>${file.name}</strong><small>${Math.max(1, Math.round(file.size / 1024))} KB</small></span></div>`}</div>
        ${field({ name: 'caption', label: 'Legenda (opcional)', full: true })}`,
      submitLabel: 'Enviar',
      onSubmit: async (d) => send({ body: d.caption || '', attachment: { name: file.name, mime: file.type || 'application/octet-stream', data: await toB64(file) } }),
    });
    if (url) URL.revokeObjectURL(url);
    return r;
  };
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toastError(new Error('Este navegador não grava áudio. Use o Chrome ou o Edge atualizados.'));
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toastError(new Error('Libere o microfone para gravar o áudio.'));
    }
    const type = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    const started = Date.now();
    rec = { mr, stream, cancel: false };
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const bar = $('[data-recbar]', view);
      bar?.remove();
      $('[data-compose]', view)?.classList.remove('recording');
      const cancelled = rec?.cancel;
      rec = null;
      clearInterval(tick);
      if (cancelled || !chunks.length) return;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const ext = /ogg/.test(blob.type) ? 'ogg' : /mp4/.test(blob.type) ? 'm4a' : 'webm';
      await send({ voice: true, duration: Math.round((Date.now() - started) / 1000), attachment: { name: `audio.${ext}`, mime: blob.type.split(';')[0], data: await toB64(blob) } });
    };
    mr.start();
    const form = $('[data-compose]', view);
    form.classList.add('recording');
    form.insertAdjacentHTML('beforeend', '<div class="wa-recbar" data-recbar><button type="button" class="icon" data-act="rec-cancel" aria-label="Cancelar gravação">✕</button><span class="rec-dot"></span><span data-rectime>0:00</span><button type="button" class="wa-send" data-act="rec-send" aria-label="Enviar áudio">➤</button></div>');
    const tick = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      const el = $('[data-rectime]', view);
      if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= 300) mr.stop();
    }, 500);
    return undefined;
  };

  /* ---------- Painel "Ver": histórico do lead, IA Vero e conversão ---------- */
  let sideTab = 'resumo';
  let aiThread = null;
  const drawSide = async () => {
    const side = $('[data-side]', view);
    side.hidden = false;
    shell.classList.add('has-side');
    // A coluna da conversa fica mais estreita: mantém a última mensagem à vista
    const box = $('[data-msgs]', view);
    if (box) box.scrollTop = box.scrollHeight;
    if (!conv) return;
    if (!conv.contact_id) {
      render(side, html`<header class="wa-side-head"><strong>Ver</strong><button type="button" class="icon" data-act="side-close" aria-label="Fechar">×</button></header>
        <div class="wa-side-body"><p>Esta conversa ainda não está ligada a um cadastro.</p><button type="button" class="btn primary block" data-act="link">Vincular cadastro</button><button type="button" class="btn block" data-act="create">Criar lead</button></div>`);
      return;
    }
    if (conv.contact_visible === false) {
      render(side, html`<header class="wa-side-head"><strong>Ver · ${conv.contact_name}</strong><button type="button" class="icon" data-act="side-close" aria-label="Fechar">×</button></header>
        <div class="wa-side-body"><div class="wa-lead-top"><span class="avatar-ini">${conv.owner_initials || '?'}</span><div><strong>${conv.contact_name}</strong><small class="muted">${conv.stage ? conv.stage.name : 'Lead'} · responsável: ${conv.owner_name || '—'}</small></div></div>
          <p class="small muted">Este lead é de outro especialista. Com o acesso a este número você acompanha as mensagens; o cadastro, a IA Vero e a conversão ficam com o responsável, o líder e o administrador.</p></div>`);
      return;
    }
    render(side, html`<header class="wa-side-head"><strong>Ver · ${conv.contact_name}</strong><button type="button" class="icon" data-act="side-close" aria-label="Fechar">×</button></header>
      <nav class="wa-side-tabs">${[['resumo', 'Lead'], ['ia', 'IA Vero'], ['historico', 'Histórico']].map(([k, l]) => html`<button type="button" class="${sideTab === k ? 'on' : ''}" data-stab="${k}">${l}</button>`)}</nav>
      <div class="wa-side-body" data-sbody><p class="muted small">Carregando…</p></div>`);
    const body = $('[data-sbody]', side);
    try {
      if (sideTab === 'resumo') {
        const c = await get(`/api/cadastros/${conv.contact_id}`);
        const opp = (c.opportunities || []).find((o) => o.status === 'aberta') || (c.opportunities || [])[0];
        const r2 = opp && ['r1', 'qualificacao', 'r2'].includes(opp.stage_key);
        render(body, html`<div class="wa-lead">
            <div class="wa-lead-top">${ava(c.name, 48)}<div><strong>${c.name}</strong><small>${c.code} · ${conv.phone}</small>${c.email ? html`<small>${c.email}</small>` : ''}</div></div>
            <dl><dt>Etapa</dt><dd>${opp ? html`<span class="wa-stage st-${opp.stage_key || 'x'}">${opp.stage_name}</span>` : '—'}</dd>
              <dt>Responsável</dt><dd>${c.owner_name || '—'}</dd>
              ${opp?.credit_value ? html`<dt>Crédito</dt><dd>${Number(opp.credit_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</dd>` : ''}
              ${opp?.next_action ? html`<dt>Próxima ação</dt><dd>${opp.next_action}</dd>` : ''}</dl></div>
          <h4>Converter esta conversa</h4>
          <div class="wa-convert">
            <button type="button" class="btn" data-conv="meeting" data-kind="${r2 ? 'r2' : 'r1'}">${icon('calendario', 16)} Agendar ${r2 ? 'R2' : 'reunião (R1)'}</button>
            <button type="button" class="btn" data-conv="proposal">${icon('propostas', 16)} Gerar proposta</button>
            <button type="button" class="btn" data-conv="close">${icon('confirmar', 16)} Fechamento</button>
          </div>
          <button type="button" class="link-btn" data-act="lead">Abrir o lead completo →</button>`);
        body._contact = c;
        body._opp = opp;
      } else if (sideTab === 'historico') {
        const h = await get(`/api/cadastros/${conv.contact_id}/historico`, { limit: 30 });
        const rows = (h.rows || []).slice(0, 30);
        render(body, rows.length ? html`<ul class="wa-hist">${rows.map((a) => html`<li><span class="wa-hist-dot ${a.channel || ''}"></span><div><strong>${K('activity_types', a.type)}</strong>${a.notes ? html`<p>${String(a.notes).slice(0, 220)}</p>` : ''}<small class="muted">${fmtDateTime(a.occurred_at || a.created_at)}${a.user_name ? ` · ${a.user_name}` : ''}</small></div></li>`)}</ul>` : empty('Sem histórico ainda.'));
      } else {
        render(body, html`<p class="small muted">Pergunte sobre este lead e esta conversa: a IA Vero usa o cadastro, o negócio e o histórico (inclusive as mensagens do WhatsApp).</p>
          <div class="wa-ai-quick">${['Resuma a conversa e o momento do cliente', 'Qual o próximo passo para levar a uma reunião?', 'Como converter em proposta?', 'Escreva uma resposta para a última mensagem'].map((q) => html`<button type="button" class="chip" data-aiq="${q}">${q}</button>`)}</div>
          <div class="wa-ai-log" data-ailog></div>
          <form class="wa-ai-form" data-aiform><textarea name="q" rows="2" placeholder="Pergunte algo à IA Vero…" aria-label="Pergunta para a IA Vero"></textarea><button type="submit" class="btn primary">${icon('enviar', 15)}</button></form>`);
      }
    } catch (e) {
      render(body, html`<p class="error">${e.message}</p>`);
    }
  };
  const askAi = async (q) => {
    const log = $('[data-ailog]', view);
    if (!log || !q) return;
    log.insertAdjacentHTML('beforeend', String(html`<div class="wa-ai-q">${q}</div><div class="wa-ai-a pending">Pensando…</div>`));
    log.scrollTop = log.scrollHeight;
    const pend = log.querySelector('.pending');
    try {
      const r = await post(`/api/ia/leads/${conv.contact_id}/conversa`, { message: q, thread: aiThread });
      aiThread = r.thread;
      pend.classList.remove('pending');
      pend.innerHTML = String(html`<p>${r.answer}</p>${convData?.can_send ? html`<button type="button" class="link-btn" data-aiuse>Usar como resposta</button>` : ''}`);
      pend.querySelector('[data-aiuse]')?.addEventListener('click', () => {
        const t = $('[data-compose] [name=body]', view);
        if (t && !t.disabled) {
          t.value = r.answer;
          t.dispatchEvent(new Event('input', { bubbles: true }));
          t.focus();
        }
      });
    } catch (e) {
      pend.textContent = e.message;
    }
    log.scrollTop = log.scrollHeight;
  };

  /* ---------- Ações ---------- */
  const pickContact = (title) => modal({
    title,
    body: html`<div class="field full"><label>Buscar cadastro</label><input type="search" name="q" placeholder="Nome, código, telefone ou e-mail" autocomplete="off"></div><div class="pick-list" data-pl></div>`,
    onMount(form, close) {
      let t;
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = form.q.value.trim();
          if (q.length < 2) return (form.querySelector('[data-pl]').innerHTML = '');
          const r = await get('/api/cadastros', { q, limit: 8 }).catch(() => ({ rows: [] }));
          form.querySelector('[data-pl]').innerHTML = String(r.rows.length ? html`${r.rows.map((c) => html`<button type="button" class="pick-item" data-pick="${c.id}"><strong>${c.name}</strong><small>${c.code}${c.whatsapp || c.phone1 ? ` · ${c.whatsapp || c.phone1}` : ''}</small></button>`)}` : html`<p class="muted small">Nenhum cadastro encontrado.</p>`);
          return undefined;
        }, 250);
      });
      on(form, 'click', '[data-pick]', (e, b) => close(Number(b.dataset.pick)));
      form.q.focus();
    },
  });
  /** Número para iniciar a conversa: oficial ou um WhatsApp Lite com "Ver e enviar". */
  const pickNumber = async () => {
    const options = [...(officialReady ? [{ value: '', label: `WhatsApp oficial da empresa${status.display_number ? ` · ${status.display_number}` : ''}` }] : []),
      ...sendable.map((i) => ({ value: String(i.id), label: `WhatsApp Lite · ${i.name}${i.phone_label ? ` · ${i.phone_label}` : ''}` }))];
    if (!options.length) throw new Error('Nenhum número disponível para você enviar. Conecte o seu em Integrações › WhatsApp Lite.');
    if (options.length === 1) return options[0].value;
    return modal({
      title: 'Por qual número?',
      body: field({ name: 'n', label: 'Número', type: 'select', options, value: options.find((o) => o.value)?.value || '', full: true }),
      submitLabel: 'Continuar',
      onSubmit: (d) => d.n ?? '',
    });
  };
  const startWith = async (contactId) => {
    const n = await pickNumber();
    if (n === null || n === undefined) return null;
    const r = await post('/api/whatsapp/conversas', { contact_id: contactId, ...(n ? { instance_id: Number(n) } : {}) });
    await loadList();
    return openConv(r.id);
  };

  on(view, 'click', '[data-wc]', (e, b) => openConv(b.dataset.wc));
  on(view, 'click', '[data-wf]', (e, b) => {
    saved.filtro = b.dataset.wf;
    $$('[data-wf]', view).forEach((x) => x.classList.toggle('on', x === b));
    loadList();
  });
  on(view, 'click', '[data-act=filters]', (e, b) => {
    const n = $('[data-numbers]', view);
    n.hidden = !n.hidden;
    b.classList.toggle('on', !n.hidden || !!saved.canal);
  });
  on(view, 'change', '[data-canal]', (e, s) => {
    saved.canal = s.value;
    loadList();
  });
  let qt;
  on(view, 'input', '[data-q]', (e, inp) => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      saved.q = inp.value;
      loadList();
    }, 300);
  });
  on(view, 'input', '[data-compose] textarea', (e, t) => {
    t.style.height = 'auto';
    t.style.height = `${Math.min(140, t.scrollHeight)}px`;
    const has = !!t.value.trim();
    $('[data-sendbtn]', view).hidden = !has;
    $('[data-act=mic]', view).hidden = has;
  });
  on(view, 'submit', '[data-compose]', async (e, f) => {
    e.preventDefault();
    const body = f.body.value.trim();
    if (!body) return;
    f.body.value = '';
    f.body.dispatchEvent(new Event('input', { bubbles: true }));
    await send({ body });
    f.body.focus();
  });
  on(view, 'keydown', '[data-compose] textarea', (e, t) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      t.form.requestSubmit();
    }
  });
  const togglePop = (b) => {
    const pop = b.parentElement.querySelector('.pop');
    $$('.pop', view).forEach((p) => p !== pop && (p.hidden = true));
    pop.hidden = !pop.hidden;
  };
  on(view, 'click', '[data-act=more]', (e, b) => togglePop(b));
  on(view, 'click', '[data-act=plus]', (e, b) => togglePop(b));
  on(view, 'click', '[data-act=pick-image]', () => $('[data-file=image]', view)?.click());
  on(view, 'click', '[data-act=pick-doc]', () => $('[data-file=doc]', view)?.click());
  on(view, 'change', '[data-file]', async (e, inp) => {
    const f = inp.files?.[0];
    inp.value = '';
    $$('.pop', view).forEach((p) => (p.hidden = true));
    await sendFile(f);
  });
  on(view, 'click', '[data-act=emoji]', () => {
    const p = $('[data-emojis]', view);
    p.hidden = !p.hidden;
  });
  on(view, 'click', '[data-emoji]', (e, b) => {
    const t = $('[data-compose] [name=body]', view);
    const s = t.selectionStart ?? t.value.length;
    t.value = `${t.value.slice(0, s)}${b.dataset.emoji}${t.value.slice(t.selectionEnd ?? s)}`;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.focus();
    t.setSelectionRange(s + b.dataset.emoji.length, s + b.dataset.emoji.length);
  });
  on(view, 'click', '[data-act=mic]', () => startRecording());
  on(view, 'click', '[data-act=rec-send]', () => rec?.mr.state === 'recording' && rec.mr.stop());
  on(view, 'click', '[data-act=rec-cancel]', () => {
    if (rec) {
      rec.cancel = true;
      rec.mr.stop();
    }
  });
  on(view, 'click', '[data-act=template]', async () => {
    const st = status.template || {};
    const r = await modal({
      title: 'Enviar modelo aprovado',
      body: html`<p class="hint">Na API oficial, fora das 24 horas, a Meta só permite iniciar a conversa com um modelo (template) aprovado. Se o modelo tiver variáveis ({{1}}, {{2}}…), preencha na ordem.</p><div class="grid">
        ${field({ name: 'template', label: 'Nome do modelo', value: st.name || '', required: true, placeholder: 'ex.: retomar_contato' })}
        ${field({ name: 'language', label: 'Idioma', value: st.language || 'pt_BR' })}
        ${field({ name: 'p1', label: 'Variável {{1}} (opcional)', value: conv?.contact_name?.split(' ')[0] || '' })}
        ${field({ name: 'p2', label: 'Variável {{2}} (opcional)' })}</div>`,
      submitLabel: 'Enviar modelo',
      onSubmit: (d) => send({ template: d.template, language: d.language, params: [d.p1, d.p2].filter(Boolean) }),
    });
    if (r) toast('Modelo enviado.');
  });
  on(view, 'click', '[data-act=side]', () => {
    const side = $('[data-side]', view);
    if (!side.hidden && sideTab !== 'ia') {
      side.hidden = true;
      shell.classList.remove('has-side');
      return;
    }
    sideTab = sideTab === 'ia' ? 'resumo' : sideTab;
    drawSide();
  });
  on(view, 'click', '[data-act=ia]', () => {
    sideTab = 'ia';
    drawSide();
  });
  on(view, 'click', '[data-act=side-close]', () => {
    $('[data-side]', view).hidden = true;
    shell.classList.remove('has-side');
  });
  on(view, 'click', '[data-stab]', (e, b) => {
    sideTab = b.dataset.stab;
    drawSide();
  });
  on(view, 'click', '[data-aiq]', (e, b) => askAi(b.dataset.aiq));
  on(view, 'submit', '[data-aiform]', (e, f) => {
    e.preventDefault();
    const q = f.q.value.trim();
    f.q.value = '';
    askAi(q);
  });
  on(view, 'click', '[data-conv]', async (e, b) => {
    const body = $('[data-sbody]', view);
    const c = body?._contact;
    const opp = body?._opp;
    if (!c) return;
    let ok = null;
    if (b.dataset.conv === 'meeting') ok = await scheduleMeetingDialog({ contactId: c.id, oppId: opp?.id, kind: b.dataset.kind, moveTo: true });
    else if (b.dataset.conv === 'proposal') {
      if (!opp) return toastError(new Error('Crie um negócio para o lead antes de gerar a proposta.'));
      ok = await newProposalFlow({ ...opp, contact_name: c.name }, c);
    } else openLeadDrawer(c.id, { tab: 'propostas', onChange: () => openConv(conv.id, { silent: true }) });
    if (ok) {
      toast('Feito! O lead foi atualizado.');
      await loadList();
      openConv(conv.id, { silent: true });
    }
    return undefined;
  });
  on(view, 'click', '[data-act=lead]', () => conv?.contact_id && openLeadDrawer(conv.contact_id, { onChange: () => openConv(conv.id, { silent: true }) }));
  const link = async () => {
    const cid = await pickContact('Vincular a conversa a um cadastro');
    if (!cid) return;
    try {
      await patch(`/api/whatsapp/conversas/${conv.id}`, { contact_id: cid });
      toast('Conversa vinculada ao cadastro.');
      await loadList();
      openConv(conv.id, { silent: true });
    } catch (e) {
      toastError(e);
    }
  };
  on(view, 'click', '[data-act=link]', link);
  on(view, 'click', '[data-act=unlink]', link);
  on(view, 'click', '[data-act=create]', async () => {
    const r = await quickCreateContact({ name: conv.profile_name || '', phone1: conv.phone.replace(/^\+55\s?/, ''), origin: 'whatsapp', stay: true });
    if (!r?.id) return;
    await patch(`/api/whatsapp/conversas/${conv.id}`, { contact_id: r.id }).catch(toastError);
    await loadList();
    openConv(conv.id, { silent: true });
  });
  on(view, 'click', '[data-act=assign]', async () => {
    const r = await modal({
      title: 'Responsável pela conversa',
      body: field({ name: 'assigned_to', label: 'Responsável', type: 'select', options: (state.meta.users || []).filter((u) => u.active !== 0).map((u) => ({ value: u.id, label: u.name })), value: conv.assigned_to, full: true }),
      submitLabel: 'Salvar',
      onSubmit: (d) => patch(`/api/whatsapp/conversas/${conv.id}`, { assigned_to: d.assigned_to || null }),
    });
    if (r) {
      await loadList();
      openConv(conv.id, { silent: true });
    }
  });
  on(view, 'click', '[data-act=close]', async () => {
    await patch(`/api/whatsapp/conversas/${conv.id}`, { status: conv.status === 'encerrada' ? 'aberta' : 'encerrada' }).catch(toastError);
    toast(conv.status === 'encerrada' ? 'Conversa reaberta.' : 'Conversa arquivada (encerrada). Ela reabre quando o cliente escrever.');
    await loadList();
    openConv(conv.id, { silent: true });
  });
  on(view, 'click', '[data-act=back]', () => {
    shell.classList.remove('has-conv', 'has-side');
    $('[data-side]', view).hidden = true;
    clearInterval(timer);
    conv = null;
    history.replaceState(null, '', '#/comunicacao/whatsapp');
    showWelcome();
    drawList();
  });
  const aiControl = async (acao) => {
    try {
      await post(`/api/whatsapp/conversas/${conv.id}/ia`, { acao });
      toast(acao === 'assumir' ? 'Você assumiu a conversa: a IA não responde mais aqui.' : 'Conversa devolvida para a IA.');
      await loadList();
      openConv(conv.id, { silent: true });
    } catch (e) {
      toastError(e);
    }
  };
  on(view, 'click', '[data-act=ai-take]', () => aiControl('assumir'));
  on(view, 'click', '[data-act=ai-give]', () => aiControl('devolver'));
  on(view, 'click', '[data-act=link-wa]', () => linkWa());
  on(view, 'click', '[data-act=link-newqr]', () => linkWa(false));
  on(view, 'click', '[data-act=link-cancel]', () => {
    shell.classList.remove('has-conv');
    showWelcome();
  });
  on(view, 'click', '[data-act=link-sim]', async () => {
    try {
      linking = { ...linking, ...(await post(`/api/whatsapp/lite/instancias/${linking.id}/simular-conexao`, {})) };
      drawLink(linking);
      linked();
    } catch (e) {
      toastError(e);
    }
  });
  on(view, 'change', '[data-known]', async (e, el) => {
    if (!linking) return;
    try {
      await patch(`/api/whatsapp/lite/instancias/${linking.id}`, { only_known: el.checked });
      linking.only_known = el.checked;
    } catch (ex) {
      toastError(ex);
    }
  });
  on(view, 'click', '[data-act=new]', async () => {
    const cid = await pickContact('Conversar com um cliente');
    if (!cid) return;
    try {
      await startWith(cid);
    } catch (e) {
      toastError(e);
    }
  });
  // Fecha menus e emojis ao clicar fora
  view.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) $$('.pop', view).forEach((p) => (p.hidden = true));
    if (!e.target.closest('.wa-input')) $$('[data-emojis]', view).forEach((p) => (p.hidden = true));
  });

  await loadList();
  // Vindo do painel do lead (?contato=ID): abre ou cria a conversa com o cliente
  if (params.contato) {
    try {
      const existing = list.find((c) => c.contact_id === Number(params.contato));
      if (existing) await openConv(existing.id);
      else await startWith(Number(params.contato));
      const box = $('[data-compose] [name=body]', view);
      if (params.texto && box && !box.disabled) {
        box.value = params.texto;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.focus();
      }
    } catch (e) {
      toastError(e);
    }
  } else if (openId) await openConv(openId, { silent: true });
  listTimer = setInterval(() => view.isConnected && loadList(), 20000);
  return () => {
    clearInterval(timer);
    clearInterval(listTimer);
    stopLink();
    if (rec) {
      rec.cancel = true;
      rec.mr.stop();
    }
  };
}

