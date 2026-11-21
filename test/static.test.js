import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

test('앱 파일(js/css)은 압축해서 보내고, 압축을 못 받는 쪽에는 원본을 보낸다', async () => {
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lf-static-')) });
  const port = await app.listen(0, '127.0.0.1');
  try {
    const url = `http://127.0.0.1:${port}/styles.css`;
    const raw = fs.statSync(new URL('../public/styles.css', import.meta.url)).size;
    const br = await fetch(url, { headers: { 'accept-encoding': 'br' } });
    const body = await br.text();
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.ok(Number(br.headers.get('content-length')) < raw / 3, '압축하면 원본의 1/3 이하');
    assert.ok(body.length > 1000, '풀어 보면 원래 내용');
    const gz = await fetch(url, { headers: { 'accept-encoding': 'gzip' } }); await gz.arrayBuffer();
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    const plain = await fetch(url, { headers: { 'accept-encoding': 'identity' } }); await plain.arrayBuffer();
    assert.equal(plain.headers.get('content-encoding'), null);
    const img = await fetch(`http://127.0.0.1:${port}/assets/house.webp`, { headers: { 'accept-encoding': 'br' } }); await img.arrayBuffer();
    assert.equal(img.headers.get('content-encoding'), null, '이미 압축된 그림은 다시 압축하지 않는다');
  } finally { await app.close(); }
});

test('index.html 은 모든 앱 모듈을 미리 불러오도록 적혀 있다', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const base = new URL('../public/js', import.meta.url).pathname;
  for (const f of walk(base).filter((x) => x.endsWith('.js'))) {
    const rel = '/js' + f.slice(base.length);
    assert.ok(html.includes(`href="${rel}"`), `${rel} 이(가) modulepreload 에 없어요 (npm run preload 로 갱신)`);
  }
});

test('앱 자바스크립트는 모두 문법 오류가 없다(문법 하나가 깨지면 화면이 통째로 안 뜬다)', async () => {
  const { spawnSync } = await import('node:child_process');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const base = new URL('../public/js', import.meta.url).pathname;
  for (const f of walk(base).filter((x) => x.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('알림 아이콘: 서비스 워커가 쓰는 하트 배지/아이콘 파일이 실제로 있고, 배지는 흰색 하트(투명 배경)다', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const f of ['/icons/badge-heart.png', '/icons/heart-pink.png']) {
    assert.ok(sw.includes(f), `${f} 을(를) 알림에서 쓴다`);
    assert.ok(fs.existsSync(new URL(`../public${f}`, import.meta.url)), `${f} 파일이 있다`);
  }
  const png = fs.readFileSync(new URL('../public/icons/badge-heart.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 96); assert.equal(png.readUInt32BE(20), 96); assert.equal(png[25], 6, 'RGBA(투명 배경)');
});

test('매니페스트에 단색(monochrome) 하트 아이콘이 있어, 안드로이드 설치 앱의 알림 작은 아이콘이 흰 네모가 되지 않는다', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const mono = m.icons.find((i) => i.purpose === 'monochrome');
  assert.ok(mono, 'monochrome 아이콘');
  assert.ok(fs.existsSync(new URL(`../public${mono.src}`, import.meta.url)));
});
