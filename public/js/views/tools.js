// Ferramentas: um só item no menu que reúne o que o especialista usa no dia a dia (simulador, modelo da R1,
// kit e marca, importação de leads e modelo da transcrição da R1).
import { html, render, on, state, can, hasModule } from '../ui.js';
import { icon } from '../icons.js';
import { openR1Model, downloadR1Model } from '../meeting.js';
import { downloadR1Template } from '../r1.js';

export async function show(view) {
  const company = state.meta.settings.company_name || 'Vero Consórcios';
  const tools = [
    hasModule('simulador') && { href: '#/simulador', ic: 'simulador', title: 'Simulador', text: 'Simule cartas, parcelas e lances e gere a proposta para o cliente.' },
    { act: 'r1-open', ic: 'propostas', title: 'Modelo da R1', text: `Apresentação oficial da ${company} com o seu nome, foto e contato. Abra para apresentar ou baixe o arquivo.`, extra: html`<button type="button" class="btn small" data-act="r1-download">Baixar</button>` },
    { href: '#/integracao/kit', ic: 'ferramentas', title: 'Kit do especialista', text: 'WhatsApp Business, LinkedIn com a capa da Vero e materiais de apoio.' },
    { href: '#/integracao/marca', ic: 'avaliacao', title: 'Manual da marca', text: 'Posicionamento, cores, tipografia e tom de voz.' },
    hasModule('crm') && can.write() && { href: '#/importar', ic: 'importar', title: 'Importar leads', text: 'Planilha do Excel com validação e verificação de duplicados.' },
    { act: 'r1-template', ic: 'baixar', title: 'Modelo da transcrição da R1', text: 'Planilha para registrar o que foi dito na R1 e completar a qualificação.' },
  ].filter(Boolean);
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Ferramentas</h1><p class="muted">Tudo o que você usa no atendimento, num só lugar.</p></div></div>
    <div class="tool-grid">${tools.map((t) => (t.href
      ? html`<a class="tool-card" href="${t.href}"><span class="tool-ico">${icon(t.ic, 22)}</span><strong>${t.title}</strong><small>${t.text}</small></a>`
      : html`<div class="tool-card"><button type="button" class="tool-main" data-act="${t.act}"><span class="tool-ico">${icon(t.ic, 22)}</span><strong>${t.title}</strong><small>${t.text}</small></button>${t.extra || ''}</div>`))}</div>
  </div>`);
  on(view, 'click', '[data-act=r1-open]', () => openR1Model(''));
  on(view, 'click', '[data-act=r1-download]', () => downloadR1Model(''));
  on(view, 'click', '[data-act=r1-template]', () => downloadR1Template());
}
