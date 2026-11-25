import { $, $$, esc, dateLabel, timeLabel, kstParts, shortDate, lsGet, lsSet } from '../util.js';
import { S, get, post, put, isDevice, isAdultNow, bus, boundKid } from '../api.js';
import { avatar, memberAvatar, toast, errToast, toastAction, openSheet, openPhoto } from '../ui.js';
import { loadTimers } from '../timers.js';
import { kidTimerHtml, bindDismiss } from './timerui.js';
import { kidLine } from './plan.js';
import { statusButtons, bindStatus, statusLine, STATUS } from '../common.js';
import { T, timerOf, fmt, remaining } from '../timers.js';
import { actImgUrl } from '../actimg.js';
import { adultById } from '../api.js';
import { adultPanelHtml, bindAdultPanel } from './adult.js';
import { mountWalkers, walkPadHtml, walkerCell, anyMoving, cheer, syncWalkers } from './walkers.js';
import { mountPets } from './cats.js';
import { adultHome, petOfKidIdx, PET_NAMES, houseSrc } from '../layout.js';

const dayBadge = (k) => {
  const d = k.day;
  if (d.status === 'requested') return `<div class="kid-state wait">✋ 다 했어요 · 어른 확인 중</div>`;
  if (d.status === 'ready') return `<div class="kid-state ready">🎉 다 했어요 · 도장 방에서 도장 요청!</div>`;
  if (d.status === 'approved') return `<div class="kid-state ok">💮 도장 받았어요${d.stampBy ? ` <small>(${esc(d.stampBy)})</small>` : ''}</div>`;
  if (d.status === 'recheck') return `<div class="kid-state warn">🔎 다시 확인해 보래요</div>`;
  if (d.status === 'none') return `<div class="kid-state rest">😴 오늘은 쉬는 날이에요</div>`;
  return `<div class="kid-state">${d.total - d.done}개 남았어요</div>`;
};

// 간식주기·산책하기는 아이 본인 폰에서만 누른다: 본인 카드의 이름 옆에 [🍪 간식주기][🌳 산책하기]. 그 아이가 주인인 동물이 있을 때만 보인다
const petNameOf = (i) => PET_NAMES[petOfKidIdx(i)] || '';
function petBtns(k, i) {
  const pn = petNameOf(i);
  if (!boundKid() || boundKid() !== k.id || !pn) return '';
  return `<div class="kid-pet-btns"><button type="button" class="pet-bar-btn" data-pet-act="snack" data-kid="${k.id}" aria-label="${pn}에게 간식 주기">🍪<b>간식주기</b></button><button type="button" class="pet-bar-btn" data-pet-act="walk" data-kid="${k.id}" aria-label="${esc(k.name)}와 ${pn} 산책하기">🌳<b>산책하기</b></button></div>`;
}
// 아이 카드 아래 바로가기 4칸: 오늘 할일 · 활동 · 저금통 · 가족에게 말하기 (아이 허브 화면과 같은 순서)
function kidLinks(k) {
  const done = `${k.day.done}/${k.day.total}`;
  return `<nav class="kid-links" aria-label="${esc(k.name)} 바로가기"><a class="kl" href="#/kid/${k.id}/today">✅<b>할일</b></a><a class="kl" href="#/kid/${k.id}/timer">⏱️<b>활동</b></a><a class="kl" href="#/kid/${k.id}/wallet"><img class="emo" src="/assets/money/piggy.webp" alt="" draggable="false"><b>통장</b></a><a class="kl" href="${isDevice() || boundKid() || !S.info.me ? `#/kid/${k.id}/talk` : `#/messages/${k.id}/${S.info.me.id}`}">💌<b>메시지</b></a></nav>`;
}
function kidCard(k, i) {
  const pct = k.day.total ? Math.round((k.day.done / k.day.total) * 100) : 0;
  const rem = k.day.remaining;
  return `<article class="kid-card" data-rk="k${k.id}" style="--kc:${esc(k.color)}"><a class="kid-main" href="#/kid/${k.id}" aria-label="${esc(k.name)} 카드 열기">
    <div class="kid-top">${avatar(k, 'xl')}<div class="kid-name"><h2>${esc(k.name)}</h2>${k.hasPin ? '<span class="lock" title="비밀번호가 있어요">🔒</span>' : ''}</div></div>
    <div class="kid-progress" role="img" aria-label="오늘 할일 ${k.day.done}/${k.day.total}"><div class="bar"><i style="width:${pct}%"></i></div><b>${k.day.total ? `${k.day.done}/${k.day.total}` : '–'}</b></div>
    ${dayBadge(k)}
    ${rem.length && k.day.status === 'open' ? `<ul class="rem-chips">${rem.slice(0, 3).map((n) => `<li>${esc(n)}</li>`).join('')}${rem.length > 3 ? `<li class="more">+${rem.length - 3}</li>` : ''}</ul>` : ''}
    <div class="stamp-mini" aria-label="도장 ${k.board.count}/${k.board.size}"><span>💮 도장 <b>${k.board.count}</b>/${k.board.size}</span><div class="bar thin"><i style="width:${(k.board.count / k.board.size) * 100}%"></i></div></div>
  </a>${petBtns(k, i)}${kidTimerHtml(k)}${kidLinks(k)}</article>`;
}

