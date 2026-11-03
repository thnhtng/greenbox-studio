/* Greenbox: the cockpit's theme for the embedded 3D pages. Vibrant (default) = white, black type, one red accent,
   pill buttons, flat; the cockpit's ◐ sends {gbTheme:'d'} for the dark look. Also keeps the top menus on one line. */
(function(){
var css=[
'nav{overflow-x:auto;overflow-y:hidden;scrollbar-width:none}nav::-webkit-scrollbar{display:none}nav a,nav span,nav button{white-space:nowrap;flex:0 0 auto}',
'body,body :not(code):not(pre):not(kbd):not(samp){font-family:Roboto,system-ui,-apple-system,"Segoe UI",sans-serif!important}',
'html.gbk{--button-primary-bg:#37966a;--current-step-indicator:#19df62;--blue:#37966a;--org:#4fed89;--gbp-accent:#4fed89;--gbp-panel:#0d3028f2;--gbp-card:#124035;--gbp-btn:#185043;--gbp-on:#12402b;--gbp-line:#327062;--gbp-accent-ink:#fff}',
'html.gbk button.pri,html.gbk .button{background:linear-gradient(120deg,#37966a,#19df62)!important;border-color:transparent!important;color:#fff!important;border-radius:15px!important}',
'html.gbk button{border-radius:15px}html.gbk h3 b{background:linear-gradient(120deg,#37966a,#19df62)}html.gbk :is(input[type=range],input[type=checkbox]){accent-color:#19df62}',
'html.gbv{--bg-primary:#fff;--bg-alternate:#F4F4F5;--bg-tertiary:#fff;--button-alternate-bg:#fff;--button-primary-bg:#D83933;--button-shadow-color:transparent;--current-step-indicator:#D83933;--link-color:#565C65;--nav-active-item-bg:#F4F4F5;--nav-background:#fff;--radio-button-group-bg:#F4F4F5;--radio-button-group-hover:#e9e9eb;--text-alternate:#565C65;--text-primary:#000;',
'--bg:#fff;--bg2:#fff;--bg3:#000;--nav:#fff;--txt:#000;--mut:#565C65;--blue:#D83933;--org:#D83933;--line:#B9B9BB;',
'--gbp-panel:#fff;--gbp-card:#F4F4F5;--gbp-btn:#fff;--gbp-input:#000;--gbp-on:#fff;--gbp-ink:#000;--gbp-line:#B9B9BB;--gbp-accent:#D83933;--gbp-accent-ink:#fff;--gbp-shadow:none;color-scheme:light}',
'html.gbv body{background:#fff!important;color:#000;font-family:"Public Sans",system-ui,sans-serif}',
'html.gbv :is(h1,h2,h3,h4){font-family:Inter,system-ui,sans-serif;font-weight:700;letter-spacing:0;text-transform:none;color:#000}',
'html.gbv h3 b{background:#D83933;color:#fff}',
'html.gbv nav{background:#fff!important;border-bottom:1px solid #B9B9BB!important}html.gbv nav a{color:#000}html.gbv nav a:hover{background:#F4F4F5;color:#000}html.gbv nav a.on{background:#000;color:#fff}',
'html.gbv #logo-branding{color:#000!important}html.gbv #logo-branding i{background:#D83933!important;box-shadow:none!important;border-radius:3px!important}html.gbv #logo-branding span{color:#D83933!important}',
'html.gbv .logo{color:#000}html.gbv .logo span{color:#D83933}html.gbv .logo i{background:#D83933;box-shadow:none;border-radius:3px}',
'html.gbv button{background:#fff;color:#000;border:1px solid #000;border-radius:50px;box-shadow:none;transition:transform .2s,background .2s}',
'html.gbv button:hover:not(:disabled){transform:scale(1.05);background:#F4F4F5}',
'html.gbv :is(button.pri,button.primary,.button-primary,#load-model-button,#action_upload){background:#D83933!important;border-color:#D83933!important;color:#fff!important}',
'html.gbv .button,html.gbv label.button{background:#D83933!important;color:#fff!important;border:1px solid #D83933!important;border-radius:50px!important;box-shadow:none!important}',
'html.gbv button.on{background:#000;color:#fff;border-color:#000}',
'html.gbv section{background:#fff!important;border:1px solid #B9B9BB!important;border-radius:16px!important}',
'html.gbv aside,html.gbv #tool-panel{background:#fff!important;box-shadow:none!important;border-left:1px solid #B9B9BB!important}',
'html.gbv :is(select,input[type=number],input[type=text]){background:#000!important;color:#fff!important;border:1px solid #565C65!important;border-radius:8px}',
'html.gbv :is(input[type=range],input[type=checkbox],input[type=radio]){accent-color:#D83933}',
'html.gbv #vh-status{background:#F4F4F5;color:#000}html.gbv #vh-status.warn{background:#fdecea}',
'html.gbv a{color:#565C65}',
'html.gbv :is(button,a,input,select,summary):focus-visible{outline:.25rem solid rgb(36,145,255);outline-offset:2px}'
].join('\n');
var st=document.createElement('style'); st.id='gb-theme'; st.textContent=css; (document.head||document.documentElement).appendChild(st);
var f=document.createElement('link'); f.rel='stylesheet'; f.href='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&family=Public+Sans:wght@400;500;700&family=Roboto:wght@400;500;700;900&display=swap'; (document.head||document.documentElement).appendChild(f);
try{ var me=document.currentScript; if(me&&me.src){ var x=document.createElement('script'); x.src=new URL('../gb-xp.js', me.src).href; (document.head||document.documentElement).appendChild(x); } }catch(e){} // XP for using the 3D pages
var r=document.documentElement, set=function(v){ r.classList.toggle('gbv', v==='v'); r.classList.toggle('gbk', v!=='v' && v!=='d'); };
try{ var v0=localStorage.getItem('gbc.ui')||'k'; set(v0); localStorage.setItem('mesh2motion-theme', v0==='v'?'light':'dark'); }catch(e){ set('k'); } // the 3D view itself follows on the next load
addEventListener('message', function(e){ if((e.origin===location.origin||(location.protocol==='file:'&&e.origin==='null')) && e.data && e.data.gbTheme) set(e.data.gbTheme); });
addEventListener('storage', function(e){ if(e.key==='gbc.ui') set(e.newValue||'k'); });
})();
