let csrf = '';
export const setCsrf = (token) => { csrf = token || ''; };

export async function api(method, url, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (csrf) options.headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw Object.assign(new Error('No se pudo conectar con el servidor.'), { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    throw Object.assign(new Error((data && data.error) || `Error ${res.status}`), { status: res.status, data });
  }
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body = {}) => api('PUT', url, body);
export const del = (url) => api('DELETE', url);
