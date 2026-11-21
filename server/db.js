import { DatabaseSync } from 'node:sqlite';

// 금액은 모두 원 단위 정수. 날짜는 KST 'YYYY-MM-DD' 문자열, 시각은 epoch ms.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, login_id TEXT NOT NULL UNIQUE COLLATE NOCASE, pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
  show_grandma_status INTEGER NOT NULL DEFAULT 1, timer_sound INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id),
  kind TEXT NOT NULL CHECK (kind IN ('kid','adult')),
  role TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL, color TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id), is_guardian INTEGER NOT NULL DEFAULT 0,
  pin_hash TEXT, avatar_photo_id INTEGER, removed INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS members_user_family ON members(user_id, family_id) WHERE user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, family_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user','device')), user_id INTEGER, member_id INTEGER,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, bound_kid_id INTEGER, label TEXT);
CREATE TABLE IF NOT EXISTS elevations (
  token_hash TEXT PRIMARY KEY, session_id INTEGER NOT NULL, member_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kid_unlocks (
  session_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (session_id, kid_id));
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, device INTEGER NOT NULL DEFAULT 0, session_id INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kid_pair_codes (
  code_hash TEXT PRIMARY KEY, kid_id INTEGER NOT NULL, family_id INTEGER NOT NULL, created_by INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (
  scope TEXT NOT NULL, key TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key));

-- 루틴 (정의) / 하루 스냅샷 (과거 기록은 당시 이름·요일·목록 유지)
CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL REFERENCES members(id),
  name TEXT NOT NULL, icon TEXT NOT NULL, days INTEGER NOT NULL, slot TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, activity_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL REFERENCES members(id),
  date TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (kid_id, date));
CREATE TABLE IF NOT EXISTS day_items (
  id INTEGER PRIMARY KEY, day_id INTEGER NOT NULL REFERENCES days(id), routine_id INTEGER,
  name TEXT NOT NULL, icon TEXT NOT NULL, slot TEXT NOT NULL, sort INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, done_at INTEGER, flag_reason TEXT, activity_id INTEGER);
CREATE INDEX IF NOT EXISTS day_items_day ON day_items(day_id);

-- 도장
CREATE TABLE IF NOT EXISTS stamp_requests (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, day_id INTEGER NOT NULL REFERENCES days(id),
  date TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','approved','recheck','stale','voided')),
  created_at INTEGER NOT NULL, decided_by INTEGER, decided_at INTEGER, recheck_reason TEXT, recheck_items TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request ON stamp_requests(day_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS stamps (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, date TEXT NOT NULL,
  request_id INTEGER NOT NULL, provider_id INTEGER NOT NULL, approved_at INTEGER NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, voided_by INTEGER, voided_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS one_stamp_per_day ON stamps(kid_id, date) WHERE voided = 0;
CREATE TABLE IF NOT EXISTS board_rewards (
  id INTEGER PRIMARY KEY, kid_id INTEGER NOT NULL, board_no INTEGER NOT NULL, seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit','reverse')), ledger_id INTEGER, settlement_id INTEGER, created_at INTEGER NOT NULL,
  UNIQUE (kid_id, board_no, seq));
CREATE TABLE IF NOT EXISTS praises (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, from_id INTEGER NOT NULL,
  target_type TEXT NOT NULL, target_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);

-- 돼지 저금통 장부 (amount: 들어온 돈 +, 나간 돈 −. affects=0 은 잔액에 영향 없는 메모)
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL, amount INTEGER NOT NULL, affects INTEGER NOT NULL DEFAULT 1, memo TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, actor_id INTEGER, balance_after INTEGER NOT NULL, request_id INTEGER,
  idem_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_kid ON ledger(kid_id, date);
CREATE TABLE IF NOT EXISTS money_requests (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, type TEXT NOT NULL CHECK (type IN ('deposit','withdraw','purchase')),
  amount INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT '', to_member_id INTEGER NOT NULL, status TEXT NOT NULL,
  reject_reason TEXT, wish_id INTEGER, actual_amount INTEGER, decided_by INTEGER, ledger_id INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS money_requests_kid ON money_requests(kid_id, status);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, settled_at INTEGER, settled_by INTEGER);

-- 사고 싶은 것 / 저축 미션
CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '', photo_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('wanted','goal','ready','purchasing','bought','canceled')),
  allocated INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, bought_at INTEGER, bought_amount INTEGER, bought_photo_id INTEGER);
CREATE TABLE IF NOT EXISTS goal_moves (
  id INTEGER PRIMARY KEY, wish_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('add','remove','spend')),
  amount INTEGER NOT NULL, date TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, title TEXT NOT NULL, reward INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','requested','done','canceled')),
  created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, requested_at INTEGER, done_by INTEGER, done_at INTEGER, ledger_id INTEGER);
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY, kid_id INTEGER NOT NULL, key TEXT NOT NULL, period TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (kid_id, key, period));

