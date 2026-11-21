import { err, sha256 } from './util.js';

export const SESSION_COOKIE = 'lf_sid';
export const ELEVATION_MS = 10 * 60 * 1000;
export const UNLOCK_MS = 30 * 60 * 1000;

// 요청 하나의 신원/권한 컨텍스트.
// - user 세션: 어른 본인 계정(휴대폰). 어른 권한이 항상 있다.
// - device 세션: 거실 공용 기기. 아이 전환·체크는 가능하지만 어른 권한은 '재인증(elevation)'이 있어야 한다.
export class Ctx {
  constructor(core, session, headers = {}) {
    this.core = core;
    this.session = session;
    this.headers = headers;
    this.familyId = session.family_id;
    this.isDevice = session.kind === 'device';
    this._adult = undefined;
  }
  get now() { return this.core.now(); }

  // 현재 요청을 수행하는 어른 (없으면 null)
  adultOrNull() {
    if (this._adult !== undefined) return this._adult;
    let a = null;
    if (!this.isDevice) {
      const m = this.core.member(this.session.member_id);
      if (m && m.family_id === this.familyId && m.kind === 'adult' && !m.removed) a = m;
    } else {
      const tok = this.headers['x-elevation'];
      if (tok) {
        const row = this.core.get('SELECT * FROM elevations WHERE token_hash = ? AND session_id = ? AND expires_at > ?', sha256(String(tok)), this.session.id, this.now);
        if (row) a = this.core.member(row.member_id);
      }
    }
    this._adult = a;
    return a;
  }
  adult() {
    const a = this.adultOrNull();
    if (!a) {
      throw err(401, this.isDevice ? 'reauth_required' : 'login_required',
        this.isDevice ? '어른 확인이 필요해요. 비밀번호를 다시 입력해 주세요.' : '로그인이 필요해요.');
    }
    return a;
  }
  guardian() {
    const a = this.adult();
    if (!a.is_guardian) throw err(403, 'guardian_only', '부모님 권한이 있는 어른만 할 수 있어요.');
    return a;
  }

  // 공용 기기에서 현재 선택된 아이 (X-Act-Kid)
  actKidId() {
    if (!this.isDevice) return null;
    const v = Number(this.headers['x-act-kid']);
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  }
  kidUnlocked(kid) {
    if (!kid.pin_hash) return true;
    return !!this.core.get('SELECT 1 FROM kid_unlocks WHERE session_id = ? AND kid_id = ? AND expires_at > ?', this.session.id, kid.id, this.now);
  }

  kidRow(kidId) {
    const kid = this.core.member(kidId);
    // 다른 가족의 아이는 존재 여부도 알려 주지 않는다.
    if (!kid || kid.kind !== 'kid' || kid.family_id !== this.familyId) throw err(404, 'not_found', '찾을 수 없어요.');
    return kid;
  }
  // 아이 공개 정보(루틴, 도장 현황 등): 같은 가족 세션이면 접근 가능
  kid(kidId) { return this.kidRow(kidId); }
  // 아이 비공개 정보(장부·사고 싶은 것·받은 편지함): 어른, 또는 해당 아이로 전환한(PIN 해제된) 공용 기기만
  kidPrivate(kidId) {
    const kid = this.kidRow(kidId);
    if (this.adultOrNull()) return kid;
    if (this.isDevice && this.actKidId() === kid.id) {
      if (!this.kidUnlocked(kid)) throw err(403, 'kid_locked', '이 친구의 비밀번호를 먼저 눌러 주세요.');
      return kid;
    }
    throw err(403, 'forbidden', '볼 수 없는 정보예요.');
  }
  // 아이 본인이 하는 요청(출금 요청·메시지·미션 완료 등)
  asKid(kidId) {
    const kid = this.kidRow(kidId);
    if (this.isDevice && this.actKidId() === kid.id) {
      if (!this.kidUnlocked(kid)) throw err(403, 'kid_locked', '이 친구의 비밀번호를 먼저 눌러 주세요.');
      return kid;
    }
    throw err(403, 'kid_only', '아이 화면에서만 보낼 수 있어요.');
  }
  // 어른이거나 해당 아이인 경우 (사고 싶은 것 등록처럼 둘 다 되는 동작)
  kidOrAdult(kidId) {
    const kid = this.kidRow(kidId);
    if (this.adultOrNull()) return { kid, adult: this.adultOrNull() };
    this.asKid(kidId);
    return { kid, adult: null };
  }
  adultMember(id) {
    const m = this.core.member(id);
    if (!m || m.kind !== 'adult' || m.removed || m.family_id !== this.familyId) throw err(404, 'not_found', '찾을 수 없는 어른이에요.');
    return m;
  }
}
