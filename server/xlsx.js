'use strict';
/**
 * Planilha do Excel (.xlsx) gerada no servidor, sem biblioteca externa: um ZIP (sem compressão) com o XML do
 * SpreadsheetML. Usado na exportação dos relatórios (uma aba por relatório) e no pacote para BI.
 *
 * sheets: [{ name, columns: [{ label, type }], rows: [[...]] }]. Tipos: money e num (número com 2 casas),
 * int (inteiro), pct (percentual já multiplicado por 100, ex.: 12,5), date/datetime e texto.
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameB = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameB.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const size = central.reduce((t, b) => t + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
// Estilos: 0 texto, 1 cabeçalho, 2 número 2 casas, 3 inteiro, 4 data, 5 título, 6 total (negrito, 2 casas)
const STYLE_BY_TYPE = { money: 2, num: 2, pct: 2, int: 3, date: 4, datetime: 4 };
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const excelDate = (v) => {
  const ms = Date.parse(String(v).length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(ms)) return null;
  const local = String(v).length === 10 ? ms : ms - 3 * 3600000; // horário de Brasília
  return Math.round(((local - EXCEL_EPOCH) / 86400000) * 100000) / 100000;
};

function sheetXml(sh) {
  const widths = sh.columns.map((c, i) => Math.min(60, Math.max(10, String(c.label).length + 2, ...sh.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))));
  const cell = (v, r, c, style) => {
    const ref = `${colName(c)}${r}`;
    if (v == null || v === '') return '';
    const type = sh.columns[c]?.type;
    if ((type === 'date' || type === 'datetime') && style !== 1) {
      const d = excelDate(v);
      if (d != null) return `<c r="${ref}" s="4"><v>${d}</v></c>`;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${style === 2 || style === 3 ? 0 : style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const lines = [];
  let r = 1;
  if (sh.title) {
    lines.push(`<row r="${r}">${cell(sh.title, r, 0, 5)}</row>`);
    r += 1;
    if (sh.subtitle) {
      lines.push(`<row r="${r}">${cell(sh.subtitle, r, 0, 0)}</row>`);
      r += 1;
    }
    r += 1;
  }
  const headerRow = r;
  lines.push(`<row r="${r}">${sh.columns.map((c, i) => cell(c.label, r, i, 1)).join('')}</row>`);
  for (const row of sh.rows) {
    r += 1;
    lines.push(`<row r="${r}">${row.map((v, i) => cell(v, r, i, STYLE_BY_TYPE[sh.columns[i]?.type] ?? 0)).join('')}</row>`);
  }
  if (sh.totals) {
    r += 1;
    lines.push(`<row r="${r}">${sh.totals.map((v, i) => cell(v, r, i, 6)).join('')}</row>`);
  }
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const pane = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  const filter = sh.rows.length ? `<autoFilter ref="A${headerRow}:${colName(sh.columns.length - 1)}${headerRow + sh.rows.length}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${lines.join('')}</sheetData>${filter}</worksheet>`;
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0D1B2A"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B263B"/></patternFill></fill></fills>' +
  '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>' +
  '<cellXfs count="7"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="1" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/><xf fontId="3" numFmtId="164" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>';

/** Gera o .xlsx (Buffer). */
function buildXlsx(sheets) {
  const names = new Set();
  const safe = sheets.map((s, i) => {
    let n = String(s.name || `Planilha ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Planilha ${i + 1}`;
    while (names.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i + 1}`;
    names.add(n.toLowerCase());
    return { ...s, name: n };
  });
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...safe.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]);
}

/** Relatório no formato da API ({ title, columns: [{key,label,type}], rows: [{}], totals }) → aba da planilha. */
function reportSheet(r, name) {
  const cols = r.columns.map((c) => ({ label: c.label, type: c.type }));
  const pick = (row) => r.columns.map((c) => row[c.key] ?? null);
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
  return {
    name: name || r.title,
    title: r.title,
    subtitle: r.period ? `Período: ${fmt(r.period.from)} a ${fmt(r.period.to)} · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : null,
    columns: cols,
    rows: r.rows.map(pick),
    totals: r.totals ? r.columns.map((c, i) => (i === 0 && r.totals[c.key] == null ? 'Total' : r.totals[c.key] ?? null)) : null,
  };
}

module.exports = { buildXlsx, reportSheet, zip, crc32 };
