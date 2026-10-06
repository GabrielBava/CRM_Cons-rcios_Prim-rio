'use strict';
/**
 * E-mails da Vero Consórcios (remetente padrão admin@veroconsorciosbr.com.br).
 *
 * Envio por SMTP (cliente mínimo, sem dependências): TLS direto (porta 465), STARTTLS (587) ou sem criptografia
 * (somente para servidores locais de teste). A senha fica cifrada no banco. Sem SMTP configurado, o CRM devolve o
 * e-mail pronto (HTML e texto) para o especialista enviar pelo próprio programa de e-mail.
 */
const { HttpError, badRequest, clean, nowIso, sealSecret, openSecret, normalizeEmail } = require('../util');
const { getSetting } = require('../db');
const { audit } = require('../core');

const DEFAULT_FROM = 'admin@veroconsorciosbr.com.br';

function smtpConfig(db) {
  const c = getSetting(db, 'smtp') || {};
  return {
    host: process.env.SMTP_HOST || c.host || '',
    port: Number(process.env.SMTP_PORT || c.port) || 465,
    security: process.env.SMTP_SECURITY || c.security || 'tls',
    user: process.env.SMTP_USER || c.user || '',
    password: process.env.SMTP_PASSWORD || openSecret(c.password_enc) || '',
    from_email: c.from_email || DEFAULT_FROM,
    from_name: c.from_name || getSetting(db, 'company_name') || 'Vero Consórcios',
  };
}
const configured = (cfg) => !!(cfg.host && cfg.from_email);

function smtpStatus(db, user) {
  const cfg = smtpConfig(db);
  return {
    configured: configured(cfg),
    host: user.role === 'admin' ? cfg.host : undefined,
    port: user.role === 'admin' ? cfg.port : undefined,
    security: user.role === 'admin' ? cfg.security : undefined,
    user: user.role === 'admin' ? cfg.user : undefined,
    has_password: user.role === 'admin' ? !!cfg.password : undefined,
    from_email: cfg.from_email,
    from_name: cfg.from_name,
  };
}

function saveSmtp(db, user, data) {
  if (user.role !== 'admin') throw new HttpError(403, 'Apenas o administrador configura o envio de e-mails.');
  const cur = getSetting(db, 'smtp') || {};
  const port = data.port === undefined || data.port === '' ? cur.port || 465 : Number(data.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest('Porta SMTP inválida.');
  const security = data.security || cur.security || 'tls';
  if (!['tls', 'starttls', 'none'].includes(security)) throw badRequest('Segurança: tls, starttls ou none.');
  const from = data.from_email !== undefined ? normalizeEmail(data.from_email) || DEFAULT_FROM : cur.from_email || DEFAULT_FROM;
  const next = {
    host: data.host !== undefined ? clean(data.host) || '' : cur.host || '',
    port, security,
    user: data.user !== undefined ? clean(data.user) || '' : cur.user || '',
    password_enc: data.password ? sealSecret(String(data.password)) : data.password === '' && data.clear_password ? null : cur.password_enc || null,
    from_email: from,
    from_name: data.from_name !== undefined ? clean(data.from_name) || '' : cur.from_name || '',
  };
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('smtp', JSON.stringify(next));
  audit(db, user, 'settings', null, 'smtp_configurado', { host: next.host, remetente: next.from_email });
  return smtpStatus(db, user);
}

/* ------------------------- Cliente SMTP mínimo ------------------------- */

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, (m) => `${m}\r\n`);

