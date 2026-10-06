'use strict';
/**
 * Lê o arquivo de configuração local (config.env na pasta do sistema, ou o caminho em CRM_CONFIG), no formato
 * CHAVE=valor, uma por linha (# comenta). Variáveis já definidas no ambiente têm prioridade.
 * O arquivo guarda senhas e chaves (Google, SMTP): fica fora do controle de versão (.gitignore).
 */
const fs = require('node:fs');
const path = require('node:path');

function loadConfigEnv(file = process.env.CRM_CONFIG || path.join(__dirname, '..', 'config.env')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const loaded = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined || process.env[m[1]] === '') {
      process.env[m[1]] = v;
      loaded.push(m[1]);
    }
  }
  return loaded;
}

module.exports = { loadConfigEnv };
