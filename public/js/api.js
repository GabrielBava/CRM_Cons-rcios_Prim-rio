// Cliente HTTP da aplicação. Todas as regras de permissão são verificadas no servidor.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua rede e tente novamente.');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/setup')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Erro ${res.status}`, data?.details);
  }
  return data;
}

export const get = (url, params) => {
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
    const s = q.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return api('GET', url);
};
export const post = (url, body = {}) => api('POST', url, body);
export const patch = (url, body = {}) => api('PATCH', url, body);

/** Baixa um arquivo (CSV) respeitando a sessão. */
export async function download(url, params) {
  if (window.CRM_PREVIEW) {
    throw new ApiError(0, 'Na versão de teste no navegador o download de arquivos fica desativado. No CRM instalado a exportação funciona normalmente.');
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const full = url + (q.toString() ? `?${q}` : '');
  const res = await fetch(full, { credentials: 'same-origin', headers: { 'X-Requested-With': 'crm' } });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'exportacao.csv';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
