import { $, $$, esc, won, ago, shortDate } from '../util.js';
import { S, get, post, isDevice } from '../api.js';
import { avatar, memberAvatar, toast, errToast, confirmDialog } from '../ui.js';
import { back, statusButtons, bindStatus, statusLine } from '../common.js';

// 어른 홈 패널: 내 상태 / 도장 확인 대기 / 용돈·구매 요청 / 미션 확인 / 받은 메시지 / 안 읽은 알림장
export function adultPanelHtml(ah) {
  const sec = (title, count, body) => `<div class="ap-sec"><h3>${title}${count ? ` <span class="badge">${count}</span>` : ''}</h3>${body}</div>`;
  const approvals = ah.approvals.length
    ? `<ul class="todo">${ah.approvals.map((a) => `<li style="--kc:${esc(a.kidColor)}"><span>${memberAvatar(a.kidId, 'sm', { avatar: a.kidAvatar, color: a.kidColor })} <b>${esc(a.kidName)}</b> · ${shortDate(a.date)} 할일 완료</span><a class="btn primary small" href="#/approve/${a.id}">확인하기</a></li>`).join('')}</ul>`
    : '<p class="muted">확인할 도장이 없어요 👍</p>';
  const money = ah.money.length
    ? `<ul class="todo">${ah.money.map((m) => `<li><span><b>${esc(m.kidName)}</b> · ${m.type === 'deposit' ? '입금 확인' : m.type === 'withdraw' ? '출금' : '구매'} ${won(m.amount)} <small class="muted">${esc(m.purpose)} · ${esc(m.statusLabel)}</small></span><a class="btn small primary" href="#/money/${m.id}">처리하기</a></li>`).join('')}</ul>`
    : '<p class="muted">처리할 요청이 없어요</p>';
  const missions = ah.missions.length
    ? `<ul class="todo">${ah.missions.map((m) => `<li><span><b>${esc(m.kidName)}</b> · ${esc(m.title)} ${m.reward ? `<small class="muted">(${won(m.reward)})</small>` : ''}</span><span class="row gap"><button class="btn small primary" data-mission="${m.id}" data-do="confirm">확인</button><button class="btn small ghost" data-mission="${m.id}" data-do="reject">다시</button></span></li>`).join('')}</ul>` : '';
  return `<div class="ap-head"><div>${avatar(ah.me, 'sm')} <b>${esc(ah.me.name)}</b>의 홈</div><div class="ap-links"><a class="btn small ghost" href="#/inbox">📬 받은 편지함${ah.unreadMessages || ah.unreadNotifications ? ` <span class="badge">${ah.unreadMessages + ah.unreadNotifications}</span>` : ''}</a><a class="btn small ghost" href="#/notebook">📒 알림장${ah.unreadPosts ? ` <span class="badge">${ah.unreadPosts}</span>` : ''}</a></div></div>
    <div class="ap-grid">
      ${sec('내 상태', 0, `<div class="adult-status">${statusLine(ah.myStatus)}</div>${statusButtons(ah.me.id, ah.myStatus?.state)}`)}
      ${sec('도장 확인 대기', ah.approvals.length, approvals)}
      ${sec('용돈·구매 요청', ah.money.length, money)}
      ${ah.missions.length ? sec('미션 확인', ah.missions.length, missions) : ''}
    </div>`;
}
export function bindAdultPanel(root, reload) {
  bindStatus(root, reload);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mission]'); if (!b) return;
    try {
      const r = await post(`/api/missions/${b.dataset.mission}/${b.dataset.do}`);
      toast(r.result === 'already' ? `${r.by}이(가) 이미 확인했어요` : '처리했어요'); reload();
    } catch (x) { errToast(x); }
  });
}

