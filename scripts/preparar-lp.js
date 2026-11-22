#!/usr/bin/env node
'use strict';
/**
 * Prepara uma landing page para enviar os leads ao CRM com o rastreio de campanhas (UTM).
 *
 *   node scripts/preparar-lp.js <entrada.html> <saida.html> --lp <identificador> --area <consorcio|planejamento|seguros|investimentos> [--crm https://crm.veroconsorciosbr.com.br]
 *
 * O que muda no arquivo:
 *  1. Embute no <head> a configuração (window.VERO_LP = { crm, lp, area }) e o public/lp/vero-rastreio.js;
 *  2. Troca o `leadEndpoint:""` da LP pelo endereço do CRM (VeroLP.endpoint()).
 * Rodar de novo no mesmo arquivo substitui o bloco anterior (não duplica). Sem --crm, o endereço fica vazio: a LP só
 * envia quando servida pelo próprio CRM (/lp/). Para a hospedagem, informe --crm (ou baixe a LP em Ferramentas › LPs e
 * rastreio, que já vem com o endereço do CRM).
 *
 * LPs novas sem `leadEndpoint`: chame no envio do formulário `VeroLP.enviar({ nome, email, celular, area, formulario,
 * respostas: { 'Pergunta': 'Resposta' }, preferencia_contato, melhor_horario, aceite_privacidade: true })`.
 */
const fs = require('fs');
const path = require('path');

const AREAS = ['consorcio', 'planejamento', 'seguros', 'investimentos'];
const START = '<!-- vero-lp:inicio -->';
const END = '<!-- vero-lp:fim -->';

function prepare(html, { lp, area, crm = '' }) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(lp || '')) throw new Error('Informe --lp com letras minúsculas, números e hífen (ex.: consorcios, planejamento, seguros-vida).');
  if (!AREAS.includes(area)) throw new Error(`Informe --area: ${AREAS.join(', ')}.`);
  if (crm && !/^https?:\/\/[^\s"'<>]+$/.test(crm)) throw new Error('Endereço do CRM inválido (use https://…).');
  const tracker = fs.readFileSync(path.join(__dirname, '..', 'public', 'lp', 'vero-rastreio.js'), 'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/, '');
  if (/<\/script/i.test(tracker)) throw new Error('vero-rastreio.js não pode conter "</script".');
  const cfg = { crm: crm.replace(/\/+$/, ''), lp, area };
  const block = `${START}
<script>/* Vero CRM: endereço do CRM que recebe os leads desta LP. Na hospedagem, o endereço do CRM (ex.: https://crm.veroconsorciosbr.com.br); servida pelo próprio CRM em /lp/, vazio. */
window.VERO_LP={crm:${JSON.stringify(cfg.crm)},lp:${JSON.stringify(lp)},area:${JSON.stringify(area)}};</script>
<script>${tracker}</script>
${END}`;
  let out = html;
  const a = out.indexOf(START);
  const b = out.indexOf(END);
  if (a >= 0 && b > a) out = out.slice(0, a) + block + out.slice(b + END.length);
  else {
    const head = out.match(/<head[^>]*>/i);
    if (!head) throw new Error('A LP não tem <head>.');
    out = out.replace(head[0], `${head[0]}\n${block}`);
  }
  // leadEndpoint vazio da LP → endereço do CRM
  let endpoints = 0;
  out = out.replace(/leadEndpoint\s*:\s*(""|'')/g, () => {
    endpoints++;
    return 'leadEndpoint:window.VeroLP?VeroLP.endpoint():""';
  });
  return { html: out, endpoints, wired: /leadEndpoint:window\.VeroLP\?VeroLP\.endpoint\(\):""/.test(out) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const lp = opt('lp');
  const area = opt('area');
  const crm = opt('crm') || '';
  const [input, output] = args;
  if (!input || !output) {
    console.error('Uso: node scripts/preparar-lp.js <entrada.html> <saida.html> --lp <identificador> --area <área> [--crm https://…]');
    process.exit(1);
  }
  try {
    const r = prepare(fs.readFileSync(input, 'utf8'), { lp, area, crm });
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, r.html);
    console.log(`LP preparada: ${output} (lp=${lp}, área=${area}, CRM=${crm || 'o próprio CRM em /lp/'}).`);
    if (!r.wired) console.warn('Atenção: não encontrei leadEndpoint:"" na LP. No envio do formulário, use VeroLP.enviar(dados).');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { prepare };