-- 가족 상태 / 알림장 / 한마디 / 일정
CREATE TABLE IF NOT EXISTS statuses (
  member_id INTEGER PRIMARY KEY, state TEXT NOT NULL, eta_at INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, owner_id INTEGER, kind TEXT NOT NULL, kid_id INTEGER,
  path TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, author_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  kid_id INTEGER, photo_id INTEGER, due_date TEXT, supplies TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS post_reads (
  post_id INTEGER NOT NULL, member_id INTEGER NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY (post_id, member_id));
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, author_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, kid_id INTEGER, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, plan_id INTEGER, time TEXT);

-- 개인 메시지 (kid_id + adult_id 한 쌍의 대화. 두 사람에게만 열림)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, adult_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(kid_id, adult_id, id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, member_id INTEGER NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', dedupe TEXT UNIQUE,
  created_at INTEGER NOT NULL, read_at INTEGER);
CREATE INDEX IF NOT EXISTS notifications_member ON notifications(member_id, id);

-- 활동 타이머 (남은 시간은 항상 ends_at 기준으로 계산)
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
  minutes INTEGER NOT NULL DEFAULT 30, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS timers (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, activity_id INTEGER, name TEXT NOT NULL, icon TEXT NOT NULL, kind TEXT NOT NULL,
  duration_ms INTEGER NOT NULL, extended_ms INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','ended','dismissed','canceled')),
  warn_sent_for INTEGER, end_sent_for INTEGER, next_type TEXT, next_item_id INTEGER, next_name TEXT, next_icon TEXT, ended_at INTEGER, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_timer ON timers(kid_id) WHERE status = 'running';

-- 내일 준비물 (루틴·도장과 완전히 별개)
CREATE TABLE IF NOT EXISTS supplies (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, post_id INTEGER, name TEXT NOT NULL, name_norm TEXT NOT NULL, icon TEXT NOT NULL,
  date TEXT NOT NULL, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS supplies_dedupe ON supplies(family_id, IFNULL(post_id, 0), name_norm, date);
CREATE TABLE IF NOT EXISTS supply_kids (
  supply_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, checked INTEGER NOT NULL DEFAULT 0, checked_at INTEGER, PRIMARY KEY (supply_id, kid_id));

-- 이번 주 가족 활동
CREATE TABLE IF NOT EXISTS fam_options (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL, photo_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fam_picks (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, week TEXT NOT NULL, kid_id INTEGER NOT NULL, option_id INTEGER NOT NULL, picked_at INTEGER NOT NULL,
  UNIQUE (week, kid_id));
CREATE TABLE IF NOT EXISTS fam_plans (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, week TEXT NOT NULL, option_id INTEGER NOT NULL, date TEXT NOT NULL, time TEXT,
  status TEXT NOT NULL DEFAULT 'planned', event_id INTEGER, created_by INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (week, option_id));
CREATE UNIQUE INDEX IF NOT EXISTS events_plan ON events(plan_id) WHERE plan_id IS NOT NULL;
`;

// 이미 만들어진 개발/운영 DB 를 위한 컬럼 추가
const COLUMNS = [
  ['families', 'timer_sound INTEGER NOT NULL DEFAULT 1'], ['push_subs', 'device INTEGER NOT NULL DEFAULT 0'],
  ['routines', 'activity_id INTEGER'], ['members', 'avatar_photo_id INTEGER'], ['members', 'removed INTEGER NOT NULL DEFAULT 0'], ['sessions', 'bound_kid_id INTEGER'], ['sessions', 'label TEXT'], ['push_subs', 'session_id INTEGER'], ['day_items', 'activity_id INTEGER'], ['events', 'plan_id INTEGER'], ['events', 'time TEXT'],
];

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA.replace(/CREATE UNIQUE INDEX IF NOT EXISTS events_plan[^;]*;/, ''));
  for (const [table, ddl] of COLUMNS) {
    const col = ddl.split(' ')[0];
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_plan ON events(plan_id) WHERE plan_id IS NOT NULL;');
  return db;
}
