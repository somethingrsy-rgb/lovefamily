import { $, $$, esc, ago, timeLabel } from '../util.js';
import { S, get, post, isDevice, kidById, adultById } from '../api.js';
import { avatar, memberAvatar, errToast, toast } from '../ui.js';
import { back } from '../common.js';
import { morph } from '../morph.js';

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
        <div class="big-grid">${S.info.adults.map((a) => { const t = ths.find((x) => x.adultId === a.id); return `<button class="big-btn" data-to="${a.id}" style="--kc:${esc(a.color)}"><span class="bi">${memberAvatar(a.id, 'xl', a)}</span><b>${esc(a.name)}에게</b>${t?.unread ? `<span class="badge">${t.unread}</span>` : ''}</button>`; }).join('')}</div>`;
      el.onclick = (e) => { const b = e.target.closest('[data-to]'); if (b) { to = Number(b.dataset.to); load().catch(errToast); } };
      return;
    }
    const a = adultById(to);
    const msgs = await get(`/api/threads/${id}/${to}`);
    if (msgs.some((m) => m.senderId !== Number(id) && !m.readAt)) post(`/api/threads/${id}/${to}/read`).catch(() => {}); // 안 읽은 게 있을 때만
    const first = !$('.chat', el);
    morph(el, `${back(`/kid/${id}`, `${avatar(a, 'sm')} ${esc(a.name)}에게`)}
      <section class="chat card">${bubbles(msgs, Number(id))}</section>
      <div class="phrases">${PHRASES.map((p) => `<button class="chip big" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <form class="chat-form" novalidate><input name="body" maxlength="500" placeholder="직접 쓰기" autocomplete="off" aria-label="메시지">${SR ? '<button type="button" class="btn big mic-btn" id="mic" aria-label="말로 보내기" aria-pressed="false">🎤</button>' : ''}<button class="btn primary">보내기</button></form>
      ${SR ? '<p class="mic-status small muted center" id="micstat" aria-live="polite">🎤 를 누르고 말해 보세요. 5초 동안 조용하면 보내요.</p>' : ''}
      <div class="row center"><button class="btn ghost small" id="other">다른 사람에게</button></div>`);
    const list = $('.bubbles', el); if (first || list.scrollHeight - list.scrollTop - list.clientHeight < 80) list.scrollTop = list.scrollHeight;
    const send = async (body) => { try { await post('/api/messages', { kidId: Number(id), adultId: to, body }); const inp = $('.chat-form input', el); if (inp) inp.value = ''; toast(`${a.name}에게 보냈어요 💌`); load(); } catch (e) { errToast(e); } };
    el.onclick = (e) => { const p = e.target.closest('[data-p]'); if (p) send(p.dataset.p); if (e.target.id === 'other') { to = null; load(); } };
    $('.chat-form', el).onsubmit = (e) => { e.preventDefault(); const v = e.target.body.value.trim(); if (v) send(v); };
    bindMic(el, send);
  }
  await load();
  return { refresh: () => (mic ? Promise.resolve() : load()), topics: ['messages'], destroy: () => stopMic() }; // 듣는 동안에는 화면을 다시 그리지 않는다
}