function suppliesHtml(list) {
  return list.map((k) => `<div class="sup-kid" style="--kc:${esc(k.kidColor)}"><div class="sup-head">${memberAvatar(k.kidId, 'sm', { avatar: k.kidAvatar, color: k.kidColor })} <b>${esc(k.kidName)}</b></div>${k.cards.length ? k.cards.map((c) => `<div class="sup-card"><div class="small"><b>${esc(c.label)}</b> · ${c.checked}/${c.total} 챙겼어요</div>${c.allDone && !c.items.length ? '<div class="ok"><b>다 챙겼어요 ✅</b></div>' : ''}<div class="sup-chips">${c.items.map((i) => `<span class="sup-chip ${i.checked ? 'on' : ''}"><button class="sc-btn" data-sup="${i.id}" data-kid="${k.kidId}" data-checked="${i.checked ? 1 : 0}" aria-pressed="${i.checked}" aria-label="${esc(i.name)} ${i.checked ? '챙김' : '안 챙김'}">${i.checked ? '✔' : esc(i.icon)} ${esc(i.name)}</button>${i.photoUrl ? `<button class="sc-photo" data-photo="${esc(i.photoUrl)}" aria-label="알림장 사진 보기">📷</button>` : ''}</span>`).join('')}</div></div>`).join('') : '<p class="muted small">챙길 것이 없어요</p>'}</div>`).join('') || '<p class="muted">아이를 추가해 주세요</p>';
}
async function supplyClick(e) {
  const b = e.target.closest('[data-sup]'); const ph = e.target.closest('[data-photo]');
  if (ph) return openPhoto(ph.dataset.photo, '알림장 원본 사진');
  if (!b) return;
  const was = b.dataset.checked === '1'; const supId = b.dataset.sup; const kid = b.dataset.kid;
  try {
    await put(`/api/supplies/${supId}/kids/${kid}`, { checked: !was });
    if (!was) toastAction('챙겼어요! 👍', '되돌리기', () => put(`/api/supplies/${supId}/kids/${kid}`, { checked: false }).catch(errToast));
  } catch (x) { errToast(x); }
}

