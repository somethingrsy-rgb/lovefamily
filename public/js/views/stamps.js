import { $, $$, esc, won, shortDate, DOW, dateLabel, addDays, SLOT } from '../util.js';
import { S, get, post, isDevice, isAdultNow } from '../api.js';
import { avatar, toast, errToast, formSheet, openSheet, needAdult } from '../ui.js';
import { back } from '../common.js';

// 도장판(30칸) + 달력(날짜별 체크 결과·도장 여부)
export async function mount(el, params) {
  const kids = S.info.kids;
  let kidId = Number(params.kidId || params.id) || kids[0]?.id;
  let view = 'board';
  let month = S.info.today.slice(0, 7);
  const fromKid = !!params.id;
  async function load() {
    const [b, cal] = await Promise.all([get(`/api/kids/${kidId}/stamps`), get(`/api/kids/${kidId}/calendar?month=${month}`)]);
    const kid = kids.find((k) => k.id === kidId);
    el.innerHTML = `${fromKid ? back(`/kid/${kidId}`, '도장판') : '<header class="page-head"><h1>💮 도장판</h1></header>'}
      ${fromKid ? '' : `<div class="kid-tabs" role="tablist">${kids.map((k) => `<button role="tab" class="kid-tab ${k.id === kidId ? 'on' : ''}" aria-selected="${k.id === kidId}" data-kid="${k.id}" style="--kc:${esc(k.color)}">${avatar(k, 'sm')} ${esc(k.name)}</button>`).join('')}</div>`}
      <div class="seg wide" role="tablist"><label class="seg-opt"><input type="radio" name="v" value="board" ${view === 'board' ? 'checked' : ''}><span>도장판</span></label><label class="seg-opt"><input type="radio" name="v" value="cal" ${view === 'cal' ? 'checked' : ''}><span>달력</span></label></div>
      ${view === 'board' ? boardHtml(b, kid) : calHtml(cal)}`;
    $$('.kid-tab', el).forEach((t) => t.addEventListener('click', () => { kidId = Number(t.dataset.kid); load().catch(errToast); }));
    $$('input[name=v]', el).forEach((r) => r.addEventListener('change', () => { view = r.value; load().catch(errToast); }));
    el.onclick = async (e) => {
      const c = e.target.closest('[data-stamp]'); const d = e.target.closest('[data-date]'); const nav = e.target.closest('[data-m]');
      try {
        if (nav) { const [y, m] = month.split('-').map(Number); const n = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.m), 1)); month = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`; await load(); }
        if (d) await dayDetail(d.dataset.date);
        if (c) await stampInfo(b, Number(c.dataset.stamp));
        if (e.target.id === 'praise') await formSheet({ title: '도장판에 칭찬 남기기', submit: '남기기', html: '<label class="field">짧은 칭찬<input name="text" maxlength="80" placeholder="매일 잘하고 있어요!" required></label>', onSubmit: async (v) => { await post('/api/praises', { kidId, targetType: 'stamp', targetId: 0, text: v.text }); toast('칭찬을 남겼어요'); load(); } });
        const so = e.target.closest('[data-settle]'); if (so) { await post(`/api/settlements/${so.dataset.settle}/settle`); toast('정산 완료로 표시했어요'); load(); }
        if (e.target.closest('[data-arch]')) { const x = e.target.closest('[data-arch]'); const box = $(`#arch${x.dataset.arch}`, el); box.hidden = !box.hidden; }
      } catch (x) { errToast(x); }
    };
  }
  function cells(list, size) { const byNo = new Map(list.map((s) => [s.no, s])); return Array.from({ length: size }, (_, i) => { const s = byNo.get(i + 1); return s ? `<button class="cell on" data-stamp="${s.id}" aria-label="${i + 1}번째 도장 ${shortDate(s.date)} ${esc(s.providerName || '')}"><span class="st">💮</span><small>${shortDate(s.date)}</small><small class="by">${esc(s.providerName || '')}</small></button>` : `<div class="cell"><span class="no">${i + 1}</span></div>${''}`; }).join(''); }
  function boardHtml(b, kid) {
    const adult = !isDevice() || isAdultNow();
    return `<section class="card page-card board" style="--kc:${esc(kid.color)}"><div class="board-head"><h2>${esc(kid.name)}의 ${b.boardNo}번째 도장판</h2><b>${b.count}/${b.size}</b></div>
      <div class="bar"><i style="width:${(b.count / b.size) * 100}%"></i></div><p class="small muted">30개를 모으면 ${won(b.reward)}이 저금통에 들어가요 · 연속이 아니어도 괜찮아요 (${b.size - b.count}개 남았어요)</p>
      <div class="stamp-grid">${cells(b.current, b.size)}</div>
      ${b.praises.length ? `<ul class="praises">${b.praises.map((p) => `<li>👏 <b>${esc(p.from)}</b> ${esc(p.text)}</li>`).join('')}</ul>` : ''}
      <div class="row gap wrap">${adult ? '<button class="btn ghost" id="praise">👏 칭찬 남기기</button>' : ''}</div></section>
      ${b.settlements.some((s) => s.status === 'open') ? `<section class="card page-card"><h3>⚠️ 정산 필요</h3><ul class="reqs">${b.settlements.filter((s) => s.status === 'open').map((s) => `<li><b>${won(s.amount)}</b> ${esc(s.reason)} <button class="btn small ghost" data-settle="${s.id}">정산 완료</button></li>`).join('')}</ul></section>` : ''}
      <section class="card page-card"><h3>📦 완성한 도장판 보관함 (${b.completed.length})</h3>${b.completed.length ? b.completed.map((c) => `<div class="arch"><button class="btn ghost wide" data-arch="${c.boardNo}">${c.boardNo}번째 도장판 · ${shortDate(new Date(c.completedAt + 9 * 3600e3).toISOString().slice(0, 10))} 완성 🎉</button><div id="arch${c.boardNo}" hidden><div class="stamp-grid small">${cells(c.stamps, 30)}</div></div></div>`).join('') : '<p class="muted">30개를 채우면 여기에 보관돼요</p>'}</section>`;
  }
  function calHtml(cal) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const map = new Map(cal.map((c) => [c.date, c]));
    const blanks = first.getUTCDay();
    return `<section class="card page-card"><div class="month-nav"><button class="btn ghost" data-m="-1" aria-label="이전 달">‹</button><h3>${y}년 ${m}월</h3><button class="btn ghost" data-m="1" aria-label="다음 달">›</button></div>
      <div class="cal">${DOW.map((d, i) => `<div class="cal-h ${i === 0 ? 'sun' : ''}">${d}</div>`).join('')}${'<div></div>'.repeat(blanks)}${Array.from({ length: days }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`; const c = map.get(date);
        return `<button class="cal-d ${c ? 'has' : ''} ${date === S.info.today ? 'today' : ''}" data-date="${date}" ${c ? '' : 'disabled'}><span>${i + 1}</span>${c ? `<small>${c.done}/${c.total}</small>${c.stamp ? '<i>💮</i>' : c.pending ? '<i>✋</i>' : ''}` : ''}</button>`; }).join('')}</div></section>`;
  }
  async function dayDetail(date) {
    const d = await get(`/api/kids/${kidId}/day?date=${date}`);
    const sh = openSheet(`<h2>${dateLabel(date)}</h2><p class="muted">${d.status === 'approved' ? `💮 도장 받았어요 (${esc(d.stamp?.providerName || '')})` : d.status === 'requested' ? '✋ 어른 확인 중' : d.status === 'none' ? '예정된 루틴이 없었어요' : `${d.done}/${d.total} 완료`}</p>
      <ul class="checks readonly">${d.items.map((i) => `<li><div class="check-item ${i.done ? 'done' : ''}"><span class="ci-icon">${esc(i.icon)}</span><span class="ci-name">${esc(i.name)} <small>${SLOT[i.slot]}</small></span><span class="ci-box">${i.done ? '✔' : ''}</span></div></li>`).join('')}</ul><div class="row end"><button class="btn primary" data-close>닫기</button></div>`);
    void sh;
  }
  async function stampInfo(b, sid) {
    const s = [...b.current, ...b.completed.flatMap((c) => c.stamps)].find((x) => x.id === sid);
    const adult = !isDevice() || isAdultNow();
    const sh = openSheet(`<h2>💮 ${dateLabel(s.date)}</h2><p>도장을 준 사람: <b>${esc(s.providerName || '')}</b></p>${adult ? '<button class="btn danger wide" id="void">기록 정정(취소)</button>' : '<button class="btn ghost small" id="adm">🔑 어른 확인</button>'}<div class="row end"><button class="btn ghost" data-close>닫기</button></div>`);
    $('#void', sh.el)?.addEventListener('click', async () => {
      sh.close();
      await formSheet({ title: '도장 기록 정정', submit: '정정하기', danger: true, html: '<p class="muted">부모님만 할 수 있어요. 30개 보상 조건이 바뀌면 조정·정산 내역이 남아요.</p><label class="field">사유<input name="reason" maxlength="100" required></label>', onSubmit: async (v) => { await post(`/api/stamps/${sid}/void`, { reason: v.reason }); toast('정정했어요'); load(); } });
    });
    $('#adm', sh.el)?.addEventListener('click', async () => { sh.close(); if (await needAdult()) stampInfo(b, sid); });
  }
  await load();
  return { refresh: load, topics: ['stamps', 'day'] };
}
void addDays;
