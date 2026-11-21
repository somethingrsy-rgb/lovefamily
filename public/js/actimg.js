import { S } from './api.js';
import { esc } from './util.js';

// 활동별·아이별 그림 (public/assets/act/{종류}-{yuel|yuha}.webp). 그림이 없는 조합은 이모지로 대신한다.
const KEYS = ['yuel', 'yuha'];
const HAVE = { meal: ['yuel', 'yuha'], homework: ['yuel', 'yuha'], reading: ['yuel', 'yuha'], bath: ['yuel', 'yuha'], game: ['yuel', 'yuha'], brush: ['yuha'] };
export const kidKey = (kidId) => KEYS[S.info?.kids.findIndex((k) => k.id === Number(kidId))] || null;
export function actImgUrl(kind, kidId) {
  const k = kidKey(kidId);
  return k && HAVE[kind]?.includes(k) ? `/assets/act/${kind}-${k}.webp` : null;
}
export function actPic(kind, icon, kidId, cls = '') {
  const u = actImgUrl(kind, kidId);
  return u ? `<img class="act-pic ${cls}" src="${u}" alt="" loading="lazy" draggable="false">` : `<span class="act-emoji ${cls}" aria-hidden="true">${esc(icon)}</span>`;
}
