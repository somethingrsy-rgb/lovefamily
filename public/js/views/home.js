import { $, $$, esc, dateLabel, timeLabel, kstParts, shortDate } from '../util.js';
import { S, get, post, put, isDevice, isAdultNow, bus } from '../api.js';
import { avatar, toast, errToast, toastAction, openSheet } from '../ui.js';
import { loadTimers } from '../timers.js';
import { kidTimerHtml, bindDismiss } from './timerui.js';
import { kidLine } from './plan.js';
import { statusButtons, bindStatus, statusLine } from '../common.js';
import { adultPanelHtml, bindAdultPanel } from './adult.js';

const dayBadge = (k) => {
  const d = k.day;
  if (d.status === 'requested') return `<div class="kid-state wait">✋ 다 했어요 · 어른 확인 중</div>`;
  if (d.status === 'approved') return `<div class="kid-state ok">💮 도장 받았어요${d.stampBy ? ` <small>(${esc(d.stampBy)})</small>` : ''}</div>`;
  if (d.status === 'recheck') return `<div class="kid-state warn">🔎 다시 확인해 보래요</div>`;
  if (d.status === 'none') return `<div class="kid-state rest">😴 오늘은 쉬는 날이에요</div>`;
  return `<div class="kid-state">${d.total - d.done}개 남았어요</div>`;
};

function kidCard(k) {
  const pct = k.day.total ? Math.round((k.day.done / k.day.total) * 100) : 0;
  const rem = k.day.remaining;
  return `<article class="kid-card" style="--kc:${esc(k.color)}"><a class="kid-main" href="#/kid/${k.id}" aria-label="${esc(k.name)} 카드 열기">
    <div class="kid-top">${avatar(k, 'xl')}<div class="kid-name"><h2>${esc(k.name)}</h2>${k.hasPin ? '<span class="lock" title="비밀번호가 있어요">🔒</span>' : ''}</div></div>
    <div class="kid-progress" role="img" aria-label="오늘 루틴 ${k.day.done}/${k.day.total}"><div class="bar"><i style="width:${pct}%"></i></div><b>${k.day.total ? `${k.day.done}/${k.day.total}` : '–'}</b></div>
    ${dayBadge(k)}
    ${rem.length && k.day.status === 'open' ? `<ul class="rem-chips">${rem.slice(0, 3).map((n) => `<li>${esc(n)}</li>`).join('')}${rem.length > 3 ? `<li class="more">+${rem.length - 3}</li>` : ''}</ul>` : ''}
    <div class="stamp-mini" aria-label="도장 ${k.board.count}/${k.board.size}"><span>💮 도장 <b>${k.board.count}</b>/${k.board.size}</span><div class="bar thin"><i style="width:${(k.board.count / k.board.size) * 100}%"></i></div></div>
  </a>${kidTimerHtml(k)}</article>`;
}

function adultCard(a, meId, canEdit) {
  const mine = canEdit;
  return `<div class="adult-card" style="--kc:${esc(a.color)}">${avatar(a, 'md')}<div class="adult-info"><b>${esc(a.name)}</b><div class="adult-status">${statusLine(a.status)}</div>
    ${mine ? statusButtons(a.id, a.status?.state) : ''}</div></div>`;
}

function suppliesHtml(list) {
  return list.map((k) => `<div class="sup-kid" style="--kc:${esc(k.kidColor)}"><div class="sup-head">${avatar({ avatar: k.kidAvatar, color: k.kidColor }, 'sm')} <b>${esc(k.kidName)}</b></div>${k.cards.length ? k.cards.map((c) => `<div class="sup-card"><div class="small"><b>${esc(c.label)}</b> · ${c.checked}/${c.total} 챙겼어요</div>${c.allDone && !c.items.length ? '<div class="ok"><b>다 챙겼어요 ✅</b></div>' : ''}<div class="sup-chips">${c.items.map((i) => `<span class="sup-chip ${i.checked ? 'on' : ''}"><button class="sc-btn" data-sup="${i.id}" data-kid="${k.kidId}" data-checked="${i.checked ? 1 : 0}" aria-pressed="${i.checked}" aria-label="${esc(i.name)} ${i.checked ? '챙김' : '안 챙김'}">${i.checked ? '✔' : esc(i.icon)} ${esc(i.name)}</button>${i.photoUrl ? `<button class="sc-photo" data-photo="${esc(i.photoUrl)}" aria-label="알림장 사진 보기">📷</button>` : ''}</span>`).join('')}</div></div>`).join('') : '<p class="muted small">챙길 것이 없어요</p>'}</div>`).join('') || '<p class="muted">아이를 추가해 주세요</p>';
}
async function supplyClick(e) {
  const b = e.target.closest('[data-sup]'); const ph = e.target.closest('[data-photo]');
  if (ph) return openSheet(`<img class="full-photo" src="${esc(ph.dataset.photo)}" alt="알림장 원본 사진"><div class="row end"><button class="btn primary" data-close>닫기</button></div>`);
  if (!b) return;
  const was = b.dataset.checked === '1'; const supId = b.dataset.sup; const kid = b.dataset.kid;
  try {
    await put(`/api/supplies/${supId}/kids/${kid}`, { checked: !was });
    if (!was) toastAction('챙겼어요! 👍', '되돌리기', () => put(`/api/supplies/${supId}/kids/${kid}`, { checked: false }).catch(errToast));
  } catch (x) { errToast(x); }
}

