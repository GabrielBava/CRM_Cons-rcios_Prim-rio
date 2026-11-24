#!/usr/bin/env bash
# Diagnóstico do WhatsApp Lite. Rode na VPS, como root:
#   curl -fsSL https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/HEAD/deploy/whatsapp-lite/diagnostico.sh -o diagnostico.sh
#   bash diagnostico.sh
# Mostra, sem expor a chave nem os números completos:
#   - os números conectados no conector;
#   - para onde o conector manda as mensagens recebidas (webhook do CRM) e se o CRM aceita;
#   - as últimas mensagens que passaram pelo conector;
#   - os últimos erros do conector.
set -uo pipefail
PASTA="${VERO_PASTA:-/opt/vero-whatsapp}"
cd "$PASTA" 2>/dev/null || { echo "Conector não encontrado em $PASTA. Rode o instalador primeiro."; exit 1; }
if ! docker compose ps --status running --services 2>/dev/null | grep -qx evolution-api; then
  echo "O conector não está rodando. Rode: vero-whatsapp reiniciar"
  exit 1
fi

docker compose exec -T -w /evolution evolution-api node - <<'NODE'
const key = process.env.AUTHENTICATION_API_KEY;
const base = 'http://127.0.0.1:8080';
const mask = (s) => String(s || '').replace(/\d{6,}/g, (d) => `${d.slice(0, 4)}${'*'.repeat(d.length - 8)}${d.slice(-4)}`);
const maskUrl = (u) => String(u || '').replace(/(\/webhook\/[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/, '$1…');
const api = async (p) => {
  const r = await fetch(base + p, { headers: { apikey: key } });
  return r.json().catch(() => null);
};
const hora = (ts) => new Date(Number(ts) * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const ESTADO = { open: 'conectado', connecting: 'aguardando QR Code', close: 'desconectado' };

(async () => {
  const list = await api('/instance/fetchInstances');
  console.log('== Números no conector ==');
  if (!Array.isArray(list) || !list.length) console.log('Nenhum. Conecte pelo CRM: Comunicação › WhatsApp › Conectar meu WhatsApp.');
  for (const it of Array.isArray(list) ? list : []) {
    console.log(`\n* ${it.name} · ${ESTADO[it.connectionStatus] || it.connectionStatus} · número ${mask(String(it.ownerJid || '').split('@')[0]) || '-'}`);
    const wh = await api(`/webhook/find/${encodeURIComponent(it.name)}`);
    if (!wh || !wh.url) {
      console.log('  Webhook: NÃO CADASTRADO. O conector não avisa o CRM das mensagens recebidas.');
      continue;
    }
    const evs = Array.isArray(wh.events) ? wh.events : [];
    console.log(`  Webhook: ${wh.enabled ? 'ligado' : 'DESLIGADO'} · ${maskUrl(wh.url)}`);
    console.log(`  Eventos: ${evs.join(', ') || '(nenhum)'}${evs.includes('MESSAGES_UPSERT') ? '' : '  <- falta MESSAGES_UPSERT (mensagens recebidas)'}`);
    try {
      const r = await fetch(wh.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'diagnostico', instance: it.name }),
        signal: AbortSignal.timeout(20000),
      });
      const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 140);
      let veredito = 'OK: o CRM recebe os avisos deste número';
      if (!r.ok) veredito = r.status === 401 && /desconhecida/i.test(t) ? 'o CRM não reconhece este número (apagado ou recriado no CRM)' : `FALHOU · ${t}`;
      console.log(`  Teste do CRM: ${r.status} · ${veredito}`);
    } catch (e) {
      console.log(`  Teste do CRM: FALHOU · ${e.name === 'TimeoutError' ? 'sem resposta em 20 s' : e.cause?.code || e.message}`);
    }
  }

  try {
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient();
    const rows = await db.message.findMany({
      orderBy: { messageTimestamp: 'desc' },
      take: 12,
      select: { key: true, messageType: true, messageTimestamp: true, Instance: { select: { name: true } } },
    });
    console.log('\n== Últimas mensagens que passaram pelo conector ==');
    if (!rows.length) console.log('Nenhuma ainda.');
    for (const m of rows) {
      const k = m.key || {};
      const jid = String(k.remoteJid || '');
      const alt = k.remoteJidAlt || k.senderPn || '';
      const tipo = /@lid$/.test(jid) ? (alt ? 'LID com número' : 'LID SEM número') : /@g\.us$/.test(jid) ? 'grupo' : 'número';
      console.log(`${hora(m.messageTimestamp)} · ${k.fromMe ? 'enviada ' : 'RECEBIDA'} · ${m.messageType} · ${tipo} · ${mask(jid)}${alt && alt !== jid ? ` / ${mask(alt)}` : ''} · ${m.Instance?.name || ''}`);
    }
    await db.$disconnect();
  } catch (e) {
    console.log(`\n(não foi possível ler as mensagens guardadas: ${e.message})`);
  }
})();
NODE

echo
echo "== Últimos avisos e erros do conector (3 horas) =="
docker compose logs --since 3h --no-color evolution-api 2>/dev/null \
  | grep -iE "webhook|error" | grep -viE "Database URL|migration|└─" \
  | sed -E 's#(/webhook/[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+#\1…#g; s#([0-9]{4})[0-9]{2,}([0-9]{4})#\1****\2#g' \
  | tail -n 15
echo
echo "Fim do diagnóstico. Mande um print desta tela (não aparece a chave nem os números completos)."