// ---- 우리 집 그림: 방마다 누를 수 있는 칸 (좌표는 house.webp 1086x1448 기준 %) ----
// k0·k1 = 아이방 둘(가족 탭 순서), bank = 도장방, a0·a1·a2 = 아래층 어른방(왼쪽·가운데·오른쪽). 어느 방에 누가 서는지는 layout.js 가 정한다.
const ROOMS = {
  living: [8.3, 10.4, 91.7, 32.5], k0: [5.1, 34.5, 34.1, 54.9], k1: [36.4, 34.5, 64.0, 54.9], bank: [65.8, 34.5, 94.8, 54.9],
  a0: [5.1, 56.6, 34.1, 76.4], a1: [36.4, 56.6, 64.0, 76.4], a2: [65.8, 56.6, 94.8, 76.4],
};
const ADULT_CELLS = ['20', '21', '22'];
const box = (k) => { const [x1, y1, x2, y2] = ROOMS[k]; return `left:${x1}%;top:${y1}%;width:${x2 - x1}%;height:${y2 - y1}%`; };
function houseHtml(h) {
  const kidRooms = h.kids.slice(0, 2).map((k, i) => {
    const t = timerOf(k.id); const d = k.day;
    const chips = [d.total ? `${d.done}/${d.total}` : '', d.status === 'approved' ? '💮' : d.status === 'requested' ? '✋' : d.status === 'ready' ? '🎉' : ''].filter(Boolean);
    // 활동 중이면 방 안의 캐릭터가 그 활동 그림으로 바뀌고(그림이 없으면 서 있는 모습 유지), 지난 시간·남은 시간·진행 막대를 보여 준다
    const total = t ? t.totalMs : 1; const rem = t ? remaining(t) : 0;
    // 지나간 시간만 그림 바로 아래에 표시(남은 시간·막대는 보여 주지 않는다)
    const timeTag = !t ? '' : t.state === 'paused'
      ? `<span class="room-time paused" role="timer" aria-label="${esc(t.name)} 일시 중단, 남은 시간">⏸ 남은 <span data-timer="${t.id}">${fmt(remaining(t))}</span></span>`
      : t.state === 'ended'
      ? `<span class="room-time ended" role="timer" aria-label="${esc(t.name)} 끝남">⏰ 끝났어요</span>`
      : `<span class="room-time" role="timer" aria-label="${esc(t.name)} 지난 시간">⏱ <span data-elapsed="${t.id}">${fmt(Math.max(0, total - rem))}</span></span>`;
    return `<button class="room kid ${t ? 'has-time' : ''}" style="${box(i === 0 ? 'k0' : 'k1')};--kc:${esc(k.color)}" data-room="kid" data-id="${k.id}" aria-label="${esc(k.name)}방 열기">${chips.length ? `<span class="room-chips">${chips.map((c) => `<i>${c}</i>`).join('')}</span>` : ''}${timeTag}</button>`;
  }).join('');
  const pending = h.kids.filter((k) => k.day.status === 'requested').length;
  // 어른방: 한 방에 어른이 둘 이상이면(예: 할머니·할아버지) 방을 나눠서 각자 누를 수 있게 한다
  const adults = ADULT_CELLS.map((cell, ci) => {
    const here = S.info.adults.filter((a) => adultHome(a.role) === cell);
    if (!here.length) return `<div class="room empty" style="${box('a' + ci)}"></div>`;
    const [x1, y1, x2, y2] = ROOMS['a' + ci]; const w = (x2 - x1) / here.length;
    return here.map((a, i) => {
      const st = h.adults.find((x) => x.id === a.id)?.status;
      return `<button class="room adult" style="left:${x1 + w * i}%;top:${y1}%;width:${w}%;height:${y2 - y1}%" data-room="adult" data-id="${a.id}" aria-label="${esc(a.name)}방 열기 (상태 바꾸기)${st ? ` · ${esc(st.label)}` : ''}"></button>`;
    }).join('');
  }).join('');
  return `<div class="house" role="group" aria-label="우리 집">
    <img src="${houseSrc()}" alt="" class="house-img" width="1086" height="1448">
    <button class="room" style="${box('living')}" data-room="living" aria-label="거실 열기 (알림장)"></button>
    ${kidRooms}
    <button class="room bank" style="${box('bank')}" data-room="bank" aria-label="은행·도장 열기">${pending ? `<span class="room-chips"><i>✋ 확인 ${pending}</i></span>` : ''}</button>
    ${adults}${walkPadHtml()}</div>`;
}
// 할일을 다 한 아이가 도장 방(확인방)까지 걸어오면, 그 방에 [도장 요청] 버튼이 나타난다. 누르면 그때 어른들께 알림이 간다.
function syncBankReq(col, h, reload) {
  const house = col.querySelector('.house'); if (!house) return;
  house.querySelectorAll('.bank-req').forEach((b) => b.remove());
  const ready = h.kids.filter((k) => { const w = walkerCell(k.id); return k.day.status === 'ready' && w && w.cell === '12' && !w.moving; });
  if (!ready.length) return;
  house.insertAdjacentHTML('beforeend', `<div class="bank-req" style="${box('bank')}">${ready.map((k) => `<button class="btn primary bank-req-btn" data-reqstamp="${k.id}">✋ ${esc(k.name)} 도장 요청</button>`).join('')}</div>`);
  house.querySelector('.bank-req').onclick = async (e) => {
    const b = e.target.closest('[data-reqstamp]'); if (!b) return;
    e.stopPropagation(); b.disabled = true;
    try { await post(`/api/kids/${b.dataset.reqstamp}/day/request`, { date: h.today }); toast('어른들께 도장 요청을 보냈어요! ✋'); reload(); } catch (x) { b.disabled = false; errToast(x); }
  };
}
function openAdultSheet(id, h, reload) {
  const a = adultById(id); const st = h.adults.find((x) => x.id === a.id)?.status;
  const sh = openSheet(`<h2>${avatar(a, 'sm')} ${esc(a.name)}의 상태</h2><p class="adult-status">${statusLine(st)}</p>${statusButtons(a.id, st?.state)}<div class="row end"><button class="btn ghost" data-close>닫기</button></div>`);
  bindStatus(sh.el, () => { sh.close(); reload(); });
}
function bindHouse(root, reload, h) {
  root.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-room]'); if (!r) return;
    const t = r.dataset.room;
    const kp = boundKid(); // 아이 폰: 보기 위주. 자기 방·자기 도장판만 열린다(어른 상태 바꾸기·알림장·형제 화면은 열지 않는다)
    if (kp) {
      if (t === 'kid' && Number(r.dataset.id) === kp) location.hash = `#/kid/${kp}`;
      else if (t === 'bank') location.hash = `#/kid/${kp}/stamps`;
      return;
    }
    if (t === 'kid') location.hash = `#/kid/${r.dataset.id}`;
    else if (t === 'bank') location.hash = '#/stamps';
    else if (t === 'living') location.hash = '#/notebook';
    else if (t === 'adult') {
      const a = adultById(r.dataset.id); const st = h.adults.find((x) => x.id === a.id)?.status;
      const sh = openSheet(`<h2>${avatar(a, 'sm')} ${esc(a.name)}의 상태</h2><p class="adult-status">${statusLine(st)}</p>${statusButtons(a.id, st?.state)}<div class="row end"><button class="btn ghost" data-close>닫기</button></div>`);
      bindStatus(sh.el, () => { sh.close(); reload(); });
    }
  });
}

