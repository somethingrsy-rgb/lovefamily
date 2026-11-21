import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore } from './core.js';
import { buildRoutes } from './routes.js';
import { Ctx, SESSION_COOKIE } from './ctx.js';
import { HttpError, sha256, err } from './util.js';
import { ensureToday } from './services/routines.js';
import { reconcileRewards } from './services/stamps.js';
import { settleTimers, ensureDefaultActivities } from './services/timers.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'",
};

export function createApp(opts = {}) {
  const core = createCore(opts);
  const app = { core, vapidPublicKey: opts.vapidPublicKey || null, routes: null };
  app.routes = buildRoutes(app);
  const compiled = app.routes.map((r) => {
    const keys = [];
    const re = new RegExp('^' + r.path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    return { ...r, re, keys };
  });

  const secure = opts.cookieSecure ?? false;
  const cookieHeader = (token, maxAge, req) => {
    const https = secure || req.headers['x-forwarded-proto'] === 'https';
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
  };
  const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p.length === 2));

  function sessionFrom(req) {
    const tok = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!tok) return null;
    const s = core.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(tok));
    if (!s || s.expires_at < core.now()) return null;
    return s;
  }

  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(err(413, 'too_big', '요청이 너무 커요.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const send = (res, status, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const payload = isBuf ? body : JSON.stringify(body ?? {});
    res.writeHead(status, { 'Content-Type': isBuf ? headers['Content-Type'] : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers });
    res.end(payload);
  };

  const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg', '.webmanifest']);
  const ZCACHE = new Map();
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
    const ext = path.extname(file);
    const stat = fs.statSync(file);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    // 그림·코드 모두 매번 '바뀌었나?'만 물어 304 로 끝낸다(그림을 바꿔도 폰이 옛 그림을 하루 동안 붙들고 있지 않게)
    const isAsset = /^\/(assets|icons)\//.test(rel);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'Cache-Control': rel === '/sw.js' || ext === '.html' ? 'no-cache' : 'no-cache', ...SEC_HEADERS };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'], ...SEC_HEADERS }); return res.end(); }
    // 글자 파일은 압축해서 보낸다(휴대폰 데이터 환경에서 첫 화면이 훨씬 빨라진다). 압축 결과는 파일이 바뀔 때까지 메모리에 둔다.
    if (COMPRESSIBLE.has(ext)) {
      const ae = String(req.headers['accept-encoding'] || '');
      const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
      if (enc) {
        const st = fs.statSync(file); const key = `${file}|${enc}|${st.mtimeMs}|${st.size}`;
        let buf = ZCACHE.get(key);
        if (!buf) {
          const raw = fs.readFileSync(file);
          buf = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : zlib.gzipSync(raw, { level: 9 });
          if (ZCACHE.size > 200) ZCACHE.clear();
          ZCACHE.set(key, buf);
        }
        res.writeHead(200, { ...headers, 'Content-Encoding': enc, Vary: 'Accept-Encoding', 'Content-Length': buf.length });
        return res.end(buf);
      }
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    // 느린 요청은 로그에 남긴다(fly logs 에서 '느림' 으로 찾을 수 있다): 어디가 오래 걸리는지 확인하기 위함
    const t0 = Date.now();
    res.on('finish', () => { const ms = Date.now() - t0; if (ms > 500 && !String(req.url).startsWith('/api/stream')) console.log(`느림 ${ms}ms ${req.method} ${String(req.url).split('?')[0]} ${res.statusCode}`); });
    const url = new URL(req.url, 'http://x');
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    try {
      if (pathname === '/api/health') return send(res, 200, { ok: true });
      // CSRF: 쿠키 인증 + 커스텀 헤더 요구 (교차 사이트 폼/이미지 요청은 이 헤더를 붙일 수 없다)
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'lovefamily') throw err(403, 'csrf', '잘못된 요청이에요.');

      if (pathname === '/api/stream' && req.method === 'GET') {
        const s = sessionFrom(req);
        if (!s) throw err(401, 'login_required', '로그인이 필요해요.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SEC_HEADERS });
        res.write('retry: 3000\n\n');
        const ctx = new Ctx(core, s, { ...req.headers, 'x-act-kid': url.searchParams.get('kid') || '' });
        const kid = ctx.actKidId();
        const valid = kid && core.member(kid)?.family_id === s.family_id && core.member(kid)?.kind === 'kid' ? kid : null;
        core.hub.add(res, { familyId: s.family_id, memberId: s.kind === 'user' ? s.member_id : null, kidId: valid, device: s.kind === 'device', bound: s.bound_kid_id || null });
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
        res.on('close', () => clearInterval(ping));
        return;
      }

      const route = compiled.find((r) => r.method === req.method && r.re.test(pathname));
      if (!route) throw err(404, 'not_found', '없는 주소예요.');
      const m = pathname.match(route.re);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const query = Object.fromEntries(url.searchParams);
      let body = {}; let raw = null;
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
        const buf = await readBody(req, route.raw ? 9 * 1024 * 1024 : 256 * 1024);
        if (route.raw) raw = buf;
        else if (buf.length) { try { body = JSON.parse(buf.toString('utf8')); } catch { throw err(400, 'bad_json', '요청 형식이 올바르지 않아요.'); } }
        if (body === null || typeof body !== 'object') body = {};
      }
      let ctx = null;
      if (route.auth !== false) {
        const s = sessionFrom(req);
        if (!s) throw err(401, 'login_required', '로그인이 필요해요.');
        ctx = new Ctx(core, s, req.headers);
      }
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
      const idemKey = req.headers['x-idempotency-key'] ? String(req.headers['x-idempotency-key']).slice(0, 80) : null;
      const scope = ctx ? `s${ctx.session.id}:${req.method}:${pathname}` : null;
      if (idemKey && scope) { // 네트워크 재시도: 같은 키의 요청은 저장된 응답을 그대로 돌려준다
        const prev = core.get('SELECT * FROM idempotency WHERE scope = ? AND key = ?', scope, idemKey);
        if (prev) return send(res, prev.status, JSON.parse(prev.response), { 'Idempotent-Replay': 'true' });
      }
      let result = route.fn(ctx, { core, params, query, body, ip, req, res, raw, idemKey });
      if (result && typeof result.then === 'function') result = await result;
      const headers = {};
      let status = 200; let out = result;
      if (result?.$session) {
        headers['Set-Cookie'] = cookieHeader(result.$session.token, result.$session.maxAge, req);
        status = result.status || 200; out = { ok: true };
      } else if (result?.$clear) {
        headers['Set-Cookie'] = cookieHeader('', 0, req); out = { ok: true };
      } else if (result?.file) {
        res.writeHead(200, { 'Content-Type': result.mime, 'Cache-Control': 'private, max-age=86400', ...SEC_HEADERS });
        return fs.createReadStream(result.file).pipe(res);
      } else if (result && typeof result === 'object' && 'status' in result && 'body' in result) {
        status = result.status; out = result.body;
      }
      if (idemKey && scope && ctx) {
        core.run('INSERT OR IGNORE INTO idempotency (scope, key, status, response, created_at) VALUES (?,?,?,?,?)', scope, idemKey, status, JSON.stringify(out ?? {}), core.now());
      }
      return send(res, status, out, headers);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message, ...(e.extra || {}) });
      console.error('서버 오류', e);
      return send(res, 500, { error: 'server_error', message: '잠시 문제가 생겼어요. 다시 시도해 주세요.' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  let timer = null; let timerTick = null;
  const settle = () => { try { settleTimers(core); } catch (e) { console.error('timers', e); } };
  let lastDate = core.today();
  const tick = () => {
    try {
      const d = core.today();
      if (d !== lastDate) lastDate = d;
      ensureToday(core); // 자정이 지나면 모든 아이의 오늘 스냅샷 생성
      core.run('DELETE FROM idempotency WHERE created_at < ?', core.now() - 3 * 864e5);
      core.run('DELETE FROM sessions WHERE expires_at < ?', core.now());
      for (const k of core.all("SELECT id FROM members WHERE kind = 'kid'")) core.tx(() => reconcileRewards(core, k.id)); // 도장 보상 정합성 점검
    } catch (e) { console.error('scheduler', e); }
  };
  return {
    core, server,
    listen: (port, host = '0.0.0.0') => new Promise((ok) => { server.listen(port, host, () => { ensureDefaultActivities(core); tick(); settle(); timer = setInterval(tick, 5 * 60 * 1000); timerTick = setInterval(settle, 1000); ok(server.address().port); }); }),
    tick, settle,
    close: () => new Promise((ok) => { clearInterval(timer); clearInterval(timerTick); for (const c of core.hub.conns) { try { c.res.end(); } catch {} } server.closeAllConnections?.(); server.close(() => { try { core.db.close(); } catch {} ok(); }); }),
  };
}
