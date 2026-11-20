// 한국어 조사/문장 도우미 (서버가 완성된 문장을 내려 주므로 화면·푸시가 같은 문구를 쓴다)
const code = (ch) => ch.charCodeAt(0);
const isHangul = (ch) => ch && code(ch) >= 0xac00 && code(ch) <= 0xd7a3;
export const hasBatchim = (w) => { const c = w.slice(-1); return isHangul(c) && (code(c) - 0xac00) % 28 !== 0; };
export const vocative = (name) => name + (hasBatchim(name) ? '아' : '야');   // 유하야 / 유엘아
export const iEyo = (w) => w + (hasBatchim(w) ? '이에요' : '예요');           // 씻기예요 / 간식이에요
export const topic = (w) => w + (hasBatchim(w) ? '은' : '는');                // 씻기는 / 숙제는
// '씻기' → '씻을', '양치하기' → '양치할' ('이제 ~ 시간이에요' 용)
export function futureForm(name) {
  if (!name.endsWith('기') || name.length < 2) return name;
  const stem = name.slice(0, -1); const last = stem.slice(-1);
  if (!isHangul(last)) return `${stem} `.trim();
  return hasBatchim(last) ? `${stem}을` : stem.slice(0, -1) + String.fromCharCode(code(last) + 8);
}
const PHRASE = { tv: 'TV 보는', meal: '식사', game: '게임하는' };
export const phrase = (kind, name) => PHRASE[kind] || name;
export function warnText(kidName, kind, name, nextName) {
  return `${vocative(kidName)}, ${phrase(kind, name)} 시간이 5분 남았어요.${nextName ? ` 다음은 ${iEyo(nextName)}.` : ''} 이제 슬슬 마무리할 준비를 해요.`;
}
export function endText(kind, name) {
  if (kind === 'meal') return '식사 시간이 끝났어요. 더 필요하면 어른에게 알려 주세요.';
  if (kind === 'game') return '게임 시간이 끝났어요. 저장하고 마무리해요.';
  if (kind === 'tv') return 'TV 보는 시간이 끝났어요. 이제 TV를 끄고 마무리해요.';
  return `${name} 시간이 끝났어요.`;
}
export const nextEndText = (nextName, done) => (done ? `${topic(nextName)} 이미 했어요` : `이제 ${futureForm(nextName)} 시간이에요`);
