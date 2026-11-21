import './emo.js';
import { $, $$, esc, lsGet, lsSet, kstParts } from './util.js';
import { S, get, post, bus, connectStream, disconnectStream, onStatus, outboxCount, isDevice, hooks, flushOutbox, ApiError } from './api.js';
import { popup, toast, sheetOpen, openSheet, needAdult, avatar, playStamp } from './ui.js';
import * as auth from './views/auth.js';
import * as home from './views/home.js';
import * as adult from './views/adult.js';
import * as kid from './views/kid.js';
import * as wallet from './views/wallet.js';
import * as wishes from './views/wishes.js';
import * as talk from './views/talk.js';
import * as routines from './views/routines.js';
import * as stamps from './views/stamps.js';
import * as family from './views/family.js';
import * as notebook from './views/notebook.js';
import * as detail from './views/detail.js';
import * as timerui from './views/timerui.js';
import * as supplies from './views/supplies.js';
import * as plan from './views/plan.js';
import { startTimerManager } from './timers.js';

const app = document.getElementById('app');
const routes = [];
const R = (pattern, view, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, view, ...opts });
};
// 공개 화면(로그인 전)
R('/login', auth.login, { pub: true }); R('/register', auth.register, { pub: true }); R('/join/:code', auth.join, { pub: true }); R('/join', auth.join, { pub: true });
// 메인 화면
R('/', home, { tab: 'today' });
R('/adult', adult.page, { tab: 'today', adult: true }); R('/inbox', adult.inbox, { tab: 'today', adult: true });
R('/routines', routines, { tab: 'routines', adult: true });
R('/stamps', stamps, { tab: 'stamps' }); R('/stamps/:kidId', stamps, { tab: 'stamps' });
R('/family', family, { tab: 'family' });
R('/notebook', notebook, { tab: 'family' }); R('/notebook/:postId', notebook, { tab: 'family' });
R('/calendar', family.calendar, { tab: 'family' });
R('/approve/:id', detail.approve, { tab: 'today', adult: true }); R('/money/:id', detail.money, { tab: 'today', adult: true });
R('/messages/:kidId/:adultId', talk.adultThread, { tab: 'today', adult: true });
R('/kid/:id', kid.hub, { tab: 'today', kid: true }); R('/kid/:id/today', kid.today, { tab: 'today', kid: true });
R('/kid/:id/wallet', wallet, { tab: 'today', kid: true }); R('/kid/:id/wishes', wishes, { tab: 'today', kid: true });
R('/kid/:id/talk', talk.talk, { tab: 'today', kid: true }); R('/kid/:id/talk/:adultId', talk.talk, { tab: 'today', kid: true });
R('/kid/:id/inbox', talk.kidInbox, { tab: 'today', kid: true }); R('/kid/:id/missions', kid.missions, { tab: 'today', kid: true });
R('/kid/:id/stamps', stamps, { tab: 'stamps', kid: true });
R('/kid/:id/timer', timerui.timerPage, { tab: 'today', kid: true, nopin: true });
R('/kid/:id/supplies', supplies.kidSupplies, { tab: 'today', kid: true, nopin: true });
R('/kid/:id/family', plan.kidPick, { tab: 'today', kid: true, nopin: true });
R('/family-activity', plan.adultPlan, { tab: 'family', adult: true });

const TABS = [['today', '/', '🏠', '오늘'], ['routines', '/routines', '📝', '루틴'], ['stamps', '/stamps', '💮', '도장판'], ['family', '/family', '👨‍👩‍👧‍👦', '가족']];

let current = null;       // 현재 화면 컨트롤러
let navToken = 0;
let pendingRefresh = false;
const here = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

export function go(path) { location.hash = path; }
window.__go = go;

function themeApply() {
  const pref = lsGet('theme', 'auto');
  const h = kstParts(Date.now()).h;
  const night = pref === 'dark' || (pref === 'auto' && (h >= 19 || h < 7));
  document.documentElement.dataset.theme = night ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? '#241d3a' : '#f3dff3');
}
themeApply(); setInterval(themeApply, 60000);
bus.on('theme', themeApply);

async function loadInfo() {
  try { S.info = await get('/api/me', { noPrompt: true }); return true; }
  catch (e) { if (e instanceof ApiError && e.status === 401) { S.info = null; return false; } throw e; }
}
bus.on('reloadInfo', async () => { await loadInfo(); });

function shell() {
  const dev = isDevice();
  app.innerHTML = `<div class="shell ${dev ? 'device' : ''}">
    <div class="conn-banner" id="conn" hidden></div>
    <main id="main" tabindex="-1"></main>
    <nav class="tabs" aria-label="주요 메뉴">${TABS.map(([k, p, ic, t]) => `<a href="#${p}" class="tab" data-tab="${k}"><span class="ti">${ic}</span><span>${t}</span></a>`).join('')}</nav></div>`;
  updateConn();
}
function updateConn() {
  const el = $('#conn'); if (!el) return;
  const n = outboxCount();
  if (!S.online) { el.hidden = false; el.textContent = n ? `연결이 끊겼어요 · 저장 대기 ${n}개 (연결되면 자동으로 저장돼요)` : '연결이 끊겼어요 · 다시 연결되면 자동으로 새로고침돼요'; el.className = 'conn-banner off'; }
  else if (n) { el.hidden = false; el.textContent = `저장 중… (${n}개)`; el.className = 'conn-banner wait'; }
  else el.hidden = true;
}
onStatus(updateConn);

