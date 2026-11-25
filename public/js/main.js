import './emo.js';
import { $, $$, esc, lsGet, lsSet, kstParts } from './util.js';
import { S, get, post, bus, connectStream, disconnectStream, onStatus, outboxCount, isDevice, boundKid, hooks, flushOutbox, ApiError } from './api.js';
import * as kidme from './views/kidme.js';
import { popup, toast, sheetOpen, openSheet, needAdult, avatar, playStamp, playCoins, coinsSeen } from './ui.js';
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
import { syncPush } from './views/family.js';
import { initReorder, decoratePage, applyLayout } from './reorder.js';

const app = document.getElementById('app');
const routes = [];
const R = (pattern, view, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, view, ...opts });
};
// 공개 화면(로그인 전)
R('/login', auth.login, { pub: true }); R('/pair', auth.pair, { pub: true }); R('/register', auth.register, { pub: true }); R('/join/:code', auth.join, { pub: true }); R('/join', auth.join, { pub: true }); R('/reset', auth.reset, { pub: true });
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
R('/me', kidme, { tab: 'me' });
R('/kid/:id/timer', timerui.timerPage, { tab: 'today', kid: true, nopin: true });
R('/kid/:id/supplies', supplies.kidSupplies, { tab: 'today', kid: true, nopin: true });
R('/kid/:id/family', plan.kidPick, { tab: 'today', kid: true, nopin: true });
R('/family-activity', plan.adultPlan, { tab: 'family', adult: true });

const TABS = [['today', '/', '🏠', '우리집'], ['routines', '/routines', '📝', '할일'], ['stamps', '/stamps', '💮', '도장판'], ['family', '/family', '👨‍👩‍👧‍👦', '가족']];

let current = null;       // 현재 화면 컨트롤러
let navToken = 0;
let pendingRefresh = false;
const here = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

export function go(path) { location.hash = path; }
window.__go = go;

function themeApply() {
  const night = lsGet('theme', 'light') === 'dark'; // 자동 없음: 낮/밤만 직접 고른다
  document.documentElement.dataset.theme = night ? 'dark' : 'light';
  const w = lsGet('wall', 'cloud');
  document.documentElement.style.setProperty('--wall', /^(cloud|candy|rose|lilac)$/.test(w) ? `url(/assets/bg/${w}.webp)` : 'none');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? '#241d3a' : '#f3dff3');
}
themeApply();
bus.on('theme', themeApply);

async function loadInfo() {
  try { S.info = await get('/api/me', { noPrompt: true }); lsSet('infoCache', S.info); return true; }
  catch (e) { if (e instanceof ApiError && e.status === 401) { S.info = null; lsSet('infoCache', null); lsSet('homeCache', null); return false; } throw e; }
}
bus.on('reloadInfo', async () => { await loadInfo(); });