// ---- 말로 보내기(글을 아직 못 쓰는 아이용): 🎤 를 누르고 말하면 글자로 바뀌어 입력칸에 보이고, 5초 동안 말이 없으면 자동으로 보낸다 ----
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const MIC_SILENCE_MS = 5000;
let mic = null; // { rec, timer, text, send, active }
function stopMic() { if (!mic) return; mic.active = false; clearTimeout(mic.timer); try { mic.rec.abort(); } catch { /* 이미 멈춤 */ } mic = null; }
function bindMic(root, send) {
  const btn = $('#mic', root); if (!btn || !SR) return;
  const input = $('.chat-form input', root); const stat = $('#micstat', root);
  const ui = (on, msg) => { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? '⏹' : '🎤'; if (stat) stat.textContent = msg; };
  const finish = (doSend) => {
    const m = mic; if (!m) return; const text = m.text.trim(); stopMic(); ui(false, '🎤 를 누르고 말해 보세요. 5초 동안 조용하면 보내요.');
    if (doSend && text) { input.value = ''; send(text); } else if (doSend) { toast('말소리가 들리지 않았어요. 다시 해 볼까요?'); }
  };
  const arm = () => { clearTimeout(mic.timer); mic.timer = setTimeout(() => finish(true), MIC_SILENCE_MS); }; // 말소리가 들릴 때마다 5초를 다시 센다
  btn.onclick = () => {
    if (mic) return finish(true);                       // 듣는 중에 다시 누르면 바로 보낸다
    const rec = new SR(); rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true;
    mic = { rec, timer: null, text: '', send, active: true };
    rec.onresult = (e) => {
      let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      if (!mic) return; mic.text = t; input.value = t; ui(true, `🎤 듣고 있어요… ${t}`); arm();
    };
    rec.onerror = (e) => { const code = e.error; if (code === 'no-speech' || code === 'aborted') return; stopMic(); ui(false, ''); toast(code === 'not-allowed' || code === 'service-not-allowed' ? '마이크를 쓸 수 있게 허락해 주세요 (어른에게 물어봐요)' : '말을 알아듣지 못했어요'); };
    rec.onend = () => { if (mic && mic.active) { try { rec.start(); } catch { /* 곧 다시 시작됨 */ } } }; // 브라우저가 중간에 끄면 이어서 듣는다
    try { rec.start(); } catch { stopMic(); return; }
    ui(true, '🎤 듣고 있어요… 말해 보세요'); arm();
  };
}

// 아이 받은 편지함: 어른 답장 + 알림
export async function kidInbox(el, { id }) {
  const kid = kidOf(id);
  async function load() {
    const [ths, nt] = await Promise.all([get(`/api/threads?kidId=${id}`), get(`/api/notifications?kidId=${id}`)]);
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} 받은 편지함`, nt.unread ? '<button class="btn small ghost" id="ra">모두 읽음</button>' : '')}
      <section class="card page-card"><h3>💌 메시지</h3>${ths.length ? `<ul class="threads">${ths.map((t) => `<li><a href="#/kid/${id}/talk/${t.adultId}">${memberAvatar(t.adultId, 'sm', { avatar: t.adultAvatar, color: '#e8e0f5' })}<div class="grow"><b>${esc(t.adultName)}</b><div class="small">${esc(t.last.body.slice(0, 40))}</div></div>${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</a></li>`).join('')}</ul>` : '<p class="muted">아직 메시지가 없어요</p>'}</section>
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
    if (msgs.some((m) => m.senderId !== Number(adultId) && !m.readAt)) post(`/api/threads/${kidId}/${adultId}/read`).catch(() => {}); // 안 읽은 게 있을 때만
    const first = !$('.chat', el);
    morph(el, `${back('/', `${avatar(kid, 'sm')} ${esc(kid.name)}와의 대화`)}<section class="chat card">${bubbles(msgs, Number(adultId))}</section>
      <div class="phrases">${['사랑해 💕', '잘했어요 👍', '곧 갈게요', '밥 먹어요', '숙제 먼저 해요', '알겠어요 😊'].map((p) => `<button class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <form class="chat-form" novalidate><input name="body" maxlength="500" placeholder="${esc(kid.name)}에게 메시지 쓰기" autocomplete="off" aria-label="메시지"><button class="btn primary">보내기</button></form>`);
    const list = $('.bubbles', el); if (first || list.scrollHeight - list.scrollTop - list.clientHeight < 80) list.scrollTop = list.scrollHeight;
    const send = async (body) => { try { await post('/api/messages', { kidId: Number(kidId), adultId: Number(adultId), body }); const inp = $('.chat-form input', el); if (inp) inp.value = ''; load(); } catch (e) { errToast(e); } };
    el.onclick = (e) => { const p = e.target.closest('[data-p]'); if (p) send(p.dataset.p); };
    $('.chat-form', el).onsubmit = (e) => { e.preventDefault(); const v = e.target.body.value.trim(); if (v) send(v); };
  }
  await load();
  return { refresh: load, topics: ['messages'] };
}
void isDevice;