/** Mensagem MIME (texto + HTML), em base64 para não depender de 8BITMIME. */
function buildMime({ fromName, fromEmail, to, subject, text, html }) {
  const boundary = `vero-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const domain = fromEmail.split('@')[1] || 'localhost';
  return [
    `From: ${encWord(fromName)} <${fromEmail}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function smtpSend(cfg, { to, subject, text, html }) {
  // Carregados só no envio (a versão de teste no navegador não tem rede TCP)
  const net = require('node:net');
  const tls = require('node:tls');
  return new Promise((resolve, reject) => {
    let socket;
    let buf = '';
    let waiting = null;
    const timer = setTimeout(() => fail(new Error('Tempo esgotado ao falar com o servidor SMTP.')), 20000);
    const fail = (e) => {
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {}
      reject(e);
    };
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      // Resposta completa: última linha "NNN texto" (sem hífen)
      const lines = buf.split('\r\n');
      const last = lines[lines.length - 2];
      if (last && /^\d{3} /.test(last)) {
        const reply = buf;
        buf = '';
        const w = waiting;
        waiting = null;
        w?.(reply);
      }
    };
    const expect = (codes) => new Promise((ok, ko) => {
      waiting = (reply) => {
        const code = Number(reply.split('\r\n').filter(Boolean).pop().slice(0, 3));
        if (codes.includes(code)) ok(reply);
        else ko(new Error(`Servidor SMTP respondeu: ${reply.trim().split('\r\n').pop()}`));
      };
    });
    const cmd = (line, codes) => {
      const p = expect(codes);
      socket.write(`${line}\r\n`);
      return p;
    };
    const attach = (s) => {
      socket = s;
      socket.on('data', onData);
      socket.on('error', fail);
    };
    const run = async () => {
      try {
        const greet = expect([220]);
        if (cfg.security === 'tls') attach(tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }));
        else attach(net.connect({ host: cfg.host, port: cfg.port }));
        await greet;
        const ehlo = `EHLO ${cfg.from_email.split('@')[1] || 'localhost'}`;
        let caps = await cmd(ehlo, [250]);
        if (cfg.security === 'starttls') {
          await cmd('STARTTLS', [220]);
          socket.removeListener('data', onData);
          const secure = tls.connect({ socket, servername: cfg.host });
          await new Promise((ok, ko) => {
            secure.once('secureConnect', ok);
            secure.once('error', ko);
          });
          attach(secure);
          caps = await cmd(ehlo, [250]);
        }
        if (cfg.user) {
          if (/AUTH[^\r\n]*PLAIN/i.test(caps)) await cmd(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.password}`)}`, [235]);
          else {
            await cmd('AUTH LOGIN', [334]);
            await cmd(b64(cfg.user), [334]);
            await cmd(b64(cfg.password), [235]);
          }
        }
        await cmd(`MAIL FROM:<${cfg.from_email}>`, [250]);
        await cmd(`RCPT TO:<${to}>`, [250, 251]);
        await cmd('DATA', [354]);
        const mime = buildMime({ fromName: cfg.from_name, fromEmail: cfg.from_email, to, subject, text, html }).replace(/^\./gm, '..');
        await cmd(`${mime}\r\n.`, [250]);
        await cmd('QUIT', [221]).catch(() => {});
        clearTimeout(timer);
        socket.end();
        resolve({ ok: true });
      } catch (e) {
        fail(e);
      }
    };
    run();
  });
}

/** Envia (ou devolve pronto para envio manual, sem SMTP). */
async function sendMail(db, { to, subject, text, html }) {
  const email = normalizeEmail(to);
  if (!email) throw badRequest('O cliente não tem e-mail válido no cadastro.');
  const cfg = smtpConfig(db);
  if (!configured(cfg)) return { sent: false, reason: 'nao_configurado', from: cfg.from_email };
  try {
    await smtpSend(cfg, { to: email, subject, text, html });
    return { sent: true, from: cfg.from_email, to: email, at: nowIso() };
  } catch (e) {
    return { sent: false, reason: 'erro', error: e.message, from: cfg.from_email };
  }
}

/* ------------------------- Modelo: ficha de adesão ------------------------- */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/**
 * E-mail da ficha de adesão: visual da marca, passo a passo e o botão "Acessar minha ficha" (o mesmo link enviado
 * por WhatsApp, protegido pelos 4 últimos dígitos do celular).
 */
