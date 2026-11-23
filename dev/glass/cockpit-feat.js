/* Full tool: the feature list and the top buttons use the generated glass pictures in ui/feat/<id>.webp.
   The mockup zip has no ui/ folder: the probe fails and the line icons stay. */
(function(){
  var BASE='ui/feat/',ok=false,bad={}; // bad: pictures that failed once (no retry loop: removing the img re-ran apply() for ever)
  function pic(box,id){if(!box||bad[id]||box.querySelector('img.fi'))return;var im=new Image();im.className='fi';im.alt='';im.decoding='async';
    im.onload=function(){box.classList.add('has-fi');apply()};im.onerror=function(){bad[id]=1;im.remove()};im.src=BASE+id+'.webp';box.appendChild(im)}
  function apply(){if(!ok)return;
    document.querySelectorAll('.gbc-it').forEach(function(b){pic(b.querySelector('.ic'),b.dataset.f)});
    [['#gbai-fab','ai'],['#gbc-jump','jump'],['#gbc-theme','theme']].forEach(function(p){var b=document.querySelector(p[0]);if(!b)return;var s=b.querySelector('.fi-slot');if(!s){s=document.createElement('span');s.className='fi-slot';b.prepend(s)}pic(s,p[1]);
      // the old symbol in the label (🤖 / ⚡ / ◐) goes once the picture is there
      if(s.classList.contains('has-fi'))[].forEach.call(b.childNodes,function(n){if(n.nodeType===3){var v=n.nodeValue.replace(/^[\s\u25D0-\u25D3\u26A1\uFE0F]+|^\s*\uD83E\uDD16\s*/,'');if(v!==n.nodeValue)n.nodeValue=v?' '+v.replace(/^\s+/,''):''}else if(n.nodeType===1&&n.matches('svg.gbi'))n.style.display='none'})})}
  var t=new Image();t.onload=function(){ok=true;document.documentElement.classList.add('gb-pics');apply();
    var q=0;new MutationObserver(function(){if(!q){q=1;Promise.resolve().then(function(){q=0;apply()})}}).observe(document.body,{childList:true,subtree:true})};
  t.src=BASE+'joy.webp';
})();
