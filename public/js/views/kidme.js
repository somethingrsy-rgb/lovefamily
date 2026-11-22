import { $, esc, lsGet, lsSet } from '../util.js';
import { S, boundKid, kidById, bus } from '../api.js';
import { avatar, toast, errToast, confirmDialog } from '../ui.js';
import { pushState, enablePush, disablePush, testPush } from './family.js';

// 아이 폰 전용 '내 설정': 알림 켜기, 밤 모드, 연결 끊기(로그아웃)
export async function mount(el) {
  const kid = kidById(boundKid()) || { id: boundKid(), name: '나', avatar: '🙂', color: '#e8e0f5' };
  async function load() {
    const ps = await pushState().catch(() => ({ s: 'unsupported', msg: '' }));
    const theme = (lsGet('theme', 'light') === 'dark' ? 'dark' : 'light');
    el.innerHTML = `<header class="page-head"><h1>${avatar(kid, 'sm')} ${esc(kid.name)}의 설정</h1></header>
      <section class="card page-card"><h3>🔔 알림</h3>
        ${ps.s === 'on' ? '<p class="ok">✅ 이 폰에서 알림을 받고 있어요</p><div class="row gap wrap"><button class="btn" id="ptest">🔔 테스트 알림</button><button class="btn ghost" id="poff">알림 끄기</button></div><details class="push-help"><summary>🔒 잠금 화면에 알림이 안 보여요</summary><ol class="small"><li>설정 → 알림 → <b>우리집</b>을 엽니다. (목록에 없으면 홈 화면 앱에서 먼저 알림을 켜 주세요)</li><li><b>알림 허용</b>을 켭니다.</li><li>알림 표시에서 <b>잠금 화면</b>, 알림 센터, 배너를 모두 체크합니다.</li><li>방해 금지·집중 모드가 켜져 있으면 알림이 숨겨져요. 이 앱을 허용 앱에 넣어 주세요.</li><li><b>안드로이드</b>: 설정 → 앱 → 우리집(또는 Chrome) → 알림에서 알림을 켜고, ‘잠금 화면’을 <b>모든 알림 내용 표시</b>로 바꿔 주세요. 중요도는 ‘소리 및 팝업’(긴급)이 좋아요. 배터리 설정에서 이 앱을 ‘제한 없음’으로 두면 앱을 닫아도 더 잘 와요.</li><li>위의 <b>테스트 알림</b> 버튼을 눌러 잠금 화면에 오는지 확인해요.</li></ol></details>'
          : ps.s === 'off' ? '<p class="muted">도장을 받거나 답장이 오면 알려 줘요.</p><button class="btn primary big" id="pon">🔔 알림 받기</button>'
            : ps.s === 'noserver' ? '<p class="muted">알림은 아직 준비 중이에요. 어른에게 물어봐요.</p>'
              : ps.s === 'denied' ? '<p class="muted">알림이 꺼져 있어요. 폰 설정에서 이 앱의 알림을 허용해 주세요.</p>'
                : `<p class="muted small">${esc(ps.msg || '이 폰에서는 알림을 켤 수 없어요.')}</p>`}
      </section>
      <section class="card page-card"><h3>화면</h3><div class="seg">${[['light', '낮'], ['dark', '밤']].map(([k, t]) => `<label class="seg-opt"><input type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></section>
      <section class="card page-card"><button class="btn ghost wide" id="logout">이 폰 연결 끊기</button><p class="muted small center">다시 쓰려면 어른에게 새 코드를 받아야 해요.</p></section>`;
    $('#pon', el)?.addEventListener('click', async () => { try { await enablePush(ps); toast('알림을 켰어요'); load(); } catch (e) { errToast(e); } });
    $('#poff', el)?.addEventListener('click', async () => { try { await disablePush(ps); load(); } catch (e) { errToast(e); } });
    $('#ptest', el)?.addEventListener('click', async () => { try { await testPush(); } catch (e) { errToast(e); } });
    el.querySelectorAll('input[name=theme]').forEach((r) => r.addEventListener('change', () => { lsSet('theme', r.value); bus.emit('theme'); }));
    $('#logout', el).onclick = async () => { if (await confirmDialog('이 폰의 연결을 끊을까요?', { danger: true, yes: '끊기' })) window.__app.logout(); };
  }
  await load();
  return { refresh: load, topics: ['family'] };
}
void S;
