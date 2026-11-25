// 가족 구성에 따라 집·캐릭터·반려동물이 어떻게 놓일지 정하는 곳. (이름이 아니라 성별·역할·순서·가족이 고른 값으로만 정한다)
import { S } from './api.js';
import { HOUSES, lsGet } from './util.js';

// ---- 캐릭터 그림 세트: public/assets/{chars,walk,act}/ 아래 파일 이름 ----
// 남자아이는 yuel 세트, 여자아이는 yuha 세트를 쓴다(새 캐릭터를 만들면 여기만 늘리면 된다).
export const KID_ART = { boy: 'yuel', girl: 'yuha' };
// 어른은 엄마·아빠·할머니 그림이 있고, 할아버지·기타 어른은 아직 그림이 없어 얼굴(사진·이모지) 동그라미로 보여 준다.
export const ADULT_ART = { mom: 'mom', dad: 'dad', grandma: 'gma' };
export const adultArtKey = (role) => ADULT_ART[role] || null;

// 성별이 없는 예전 아이(가입 마법사 이전)는 순서로 짐작한다: 첫째 남자아이, 둘째 여자아이
export function kidGenderOf(kidId) {
  const kids = S.info?.kids || [];
  const i = kids.findIndex((k) => k.id === Number(kidId));
  return kids[i]?.gender || (i === 1 ? 'girl' : 'boy');
}
export const kidArtKey = (kidId) => KID_ART[kidGenderOf(kidId)];

// ---- 집(3×3 칸): 0행 거실 / 1행 아이방 둘 + 도장방 / 2행 어른방 셋 ----
// 기본 방: 아이는 순서대로 10·11번 방, 셋째 이후는 거실. 어른은 할머니·할아버지·기타=20(왼쪽), 엄마=21(가운데), 아빠=22(오른쪽).
// 구성원이 직접 고른 방(homeCell)이 있으면 그것이 먼저다.
const KID_HOME = ['10', '11', '00', '02', '01', '01'];
const ADULT_HOME = { grandma: '20', grandpa: '20', other: '20', mom: '21', dad: '22' };
export const HOME_CELLS = ['00', '01', '02', '10', '11', '20', '21', '22'];
// 방 고르기 화면에 보여 줄 이름 (12번 칸은 도장방이라 고를 수 없다)
export const ROOM_OPTIONS = [
  ['거실', [['00', '왼쪽'], ['01', '가운데'], ['02', '오른쪽']]],
  ['가운데층', [['10', '왼쪽 방'], ['11', '가운데 방']]],
  ['아래층', [['20', '왼쪽 방'], ['21', '가운데 방'], ['22', '오른쪽 방']]],
];
export const roomName = (cell) => { for (const [floor, rooms] of ROOM_OPTIONS) { const r = rooms.find(([c]) => c === cell); if (r) return `${floor} ${r[1]}`; } return ''; };
export const defaultHomeOf = (m) => {
  if (m.kind === 'kid') { const i = Math.max(0, (S.info?.kids || []).findIndex((k) => k.id === m.id)); return KID_HOME[Math.min(i, KID_HOME.length - 1)]; }
  return ADULT_HOME[m.role] || '20';
};
export const homeOf = (m) => (HOME_CELLS.includes(m.homeCell) ? m.homeCell : defaultHomeOf(m));

// ---- 반려동물: 이름은 가족이 짓고(기본 이름 없음), 주인은 아이 한 명. 켜 둔 동물만 나온다 ----
export const PET_DESC = { ruby: '갈색 고양이', crystal: '하얀 고양이', yeoni: '강아지' };
export const PET_IDS = ['ruby', 'crystal', 'yeoni'];
export const PET_IMG = { ruby: '/assets/cats/ruby-sit.webp', crystal: '/assets/cats/crystal-sit.webp', yeoni: '/assets/dog/dog-sit.webp' };
export const petEnabled = (id) => (S.info?.family?.pets?.[id]) !== false;
// 이름을 아직 안 지었으면 생김새로 부른다(예: 갈색 고양이)
export const petLabel = (id) => (id ? S.info?.family?.petNames?.[id] || PET_DESC[id] || '' : '');
export const petOwnerKidId = (id) => (petEnabled(id) ? S.info?.family?.petOwners?.[id] || null : null);
export const petOwnerIdx = (id) => { const k = petOwnerKidId(id); const i = (S.info?.kids || []).findIndex((x) => x.id === k); return i >= 0 ? i : undefined; };
export const petsOfKid = (kidId) => PET_IDS.filter((id) => petOwnerKidId(id) === Number(kidId));

// ---- 집 그림: 각자 이 기기에서 고른 것(안 골랐으면 보라 집). 가족 전체에는 영향을 주지 않는다 ----
export const houseCur = () => { const h = lsGet('house', null); return HOUSES.some(([k]) => k === h) ? h : 'pastel'; }; // 처음 기본: 보라 집
export const houseSrc = () => HOUSES.find(([k]) => k === houseCur())[2];
