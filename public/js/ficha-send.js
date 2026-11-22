// Envio da ficha de adesão ao cliente: WhatsApp (modelo da Vero) e e-mail visual (remetente noreply@veroconsorciosbr.com.br).
// Com o SMTP configurado, o CRM envia o e-mail; sem SMTP, mostra o e-mail pronto para copiar ou abrir no programa de e-mail.
import { post } from './api.js';
import { html, modal, on, toast, toastError } from './ui.js';

const appBase = () => location.href.split('#')[0];
const logoUrl = () => new URL('img/vero-logo-dark.png', document.baseURI).href;

/** Envia a ficha por e-mail. endpoint: rota POST que monta e envia (pré-venda ou cadastro). */
export async function sendFichaEmail(endpoint, button = null) {
  let r;
  const label = button?.textContent;
  if (button) button.textContent = 'Enviando…';
  try {
    r = await post(endpoint, { base: appBase(), logo_url: logoUrl() });
  } catch (e) {
    toastError(e);
    return false;
  } finally {
    if (button) button.textContent = label;
  }
  if (r.sent) {
    toast(`E-mail com a ficha enviado para ${r.to} (remetente ${r.from}).`);
    return true;
  }
  await modal({
    title: 'E-mail da ficha pronto para enviar',
    wide: true,
    body: html`<div class="alert ${r.reason === 'erro' ? 'warn' : ''} small">${r.reason === 'erro'
      ? html`O servidor de e-mail não aceitou o envio (${r.error}). Envie pelo seu programa de e-mail.`
      : html`O envio automático pelo e-mail <strong>${r.from}</strong> é ativado pelo administrador em Configurações › Integrações › E-mail. Enquanto isso, copie o e-mail formatado e cole no Gmail/Outlook, ou abra o seu programa de e-mail.`}</div>
      <p class="small"><strong>Para:</strong> ${r.to} · <strong>Assunto:</strong> ${r.subject}</p>
      <iframe class="mail-preview" title="Prévia do e-mail" sandbox srcdoc="${r.html}"></iframe>
      <div class="inline-actions">
        <button type="button" class="btn primary" data-copy-html>Copiar e-mail formatado</button>
        <a class="btn" href="${r.mailto}" data-mailto>Abrir no meu e-mail (texto simples)</a>
      </div>`,
    onMount(form) {
      on(form, 'click', '[data-copy-html]', async () => {
        try {
          if (window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([r.html], { type: 'text/html' }), 'text/plain': new Blob([r.text], { type: 'text/plain' }) })]);
          } else await navigator.clipboard.writeText(r.text);
          toast('E-mail copiado. Cole no corpo de um novo e-mail para o cliente.');
        } catch {
          toastError(new Error('Não foi possível copiar automaticamente. Use "Abrir no meu e-mail".'));
        }
      });
    },
  });
  return false;
}
