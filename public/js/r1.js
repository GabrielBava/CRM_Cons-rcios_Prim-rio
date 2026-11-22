// Transcrição da R1: o especialista anexa o arquivo da reunião, confere os campos identificados e o CRM
// completa só os campos da qualificação que ainda estão vazios. O mesmo formato serve para o futuro agente de IA.
import { get, post } from './api.js';
import { html, on, modal, table, badge, fmtMoney, optLabel, toast } from './ui.js';
import { fileToText, buildXlsx, downloadBlob } from './xlsx.js';

const YN = { sim: 'Sim', nao: 'Não', nao_sabe: 'Não sabe', avaliar: 'Avaliar', nao_se_aplica: 'Não se aplica' };
const show = (i) => {
  if (i.value == null || i.value === '') return '—';
  if (i.type === 'money') return fmtMoney(i.value);
  if (i.type === 'list') return optLabel(i.list, i.value);
  if (i.type === 'yesno' || i.type === 'embedded') return YN[i.value] || i.value;
  if (i.type === 'pct') return `${String(i.value).replace('.', ',')}%`;
  return String(i.value);
};

/** Planilha modelo: Campo (chave) | Descrição | Tipo | Opções | Valor. */
export async function downloadR1Template() {
  const fields = await get('/api/r1/campos');
  const rows = [['Campo', 'Descrição', 'Tipo', 'Opções aceitas', 'Valor'], ...fields.map((f) => [f.key, f.label, f.type, f.options, ''])];
  downloadBlob(buildXlsx([
    { name: 'Transcrição R1', rows, widths: [26, 38, 18, 70, 40], styles: (r, c) => (r === 0 ? (c === 4 ? 1 : 2) : 0) },
    {
      name: 'Como usar',
      rows: [
        ['Como preencher'],
        ['Preencha a coluna Valor com o que foi coletado na R1 e anexe a planilha em Negócio › Editar qualificação › Anexar transcrição da R1.'],
        ['O CRM também lê um texto (.txt ou .docx) com uma linha por campo, no formato "Descrição: valor" — ex.: "Crédito desejado: R$ 300.000,00".'],
        ['Só os campos que ainda estão vazios no negócio são preenchidos; o que o especialista já informou não muda.'],
      ],
      widths: [140],
      styles: (r) => (r === 0 ? 3 : 0),
    },
  ]), 'modelo-transcricao-r1.xlsx');
}

/** Anexa a transcrição, mostra os campos encontrados e aplica. Retorna o resultado da aplicação ou null. */
export async function transcriptFlow(opp) {
  const res = await modal({
    title: `Transcrição da R1 — ${opp.code}`,
    body: html`<p>Anexe o arquivo da reunião (texto, Word, planilha ou CSV). O CRM identifica os campos da qualificação e <strong>completa só os que estão vazios</strong>; você confere antes de aplicar.</p>
      <div class="field"><label>Arquivo da transcrição <span class="req">*</span></label><input type="file" name="file" accept=".txt,.md,.csv,.json,.xlsx,.docx" required><small>Formatos: .txt, .docx, .xlsx ou .csv, até 4 MB.</small></div>
      <p class="hint">O arquivo traz cada campo com a sua descrição: uma linha "Descrição: valor" (ex.: "Prazo desejado: curto") ou a planilha modelo com as colunas Campo e Valor. <a href="#" data-r1-template>Baixar o modelo da transcrição (Excel)</a></p>`,
    submitLabel: 'Ler transcrição',
    onMount(form) {
      on(form, 'click', '[data-r1-template]', (e) => {
        e.preventDefault();
        downloadR1Template();
      });
    },
    async onSubmit(d, form) {
      const f = form.file.files[0];
      if (!f) throw new Error('Escolha o arquivo da transcrição.');
      if (f.size > 4 * 1024 * 1024) throw new Error('Arquivo maior que 4 MB.');
      const text = await fileToText(f);
      return post(`/api/oportunidades/${opp.id}/transcricoes`, { filename: f.name, text });
    },
  });
  if (!res) return null;
  const fill = res.items.filter((i) => i.will_fill);
  const result = await modal({
    title: 'Campos identificados na transcrição',
    wide: true,
    body: html`${res.items.length ? html`<p>${res.items.length} campo(s) encontrados · <strong>${res.fill_count} vazio(s) serão preenchidos</strong>. Campos já preenchidos no negócio não mudam.</p>
      ${table(
        [
          { label: 'Campo', render: (i) => html`<strong>${i.label}</strong>` },
          { label: 'No arquivo', render: (i) => html`<small>${i.raw || '—'}</small>` },
          { label: 'Valor entendido', render: (i) => (i.ok ? show(i) : html`<span class="warn-text">não reconhecido</span>`) },
          { label: 'Situação', render: (i) => (i.will_fill ? badge('Vai preencher', 'ok') : !i.ok ? badge('Ignorado', 'muted') : html`${badge('Já preenchido', 'muted')}<br><small class="muted">${show({ ...i, value: i.current })}</small>`) },
        ],
        res.items,
      )}` : html`<div class="alert warn">Nenhum campo da qualificação foi identificado no arquivo. Use uma linha por campo ("Descrição: valor") ou a planilha modelo.</div>`}
      <p class="hint">A transcrição fica anexada ao negócio, com a data e quem anexou.</p>`,
    submitLabel: fill.length ? `Preencher ${fill.length} campo(s) vazio(s)` : 'Fechar',
    onSubmit: () => (fill.length ? post(`/api/oportunidades/${opp.id}/transcricoes/${res.id}/aplicar`) : { filled: [] }),
  });
  if (result?.filled?.length) toast(`${result.filled.length} campo(s) preenchido(s) pela transcrição da R1.`);
  return result || null;
}
