import { $, $$, esc, dateLabel, addDays } from '../util.js';
import { S, get, post, put, boundKid, isDevice, kidById } from '../api.js';
import { avatar, errToast, toast, formSheet, needAdult } from '../ui.js';
import { back } from '../common.js';

// 아이별 급식 식단: 하루씩 넘겨 보고, 이번 주 목록에서 날짜를 고른다. 어른은 식단표를 붙여넣거나 하루씩 고친다.
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dowOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const weekdayStep = (date, dir) => { let d = addDays(date, dir); while ([0, 6].includes(dowOf(d))) d = addDays(d, dir); return d; }; // 주말은 건너뛴다
const mondayOf = (date) => addDays(date, -((dowOf(date) + 6) % 7));
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

export async function mount(el, { id }) {
  const kid = kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
  const canEdit = !boundKid(); // 아이 폰은 보기만(거실 기기는 누를 때 어른 확인)
  const myAlert = !isDevice() && !boundKid() && !!S.info.me; // 어른 폰에서만 아침 알림 설정을 보인다
  let data = { days: [], from: '', to: '', today: S.info.today }; let date = null; let alert = null;

  async function load(keepDate = true) {
    const base = date || S.info.today;
    const from = addDays(mondayOf(base), -7); const to = addDays(from, 41);
    const [d, a] = await Promise.all([get(`/api/kids/${id}/meals?from=${from}&to=${to}`), myAlert && !alert ? get('/api/meals/alert').catch(() => null) : Promise.resolve(alert)]);
    data = d; alert = a;
    if (!keepDate || !date) date = [0, 6].includes(dowOf(d.today)) ? weekdayStep(d.today, 1) : d.today; // 주말에는 다음 월요일을 먼저 보여 준다
    draw();
  }
  const dayOf = (dt) => data.days.find((x) => x.date === dt);
  async function go(dt) { date = dt; if (dt < data.from || dt > data.to) await load(true); else draw(); }

  function menuHtml() {
    const m = dayOf(date);
    if (!m) return '<p class="empty">이 날은 급식 식단이 없어요 🎈</p>';
    return `<ul class="meal-list">${m.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }
  function weekHtml() {
    const mon = mondayOf(date);
    return `<ul class="meal-week">${[0, 1, 2, 3, 4].map((i) => {
      const dt = addDays(mon, i); const m = dayOf(dt);
      return `<li><button type="button" class="meal-day ${dt === date ? 'on' : ''} ${dt === data.today ? 'is-today' : ''}" data-d="${dt}"><b>${md(dt)}<small>(${DOW[dowOf(dt)]})</small></b><span class="${m ? '' : 'muted'}">${m ? esc(m.items.slice(0, 3).join(', ')) + (m.items.length > 3 ? ' …' : '') : '식단 없음'}</span></button></li>`;
    }).join('')}</ul>`;
  }
  function alertHtml() {
    if (!myAlert || !alert) return '';
    const st = alert.status;
    const hm = (ms) => { const d = new Date(ms + 9 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
    const statusTxt = st ? `서버 시각 ${st.serverTime}(${st.weekday ? '평일' : '주말'}) · 오늘 식단 ${st.mealKids ? `${st.mealKids}명 있음` : '없음'} · 이 폰 알림 ${st.devices ? '허용됨' : '허용 안 됨'} · 마지막 급식 알림 ${st.lastSentAt ? hm(st.lastSentAt) : '아직 없음'}` : '';
    return `<section class="card page-card meal-alert"><h3>🔔 아침 급식 알림</h3><p class="muted small">평일 정한 시각에 오늘 급식을 이 폰으로 알려 줘요. 식단이 없는 날은 알리지 않아요. 알림은 어른마다 따로 정해요.</p>
      <div class="row gap wrap"><label class="check"><input type="checkbox" id="malert" ${alert.enabled ? 'checked' : ''}> <span>알림 받기</span></label><label class="field inline">시각 <input type="time" id="mtime" value="${esc(alert.time)}" ${alert.enabled ? '' : 'disabled'}></label></div>
      <div class="row gap wrap"><button class="btn ghost small" id="mtest">지금 알림 보내 보기</button></div><p class="muted small">${statusTxt}</p><p class="muted small">알림이 안 오면 이 버튼으로 점검해 보세요. 알림이 오지 않으면 설정 탭 → 화면·알림 설정에서 이 폰의 알림을 허용했는지 확인해 주세요.</p></section>`;
  }

  function draw() {
    const isToday = date === data.today;
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 급식`, canEdit ? '<button class="btn primary small" id="paste">+ 식단 넣기</button>' : '')}
      <div class="day-nav"><button class="btn ghost" id="prev" aria-label="전날">‹</button><h2>${dateLabel(date)}${isToday ? ' <span class="tag">오늘</span>' : ''}</h2><button class="btn ghost" id="next" aria-label="다음날">›</button></div>
      <section class="card page-card meal-card">${menuHtml()}${canEdit ? `<div class="row gap end"><button class="btn ghost small" id="edit">${dayOf(date) ? '이 날 고치기' : '이 날 넣기'}</button></div>` : ''}</section>
      <section class="card page-card"><h3>이번 주 급식</h3>${weekHtml()}</section>
      ${alertHtml()}
      ${canEdit && !data.days.length ? '<p class="muted small center">+ 식단 넣기에서 가정통신문 식단표를 그대로 붙여넣을 수 있어요. 한 줄에 <b>11/2(월) / 밥, 국, 반찬</b> 모양이에요. 아이마다 학교가 다르면 아이마다 따로 넣어 주세요.</p>' : ''}`;
    $('#prev', el).addEventListener('click', () => go(weekdayStep(date, -1)));
    $('#next', el).addEventListener('click', () => go(weekdayStep(date, 1)));
    $$('[data-d]', el).forEach((b) => b.addEventListener('click', () => { date = b.dataset.d; draw(); }));
    $('#paste', el)?.addEventListener('click', async () => { if (await needAdult()) pasteSheet(); });
    $('#edit', el)?.addEventListener('click', async () => { if (await needAdult()) editSheet(); });
    const ma = $('#malert', el); const mt = $('#mtime', el);
    ma?.addEventListener('change', async () => { try { alert = await put('/api/meals/alert', { enabled: ma.checked }); mt.disabled = !alert.enabled; toast(alert.enabled ? '아침 알림을 켰어요' : '아침 알림을 껐어요'); } catch (e) { ma.checked = !ma.checked; errToast(e); } });
    $('#mtest', el)?.addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        const r = await post('/api/meals/alert/test', {});
        if (!r.sent) toast('오늘 급식 식단이 없어서 보낼 게 없어요. 식단을 먼저 넣어 주세요.');
        else if (!r.devices) toast('앱 안에는 알림이 왔지만, 이 폰은 알림 허용이 안 되어 있어요. 설정 탭에서 알림을 허용해 주세요.', 'bad');
        else toast('알림을 보냈어요. 잠시 뒤에 폰에 떠요.');
      } catch (err) { errToast(err); } finally { b.disabled = false; }
    });
    mt?.addEventListener('change', async () => { try { alert = await put('/api/meals/alert', { time: mt.value }); toast(`평일 ${alert.time}에 알려 드릴게요`); } catch (e) { mt.value = alert.time; errToast(e); } });
  }

  // 식단표 붙여넣기: 한 줄이 하루
  function pasteSheet() {
    return formSheet({
      title: `${kid.name} 식단표 붙여넣기`, submit: '넣기', cls: 'tall',
      html: `<p class="muted small">한 줄에 하루씩, <b>11/2(월) / 밥, 국, 반찬</b> 모양으로 붙여넣어요. 같은 날짜가 있으면 새로 덮어써요. 괄호 안의 쉼표는 그대로 한 메뉴로 봐요.</p>
        <label class="field">식단표<textarea name="text" rows="12" placeholder="11/2(월) / 현미찹쌀밥, 근대콩나물된장국(건새우), 오리불고기&#10;11/3(화) / 칠흑미밥, 북어달걀국, 안동찜닭" required></textarea></label>`,
      onSubmit: async (v) => {
        const r = await post(`/api/kids/${id}/meals/import`, { text: v.text });
        toast(`${r.saved}일 식단을 넣었어요${r.skipped.length ? ` (읽지 못한 줄 ${r.skipped.length}개)` : ''}`);
        date = r.from; await load(true);
      },
    });
  }
  // 하루 고치기: 한 줄에 메뉴 하나(비우면 그날 식단 삭제)
  function editSheet() {
    const m = dayOf(date);
    return formSheet({
      title: `${dateLabel(date)} 식단`, submit: '저장', cls: 'tall',
      html: `<label class="field">메뉴 <small class="muted">(한 줄에 하나 · 비우면 이 날 식단이 지워져요)</small><textarea name="text" rows="9" placeholder="현미밥&#10;미역국&#10;불고기">${esc((m?.items || []).join('\n'))}</textarea></label>`,
      onSubmit: async (v) => { await put(`/api/kids/${id}/meals/${date}`, { items: v.text.split('\n').map((x) => x.trim()).filter(Boolean) }); toast('저장했어요'); await load(true); },
    });
  }

  await load(false);
  return { refresh: () => load(true), topics: ['meals', 'family'] };
}
