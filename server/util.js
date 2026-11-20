import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const err = (status, code, message, extra) => new HttpError(status, code, message, extra);

// ---- 한국시간(KST, DST 없음) 날짜 계산 ----
const KST_MS = 9 * 3600 * 1000;
export const kstDate = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);
export const kstMinutesOfDay = (ms) => {
  const d = new Date(ms + KST_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const dow = (date) => new Date(date + 'T00:00:00Z').getUTCDay(); // 0=일
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const weekStart = (date) => addDays(date, -((dow(date) + 6) % 7)); // 월요일 시작
export const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { first, next };
};

// ---- 입력 검증 ----
export function money(v, name = '금액', { min = 1, max = 10_000_000 } = {}) {
  if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
  if (!Number.isSafeInteger(v) || v < min || v > max) {
    throw err(400, 'bad_amount', `${name}은(는) ${min.toLocaleString('ko-KR')}원 이상 ${max.toLocaleString('ko-KR')}원 이하의 정수여야 해요.`);
  }
  return v;
}
export function text(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return '';
    throw err(400, 'bad_text', `${name}을(를) 입력해 주세요.`);
  }
  if (typeof v !== 'string') throw err(400, 'bad_text', `${name} 형식이 올바르지 않아요.`);
  const t = v.trim();
  if (t.length < min && !optional) throw err(400, 'bad_text', `${name}을(를) 입력해 주세요.`);
  if (t.length > max) throw err(400, 'bad_text', `${name}은(는) ${max}자 이내로 적어 주세요.`);
  return t;
}
export function id(v, name = 'id') {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw err(400, 'bad_id', `${name} 값이 올바르지 않아요.`);
  return n;
}
export function oneOf(v, list, name) {
  if (!list.includes(v)) throw err(400, 'bad_value', `${name} 값이 올바르지 않아요.`);
  return v;
}

// ---- 암호/토큰 ----
export const randToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randCode(len = 8) {
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32);
  return `${salt.toString('base64')}:${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const salt = Buffer.from(s, 'base64');
  const expect = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, salt, expect.length);
  return crypto.timingSafeEqual(got, expect);
}
