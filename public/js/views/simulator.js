// 5. Simulador: acesso ao simulador pronto para simulações rápidas (sem emitir proposta).
import { html, render, state, can } from '../ui.js';

export async function show(view) {
  const base = state.meta.settings.proposal_simulator_url || '';
  const url = base ? `${base.split('#')[0]}${base.includes('?') ? '&' : '?'}modo=simulacao#modo=simulacao` : '';
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Simulador</h1><p class="muted">Simule os valores de cada plano: crédito, parcela, prazo, lances e cenários de contemplação.</p></div></div>
    <div class="cols">
      <section class="card sim-card">
        <h3>Simulação rápida</h3>
        <p>Use para responder dúvidas e comparar planos durante a conversa com o lead. <strong>A simulação não gera proposta nem PDF.</strong></p>
        ${url ? html`<p><a class="btn primary big" href="${url}" target="_blank" rel="noopener noreferrer">Abrir o simulador</a></p>` : html`<div class="alert warn">O endereço do simulador não está configurado. ${can.admin() ? html`Informe em <a href="#/configuracoes/geral">Configurações › Geral</a>.` : 'Fale com o administrador.'}</div>`}
        <p class="hint">Aberto por aqui, o simulador entra no <strong>modo simulação</strong>: o botão "Gerar proposta (PDF)" fica inativo. Propostas são geradas só pela tela Propostas, a partir do cadastro do cliente.</p>
      </section>
      <section class="card">
        <h3>Precisa gerar uma proposta?</h3>
        <p>Propostas são geradas a partir do cadastro do cliente, para que cada proposta tenha dono, ID do cliente e acompanhamento de follow-up.</p>
        <ol class="small"><li>Abra <a href="#/propostas">Propostas</a> e clique em <strong>Nova proposta</strong>.</li><li>Escolha o cliente pelo nome ou ID (C-000001).</li><li>O simulador abre com o nome completo e o contato do cliente já preenchidos.</li><li>Depois de gerar o PDF, registre os valores e marque como enviada: a esteira de follow-up começa automaticamente.</li></ol>
        <p><a class="btn" href="#/propostas">Ir para Propostas</a></p>
      </section>
    </div>
  </div>`);
}
