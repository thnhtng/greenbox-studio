"""Builds dev/glass/gb-icons.js: the Lucide icons (ISC) used by icon_map.MAP + a small runtime that swaps those emoji
   in buttons / titles / the feature list for line icons (also in content added later). Run before apply.py."""
import json, pathlib, re, sys
from icon_map import MAP
HERE = pathlib.Path(__file__).parent
SRC = HERE / 'lucide'  # the Lucide SVGs in use (lucide-static 0.460, ISC: lucide/LICENSE); add a file here for a new icon
def build(text=None):
  use = {k: v for k, v in MAP.items() if text is None or k in text or k.replace('\ufe0f', '') in text}
  icons = {}
  for n in sorted(set(use.values())):
    sv = (SRC / f'{n}.svg').read_text()
    inner = re.search(r'<svg[^>]*>(.*)</svg>', sv, re.S).group(1)
    icons[n] = re.sub(r'\s+', ' ', inner).strip()
  emoji = use
  return """/* Greenbox line icons: Lucide (lucide.dev, ISC licence) in place of emoji in buttons, titles and the feature list */
(function(){if(window.__gbIcons)return;window.__gbIcons=1;
var I=%s,E=%s,NS='http://www.w3.org/2000/svg';
var K=Object.keys(E).sort(function(a,b){return b.length-a.length}).map(function(k){return k.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')});
var RE=new RegExp('('+K.join('|')+')\\uFE0F?','g');
var SEL='button,summary,label,h1,h2,h3,h4,#gbai header,#gbai-mcp-status,#gbai-pair-state,figcaption,.tags span,.gbc-it,.gbc-gt,.gbc-dh,.gbc-crumb,nav a,[role=tab],.tab,.ptabs,.ic,.gbi-ok';
var SKIP='option,textarea,input,select,script,style,svg,canvas,[contenteditable],[data-no-gbi],.stage,#stage,.overlay-out';
function mk(n){var s=document.createElementNS(NS,'svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','1.8');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');s.setAttribute('class','gbi gbi-'+n);s.innerHTML=I[n];return s}
function swap(t){var p=t.parentElement;if(!p||!p.closest(SEL)||p.closest(SKIP))return;var v=t.nodeValue;RE.lastIndex=0;if(!RE.test(v))return;RE.lastIndex=0;
 var f=document.createDocumentFragment(),last=0,m;while((m=RE.exec(v))){if(m.index>last)f.appendChild(document.createTextNode(v.slice(last,m.index)));var k=m[1],n=E[k]||E[k.replace(/\\uFE0F/g,'')];if(n)f.appendChild(mk(n));else f.appendChild(document.createTextNode(m[0]));last=m.index+m[0].length}
 if(last<v.length)f.appendChild(document.createTextNode(v.slice(last)));
 /* gb-i18n keeps the English source on the text node (__s): carry it over, without the emoji */
 if(t.__s!=null){var tn=[].filter.call(f.childNodes,function(c){return c.nodeType===3});if(tn.length===1){RE.lastIndex=0;tn[0].__s=String(t.__s).replace(RE,'');tn[0].__o=tn[0].nodeValue}}
 t.parentNode.replaceChild(f,t)}
function run(root){if(!root)return;if(root.nodeType===3){swap(root);return}if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;
 var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),a=[],t;while((t=w.nextNode()))if(t.nodeValue&&/[\\u2190-\\u21FF\\u2300-\\u23FF\\u2600-\\u27BF\\u2B00-\\u2BFF\\uD83C-\\uDBFF]/.test(t.nodeValue))a.push(t);a.forEach(swap)}
var q=[],raf=0;function flush(){raf=0;var b=q;q=[];b.forEach(run)}
function start(){run(document.body);new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==='characterData')q.push(m.target);else m.addedNodes.forEach(function(n){q.push(n)})});if(!raf){raf=1;Promise.resolve().then(flush)}}).observe(document.body,{childList:true,subtree:true,characterData:true})}
var st=document.createElement('style');st.textContent='svg.gbi{width:1.15em;height:1.15em;vertical-align:-.2em;flex:none;display:inline-block}.gbc-it .ic svg.gbi{width:18px;height:18px}';(document.head||document.documentElement).appendChild(st);
if(document.body)start();else document.addEventListener('DOMContentLoaded',start)})();
""" % (json.dumps(icons, ensure_ascii=False, separators=(',', ':')), json.dumps(emoji, ensure_ascii=False, separators=(',', ':')))
if __name__ == '__main__':
    js = build(); (HERE / 'gb-icons.js').write_text(js); print('gb-icons.js', len(js) // 1024, 'KB')