function scheduleHtml(sch) {
  if (!sch.length) return '<p class="muted">오늘 일정이 없어요</p>';
  return `<ul class="sched">${sch.map((s) => `<li><span class="dot ${s.type}"></span><div><b>${s.time ? esc(s.time) + ' ' : ''}${esc(s.title)}</b>${s.kidName ? ` <span class="tag">${esc(s.kidName)}</span>` : ''}${s.type === 'due' ? ' <span class="tag due">제출·준비</span>' : ''}${s.supplies ? `<div class="small">🎒 ${esc(s.supplies)}</div>` : ''}</div></li>`).join('')}</ul>`;
}

export async function mount(el) {
  let timer;
  const adultUser = !isDevice();
  async function load() {
    await loadTimers().catch(() => {});
    const [home, ah] = await Promise.all([get('/api/home'), adultUser ? get('/api/adult/home') : Promise.resolve(null)]);
    draw(home, ah);
  }
  function draw(h, ah) {
    const p = kstParts(h.now);
    const dev = isDevice();
    el.innerHTML = `<div class="home ${dev ? 'is-device' : ''}">
      <header class="topbar">
        <div class="clock"><div class="date">${dateLabel(h.today)}</div><div class="time" id="clock">${timeLabel(Date.now())}</div><div class="fam">${esc(h.family.name)}</div></div>
        <div class="adult-cards">${h.adults.map((a) => adultCard(a, S.info.me?.id, adultUser && S.info.me?.id === a.id)).join('')}</div>
        ${dev ? `<button class="btn ghost adult-menu" id="adultMenu">🔑 어른 메뉴</button>` : ''}
      </header>
      ${ah ? `<section class="adult-panel card" aria-label="내 할 일">${adultPanelHtml(ah)}</section>` : ''}
      <section class="kids" aria-label="아이들">${h.kids.map(kidCard).join('') || '<p class="empty">아이를 추가해 주세요 (가족 탭)</p>'}</section>
      <section class="lower">
        <div class="panel card"><h3>📅 오늘 일정</h3>${scheduleHtml(h.schedule)}</div>
        <div class="panel card"><h3>💬 가족 한마디</h3><ul class="notes">${h.notes.map((n) => `<li><span class="n-av">${esc(n.authorAvatar || '🙂')}</span><div><b>${esc(n.authorName)}</b> ${esc(n.text)}</div></li>`).join('') || '<li class="muted">첫 한마디를 남겨 보세요</li>'}</ul>
          <form class="note-form" novalidate><input name="text" maxlength="100" placeholder="${dev ? '아이를 고른 뒤 쓸 수 있어요' : '가족에게 한마디…'}" aria-label="가족 한마디" ${dev ? 'disabled' : ''}><button class="btn primary small" ${dev ? 'disabled' : ''}>남기기</button></form></div>
        <a class="panel card link" href="#/notebook"><h3>📒 사진 알림장</h3><ul class="posts">${h.posts.map((x) => `<li>${x.pinned ? '📌 ' : ''}<b>${esc(x.title)}</b> <span class="tag">${esc(x.tag)}</span><span class="small muted"> ${shortDate(new Date(x.at + 9 * 3600e3).toISOString().slice(0, 10))}</span></li>`).join('') || '<li class="muted">아직 글이 없어요</li>'}</ul></a>
      </section>
      <section class="lower2">
        <div class="panel card supplies"><h3>🎒 챙길 것</h3>${suppliesHtml(h.supplies)}</div>
        <div class="panel card famact"><h3>🎈 이번 주 가족 활동 <a class="small" href="#/family-activity">어른 관리</a></h3>${h.famActivity.kids.map((k) => `<a class="pick-line" href="#/kid/${k.kidId}/family"><span class="avatar sm" style="--kc:${esc(k.kidColor)}">${esc(k.kidAvatar)}</span><div><b>${esc(k.kidName)}</b> · ${kidLine(k)}</div></a>`).join('')}</div>
      </section></div>`;
    bindDismiss($('.kids', el), load);
    $('.supplies', el)?.addEventListener('click', supplyClick);
    if (ah) bindAdultPanel($('.adult-panel', el), load);
    bindStatus($('.adult-cards', el), load);
    $('#adultMenu', el)?.addEventListener('click', () => { location.hash = '#/adult'; });
    $('.note-form', el)?.addEventListener('submit', async (e) => {
      e.preventDefault(); const t = e.target.text.value.trim(); if (!t) return;
      try { await post('/api/notes', { text: t }); toast('남겼어요'); load(); } catch (x) { errToast(x); }
    });
  }
  await load();
  timer = setInterval(() => { const c = $('#clock', el); if (c) c.textContent = timeLabel(Date.now()); }, 15000);
  return { refresh: load, topics: ['home', 'status', 'family', 'approvals', 'requests', 'messages', 'posts', 'notes', 'calendar', 'day', 'stamps', 'timers', 'supplies', 'famact'], destroy: () => clearInterval(timer) };
}
