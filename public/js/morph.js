// 화면 일부를 새 HTML 로 '고쳐 쓰기': 같은 모양의 요소는 그대로 두고 달라진 글자·속성만 바꾼다.
// innerHTML 로 통째로 바꾸면 그림이 다시 만들어지며 깜박이고(지지직), 요소에 걸린 애니메이션도 처음부터 다시 시작한다.
import { emojify } from './emo.js';

function patchAttrs(o, n) {
  for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
  for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  // 입력칸의 현재 값(사용자가 쓰는 중인 글)은 건드리지 않는다
}
function patchChildren(oParent, nParent) {
  const nk = [...nParent.childNodes];
  nk.forEach((nn, i) => {
    const on = oParent.childNodes[i];
    if (!on) { oParent.appendChild(nn); return; }
    if (on.nodeType !== nn.nodeType || on.nodeName !== nn.nodeName) { oParent.replaceChild(nn, on); return; }
    if (nn.nodeType === 3 || nn.nodeType === 8) { if (on.nodeValue !== nn.nodeValue) on.nodeValue = nn.nodeValue; return; }
    patchAttrs(on, nn);
    if (on.nodeName === 'TEXTAREA' || on.nodeName === 'SELECT') return;
    patchChildren(on, nn);
  });
  while (oParent.childNodes.length > nk.length) oParent.removeChild(oParent.lastChild);
}
export function morph(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  emojify(tpl.content);
  if (!el.firstChild) { el.appendChild(tpl.content); return; }
  patchChildren(el, tpl.content);
}
