/* intro page: drifting light, reveal on scroll, the layout cards (filter, tilt, open the recording) */
(function(){
  var still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var o=document.createElement('div');o.id='gb-orbs';o.innerHTML='<i></i><i></i><i></i>';document.body.prepend(o);
  // reveal: section titles, cards, pictures, videos
  var els=[].slice.call(document.querySelectorAll('section h2, .card, .fv, .shot.main, .tstrip, .lyt, .chat, .can'));
  els.forEach(function(e,i){e.classList.add(e.classList.contains('step')?'rvo':'rv');if(!e.style.getPropertyValue('--d')&&!e.classList.contains('lyt'))e.style.setProperty('--d',((i%4)*70)+'ms')});
  if(still||!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('in')})}
  else{var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.08});els.forEach(function(e){io.observe(e)})}
  // ↺ the team loop: the ring is drawn first, then a light runs round it and each step appears as the light reaches it
  (function(){
    var box=document.querySelector('.loopc');if(!box)return;
    var steps=[].slice.call(box.querySelectorAll('.step')),hub=box.querySelector('.hub'),ring=box.querySelector('svg.ring'),all=steps.concat(hub?[hub]:[]);
    all.forEach(function(e){e.classList.add('rvo')});
    function showAll(){all.forEach(function(e){e.classList.add('in')})}
    if(still||!('IntersectionObserver' in window)||!ring||!steps.length){showAll();return}
    function center(el){var r=box.getBoundingClientRect(),b=el.getBoundingClientRect();return[(b.left+b.width/2-r.left)/r.width*100,(b.top+b.height/2-r.top)/r.height*100]}
    var started=false,lo=new IntersectionObserver(function(es){if(started||!es.some(function(e){return e.isIntersecting}))return;started=true;lo.disconnect();run()},{rootMargin:'0px 0px -28% 0px',threshold:.9});lo.observe(hub||box);
    function run(){
      if(innerWidth<=1120||box.classList.contains('editing')){showAll();return}
      var NS='http://www.w3.org/2000/svg',c=steps.map(center),H=hub?center(hub):[50,50],n=c.length,d='M'+c[0][0].toFixed(2)+' '+c[0][1].toFixed(2),cum=[0],tot=0;
      var sh=window.__gbLoopShape&&window.__gbLoopShape();
      if(sh){ // the default layout: a true circle from the top, clockwise; the steps sit every 360/n degrees
        d='M50 '+(50-sh.ry).toFixed(3)+' A'+sh.rx.toFixed(3)+' '+sh.ry.toFixed(3)+' 0 1 1 50 '+(50+sh.ry).toFixed(3)+' A'+sh.rx.toFixed(3)+' '+sh.ry.toFixed(3)+' 0 1 1 50 '+(50-sh.ry).toFixed(3);
        for(var j=1;j<=n;j++)cum.push(j/n);tot=1}
      else for(var i=0;i<n;i++){var a=c[i],b=c[(i+1)%n],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,dx=mx-H[0],dy=my-H[1],L=Math.hypot(dx,dy)||1,q=[mx+dx/L*9,my+dy/L*9];
        var seg=' Q'+q[0].toFixed(2)+' '+q[1].toFixed(2)+' '+b[0].toFixed(2)+' '+b[1].toFixed(2);d+=seg;
        var tp=document.createElementNS(NS,'path');tp.setAttribute('d','M'+a[0]+' '+a[1]+seg);ring.appendChild(tp);tot+=tp.getTotalLength();tp.remove();cum.push(tot)}
      // the usual dashed ring + arrows wait until the light has gone round
      var old=[].slice.call(ring.children).filter(function(x){return x.tagName.toLowerCase()!=='defs'});
      old.forEach(function(x){x.style.transition='opacity 700ms';x.style.opacity='0'});
      var route=document.createElementNS(NS,'path');route.setAttribute('d',d);route.setAttribute('fill','none');route.setAttribute('stroke','#4fed89');route.setAttribute('stroke-width','.28');route.setAttribute('pathLength','1');
      route.style.strokeDasharray='1';route.style.strokeDashoffset='1';route.style.filter='drop-shadow(0 0 1px rgba(79,237,137,.9))';ring.appendChild(route);
      if(hub)hub.classList.add('in');
      void route.getBoundingClientRect();route.style.transition='stroke-dashoffset 1500ms cubic-bezier(.45,0,.2,1)';route.style.strokeDashoffset='0';
      setTimeout(function(){
        var dot=document.createElement('i');dot.className='lpdot';box.appendChild(dot);
        var T=4200,t0=performance.now(),k=0;
        (function tick(now){var f=Math.min(1,(now-t0)/T),e=f<.5?2*f*f:1-Math.pow(-2*f+2,2)/2,sl=e*tot,p;
          if(sh){var a=(-90+360*e)*Math.PI/180;p={x:50+sh.rx*Math.cos(a),y:50+sh.ry*Math.sin(a)}}else p=route.getPointAtLength(e*route.getTotalLength());
          dot.style.left=p.x+'%';dot.style.top=p.y+'%';
          while(k<n&&cum[k]<=sl+.01){steps[k].classList.add('in');k++}
          if(f<1)requestAnimationFrame(tick);
          else{showAll();dot.style.opacity='0';setTimeout(function(){dot.remove()},600);old.forEach(function(x){x.style.opacity=''});route.style.transition='opacity 900ms';route.style.opacity='.25'}})(t0);
      },1550);
    }
  })();
  // ✨ showcase tiles: the same tilt + light as the layout cards
  if(!still)[].forEach.call(document.querySelectorAll('.can'),function(c){
    c.addEventListener('pointermove',function(e){if(e.pointerType!=='mouse')return;var r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
      c.classList.add('tilt');c.style.setProperty('--ry',((x-.5)*6).toFixed(2)+'deg');c.style.setProperty('--rx',((.5-y)*6).toFixed(2)+'deg');c.style.setProperty('--mx',(x*100)+'%');c.style.setProperty('--my',(y*100)+'%')});
    c.addEventListener('pointerleave',function(){c.style.setProperty('--rx','0deg');c.style.setProperty('--ry','0deg');setTimeout(function(){c.classList.remove('tilt')},140)})});
  // layout cards
  var grid=document.querySelector('.lgrid');if(!grid)return;
  var cards=[].slice.call(grid.querySelectorAll('.lyt'));
  var ALIAS={clonerig:['rig_s'],retarget:['rig_s'],flash:['f_vfx'],rig:['rig_s'],vehicle:['vehicle_s'],playtest:['playtest_s','map_s'],mocap:['mocap_s'],smash:['f_smash','smash_s']};
  function vid(id){var c=(ALIAS[id]||[]).concat(['f_'+id,id+'_s',id]);for(var i=0;i<c.length;i++){var v=document.querySelector('video[data-vid="'+c[i]+'"]');if(v)return v}return null}
  cards.forEach(function(c){if(!vid(c.dataset.id))c.classList.add('novid')});
  // filter chips
  document.querySelectorAll('.lchip').forEach(function(b){b.onclick=function(){var g=b.dataset.g;document.querySelectorAll('.lchip').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
    cards.forEach(function(c,i){var on=g==='*'||c.dataset.g===g;c.classList.toggle('hide',!on);if(on&&!still){c.classList.remove('in');c.style.setProperty('--d',(i%6)*50+'ms');void c.offsetWidth;c.classList.add('in')}})}});
  // tilt + light follow the pointer
  if(!still)cards.forEach(function(c){
    c.addEventListener('pointermove',function(e){if(e.pointerType!=='mouse')return;var r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
      c.classList.add('tilt');c.style.setProperty('--ry',((x-.5)*8).toFixed(2)+'deg');c.style.setProperty('--rx',((.5-y)*8).toFixed(2)+'deg');c.style.setProperty('--mx',(x*100)+'%');c.style.setProperty('--my',(y*100)+'%')});
    c.addEventListener('pointerleave',function(){c.style.setProperty('--rx','0deg');c.style.setProperty('--ry','0deg');setTimeout(function(){c.classList.remove('tilt')},140)})});
  // open: the recording in a glass window (the same video data as the page, nothing loaded twice)
  var m=document.getElementById('lmodal'),mv=m.querySelector('.lmv'),last=null;
  function close(){m.classList.remove('on');setTimeout(function(){m.hidden=true;mv.innerHTML=''},200);if(last)last.focus()}
  cards.forEach(function(c){c.onclick=function(){var v=vid(c.dataset.id);last=c;mv.innerHTML='';
    if(v){var nv=document.createElement('video');nv.src=v.getAttribute('data-src')||v.currentSrc||v.src;nv.muted=true;nv.loop=true;nv.playsInline=true;nv.autoplay=true;nv.controls=true;mv.appendChild(nv);var p=nv.play();if(p&&p.catch)p.catch(function(){})}
    m.querySelector('.lmt .ic').innerHTML=c.querySelector('.ic').innerHTML;m.querySelector('.lmt b').innerHTML=c.querySelector('b').innerHTML;m.querySelector('.lmd').innerHTML=c.querySelector('.ld').innerHTML;
    m.hidden=false;void m.offsetWidth;m.classList.add('on');m.querySelector('.lx').focus()}});
  m.querySelector('.lx').onclick=close;m.addEventListener('click',function(e){if(e.target===m)close()});
  addEventListener('keydown',function(e){if(e.key==='Escape'&&!m.hidden)close()});
})();
