/* Layout intro: hovering a feature in the list for a moment shows a glass card with what that page does */
(function(){
  var pop=null,timer=0,cur=null;
  function data(id){try{return ((window.__gbcF&&window.__gbcF.all)||[]).find(function(f){return f.id===id})}catch(e){return null}}
  function grp(id){try{var g=((window.__gbcF&&window.__gbcF.groups)||[]).find(function(g){return g.items.some(function(f){return f.id===id})});return g?g.name:null}catch(e){return null}}
  function T(x){try{return window.__gbcF?window.__gbcF.tr(x):(x&&(x.vi||x.en))||''}catch(e){return ''}}
  function lang(){var l=(document.documentElement.lang||'vi').slice(0,2);return l}
  function hint(){return {vi:'Bấm để mở',en:'Click to open',ko:'클릭해서 열기'}[lang()]||'Bấm để mở'}
  function show(b){var f=data(b.dataset.f);if(!f||!f.d)return;
    if(!pop){pop=document.createElement('div');pop.id='gbc-intro';pop.setAttribute('role','tooltip');document.body.appendChild(pop)}
    var ic=b.querySelector('.ic');var g=grp(f.id);
    pop.innerHTML='<div class="h"><span class="i">'+(ic?ic.innerHTML:'')+'</span><div>'+(g?'<div class="g"></div>':'')+'<div class="n"></div></div></div><div class="d"></div><div class="k"></div>';
    if(g)pop.querySelector('.g').textContent=T(g);pop.querySelector('.n').textContent=T(f.name);pop.querySelector('.d').textContent=T(f.d);pop.querySelector('.k').textContent=hint();
    var r=b.getBoundingClientRect(),W=pop.offsetWidth||300,H=pop.offsetHeight||120,x,y;
    if(r.right+12+W<innerWidth&&!document.body.classList.contains('gbc-stack')){x=r.right+12;y=Math.min(Math.max(8,r.top-6),innerHeight-H-8)}
    else{x=Math.min(Math.max(8,r.left),innerWidth-W-8);y=r.bottom+8;if(y+H>innerHeight-8)y=Math.max(8,r.top-H-8)}
    pop.style.left=x+'px';pop.style.top=y+'px';pop.classList.remove('show');void pop.offsetWidth;pop.classList.add('show')}
  function hide(){clearTimeout(timer);timer=0;cur=null;if(pop)pop.classList.remove('show')}
  document.addEventListener('mouseover',function(e){var b=e.target.closest&&e.target.closest('.gbc-it');if(b===cur)return;hide();if(!b)return;cur=b;timer=setTimeout(function(){show(b)},420)},true);
  document.addEventListener('focusin',function(e){var b=e.target.closest&&e.target.closest('.gbc-it');if(b){hide();cur=b;show(b)}},true);
  ['pointerdown','scroll','keydown','blur'].forEach(function(t){addEventListener(t,function(e){if(t==='keydown'&&e.key!=='Escape')return;hide()},true)});
  document.addEventListener('mouseleave',hide);
})();
