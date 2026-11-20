import { $, $$, esc, ago, timeLabel } from '../util.js';
import { S, get, post, isDevice, kidById, adultById } from '../api.js';
import { avatar, errToast, toast } from '../ui.js';
import { back } from '../common.js';

const kidOf = (id) => kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
const PHRASES = ['언제 와요?', '전화해 주세요', '사랑해요 💕', '보고 싶어요', '배고파요', '같이 놀아요'];

function bubbles(msgs, meId) {
  return `<ul class="bubbles">${msgs.map((m) => `<li class="${m.senderId === meId ? 'me' : 'other'}"><div>${esc(m.body)}</div><small>${timeLabel(m.at)}</small></li>`).join('') || '<li class="muted center">아직 대화가 없어요</li>'}</ul>`;
}

// 아이: 누구에게 보낼지 고르고 문구를 보낸다
export async function talk(el, { id, adultId }) {
  const kid = kidOf(id);
  let to = adultId ? Number(adultId) : null;
  async function load() {
    if (!to) {
      const ths = await get(`/api/threads?kidId=${id}`);
      el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} 가족에게 말하기`)}<p class="center big-q">누구에게 말할까요?</p>
        <div class="big-grid">${S.info.adults.map((a) => { const t = ths.find((x) => x.adultId === a.id); return `<button class="big-btn" data-to="${a.id}" style="--kc:${esc(a.color)}"><span class="bi">${esc(a.avatar)}</span><b>${esc(a.name)}에게</b>${t?.unread ? `<span class="badge">${t.unread}</span>` : ''}</button>`; }).join('')}</div>`;
      el.onclick = (e) => { const b = e.target.closest('[data-to]'); if (b) { to = Number(b.dataset.to); load().catch(errToast); } };
      return;
    }
    const a = adultById(to);
    const msgs = await get(`/api/threads/${id}/${to}`);
    post(`/api/threads/${id}/${to}/read`).catch(() => {});
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(a, 'sm')} ${esc(a.name)}에게`)}
      <section class="chat card">${bubbles(msgs, Number(id))}</section>
      <div class="phrases">${PHRASES.map((p) => `<button class="chip big" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <form class="chat-form" novalidate><input name="body" maxlength="500" placeholder="직접 쓰기" autocomplete="off" aria-label="메시지"><button class="btn primary">보내기</button></form>
      <div class="row center"><button class="btn ghost small" id="other">다른 사람에게</button></div>`;
    const list = $('.bubbles', el); list.scrollTop = list.scrollHeight;
    const send = async (body) => { try { await post('/api/messages', { kidId: Number(id), adultId: to, body }); toast(`${a.name}에게 보냈어요 💌`); load(); } catch (e) { errToast(e); } };
    el.onclick = (e) => { const p = e.target.closest('[data-p]'); if (p) send(p.dataset.p); if (e.target.id === 'other') { to = null; load(); } };
    $('.chat-form', el).onsubmit = (e) => { e.preventDefault(); const v = e.target.body.value.trim(); if (v) send(v); };
  }
  await load();
  return { refresh: load, topics: ['messages'] };
}

// 아이 받은 편지함: 어른 답장 + 알림
export async function kidInbox(el, { id }) {
  const kid = kidOf(id);
  async function load() {
    const [ths, nt] = await Promise.all([get(`/api/threads?kidId=${id}`), get(`/api/notifications?kidId=${id}`)]);
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} 받은 편지함`, nt.unread ? '<button class="btn small ghost" id="ra">모두 읽음</button>' : '')}
      <section class="card page-card"><h3>💌 메시지</h3>${ths.length ? `<ul class="threads">${ths.map((t) => `<li><a href="#/kid/${id}/talk/${t.adultId}">${avatar({ avatar: t.adultAvatar, color: '#e8e0f5' }, 'sm')}<div class="grow"><b>${esc(t.adultName)}</b><div class="small">${esc(t.last.body.slice(0, 40))}</div></div>${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</a></li>`).join('')}</ul>` : '<p class="muted">아직 메시지가 없어요</p>'}</section>
      <section class="card page-card"><h3>🔔 소식</h3>${nt.items.length ? `<ul class="notif">${nt.items.map((n) => `<li class="${n.read ? '' : 'unread'}"><b>${esc(n.title)}</b><div class="small muted">${esc(n.body)}</div><span class="small muted">${ago(n.at)}</span></li>`).join('')}</ul>` : '<p class="muted">소식이 없어요</p>'}</section>`;
    $('#ra', el)?.addEventListener('click', async () => { await post(`/api/notifications/read-all?kidId=${id}`); load(); });
  }
  await load();
  return { refresh: load, topics: ['messages', 'stamps', 'wallet', 'missions', 'day'] };
}

// 어른: 아이와의 대화
export async function adultThread(el, { kidId, adultId }) {
  const kid = kidOf(kidId);
  async function load() {
    const msgs = await get(`/api/threads/${kidId}/${adultId}`);
    post(`/api/threads/${kidId}/${adultId}/read`).catch(() => {});
    el.innerHTML = `${back('/inbox', `${avatar(kid, 'sm')} ${esc(kid.name)}와의 대화`)}<section class="chat card">${bubbles(msgs, Number(adultId))}</section>
      <div class="phrases">${['알겠어요 😊', '곧 갈게요', '사랑해 💕', '조금만 기다려요'].map((p) => `<button class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <form class="chat-form" novalidate><input name="body" maxlength="500" placeholder="답장 쓰기" autocomplete="off" aria-label="답장"><button class="btn primary">보내기</button></form>`;
    const list = $('.bubbles', el); list.scrollTop = list.scrollHeight;
    const send = async (body) => { try { await post('/api/messages', { kidId: Number(kidId), adultId: Number(adultId), body }); load(); } catch (e) { errToast(e); } };
    el.onclick = (e) => { const p = e.target.closest('[data-p]'); if (p) send(p.dataset.p); };
    $('.chat-form', el).onsubmit = (e) => { e.preventDefault(); const v = e.target.body.value.trim(); if (v) send(v); };
  }
  await load();
  return { refresh: load, topics: ['messages'] };
}
void isDevice;