async function render() {
  const token = ++navToken;
  const path = here();
  current?.destroy?.(); current = null;
  let match = null, params = {};
  for (const r of routes) { const m = path.match(r.re); if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; } }
  if (!match) { go('/'); return; }
  if (!S.info) { if (!match.pub) { go('/login'); return; } app.innerHTML = '<div id="main" class="authwrap"></div>'; current = await match.view.mount?.($('#main'), params) || await match.view($('#main'), params); return; }
  if (match.pub) { go('/'); return; }
  // 아이 화면: 공용 기기에서는 해당 아이로 전환
  if (isDevice()) {
    const want = match.kid ? Number(params.id) : null;
    if (S.actKid !== want) { S.actKid = want; connectStream(); }
  }
  if (!$('.shell')) shell();
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === match.tab));
  const main = $('#main');
  main.innerHTML = '<div class="loading">불러오는 중…</div>';
  if (match.adult && !(await needAdult())) { if (token === navToken) go('/'); return; }
  if (token !== navToken) return;
  if (match.kid && !match.nopin && isDevice()) { // 비밀번호가 걸린 아이는 해제 후 입장
    const k = S.info.kids.find((x) => x.id === Number(params.id));
    if (k?.hasPin) { try { await get(`/api/kids/${k.id}/wallet`); } catch { if (token === navToken) go('/'); return; } }
  }
  try {
    const view = match.view.mount || match.view;
    const ctl = await view(main, params);
    if (token !== navToken) { ctl?.destroy?.(); return; }
    current = ctl || null;
    main.focus({ preventScroll: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.code === 'login_required') return;
    console.error(e);
    main.innerHTML = `<div class="empty"><p>${esc(e.message || '불러오지 못했어요.')}</p><button class="btn primary" id="retry">다시 시도</button></div>`;
    $('#retry')?.addEventListener('click', render);
  }
}
window.addEventListener('hashchange', render);

// 실시간 갱신: 입력 중이거나 시트가 열려 있으면 미뤘다가 닫힌 뒤 반영
function maybeRefresh(topics) {
  if (!current?.refresh) return;
  const mine = current.topics;
  if (mine && !topics.includes('all') && !topics.some((t) => mine.includes(t))) return;
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (sheetOpen() || typing) { pendingRefresh = true; return; }
  current.refresh();
}
bus.on('refresh', (topics) => { clearTimeout(maybeRefresh.t); maybeRefresh.t = setTimeout(() => maybeRefresh(topics), 250); });
bus.on('synced', () => { if (current?.refresh && current.topics?.includes('day')) current.refresh(); });
setInterval(() => { if (pendingRefresh && !sheetOpen() && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) { pendingRefresh = false; current?.refresh?.(); } }, 1200);

// 실시간 알림 팝업 (같은 알림은 한 번만)
const seen = new Set(lsGet('seenNotifs', []));
const markSeen = (id) => { seen.add(id); lsSet('seenNotifs', [...seen].slice(-200)); };
export async function openNotification(n) {
  if (n.url?.startsWith('/#')) go(n.url.slice(2)); else if (n.url) go(n.url);
}
bus.on('stamp', (ev) => { if (isDevice()) playStamp({ provider: ev.provider, key: ev.stampId }); });
bus.on('notify', async (ev) => {
  if (seen.has(ev.id)) return;
  markSeen(ev.id);
  try {
    const n = await get(`/api/notifications/${ev.id}`, { noPrompt: true });
    bus.emit('notified', n);
    if (ev.popup === false) return;
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') return; // 백그라운드는 시스템 푸시가 처리
    popup({ title: n.title, body: n.body, onAction: () => { post(`/api/notifications/${n.id}/read`, {}, { noPrompt: true }).catch(() => {}); openNotification(n); }, kind: n.kind });
  } catch {}
});
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.t === 'open') { if (e.data.nid) markSeen(e.data.nid); const u = e.data.url || '/'; go(u.startsWith('/#') ? u.slice(2) : '/'); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { bus.emit('refresh', ['all']); flushOutbox(); } });

hooks.loginRequired = () => { S.info = null; disconnectStream(); go('/login'); };

export async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (await loadInfo()) { connectStream(); startTimerManager(); }
  if (!location.hash || location.hash === '#') { if (!S.info) go('/login'); }
  render();
}
export async function afterLogin() {
  await loadInfo(); S.actKid = null; S.elev = null;
  app.innerHTML = '';
  connectStream(); startTimerManager();
  go('/');
  render();
}
export async function logout() {
  try { await post('/api/auth/logout', {}, { noPrompt: true }); } catch {}
  S.info = null; S.actKid = null; S.elev = null; disconnectStream(); app.innerHTML = ''; go('/login'); render();
}
window.__app = { afterLogin, logout, go, render };
boot();