export async function page(el) {
  async function load() {
    const ah = await get('/api/adult/home');
    el.innerHTML = `${back('/', '어른 홈', isDevice() ? '<button class="btn small ghost" id="done">어른 모드 끝내기</button>' : '')}<section class="adult-panel card page-card">${adultPanelHtml(ah)}</section>`;
    bindAdultPanel($('.adult-panel', el), load);
    $('#done', el)?.addEventListener('click', () => { S.elev = null; location.hash = '#/'; });
  }
  await load();
  return { refresh: load, topics: ['approvals', 'requests', 'missions', 'messages', 'posts', 'status'] };
}

// 받은 편지함 (어른): 아이 메시지 대화 + 알림 목록
export async function inbox(el) {
  async function load() {
    const canPeek = !!S.info.family?.parentsSeeKidChat && !!(S.info.me?.isGuardian || S.info.elevated?.isGuardian);
    const [th, nt, kc] = await Promise.all([get('/api/threads'), get('/api/notifications'), canPeek ? get('/api/kid-chats').catch(() => []) : Promise.resolve([])]);
    el.innerHTML = `${back('/', '받은 편지함', nt.unread ? '<button class="btn small ghost" id="readall">모두 읽음</button>' : '')}
      <section class="card page-card"><h3>✏️ 아이에게 메시지 보내기</h3><div class="row gap wrap">${S.info.kids.map((k) => `<a class="btn big grow" href="#/messages/${k.id}/${S.info.me?.id}">${memberAvatar(k.id, 'sm', k)} ${esc(k.name)}에게</a>`).join('')}</div></section>
      <section class="card page-card"><h3>💌 아이들 메시지</h3>${th.length ? `<ul class="threads">${th.map((t) => `<li><a href="#/messages/${t.kidId}/${t.adultId}">${memberAvatar(t.kidId, 'sm', { avatar: t.kidAvatar, color: '#e8e0f5' })}<div class="grow"><b>${esc(t.kidName)}</b><div class="small ${t.unread ? '' : 'muted'}">${esc(t.last.body.slice(0, 40))}</div></div>${t.unread ? `<span class="badge">${t.unread}</span>` : ''}<span class="muted small">${ago(t.last.at)}</span></a></li>`).join('')}</ul>` : '<p class="muted">아직 메시지가 없어요</p>'}</section>
      ${canPeek ? `<section class="card page-card"><h3>👀 아이들끼리 메시지 <small class="muted">(읽기 전용)</small></h3>${kc.length ? `<ul class="threads">${kc.map((c) => `<li><a href="#/kid-chat/${c.kidA}/${c.kidB}">${memberAvatar(c.kidA, 'sm', { avatar: c.avatarA, color: '#e8e0f5' })}<div class="grow"><b>${esc(c.nameA)} ↔ ${esc(c.nameB)}</b><div class="small muted">${esc(c.last.body.slice(0, 40))} · ${ago(c.last.at)}</div></div><span class="tag">${c.count}개</span></a></li>`).join('')}</ul>` : '<p class="muted">아직 아이들끼리 주고받은 메시지가 없어요</p>'}<p class="small muted">아이들은 부모님이 볼 수 있다는 걸 알고 있어요. 가족 탭 설정에서 끌 수 있어요.</p></section>` : ''}
      <section class="card page-card"><h3>🔔 알림</h3>${nt.items.length ? `<ul class="notif">${nt.items.map((n) => `<li class="${n.read ? '' : 'unread'}" data-id="${n.id}" data-url="${esc(n.url)}"><b>${esc(n.title)}</b><div class="small muted">${esc(n.body)}</div><span class="small muted">${ago(n.at)}</span></li>`).join('')}</ul>` : '<p class="muted">알림이 없어요</p>'}</section>`;
    $('#readall', el)?.addEventListener('click', async () => { await post('/api/notifications/read-all'); load(); });
    $$('.notif li', el).forEach((li) => li.addEventListener('click', async () => { await post(`/api/notifications/${li.dataset.id}/read`).catch(() => {}); const u = li.dataset.url; if (u) location.hash = u.replace(/^\/#/, '#'); else load(); }));
  }
  await load();
  return { refresh: load, topics: ['messages', 'approvals', 'requests', 'posts'] };
}
void confirmDialog; void S;
