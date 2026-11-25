import { S } from './api.js';
import { esc } from './util.js';
import { kidArtKey } from './layout.js';

// 활동별·아이별 그림 (public/assets/act/{종류}-{yuel|yuha}.webp: 남자아이=yuel, 여자아이=yuha). 그림이 없는 조합은 이모지로 대신한다.
const HAVE = { tv: ['yuel', 'yuha'], meal: ['yuel', 'yuha'], homework: ['yuel', 'yuha'], reading: ['yuel', 'yuha'], bath: ['yuel', 'yuha'], game: ['yuel', 'yuha'], brush: ['yuel', 'yuha'] };
export const kidKey = (kidId) => (S.info?.kids.some((k) => k.id === Number(kidId)) ? kidArtKey(kidId) : null);
export function actImgUrl(kind, kidId) {
  const k = kidKey(kidId);
  return k && HAVE[kind]?.includes(k) ? `/assets/act/${kind}-${k}.webp` : null;
}
export function actPic(kind, icon, kidId, cls = '') {
  const u = actImgUrl(kind, kidId);
  return u ? `<img class="act-pic ${cls}" src="${u}" alt="" loading="lazy" draggable="false">` : `<span class="act-emoji ${cls}" aria-hidden="true">${esc(icon)}</span>`;
}
