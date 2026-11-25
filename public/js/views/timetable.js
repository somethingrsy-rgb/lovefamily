import { $, $$, esc, lsGet, lsSet } from '../util.js';
import { S, get, post, patch, del, boundKid, kidById } from '../api.js';
import { avatar, errToast, toast, formSheet, openSheet, confirmDialog, needAdult } from '../ui.js';
import { back } from '../common.js';

// 아이별 주간 시간표: [오늘] 요일별 목록 / [주간표] 한눈에 보는 표. 어른은 수업을 만들고 고치고, 아이는 보기만 한다.
const DOWS = ['', '월', '화', '수', '목', '금', '토', '일'];
const COLORS = ['#ffd9e6', '#d7ecff', '#e4d6ff', '#d9f6e7', '#fff1cf', '#ffe0cc'];
const PX = 1.3; // 주간표에서 1분의 높이(px)

const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
// 지금(한국시간) 요일과 하루 중 몇 분째인지: 서버 기준 시각과 같은 계산
const kstNow = () => { const d = new Date(Date.now() + 9 * 3600e3); return { dow: ((d.getUTCDay() + 6) % 7) + 1, min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const rangeTxt = (it) => `${it.start}~${it.end}`;

export async function mount(el, { id }) {
  const kid = kidById(id) || { id: Number(id), name: '아이', avatar: '🙂', color: '#e8e0f5' };
  const canEdit = !boundKid(); // 아이 폰은 보기만(거실 기기는 누를 때 어른 확인)
  let data = { items: [] }; let day = null; let view = lsGet('ttview', 'today') === 'week' ? 'week' : 'today';

  const shownDays = () => { const d = [1, 2, 3, 4, 5]; for (const x of [6, 7]) if (data.items.some((i) => i.dow === x)) d.push(x); return d; };
  const isNow = (it) => { const n = kstNow(); return it.dow === n.dow && mins(it.start) <= n.min && n.min < mins(it.end); };

  async function load() {
    data = await get(`/api/kids/${id}/timetable`);
    if (day == null) day = shownDays().includes(data.today) ? data.today : 1;
    draw();
  }

  function listHtml() {
    const items = data.items.filter((i) => i.dow === day);
    if (!items.length) return `<p class="empty">${DOWS[day]}요일에는 수업이 없어요 🎈</p>`;
    return `<ul class="tt-list">${items.map((it) => `<li><button type="button" class="tt-item ${isNow(it) ? 'now' : ''}" data-it="${it.id}" style="--tc:${esc(it.color)}"><span class="tt-time">${esc(it.start)}<small>~${esc(it.end)}</small></span><span class="grow"><b>${esc(it.title)}</b>${it.place ? `<small class="muted"> ${esc(it.place)}</small>` : ''}</span>${isNow(it) ? '<span class="tt-badge">지금</span>' : ''}</button></li>`).join('')}</ul>`;
  }

  function gridHtml() {
    const days = shownDays();
    if (!data.items.length) return '<p class="empty">아직 시간표가 없어요</p>';
    const t0 = Math.floor(Math.min(...data.items.map((i) => mins(i.start))) / 60) * 60;
    const t1 = Math.ceil(Math.max(...data.items.map((i) => mins(i.end))) / 60) * 60;
    const H = (t1 - t0) * PX; const hours = []; for (let t = t0; t <= t1; t += 60) hours.push(t);
    const n = kstNow();
    return `<div class="tt-grid" style="--cols:${days.length}"><div class="tt-corner"></div>${days.map((d) => `<div class="tt-dayhead ${d === n.dow ? 'today' : ''}">${DOWS[d]}</div>`).join('')}
      <div class="tt-axis" style="height:${H}px">${hours.map((t) => `<span style="top:${(t - t0) * PX}px">${t / 60 > 12 ? t / 60 - 12 : t / 60}시</span>`).join('')}</div>
      ${days.map((d) => `<div class="tt-col ${d === n.dow ? 'today' : ''}" style="height:${H}px">${data.items.filter((i) => i.dow === d).map((it) => {
        const top = (mins(it.start) - t0) * PX; const h = (mins(it.end) - mins(it.start)) * PX - 2;
        return `<button type="button" class="tt-block ${isNow(it) ? 'now' : ''}" data-it="${it.id}" style="top:${top}px;height:${h}px;--tc:${esc(it.color)}" aria-label="${DOWS[d]} ${esc(it.start)}~${esc(it.end)} ${esc(it.title)}"><b>${esc(it.title)}</b>${h > 40 && it.place ? `<small>${esc(it.place)}</small>` : ''}</button>`;
      }).join('')}</div>`).join('')}</div>`;
  }

  function draw() {
    el.innerHTML = `${back(`/kid/${id}`, `${avatar(kid, 'sm')} ${esc(kid.name)}의 시간표`, canEdit ? '<button class="btn primary small" id="add">+ 수업 추가</button>' : '')}
      <div class="seg wide" role="tablist"><label class="seg-opt"><input type="radio" name="v" value="today" ${view === 'today' ? 'checked' : ''}><span>요일별</span></label><label class="seg-opt"><input type="radio" name="v" value="week" ${view === 'week' ? 'checked' : ''}><span>주간표</span></label></div>
      ${view === 'today' ? `<div class="tt-days" role="tablist">${shownDays().map((d) => `<button type="button" class="chip ${d === day ? 'on' : ''} ${d === kstNow().dow ? 'is-today' : ''}" data-day="${d}">${DOWS[d]}</button>`).join('')}</div><section class="card page-card">${listHtml()}</section>` : `<section class="card page-card tt-wrap">${gridHtml()}</section>`}
      ${canEdit && !data.items.length ? '<p class="muted small center">+ 수업 추가로 학교·학원·방과후 시간표를 넣어 보세요. 같은 수업을 여러 요일에 한 번에 넣을 수 있어요.</p>' : ''}`;
    $$('input[name=v]', el).forEach((r) => r.addEventListener('change', () => { view = r.value; lsSet('ttview', view); draw(); }));
    $$('[data-day]', el).forEach((b) => b.addEventListener('click', () => { day = Number(b.dataset.day); draw(); }));
    $$('[data-it]', el).forEach((b) => b.addEventListener('click', () => itemSheet(data.items.find((i) => i.id === Number(b.dataset.it)))));
    $('#add', el)?.addEventListener('click', async () => { if (await needAdult()) editSheet(null); });
  }

  // 수업 하나 보기(어른은 수정·삭제)
  function itemSheet(it) {
    if (!it) return;
    const sh = openSheet(`<h2 style="border-left:8px solid ${esc(it.color)};padding-left:10px">${esc(it.title)}</h2>
      <p><b>${DOWS[it.dow]}요일 ${esc(rangeTxt(it))}</b></p>${it.place ? `<p class="muted">📍 ${esc(it.place)}</p>` : ''}
      <div class="row gap end">${canEdit ? '<button class="btn ghost danger-text" data-del>삭제</button><button class="btn" data-edit>수정</button>' : ''}<button class="btn primary" data-close>닫기</button></div>`);
    sh.el.querySelector('[data-edit]')?.addEventListener('click', async () => { if (await needAdult()) { sh.close(); editSheet(it); } });
    sh.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await needAdult())) return;
      if (await confirmDialog(`'${it.title}' (${DOWS[it.dow]}요일)을 지울까요?`, { danger: true, yes: '지우기' })) {
        try { await del(`/api/timetable/${it.id}`); sh.close(); toast('지웠어요'); load(); } catch (e) { errToast(e); }
      }
    });
  }

  // 수업 만들기(여러 요일 한 번에) / 수정(그 요일 하나)
  function editSheet(it) {
    const days = it ? [it.dow] : [];
    const color = it?.color || COLORS[Math.floor(Math.random() * COLORS.length)];
    return formSheet({
      title: it ? '수업 수정' : '수업 추가', submit: it ? '저장' : '추가', cls: 'tall',
      html: `<label class="field">수업 이름<input name="title" maxlength="30" value="${esc(it?.title || '')}" placeholder="예: 과학교실" required></label>
        <label class="field">장소·메모 <small class="muted">(선택)</small><input name="place" maxlength="30" value="${esc(it?.place || '')}" placeholder="예: 4층 과학3"></label>
        <div class="field"><span>요일 ${it ? '' : '<small class="muted">(여러 개 고를 수 있어요)</small>'}</span><div class="tt-daypick">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="room-chip"><input type="${it ? 'radio' : 'checkbox'}" name="${it ? 'dow' : 'd' + d}" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${DOWS[d]}</span></label>`).join('')}</div></div>
        <div class="tt-times"><label class="field">시작<input name="start" type="time" value="${esc(it?.start || '13:10')}" required></label><label class="field">끝<input name="end" type="time" value="${esc(it?.end || '13:50')}" required></label></div>
        <div class="field"><span>색</span><div class="color-pick">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>`,
      onSubmit: async (v) => {
        const body = { title: v.title, place: v.place || '', start: v.start, end: v.end, color: v.color };
        if (it) { await patch(`/api/timetable/${it.id}`, { ...body, dow: Number(v.dow) }); toast('저장했어요'); } else {
          const picked = [1, 2, 3, 4, 5, 6, 7].filter((d) => v['d' + d]);
          if (!picked.length) throw new Error('요일을 하나 이상 골라 주세요.');
          await post(`/api/kids/${id}/timetable`, { ...body, days: picked }); toast('추가했어요');
        }
        load();
      },
    });
  }

  await load();
  return { refresh: load, topics: ['timetable', 'family'] };
}
void S;
