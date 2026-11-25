// 가족 구성에 따라 집·캐릭터·반려동물이 어떻게 놓일지 정하는 곳. (이름이 아니라 성별·역할·순서로만 정한다)
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
// 아이는 순서대로 10·11번 방, 셋째 이후는 거실에서 지낸다. 어른은 할머니·할아버지·기타=20(왼쪽), 엄마=21(가운데), 아빠=22(오른쪽).
const KID_HOME = ['10', '11', '00', '02', '01', '01'];
const ADULT_HOME = { grandma: '20', grandpa: '20', other: '20', mom: '21', dad: '22' };
export const kidHome = (idx) => KID_HOME[Math.min(Math.max(idx, 0), KID_HOME.length - 1)];
export const adultHome = (role) => ADULT_HOME[role] || '20';

// ---- 반려동물: 다이아(고양이)·크리스탈(고양이)·귀요미(강아지). 켜 둔 동물만 나온다 ----
export const DEFAULT_PET_NAMES = { ruby: '다이아', crystal: '크리스탈', yeoni: '귀요미' };
// 가족이 정한 이름(없으면 기본 이름)
export const petLabel = (id) => (id ? S.info?.family?.petNames?.[id] || DEFAULT_PET_NAMES[id] || '' : '');
// 주인이 있는 동물(다이아=ruby·귀요미=yeoni)은 가능하면 첫째·둘째 아이가 주인이고, 그 아이가 없으면 아직 주인 없는 아이에게 간다.
export function petOwners() {
  const pets = S.info?.family?.pets || {}; const n = (S.info?.kids || []).length;
  const out = {}; const used = new Set();
  for (const [id, pref] of [['ruby', 0], ['yeoni', 1]]) {
    if (pets[id] === false || !n) continue;
    let idx = pref < n && !used.has(pref) ? pref : -1;
    if (idx < 0) for (let i = 0; i < n; i++) if (!used.has(i)) { idx = i; break; }
    if (idx >= 0) { out[id] = idx; used.add(idx); }
  }
  return out;
}
export const petOwnerIdx = (petId) => petOwners()[petId];
export const petOfKidIdx = (idx) => Object.keys(petOwners()).find((id) => petOwners()[id] === idx) || null;

// ---- 집 그림: 이 기기에서 따로 고른 것이 있으면 그것, 없으면 가족 설정(가입할 때 고른 것) ----
export const houseCur = () => { const h = lsGet('house', null) || S.info?.family?.house; return HOUSES.some(([k]) => k === h) ? h : 'pastel'; };
export const houseSrc = () => HOUSES.find(([k]) => k === houseCur())[2];