function fichaEmail(db, { name, url, consultant, consultantPhone, logoUrl }) {
  const company = getSetting(db, 'company_name') || 'Vero Consórcios';
  const first = String(name || '').trim().split(/\s+/)[0] || 'cliente';
  const subject = `${company} · Sua ficha de adesão ao consórcio`;
  const steps = [
    ['Acesse a ficha', 'Clique no botão abaixo. Por segurança, informe os 4 últimos dígitos do seu celular.'],
    ['Confira e complete seus dados', 'Dados pessoais e endereço (digite o CEP e o endereço é preenchido sozinho).'],
    ['Envie os documentos', 'Documento de identificação (RG ou CNH) e comprovante de endereço. Pode ser foto ou PDF.'],
    ['Salve e conclua', 'Clique em "Concluir cadastro". Em seguida enviamos o termo de adesão para você.'],
  ];
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#E0E1DD;font-family:Poppins,'Segoe UI',Arial,sans-serif;color:#0D1B2A">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#E0E1DD;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden">
  <tr><td style="background:#0D1B2A;background-image:linear-gradient(135deg,#0D1B2A,#1B263B);padding:32px 36px">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(company)}" height="44" style="display:block;height:44px;margin-bottom:22px">` : `<div style="font-size:24px;letter-spacing:4px;color:#E0E1DD;margin-bottom:22px">VERO <span style="font-size:12px;letter-spacing:6px;color:#A9B8CB">CONSÓRCIOS</span></div>`}
    <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#778DA9">Ficha de adesão</div>
    <h1 style="margin:8px 0 6px;font-size:26px;line-height:1.25;color:#ffffff;font-weight:600">Olá, ${esc(first)}! Falta pouco para a sua adesão.</h1>
    <p style="margin:0;color:#A9B8CB;font-size:15px;line-height:1.6">Preencha a sua ficha cadastral on-line. Leva cerca de 5 minutos e você pode salvar e voltar depois.</p>
  </td></tr>
  <tr><td style="padding:30px 36px 10px">
    <h2 style="margin:0 0 16px;font-size:17px;color:#0D1B2A">Como funciona</h2>
    ${steps.map(([t, d], i) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:14px"><tr>
      <td width="40" valign="top"><div style="width:30px;height:30px;border-radius:50%;background:#1B263B;color:#E0E1DD;font-weight:600;font-size:14px;line-height:30px;text-align:center">${i + 1}</div></td>
      <td valign="top" style="font-size:15px;line-height:1.5"><strong style="color:#0D1B2A">${esc(t)}</strong><br><span style="color:#415A77">${esc(d)}</span></td></tr></table>`).join('')}
  </td></tr>
  <tr><td align="center" style="padding:10px 36px 26px">
    <a href="${esc(url)}" style="display:inline-block;background:#0D1B2A;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:15px 36px;border-radius:999px">Acessar minha ficha</a>
    <p style="margin:14px 0 0;font-size:12px;color:#778DA9">Se o botão não abrir, copie e cole no navegador:<br><span style="word-break:break-all;color:#415A77">${esc(url)}</span></p>
  </td></tr>
  <tr><td style="padding:0 36px 26px"><div style="background:#F2F3F0;border-left:3px solid #778DA9;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.55;color:#415A77">
    <strong style="color:#0D1B2A">Seus dados protegidos.</strong> A ficha só abre depois que você informa os 4 últimos dígitos do seu celular. Usamos seus dados apenas para formalizar a adesão junto à administradora, conforme a LGPD. Nunca pedimos senhas ou códigos recebidos por SMS.
  </div></td></tr>
  <tr><td style="padding:22px 36px;border-top:1px solid #E0E1DD;font-size:14px;line-height:1.6;color:#415A77">
    ${consultant ? `Qualquer dúvida, fale comigo.<br><strong style="color:#0D1B2A">${esc(consultant)}</strong> · ${esc(company)}${consultantPhone ? `<br>WhatsApp: ${esc(consultantPhone)}` : ''}` : `Equipe ${esc(company)}`}
  </td></tr>
  <tr><td style="background:#0D1B2A;padding:16px 36px;font-size:11px;color:#778DA9;text-align:center">${esc(company)} · Este e-mail foi enviado porque você está em processo de adesão a um consórcio.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `Olá, ${first}!\n\nFalta pouco para a sua adesão ao consórcio. Preencha a sua ficha cadastral on-line:\n${url}\n\n` +
    steps.map(([t, d], i) => `${i + 1}. ${t}: ${d}`).join('\n') +
    `\n\nPor segurança, a ficha só abre depois que você informa os 4 últimos dígitos do seu celular. Nunca pedimos senhas ou códigos recebidos por SMS.\n\n${consultant ? `${consultant} · ` : ''}${company}`;
  return { subject, html, text };
}

/** Mensagem de WhatsApp da ficha (mesmo link e mesma regra dos 4 dígitos). */
function fichaWhatsapp(db, { name, url, consultant }) {
  const company = getSetting(db, 'company_name') || 'Vero Consórcios';
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return `Olá, ${first}! Aqui é ${consultant || `a equipe da ${company}`}, da ${company}. Para seguirmos com a sua adesão ao consórcio, preencha a sua ficha cadastral neste link seguro:\n${url}\n\n` +
    'Como funciona:\n1. Abra o link e informe os 4 últimos dígitos do seu celular (por segurança).\n2. Confira e complete seus dados e o endereço.\n3. Envie o documento de identificação (RG ou CNH) e o comprovante de endereço: pode ser foto ou PDF.\n4. Clique em "Concluir cadastro". Em seguida enviamos o termo de adesão.\n\n' +
    'Seus dados são usados apenas para formalizar a adesão junto à administradora, conforme a LGPD. Qualquer dúvida, é só me chamar!';
}

module.exports = { smtpConfig, smtpStatus, saveSmtp, sendMail, smtpSend, buildMime, fichaEmail, fichaWhatsapp, DEFAULT_FROM };
