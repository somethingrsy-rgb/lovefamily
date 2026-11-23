import { createRequire } from 'node:module'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createApp } from '../../server/app.js';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-a-')) }); const port = await app.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${port}`;
let cookie=''; const call = async (m,u,b,h={})=>{const r=await fetch(base+u,{method:m,headers:{'X-Requested-With':'lovefamily','Content-Type':'application/json',cookie,...h},body:b&&JSON.stringify(b)});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];return r.json().catch(()=>({}))};
await call('POST','/api/auth/register',{loginId:'m@t',password:'secret1',role:'mom'});
const me = await call('GET','/api/me'); const [k1,k2]=me.kids.map(k=>k.id);
for (const [n,i,s] of [['양치하기','🪥','morning'],['숙제하기','📚','after_school'],['성경말씀','✝','evening']]) await call('POST','/api/routines',{kidIds:[k1,k2],name:n,icon:i,days:'daily',slot:s});
const day = await call('GET',`/api/kids/${k1}/day`); for (const it of day.items) await call('PUT',`/api/day-items/${it.id}`,{done:true},{'X-Act-Kid':String(k1)});
await call('POST',`/api/kids/${k1}/day/request`,{},{'X-Act-Kid':String(k1)});
await call('POST','/api/posts',{title:'알림',body:'소풍'}); await call('POST','/api/events',{title:'외식',date:new Date().toISOString().slice(0,10),kidId:'all'});
await call('POST',`/api/kids/${k1}/wishes`,{name:'레고',price:30000}); await call('POST','/api/missions',{kidId:k1,title:'책 읽기',reward:1000});
const ap = await call('GET','/api/approvals'); const rid = ap.pending?.[0]?.id;
const { code } = await call('POST',`/api/kids/${k2}/pair-code`);
const routes = ['/','/adult','/inbox','/routines','/stamps',`/stamps/${k1}`,'/family','/notebook','/calendar',rid?`/approve/${rid}`:null,`/money/${k1}`,'/family-activity'].filter(Boolean);
const kidRoutes = ['/',`/kid/${k2}`,`/kid/${k2}/today`,`/kid/${k2}/wallet`,`/kid/${k2}/wishes`,`/kid/${k2}/talk`,`/kid/${k2}/inbox`,`/kid/${k2}/missions`,`/kid/${k2}/stamps`,`/kid/${k2}/timer`,`/kid/${k2}/supplies`,`/kid/${k2}/family`,'/me'];
const b = await chromium.launch();
const issues = [];
async function run(label, ctxOpts, setup, rs) {
  const ctx = await b.newContext(ctxOpts); const pg = await ctx.newPage();
  let cur = '';
  pg.on('pageerror', (e) => issues.push([label, cur, 'JS오류', e.message]));
  pg.on('console', (m) => { if (m.type() === 'error') issues.push([label, cur, '콘솔오류', m.text().slice(0, 140)]); });
  pg.on('requestfailed', (r) => issues.push([label, cur, '요청실패', r.url().replace(base, '') + ' ' + (r.failure()?.errorText || '')]));
  pg.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/auth')) issues.push([label, cur, 'HTTP ' + r.status(), r.url().replace(base, '')]); });
  await setup(pg);
  for (const r of rs) {
    cur = r; await pg.goto(base + '/#' + r); await pg.waitForTimeout(1100);
    const m = await pg.evaluate(() => {
      const vw = document.documentElement.clientWidth; const out = {};
      out.hscroll = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
      out.broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.split('/').slice(-2).join('/')).slice(0, 3);
      out.small = [...document.querySelectorAll('#main a, #main button, #main input:not([type=hidden]), .tabs a, .tabs button')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (r.height < 32 || r.width < 32) && !e.closest('.walkers') && !e.closest('.house'); }).map((e) => (e.className || e.tagName) + '「' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 8) + '」' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).slice(0, 4);
      out.offscreen = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 2 || r.left < -2) && !e.closest('.walkers,.house,.pets,[aria-hidden=true]') && getComputedStyle(e).position !== 'fixed'; }).map((e) => (e.className || e.tagName).toString().slice(0, 30)).slice(0, 3);
      return out;
    });
    if (m.hscroll > 1) issues.push([label, r, '가로 스크롤', m.hscroll + 'px']);
    if (m.broken.length) issues.push([label, r, '깨진 이미지', m.broken.join(',')]);
    if (m.small.length) issues.push([label, r, '작은 터치칸', m.small.join(' | ')]);
    if (m.offscreen.length) issues.push([label, r, '화면 밖', m.offscreen.join(',')]);
  }
  await ctx.close();
}
const adultLogin = (pg) => async () => {};
const login = async (pg) => { await pg.goto(base+'/#/login'); await pg.fill('input[name=loginId]','m@t'); await pg.fill('input[name=password]','secret1'); await pg.click('button[type=submit]'); await pg.waitForSelector('.kid-card'); };
await run('어른폰', { ...devices['iPhone 13'] }, login, routes);
await run('아이패드', { viewport: { width: 1180, height: 820 }, hasTouch: true }, login, routes.slice(0, 7));
await run('폰가로', { viewport: { width: 844, height: 390 }, hasTouch: true }, login, ['/', '/family', '/stamps']);
await run('아이폰', { ...devices['Galaxy S9+'] }, async (pg) => { await pg.goto(base + '/#/pair'); await pg.fill('input', code); await pg.click('button[type=submit]'); await pg.waitForSelector('.tab'); }, kidRoutes);
await b.close(); await app.close();
const seen = new Set(); for (const i of issues) { const k = i.join('|'); if (!seen.has(k)) { seen.add(k); console.log(i.join('  ')); } }
console.log('총', seen.size);
