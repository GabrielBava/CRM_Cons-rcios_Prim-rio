/*
 * Vero — rastreio das LPs (UTM) e envio dos leads ao CRM.
 *
 * Como usar numa LP (as LPs de consórcio e de planejamento já vêm com isto embutido pelo scripts/preparar-lp.js):
 *   <script>window.VERO_LP={crm:"https://crm.veroconsorciosbr.com.br",lp:"seguros-vida",area:"seguros"};</script>
 *   <script src="https://crm.veroconsorciosbr.com.br/lp/vero-rastreio.js"></script>
 *
 * O que faz:
 *  - Guarda no navegador (90 dias) o PRIMEIRO e o ÚLTIMO toque: UTMs (utm_source, utm_medium, utm_campaign, utm_content,
 *    utm_term, utm_id) e identificadores de clique (gclid, gbraid, wbraid, fbclid, ttclid, msclkid, li_fat_id), a página
 *    de entrada, o site de origem (referrer) e a data. Sem UTM, identifica o canal pelo referrer (busca orgânica, rede
 *    social, outro site ou acesso direto). Uma visita direta depois de um anúncio não apaga o anúncio do último toque.
 *  - Completa todo envio de lead para o CRM (/api/publico/lp/leads) com `rastreio`, `utm`, `lp` e `area`, sem mexer no
 *    formulário da LP.
 *  - VeroLP.endpoint(): endereço do CRM para o leadEndpoint da LP. VeroLP.enviar(dados): envia um lead (LPs novas).
 */