function scheduleHtml(sch) {
  if (!sch.length) return '<p class="muted">오늘 일정이 없어요</p>';
  return `<ul class="sched">${sch.map((s) => `<li><span class="dot ${s.type}"></span><div><b>${s.time ? esc(s.time) + ' ' : ''}${esc(s.title)}</b>${s.kidName ? ` <span class="tag">${esc(s.kidName)}</span>` : ''}${s.type === 'due' ? ' <span class="tag due">제출·준비</span>' : ''}${s.supplies ? `<div class="small">🎒 ${esc(s.supplies)}</div>` : ''}</div></li>`).join('')}</ul>`;
}

export async function mount(el) {
  let timer;
  let lastSig = '';
  const lastDay = new Map(); // 아이별 직전 하루 상태: 도장을 '방금' 받았는지 알아내기 위함
  let deferred = false; // 누군가 걷는 중이면 화면을 다시 그리지 않고, 도착한 뒤에 한 번만 갱신(걷는 그림이 끊기거나 깜박이지 않게)
  const kidPhone = !!boundKid();
  const adultUser = !isDevice() && !kidPhone;
  async function load() {
    // 요청을 한꺼번에 보낸다(하나씩 기다리면 휴대폰 망에서 왕복 시간이 그대로 쌓인다)
    const [info, , home, ah] = await Promise.all([
      get('/api/me').catch(() => S.info), // 올린 얼굴 사진이 바로 반영되도록 가족 정보를 새로 읽는다
      loadTimers().catch(() => {}),
      get('/api/home'),
      adultUser ? get('/api/adult/home') : Promise.resolve(null),
    ]);
    S.info = info;
    // 내용이 그대로면(위치만 달라진 알림 등) 화면을 다시 그리지 않는다 — 다시 그리면 모든 그림이 새로 만들어져 깜박인다
    const sig = JSON.stringify([home, ah, info.kids, info.adults], (k, v) => (['now', 'walkers', 'serverNow', 'remainingMs', 'remaining'].includes(k) ? undefined : v));
    if (sig === lastSig && el.querySelector('.house')) { syncWalkers(home); return; }
    lastSig = sig;
    draw(home, ah);
    lsSet('homeCache', { home, ah, kid: boundKid() || 0, adult: adultUser ? 1 : 0 });
  }
  function draw(h, ah) {
    const p = kstParts(h.now);
    const dev = isDevice() || kidPhone;
    el.innerHTML = `<div class="home ${dev ? 'is-device' : ''}">
      <aside class="house-col">${houseHtml(h)}</aside>
      <div class="home-main" data-rc="home.sections">
      ${kidPhone ? '' : `<header class="topbar" data-rk="topbar" data-section="1">
        <div class="clock"><div class="date">${dateLabel(h.today)}</div><div class="time" id="clock">${timeLabel(Date.now())}</div><div class="fam">${esc(h.family.name)}</div></div>
        ${isDevice() ? `<button class="btn ghost adult-menu" id="adultMenu">🔑 어른 메뉴</button>` : ''}
      </header>
      `}
      <section class="kids" aria-label="아이들" data-rk="kids" data-section="1" data-rc="home.kids">${(kidPhone ? [...h.kids].sort((x, y) => (y.id === boundKid()) - (x.id === boundKid())) : h.kids).map((k) => kidCard(k, h.kids.indexOf(k))).join('') || '<p class="empty">아이를 추가해 주세요 (가족 탭)</p>'}</section>
      ${ah ? `<section class="adult-panel card" aria-label="내 할 일" data-rk="panel" data-section="1">${adultPanelHtml(ah)}</section>` : ''}
      <section class="lower" data-rk="lower" data-section="1" data-rc="home.lower">
        <div class="panel card" data-rk="schedule"><h3>📅 오늘 일정</h3>${scheduleHtml(h.schedule)}</div>
        <div class="panel card" data-rk="notes"><h3>💬 가족 한마디</h3><ul class="notes">${h.notes.map((n) => `<li><span class="n-av">${memberAvatar(n.authorId, 'sm', { avatar: n.authorAvatar || '🙂', color: '#e8e0f5' })}</span><div><b>${esc(n.authorName)}</b> ${esc(n.text)}</div></li>`).join('') || '<li class="muted">첫 한마디를 남겨 보세요</li>'}</ul>
          <form class="note-form" novalidate><input name="text" maxlength="100" placeholder="${dev ? '아이를 고른 뒤 쓸 수 있어요' : '가족에게 한마디…'}" aria-label="가족 한마디" ${dev ? 'disabled' : ''}><button class="btn primary small" ${dev ? 'disabled' : ''}>남기기</button></form></div>
        <a class="panel card link" href="#/notebook" data-rk="notebook"><h3>📒 사진 알림장</h3><ul class="posts">${h.posts.map((x) => `<li>${x.pinned ? '📌 ' : ''}<b>${esc(x.title)}</b> <span class="tag">${esc(x.tag)}</span><span class="small muted"> ${shortDate(new Date(x.at + 9 * 3600e3).toISOString().slice(0, 10))}</span></li>`).join('') || '<li class="muted">아직 글이 없어요</li>'}</ul></a>
      </section>
      <section class="lower2" data-rk="lower2" data-section="1" data-rc="home.lower2">
        <div class="panel card supplies" data-rk="supplies"><h3>🎒 챙길 것</h3>${suppliesHtml(h.supplies)}</div>
        <div class="panel card famact" data-rk="famact"><h3>🎈 이번 주 가족 활동 ${kidPhone ? "" : `<a class="small" href="#/family-activity">어른 관리</a>`}</h3>${h.famActivity.kids.map((k) => `<a class="pick-line" href="#/kid/${k.kidId}/family">${memberAvatar(k.kidId, 'sm', { avatar: k.kidAvatar, color: k.kidColor })}<div><b>${esc(k.kidName)}</b> · ${kidLine(k)}</div></a>`).join('')}</div>
      </section></div></div>`;
    bindHouse($('.house-col', el), load, h);
    const col = $('.house-col', el);
    mountWalkers(col, h, {
      onOpen: (p) => { if (kidPhone) { if (p.id === boundKid()) location.hash = `#/kid/${p.id}`; return; } if (p.kind === 'kid') location.hash = `#/kid/${p.id}`; else openAdultSheet(p.id, h, load); },
      onDouble: (p) => { if (kidPhone) { if (p.id === boundKid()) location.hash = `#/kid/${p.id}`; return; } if (p.kind === 'kid') location.hash = `#/kid/${p.id}`; else openAdultSheet(p.id, h, load); }, // 두 번 누르면 그 사람 화면(아이 폰은 자기 것만)
      onArrive: () => { if (deferred) { deferred = false; load(); } else syncBankReq(col, h, load); },
    });
    syncBankReq(col, h, load);
    mountPets(col, S.info.family?.pets || {});
    for (const k of h.kids) {
      if (lastDay.has(k.id) && lastDay.get(k.id) !== 'approved' && k.day.status === 'approved') cheer(k.id, { delay: isDevice() ? 3200 : 0 });
      lastDay.set(k.id, k.day.status);
    }
    bindDismiss($('.kids', el), load);
    $$('.kid-pet-btns', el).forEach((box) => box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pet-act]'); if (!b) return;
      e.preventDefault();
      const idx = h.kids.findIndex((k) => k.id === Number(b.dataset.kid)); const pn = petNameOf(idx);
      try {
        await post('/api/pets/act', { kidId: Number(b.dataset.kid), kind: b.dataset.petAct });
        toast(b.dataset.petAct === 'snack' ? `${pn}에게 간식을 줬어요 🍪` : `${pn}랑 산책 가요 🌳`);
      } catch (x) { errToast(x); }
    }));
    $('.supplies', el)?.addEventListener('click', supplyClick);
    if (ah) bindAdultPanel($('.adult-panel', el), load);
    $('#adultMenu', el)?.addEventListener('click', () => { location.hash = '#/adult'; });
    $('.note-form', el)?.addEventListener('submit', async (e) => {
      e.preventDefault(); const t = e.target.text.value.trim(); if (!t) return;
      try { await post('/api/notes', { text: t }); toast('남겼어요'); load(); } catch (x) { errToast(x); }
    });
  }
  // 빠른 첫 화면: 지난번 홈 내용이 있으면 바로 그려 두고(같은 사용자 유형일 때만), 새 내용은 뒤에서 받아 바꾼다
  { const c = lsGet('homeCache', null); if (c?.home && c.kid === (boundKid() || 0) && c.adult === (adultUser ? 1 : 0)) { try { draw(c.home, c.ah); } catch { /* 옛 형식이면 건너뛴다 */ } } }
  await load();
  timer = setInterval(() => { const c = $('#clock', el); if (c) c.textContent = timeLabel(Date.now()); }, 15000);
  return { refresh: () => { if (anyMoving()) { deferred = true; return Promise.resolve(); } return load(); }, topics: ['home', 'status', 'family', 'approvals', 'requests', 'messages', 'posts', 'notes', 'calendar', 'day', 'stamps', 'timers', 'supplies', 'famact', 'walkers'], destroy: () => clearInterval(timer) };
}
