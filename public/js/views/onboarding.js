// Trilha de integração do novo especialista: troca obrigatória da senha provisória, etapas no Painel inicial,
// guia da marca Vero, kit de configuração (WhatsApp Business e LinkedIn) e liberação do treinamento de consórcios.
import { get, post } from '../api.js';
import { html, render, $, $$, on, state, toast, toastError, badge } from '../ui.js';
import { icon } from '../icons.js';
import { changePasswordDialog } from './profile.js';
import { brandGuide, kitDoc, linkedinCover, kitPrintable } from '../onboarding-content.js';

const STEP_LINK = {
  senha: null,
  perfil: '#/meu-cadastro',
  marca: '#/integracao/marca',
  configuracao: '#/integracao/kit',
  consorcios: '#/treinamentos',
};

/** Cartão "Primeiros passos" do Painel inicial (só enquanto a trilha estiver em andamento). */
export function onboardingCard(st) {
  if (!st?.active || st.complete) return '';
  const pct = Math.round((st.done / st.total) * 100);
  const next = st.steps.find((s) => !s.done);
  return html`<section class="card ob-card">
    <div class="section-head"><h3>${icon('treinamentos', 18)} Sua integração na Vero</h3><span class="count">${st.done} de ${st.total}</span></div>
    <div class="progress-bar goal"><span style="width:${pct}%"></span></div>
    <ol class="ob-steps">${st.steps.map((s, i) => html`<li class="${s.done ? 'done' : s.locked ? 'locked' : 'current'}">
      <span class="ob-n">${s.done ? '✓' : i + 1}</span>
      <div><strong>${s.title}</strong><small>${s.hint}</small></div>
      ${s.done ? badge('Concluída', 'ok') : s.locked ? badge('Bloqueada', 'muted') : STEP_LINK[s.key] ? html`<a class="btn small ${s.key === next?.key ? 'primary' : ''}" href="${STEP_LINK[s.key]}">${s.key === 'consorcios' ? 'Ir para Treinamentos' : 'Começar'}</a>` : ''}
    </li>`)}</ol>
    ${st.trainings_unlocked && !st.complete ? html`<p class="hint">Treinamento de consórcios liberado: ${st.trainings.filter((t) => t.completed).length} de ${st.trainings.length} módulos concluídos.</p>` : html`<p class="hint">O treinamento de consórcios é liberado em Treinamentos assim que as etapas anteriores forem concluídas.</p>`}
  </section>`;
}

/** Primeiro acesso: a plataforma só abre depois de trocar a senha provisória. */
export function firstPasswordScreen(app, { onDone, onLogout }) {
  render(app, html`<div class="auth"><div class="card ob-first">
    <div class="auth-brand"><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span></div>
    <h1>Bem-vindo(a), ${state.user.name.split(' ')[0]}!</h1>
    <p>A senha que você recebeu é <strong>provisória</strong>. Antes de começar, crie a sua senha pessoal. Ela é só sua: não compartilhe com ninguém.</p>
    <ol class="ob-mini"><li><strong>Crie sua senha</strong> (agora)</li><li>Complete Meu cadastro</li><li>Conheça a Vero</li><li>Kit do especialista</li><li>Treinamento de consórcios</li></ol>
    <button type="button" class="btn primary big" data-act="pw">Criar minha senha</button>
    <button type="button" class="btn ghost" data-act="logout">Sair</button>
  </div></div>`);
  on(app, 'click', '.ob-first [data-act=pw]', async () => {
    if (await changePasswordDialog({ first: true })) onDone();
  });
  on(app, 'click', '.ob-first [data-act=logout]', onLogout);
}

export async function show(view, { id }) {
  const tab = ['marca', 'kit'].includes(id) ? id : 'etapas';
  let st;
  let profile;
  try {
    [st, profile] = await Promise.all([get('/api/integracao'), get('/api/perfil')]);
  } catch (e) {
    return toastError(e);
  }
  const stepOf = (k) => st.steps.find((s) => s.key === k);
  const doneBtn = (k, label) => {
    const s = stepOf(k);
    if (!st.active) return '';
    if (s.done) return html`<p class="ob-done">${icon('confirmar', 16)} Etapa concluída.</p>`;
    if (s.locked) return html`<p class="hint">Conclua as etapas anteriores da trilha para registrar esta etapa.</p>`;
    return html`<button type="button" class="btn primary" data-step="${k}">${label}</button>`;
  };
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Integração do especialista</h1><p class="muted">Senha, cadastro, marca, canais de atendimento e treinamento de consórcios.</p></div></div>
    <nav class="tabs"><a href="#/integracao" class="${tab === 'etapas' ? 'active' : ''}">Etapas</a><a href="#/integracao/marca" class="${tab === 'marca' ? 'active' : ''}">Conheça a Vero</a><a href="#/integracao/kit" class="${tab === 'kit' ? 'active' : ''}">Kit do especialista</a></nav>
    ${tab === 'etapas' ? (st.active ? onboardingCard(st) || html`<div class="alert ok-alert">Integração concluída. Bem-vindo(a) à Vero!</div>` : html`<div class="alert">A trilha de integração é ativada para novos especialistas. O guia da marca e o kit continuam disponíveis nas abas acima.</div>`) : ''}
    ${tab === 'marca' ? html`<section class="card">${brandGuide()}<div class="ob-foot">${doneBtn('marca', 'Li o guia da marca: concluir etapa')}</div></section>` : ''}
    ${tab === 'kit' ? html`<section class="card">
      <div class="inline-actions ob-kit-actions"><button type="button" class="btn" data-act="cover">${icon('baixar', 16)}Baixar capa do LinkedIn</button><button type="button" class="btn" data-act="print">Abrir documento para imprimir ou salvar em PDF</button></div>
      <div id="kit">${kitDoc(profile)}</div>
      <div class="ob-foot">${doneBtn('configuracao', 'Configurei WhatsApp Business e LinkedIn: concluir etapa')}</div></section>` : ''}
  </div>`);
  on(view, 'click', '[data-step]', async (e, b) => {
    b.disabled = true;
    try {
      const r = await post(`/api/integracao/${b.dataset.step}/concluir`);
      toast(r.trainings_unlocked && b.dataset.step === 'configuracao' ? 'Etapa concluída. O treinamento de consórcios foi liberado em Treinamentos!' : 'Etapa concluída.');
      location.hash = '#/painel';
    } catch (ex) {
      toastError(ex);
      b.disabled = false;
    }
  });
  on(view, 'click', '[data-copy]', async (e, b) => {
    const text = b.previousElementSibling?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      toast('Texto copiado.');
    } catch {
      toastError(new Error('Não foi possível copiar. Selecione o texto e copie manualmente.'));
    }
  });
  on(view, 'click', '[data-act=cover]', async () => {
    try {
      const blob = await linkedinCover({ name: profile.name, role: profile.job_title || 'Especialista em consórcios' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'capa-linkedin-vero.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (ex) {
      toastError(ex);
    }
  });
  on(view, 'click', '[data-act=print]', () => {
    const doc = kitPrintable(profile, $('#kit', view).innerHTML);
    const w = window.open(URL.createObjectURL(new Blob([doc], { type: 'text/html' })), '_blank');
    if (!w) toastError(new Error('O navegador bloqueou a nova guia. Permita pop-ups para este site.'));
  });
  $$('.ob-check input', view).forEach((c) => c.addEventListener('change', () => c.closest('li').classList.toggle('checked', c.checked)));
}