(function () {
  'use strict';
  var CFG = window.VERO_LP || {};
  var KEY = 'vero_rastreio';
  var DAYS = 90;
  var PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'li_fat_id'];
  var ENDPOINT_RE = /\/api\/publico\/lp\/leads(\?|$)/;

  function iso() { return new Date().toISOString(); }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && v.expira && Date.parse(v.expira) > Date.now() ? v : null;
    } catch (e) { return null; }
  }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* navegador sem armazenamento */ } }
  function fromUrl() {
    var o = {};
    try {
      var q = new URLSearchParams(location.search);
      PARAMS.forEach(function (k) { var x = q.get(k); if (x) o[k] = String(x).slice(0, 200); });
    } catch (e) { /* navegador antigo */ }
    return o;
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  /** Canal sem UTM, pelo site de origem. */
  function channel(ref) {
    var h = host(ref);
    var self = location.hostname.replace(/^www\./, '');
    if (!h || h === self) return { fonte: 'direto', meio: 'nenhum' };
    if (/(^|\.)google\./.test(h)) return { fonte: 'google', meio: 'organico' };
    if (/(^|\.)(bing|yahoo|duckduckgo|ecosia)\./.test(h)) return { fonte: h.split('.')[0], meio: 'organico' };
    if (/instagram\./.test(h)) return { fonte: 'instagram', meio: 'social' };
    if (/(facebook|fb)\.(com|me)/.test(h)) return { fonte: 'facebook', meio: 'social' };
    if (/linkedin\.|lnkd\.in/.test(h)) return { fonte: 'linkedin', meio: 'social' };
    if (/tiktok\./.test(h)) return { fonte: 'tiktok', meio: 'social' };
    if (/youtube\.|youtu\.be/.test(h)) return { fonte: 'youtube', meio: 'social' };
    if (/(^|\.)t\.co$|twitter\.|x\.com/.test(h)) return { fonte: 'x', meio: 'social' };
    if (/whatsapp\.|wa\.me/.test(h)) return { fonte: 'whatsapp', meio: 'mensagem' };
    if (/mail\.|outlook\./.test(h)) return { fonte: 'email', meio: 'email' };
    return { fonte: h, meio: 'referencia' };
  }
  function hasCampaign(u) { return !!(u.utm_source || u.utm_medium || u.utm_campaign || u.gclid || u.gbraid || u.wbraid || u.fbclid || u.ttclid || u.msclkid || u.li_fat_id); }

  var url = fromUrl();
  var ref = document.referrer || '';
  var campaign = hasCampaign(url);
  var touch = { utm: url, canal: campaign ? null : channel(ref), pagina: location.href.split('#')[0].slice(0, 500), referrer: ref.slice(0, 500), data: iso() };
  var st = load() || {};
  if (!st.primeiro_toque) st.primeiro_toque = touch;
  // Novo clique de campanha substitui o último toque; visita direta ou orgânica só entra se ainda não houver campanha
  if (campaign || !st.ultimo_toque || !hasCampaign(st.ultimo_toque.utm || {})) st.ultimo_toque = touch;
  st.visitas = (st.visitas || 0) + 1;
  st.expira = new Date(Date.now() + DAYS * 864e5).toISOString();
  save(st);

  var R = {
    /** UTMs da visita atual ou, sem elas, as do último toque com campanha. */
    utm: function () {
      var u = fromUrl();
      if (hasCampaign(u)) return u;
      var last = (st.ultimo_toque && st.ultimo_toque.utm) || {};
      return hasCampaign(last) ? last : {};
    },
    dados: function () {
      return {
        lp: CFG.lp || '',
        area: CFG.area || '',
        primeiro_toque: st.primeiro_toque || null,
        ultimo_toque: st.ultimo_toque || null,
        canal: st.ultimo_toque && st.ultimo_toque.canal,
        visitas: st.visitas || 1,
        pagina: location.href.split('#')[0].slice(0, 500),
        referrer: ref.slice(0, 500),
        dispositivo: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'celular' : 'computador',
      };
    },
  };
  window.VeroRastreio = R;

  function complete(b) {
    if (!b || typeof b !== 'object') return b;
    if (!b.rastreio) b.rastreio = R.dados();
    if (!b.utm || typeof b.utm !== 'object' || !Object.keys(b.utm).length) b.utm = R.utm();
    if (!b.lp && CFG.lp) b.lp = CFG.lp;
    if (!b.area && CFG.area) b.area = CFG.area;
    return b;
  }

  window.VeroLP = {
    /** Endereço que recebe os leads: o CRM configurado em VERO_LP.crm ou, na LP servida pelo próprio CRM (/lp/), o mesmo site. */
    endpoint: function () {
      var c = String(CFG.crm || '').replace(/\/+$/, '');
      if (!c && location.pathname.indexOf('/lp/') !== 0) {
        if (window.console) console.warn('Vero: VERO_LP.crm não está configurado; os leads desta LP não chegam ao CRM.');
        return '';
      }
      return c + '/api/publico/lp/leads';
    },
    /** Envia um lead ao CRM (para LPs novas): nome, email, celular, area, formulario, respostas {pergunta: resposta}, aceite_privacidade… */
    enviar: function (dados) {
      var e = window.VeroLP.endpoint();
      if (!e || !window.fetch) return Promise.resolve({ ok: false });
      var b = complete(JSON.parse(JSON.stringify(dados || {})));
      b.pagina = b.pagina || location.href;
      b.data = b.data || iso();
      return fetch(e, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), keepalive: true })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); });
    },
  };

  // Todo envio de lead da LP ao CRM leva o rastreio (sem alterar o código do formulário)
  if (window.fetch) {
    var original = window.fetch;
    window.fetch = function (input, init) {
      try {
        var u = typeof input === 'string' ? input : (input && input.url) || '';
        if (ENDPOINT_RE.test(u) && init && typeof init.body === 'string') {
          var b = JSON.parse(init.body);
          if (b && typeof b === 'object' && !Array.isArray(b)) {
            var copy = {};
            for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) copy[k] = init[k];
            copy.body = JSON.stringify(complete(b));
            init = copy;
          }
        }
      } catch (e) { /* envio segue como veio */ }
      return original.call(window, input, init);
    };
  }
})();