function tabsFor() {
  const k = boundKid();
  if (!k) return TABS;
  return [['home', '/', '🏠', '우리집'], ['today', `/kid/${k}`, '✅', '내 화면'], ['stamps', `/kid/${k}/stamps`, '💮', '도장판'], ['me', '/me', '⚙️', '내 설정']];
}
function shell() {
  const dev = isDevice();
  app.innerHTML = `<div class="shell ${dev ? 'device' : ''}">
    <div class="conn-banner" id="conn" hidden></div>
    <main id="main" tabindex="-1"></main>
    <nav class="tabs" aria-label="주요 메뉴" data-rc="tabs">${tabsFor().map(([k, p, ic, t]) => `<a href="#${p}" class="tab" data-tab="${k}" data-rk="${k}"><span class="ti">${ic}</span><span>${t}</span></a>`).join('')}</nav></div>`;
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
  if (S.info && boundKid() && !match.pub) { // 아이 폰: 자기 아이 화면과 내 설정만 열린다
    const own = boundKid();
    S.actKid = own; document.body.classList.add('kidphone');
    const ok = match.view === kidme || match.view === home || (match.kid && Number(params.id) === own); // 우리집 대시보드(홈)도 볼 수 있다
    if (!ok) { go('/'); return; }
  } else document.body.classList.remove('kidphone');
  if (!S.info) { if (!match.pub) { go('/login'); return; } app.innerHTML = '<div id="main" class="authwrap"></div>'; current = await match.view.mount?.($('#main'), params) || await match.view($('#main'), params); return; }
  if (match.pub) { go('/'); return; }
  // 아이 화면: 공용 기기에서는 해당 아이로 전환
  if (isDevice()) {
    const want = match.kid ? Number(params.id) : null;
    if (S.actKid !== want) { S.actKid = want; connectStream(); }
  }
  if (!$('.shell')) shell();
  else if (boundKid() && $$('.tab').length !== 4) { $('.tabs').innerHTML = tabsFor().map(([k, p, ic, t]) => `<a href="#${p}" class="tab" data-tab="${k}"><span class="ti">${ic}</span><span>${t}</span></a>`).join(''); }
  const tabKey = boundKid() && match.view === home ? 'home' : match.tab;
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tabKey));
  const main = $('#main');
  main.onclick = null; // 이전 화면의 눌림 처리가 새 화면에 남지 않게
  main.innerHTML = '<div class="loading">불러오는 중…</div>';
  setTimeout(() => { const l = $('.loading', main); if (l && token === navToken) l.innerHTML = '불러오는 중…<br><small>오래 걸리고 있어요. 인터넷을 확인하고 다시 시도해 주세요.</small><br><button class="btn small" id="retryLoad">다시 시도</button>', $('#retryLoad', l).onclick = () => location.reload(); }, 12000);
  if (match.adult && !(await needAdult())) { if (token === navToken) go('/'); return; }
  if (token !== navToken) return;
  if (match.kid && !match.nopin && isDevice()) { // 비밀번호가 걸린 아이는 해제 후 입장
    const k = S.info.kids.find((x) => x.id === Number(params.id));
    if (k?.hasPin) { try { await get(`/api/kids/${k.id}/wallet`); } catch { if (token === navToken) go('/'); return; } }
  }
  try {
    const view = match.view.mount || match.view;
    const ctl = await view(main, params);
    decoratePage(main, path.replace(/\/\d+/g, '/:id'));
    applyLayout();
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
bus.on('stamp', (ev) => { if (boundKid() && ev.kidId !== boundKid()) return; if (isDevice()) playStamp({ provider: ev.provider, key: ev.stampId }); });
// 용돈·보상이 들어오면 어느 화면에 있든 '저금통에 쏙' 모션(그 아이 폰, 거실 기기). 거실 기기에서는 금액은 가린다.
const coinSeen = new Set();
bus.on('coins', (ev) => {
  if (!isDevice() || coinSeen.has(ev.key)) return;
  coinSeen.add(ev.key); coinsSeen.set(ev.kidId, Date.now());
  playCoins(ev.dir === 'out' ? 'out' : 'in', ev.amount, { hideAmount: !boundKid(), pieces: ev.pieces });
});
const INFO_KINDS = new Set(['money_approved', 'money_done', 'money_rejected', 'stamp_approved', 'board_complete', 'praise', 'mission_done', 'mission_reward']);
bus.on('notify', async (ev) => {
  if (seen.has(ev.id)) return;
  markSeen(ev.id);
  try {
    const n = await get(`/api/notifications/${ev.id}`, { noPrompt: true });
    bus.emit('notified', n);
    if (ev.popup === false) return;
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') return; // 백그라운드는 시스템 푸시가 처리
    const info = INFO_KINDS.has(n.kind); // 결과만 알려 주는 소식(승인됐어요·입금됐어요 등)은 [확인]으로 닫기만 한다. 눌러서 처리할 요청은 [열기].
    popup({ title: n.title, body: n.body, actionLabel: info ? '확인' : '열기', onAction: () => { post(`/api/notifications/${n.id}/read`, {}, { noPrompt: true }).catch(() => {}); if (!info) openNotification(n); }, kind: n.kind });
  } catch {}
});
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.t === 'open') { if (e.data.nid) markSeen(e.data.nid); const u = e.data.url || '/'; go(u.startsWith('/#') ? u.slice(2) : '/'); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { bus.emit('refresh', ['all']); flushOutbox(); } });

hooks.loginRequired = () => { S.info = null; lsSet('infoCache', null); lsSet('homeCache', null); disconnectStream(); go('/login'); };

export async function boot() {
  initReorder();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  // 빠른 시작: 지난번에 받아 둔 가족 정보로 화면을 먼저 그리고(불러오는 중 없이), 서버 확인은 뒤에서 한다. 로그인이 풀렸으면 그때 로그인 화면으로 보낸다.
  const cached = lsGet('infoCache', null);
  if (cached?.session) {
    S.info = cached;
    if (!location.hash || location.hash === '#') location.hash = '#/';
    render();
    loadInfo().then((ok) => { if (ok) { connectStream(); startTimerManager(); syncPush(); bus.emit('refresh', ['family']); } else { disconnectStream(); go('/login'); } }).catch(() => { connectStream(); });
    return;
  }
  if (await loadInfo()) { connectStream(); startTimerManager(); syncPush(); }
  if (!location.hash || location.hash === '#') { if (!S.info) go('/login'); }
  render();
}
export async function afterLogin() {
  await loadInfo(); S.actKid = boundKid(); S.elev = null;
  app.innerHTML = '';
  connectStream(); startTimerManager();
  go('/');
  render();
}
export async function logout() {
  try { await post('/api/auth/logout', {}, { noPrompt: true }); } catch {}
  lsSet('infoCache', null); lsSet('homeCache', null);
  S.info = null; S.actKid = null; S.elev = null; disconnectStream(); app.innerHTML = ''; go('/login'); render();
}
window.__app = { afterLogin, logout, go, render };
boot();
