import { $, $$, esc, dateLabel, timeLabel, kstParts, shortDate } from '../util.js';
import { S, get, post, isDevice, isAdultNow } from '../api.js';
import { avatar, toast, errToast } from '../ui.js';
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
  return `<a class="kid-card" href="#/kid/${k.id}" style="--kc:${esc(k.color)}" aria-label="${esc(k.name)} 카드 열기">
    <div class="kid-top">${avatar(k, 'xl')}<div class="kid-name"><h2>${esc(k.name)}</h2>${k.hasPin ? '<span class="lock" title="비밀번호가 있어요">🔒</span>' : ''}</div></div>
    <div class="kid-progress" role="img" aria-label="오늘 루틴 ${k.day.done}/${k.day.total}"><div class="bar"><i style="width:${pct}%"></i></div><b>${k.day.total ? `${k.day.done}/${k.day.total}` : '–'}</b></div>
    ${dayBadge(k)}
    ${rem.length && k.day.status === 'open' ? `<ul class="rem-chips">${rem.slice(0, 3).map((n) => `<li>${esc(n)}</li>`).join('')}${rem.length > 3 ? `<li class="more">+${rem.length - 3}</li>` : ''}</ul>` : ''}
    <div class="stamp-mini" aria-label="도장 ${k.board.count}/${k.board.size}"><span>💮 도장 <b>${k.board.count}</b>/${k.board.size}</span><div class="bar thin"><i style="width:${(k.board.count / k.board.size) * 100}%"></i></div></div>
  </a>`;
}

function adultCard(a, meId, canEdit) {
  const mine = canEdit;
  return `<div class="adult-card" style="--kc:${esc(a.color)}">${avatar(a, 'md')}<div class="adult-info"><b>${esc(a.name)}</b><div class="adult-status">${statusLine(a.status)}</div>
    ${mine ? statusButtons(a.id, a.status?.state) : ''}</div></div>`;
}

function scheduleHtml(sch) {
  if (!sch.length) return '<p class="muted">오늘 일정이 없어요</p>';
  return `<ul class="sched">${sch.map((s) => `<li><span class="dot ${s.type}"></span><div><b>${esc(s.title)}</b>${s.kidName ? ` <span class="tag">${esc(s.kidName)}</span>` : ''}${s.type === 'due' ? ' <span class="tag due">제출·준비</span>' : ''}${s.supplies ? `<div class="small">🎒 ${esc(s.supplies)}</div>` : ''}</div></li>`).join('')}</ul>`;
}

export async function mount(el) {
  let timer;
  const adultUser = !isDevice();
  async function load() {
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
      </section></div>`;
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
  return { refresh: load, topics: ['home', 'status', 'family', 'approvals', 'requests', 'messages', 'posts', 'notes', 'calendar', 'day', 'stamps'], destroy: () => clearInterval(timer) };
}
