// 이모지를 귀여운 그림(public/assets/emoji/*.webp)으로 자동 교체한다.
// 화면에 글자로 그려진 이모지를 찾아 <img>로 바꾸고, 새로 그려지는 화면도 계속 감시한다.
// 그림이 없는 이모지는 그대로 이모지로 남고, 그림 파일을 불러오지 못하면 원래 이모지가 보인다(alt).
const PAIRS = [
  ['👨‍👩‍👧‍👦', 'family'],
  ['💮', 'stamp-mark'],
  ['🎒', 'backpack'],
  ['⏱', 'stopwatch'],
  ['✅', 'check-done'],
  ['🔑', 'key'],
  ['✋', 'raised-hand'],
  ['🔎', 'magnifier'],
  ['🗑', 'trash'],
  ['📅', 'calendar'],
  ['🎈', 'balloon'],
  ['📒', 'notebook-yellow'],
  ['🔔', 'bell'],
  ['🏠', 'home'],
  ['📝', 'memo'],
  ['🎉', 'party-popper'],
  ['👏', 'clap'],
  ['💌', 'love-letter'],
  ['📌', 'pushpin'],
  ['📷', 'camera'],
  ['😴', 'sleepy-face'],
  ['⭐', 'star'],
  ['🔒', 'lock'],
  ['➡', 'arrow-right'],
  ['🔓', 'unlock'],
  ['💧', 'water-drop'],
  ['🧸', 'teddy'],
  ['👕', 'tshirt'],
  ['👚', 'blouse'],
  ['✕', 'close-x'],
  ['🔇', 'muted'],
  ['⏰', 'alarm-clock'],
  ['⏳', 'hourglass'],
  ['👍', 'thumbs-up'],
  ['🛍', 'shopping-bags'],
  ['➕', 'plus'],
  ['🏆', 'trophy'],
  ['🏅', 'medal'],
  ['🎯', 'target'],
  ['💰', 'money-bag'],
  ['🛒', 'shopping-cart'],
  ['➖', 'minus'],
  ['🖼', 'album'],
  ['🖐', 'stamping-hand'],
  ['💬', 'speech-bubble'],
  ['⚠', 'warning'],
  ['📥', 'inbox-tray'],
  ['💕', 'two-hearts'],
  ['🌳', 'park-tree'],
  ['🎲', 'dice'],
  ['🍪', 'cookie'],
  ['🎬', 'clapperboard'],
  ['🚲', 'bicycle'],
  ['🏖', 'beach'],
  ['🍕', 'pizza'],
  ['🎨', 'palette'],
  ['🛝', 'slide'],
  ['⚽', 'soccer'],
  ['🍦', 'ice-cream'],
  ['🏕', 'camping'],
  ['🧹', 'broom'],
  ['🛏', 'bed'],
  ['🚿', 'shower'],
  ['🧦', 'socks'],
  ['🥛', 'milk'],
  ['🎹', 'piano'],
  ['✏', 'pencil'],
  ['🖍', 'crayon'],
  ['🟥', 'colored-paper'],
  ['✂', 'scissors'],
  ['🧴', 'glue'],
  ['👟', 'sneaker'],
  ['🎽', 'gym-shirt'],
  ['📔', 'notebook-small'],
  ['🍙', 'riceball'],
  ['🧻', 'tissue'],
  ['🧾', 'receipt'],
  ['🏧', 'cash-out'],
  ['😊', 'happy-face'],
  ['⚡', 'lightning'],
  ['▶', 'play'],
  ['💞', 'hearts-orbit'],
  ['🙂', 'smile-face'],
  ['🍽', 'meal'],
  ['📺', 'tv'],
  ['🎮', 'game'],
  ['🪥', 'toothbrush'],
  ['📚', 'homework'],
  ['📖', 'reading'],
  ['🛁', 'bath'],
  ['💼', 'briefcase'],
  ['🚌', 'bus'],
  ['🚗', 'car'],
  ['🐰', 'avatar-rabbit'],
  ['🐱', 'avatar-cat'],
];
const MAP = new Map(PAIRS.map(([e, f]) => [e, f]));
const RE = new RegExp(PAIRS.map(([e]) => e).sort((a, b) => b.length - a.length).join('|') + '', 'gu');
const RE_FULL = new RegExp('(' + PAIRS.map(([e]) => e).sort((a, b) => b.length - a.length).join('|') + ')\\uFE0F?', 'gu');
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION', 'SELECT', 'TITLE', 'NOSCRIPT']);

function swapText(node) {
  const text = node.nodeValue;
  if (!text || !RE.test(text)) { RE.lastIndex = 0; return; }
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0; let m;
  RE_FULL.lastIndex = 0;
  while ((m = RE_FULL.exec(text))) {
    const file = MAP.get(m[1]);
    if (!file) continue;
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const img = document.createElement('img');
    img.className = 'emo'; img.src = `/assets/emoji/${file}.webp`; img.alt = m[1]; img.draggable = false; img.decoding = 'sync';
    frag.appendChild(img);
    last = m.index + m[0].length;
  }
  if (!last) return;
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  node.parentNode.replaceChild(frag, node);
}
function walk(root) {
  if (root.nodeType === 3) { if (root.parentNode && !SKIP.has(root.parentNode.nodeName)) swapText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName) || root.classList?.contains('emo')) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentNode && SKIP.has(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const list = []; while (w.nextNode()) list.push(w.currentNode);
  list.forEach(swapText);
}
let queued = false; const pending = new Set();
function flush() { queued = false; const items = [...pending]; pending.clear(); items.forEach((n) => { if (n.isConnected !== false) walk(n); }); }
const mo = new MutationObserver((muts) => {
  for (const mu of muts) {
    if (mu.type === 'childList') mu.addedNodes.forEach((n) => pending.add(n));
    else if (mu.type === 'characterData') pending.add(mu.target);
  }
  if (!queued) { queued = true; queueMicrotask(flush); }
});
// 화면에 붙이기 전의 조각(template 내용)을 미리 그림으로 바꾼다 — 화면을 '고쳐 쓰기(morph)'할 때 새 조각과 현재 화면을 같은 모양으로 비교하기 위함
export function emojify(root) { [...root.childNodes].forEach((n) => walk(n)); }
export function startEmoji() {
  walk(document.body);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}
startEmoji();
