import { uuid, lsGet, lsSet } from './util.js';

// 앱 전역 상태
export const S = {
  info: null,          // /api/me 응답
  actKid: null,        // 공용 기기에서 현재 선택된 아이
  elev: null,          // 공용 기기 어른 재인증 { token, memberId, name, exp }
  online: navigator.onLine,
};
export const isDevice = () => S.info?.session.kind === 'device';
export const isAdultNow = () => (S.info && !isDevice() && !!S.info.me) || !!(S.elev && S.elev.exp > Date.now());
export const kidById = (id) => S.info?.kids.find((k) => k.id === Number(id));
export const adultById = (id) => S.info?.adults.find((a) => a.id === Number(id));

export class ApiError extends Error {
  constructor(status, body) { super(body?.message || '요청에 실패했어요.'); this.status = status; this.code = body?.error; this.body = body || {}; }
}
export class NetError extends Error { constructor() { super('인터넷 연결을 확인해 주세요.'); this.net = true; } }

// UI 가 주입하는 프롬프트(재인증/아이 PIN). ui.js 가 등록한다.
export const hooks = { reauth: null, unlock: null, loginRequired: null };

async function once(method, url, body, key, opts) {
  const headers = { 'X-Requested-With': 'lovefamily' };
  if (body !== undefined && !(body instanceof Blob)) headers['Content-Type'] = 'application/json';
  if (key) headers['X-Idempotency-Key'] = key;
  if (isDevice()) {
    if (S.actKid) headers['X-Act-Kid'] = String(S.actKid);
    if (S.elev && S.elev.exp > Date.now()) headers['X-Elevation'] = S.elev.token;
  }
  Object.assign(headers, opts?.headers || {});
  let res;
  try {
    res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body) });
  } catch { throw new NetError(); }
  let json = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export async function api(method, url, body, opts = {}) {
  const key = method === 'GET' ? null : uuid(); // 네트워크 재시도에도 서버에서 한 번만 처리되도록 같은 키 재사용
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await once(method, url, body, key, opts);
      setOnline(true);
      return r;
    } catch (e) {
      if (e instanceof NetError) {
        setOnline(false);
        if (attempt < (opts.retries ?? (method === 'GET' ? 0 : 2))) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
        throw e;
      }
      if (e instanceof ApiError && !opts.noPrompt && attempt < 3) {
        if (e.status === 401 && e.code === 'reauth_required' && hooks.reauth) { if (await hooks.reauth()) continue; }
        else if (e.status === 403 && e.code === 'kid_locked' && hooks.unlock) { if (await hooks.unlock(S.actKid)) continue; }
        else if (e.status === 401 && e.code === 'login_required' && hooks.loginRequired) { hooks.loginRequired(); }
      }
      throw e;
    }
  }
}
export const get = (u, o) => api('GET', u, undefined, o);
export const post = (u, b = {}, o) => api('POST', u, b, o);
export const put = (u, b = {}, o) => api('PUT', u, b, o);
export const patch = (u, b = {}, o) => api('PATCH', u, b, o);
export const del = (u, o) => api('DELETE', u, undefined, o);

// ---- 온라인 상태 / 저장 대기 대기열 (체크 토글만: 같은 값으로 다시 보내도 안전한 동작) ----
const listeners = new Set();
export const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((f) => f());
function setOnline(v) { if (S.online !== v) { S.online = v; notify(); } }

let outbox = lsGet('outbox', []);
export const pendingItems = () => new Map(outbox.map((o) => [o.itemId, o]));
export const outboxCount = () => outbox.length;
const saveBox = () => { lsSet('outbox', outbox); notify(); };
let flushing = false;
export async function flushOutbox() {
  if (flushing || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      const o = outbox[0];
      try { const st = await once('PUT', `/api/day-items/${o.itemId}`, { done: o.done }, o.key, { headers: o.act ? { 'X-Act-Kid': String(o.act) } : {} }); outbox.shift(); saveBox(); setOnline(true); o.cb?.(st); }
      catch (e) {
        if (e instanceof NetError) { setOnline(false); break; }
        outbox.shift(); saveBox(); // 서버가 거절(잠김 등)한 항목은 버리고 화면을 새로 읽게 한다
      }
    }
  } finally { flushing = false; bus.emit('synced'); }
}
// 체크 토글: 서버 확정 전에는 '저장 중/저장 대기'로 표시되고 확정으로 취급하지 않는다.
export async function toggleItem(itemId, done) {
  outbox = outbox.filter((o) => o.itemId !== itemId);
  outbox.push({ itemId, done, key: uuid(), act: S.actKid, t: Date.now() });
  saveBox();
  bus.emit('synced');
  await flushOutbox();
}
window.addEventListener('online', () => { setOnline(true); flushOutbox(); bus.emit('refresh', ['all']); });
window.addEventListener('offline', () => setOnline(false));
setInterval(() => { if (outbox.length) flushOutbox(); }, 6000);

// ---- 이벤트 버스 + SSE ----
export const bus = {
  h: {},
  on(t, f) { (this.h[t] ||= new Set()).add(f); return () => this.h[t].delete(f); },
  emit(t, ...a) { (this.h[t] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); },
};
let es = null; let esKid;
export function connectStream() {
  const kid = isDevice() ? S.actKid : null;
  if (es && esKid === kid) return;
  es?.close();
  esKid = kid;
  es = new EventSource(`/api/stream${kid ? `?kid=${kid}` : ''}`);
  let opened = false;
  es.onopen = () => { setOnline(true); if (opened) bus.emit('refresh', ['all']); opened = true; flushOutbox(); };
  es.onerror = () => { if (!navigator.onLine) setOnline(false); };
  es.onmessage = (m) => {
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    if (ev.t === 'refresh') bus.emit('refresh', ev.topics || ['all']);
    else if (ev.t === 'notify') bus.emit('notify', ev);
    else if (ev.t === 'timer') bus.emit('timer', ev);
    else if (ev.t === 'stamp') bus.emit('stamp', ev);
  };
}
export function disconnectStream() { es?.close(); es = null; esKid = undefined; }
