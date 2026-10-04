// Planilhas do Excel (.xlsx) e documentos do Word (.docx) no navegador, sem biblioteca externa.
// Gera .xlsx (modelos de importação) e lê .xlsx/.docx (importação de leads e transcrição da R1).
// O arquivo é um ZIP: na geração os itens são gravados sem compressão; na leitura usa DecompressionStream.

/* ------------------------- ZIP ------------------------- */

const enc = new TextEncoder();
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameB = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint16(8, 0, true); // sem compressão
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
}

async function inflate(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não lê arquivos .xlsx/.docx. Salve como CSV e tente de novo.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lê os itens de um ZIP: { nome: Uint8Array } (só os pedidos em wanted, se informado). */
async function unzip(buffer, wanted = null) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo inválido: não é uma planilha .xlsx nem um documento .docx.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (wanted && !wanted(name)) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = bytes.subarray(start, start + csize);
    out[name] = method === 0 ? raw : await inflate(raw);
  }
  return out;
}

/* ------------------------- Escrita (.xlsx) ------------------------- */

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/**
 * Gera um .xlsx. sheets: [{ name, rows: [[...]], widths?: [n], styles?: (r, c) => 0|1|2|3 }]
 * Estilos: 0 normal, 1 cabeçalho obrigatório (negrito, fundo escuro), 2 cabeçalho opcional (negrito, fundo claro), 3 negrito.
 */
export function buildXlsx(sheets) {
  const sheetXml = (sh) => {
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rows = sh.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const st = sh.styles ? sh.styles(r, c) : 0;
      const ref = `${colName(c)}${r + 1}`;
      if (v == null || v === '') return st ? `<c r="${ref}" s="${st}"/>` : '';
      if (typeof v === 'number') return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF0D1B2A"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B263B"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0E1DD"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="2" fillId="3" applyFont="1" applyFill="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>'],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files);
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/* ------------------------- Leitura (.xlsx) ------------------------- */

const xmlText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
// Datas do Excel (número de série) → AAAA-MM-DD
const excelDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000)).toISOString().slice(0, 10);

/** Lê a primeira planilha de um .xlsx: matriz de textos. */
export async function readXlsx(buffer) {
  const files = await unzip(buffer, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/styles.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const dec = new TextDecoder();
  const shared = files['xl/sharedStrings.xml'] ? [...dec.decode(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : [];
  // Estilos de data (para converter números de série)
  const dateStyles = new Set();
  if (files['xl/styles.xml']) {
    const st = dec.decode(files['xl/styles.xml']);
    const custom = new Map([...st.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), m[2]]));
    const xfs = (st.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
    [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].forEach((m, i) => {
      const id = Number((m[1].match(/numFmtId="(\d+)"/) || [])[1] || 0);
      const code = custom.get(id) || '';
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (code && /[dy]/i.test(code.replace(/"[^"]*"/g, '')))) dateStyles.add(i);
    });
  }
  let sheetName = 'xl/worksheets/sheet1.xml';
  if (files['xl/workbook.xml'] && files['xl/_rels/workbook.xml.rels']) {
    const rid = (dec.decode(files['xl/workbook.xml']).match(/<sheet [^>]*r:id="([^"]+)"/) || [])[1];
    const target = rid && (dec.decode(files['xl/_rels/workbook.xml.rels']).match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`)) || [])[1];
    if (target) sheetName = `xl/${target.replace(/^\/?xl\//, '')}`;
  }
  const xml = files[sheetName] ? dec.decode(files[sheetName]) : '';
  if (!xml) throw new Error('Planilha vazia ou não encontrada no arquivo.');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const cm of (rm[1] || '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const t = (attrs.match(/t="([^"]+)"/) || [])[1];
      const s = Number((attrs.match(/s="(\d+)"/) || [])[1] || 0);
      const inner = cm[2] || '';
      let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's') v = shared[Number(v)];
      else if (t === 'inlineStr') v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
      if (v != null && t !== 's') v = xmlText(v);
      if (v != null && !t && dateStyles.has(s) && /^\d+(\.\d+)?$/.test(v)) v = excelDate(Number(v));
      row[ref ? colIndex(ref) : row.length] = v ?? '';
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  while (rows.length && rows[rows.length - 1].every((x) => String(x).trim() === '')) rows.pop();
  return rows;
}

/** Converte linhas em CSV (separado por ponto e vírgula), para reaproveitar a importação existente. */
export function rowsToCsv(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, i) => {
    const v = String(r[i] ?? '');
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(';')).join('\n');
}

/** Texto de um .docx (parágrafos separados por quebra de linha). */
export async function readDocxText(buffer) {
  const files = await unzip(buffer, (n) => n === 'word/document.xml');
  const xml = files['word/document.xml'] ? new TextDecoder().decode(files['word/document.xml']) : '';
  if (!xml) throw new Error('Documento do Word sem texto.');
  return xml.split(/<\/w:p>/).map((p) => xmlText([...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] ?? '\t')).join(''))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Lê um arquivo enviado pelo usuário como texto: .xlsx vira CSV, .docx vira texto; demais formatos como texto UTF-8. */
export async function fileToText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return rowsToCsv(await readXlsx(await file.arrayBuffer()));
  if (name.endsWith('.docx')) return readDocxText(await file.arrayBuffer());
  if (name.endsWith('.xls') || name.endsWith('.doc')) throw new Error('Formato antigo do Office (.xls/.doc): salve como .xlsx, .docx ou CSV.');
  return file.text();
}
