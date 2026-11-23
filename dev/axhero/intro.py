"""AX Hero service intro page: intro.template.html with its pictures (dev/axhero/shots) and demo videos (dev/axhero/videos) embedded -> ax-hero/introduction.html"""
import base64, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'ax-hero' / 'introduction.html'
MIME = {'.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4'}
s = (HERE / 'intro.template.html').read_text()
# every video keeps its file name (data-vid) so the layout cards can open it; the layout section comes from the cockpit's feature list
s = re.sub(r'<video ([^>]*?)(data-src|src)="\{\{([\w.-]+)\.mp4\}\}"', lambda m: '<video data-vid="%s" %s%s="{{%s.mp4}}"' % (m.group(3), m.group(1), m.group(2), m.group(3)), s)
import json, subprocess, html
G = json.loads(subprocess.run(['node', str(HERE / 'layouts.mjs')], capture_output=True, text=True, check=True).stdout)
def L3(o, cls=''):
    return ''.join('<span data-l="%s"%s>%s</span>' % (k, (' class="%s"' % cls) if cls else '', html.escape(o.get(k) or o['en'])) for k in ('vi', 'en', 'ko'))
chips = '<button class="lchip" data-g="*" aria-pressed="true">' + L3({'vi': 'Tất cả', 'en': 'All', 'ko': '전체'}) + '</button>' + ''.join('<button class="lchip" data-g="%s" aria-pressed="false">%s</button>' % (g['id'], L3(g['name'])) for g in G)
cards, k = [], 0
for g in G:
    for f in g['items']:
        pic = '<img class="fi" alt="" src="{{feat_%s.webp}}">' % f['id'] if (HERE / 'shots' / ('feat_%s.webp' % f['id'])).exists() else None
        cards.append('<button class="lyt rv" data-id="%s" data-g="%s" style="--d:%dms"><span class="lg">%s</span><span class="ic">%s</span><b>%s</b><span class="ld">%s</span><span class="go">%s</span></button>' % (
            f['id'], g['id'], (k % 6) * 60, L3(g['name']), pic or f.get('ic') or '🧩', L3(f['name']), L3(f['d']), L3({'vi': '▶ Xem video', 'en': '▶ Watch', 'ko': '▶ 영상 보기'})))
        k += 1
sec = ('<section id="layouts"><div class="wrap">\n  <h2>🧩 ' + L3({'vi': '&nbsp;Các layout trong Greenbox', 'en': '&nbsp;The layouts in Greenbox', 'ko': '&nbsp;Greenbox 레이아웃'}).replace('&amp;nbsp;', '&nbsp;') + '</h2>\n'
       '  <p class="note lnote">' + L3({'vi': 'Mỗi thẻ là một trang trong Cockpit. Rê chuột để xem nhanh, bấm để xem video quay thật.', 'en': 'Each card is one page of the cockpit. Hover for a quick look, click to watch the real recording.', 'ko': '카드 하나가 콕핏의 한 페이지입니다. 마우스를 올려 미리 보고, 클릭해 실제 녹화를 보세요.'}) + '</p>\n'
       '  <div class="lchips">' + chips + '</div>\n  <div class="lgrid">' + ''.join(cards) + '</div>\n</div></section>\n'
       '<div id="lmodal" role="dialog" aria-modal="true" hidden><div class="lbox"><button class="lx" aria-label="Close">✕</button><div class="lmv"></div><div class="lmt"><span class="ic"></span><b></b></div><p class="lmd"></p></div></div>\n')
s = s.replace('<!--LAYOUTS-->', sec, 1)
# download: the full tool (link in download.json; empty = "link coming", the button says so instead of a dead link)
DL = json.loads((HERE / 'download.json').read_text())
full = HERE.parents[2] / 'Greenbox-Studio-full.zip'
mb = ' · %d MB' % round(full.stat().st_size / 1048576) if full.exists() else ''
ico = '<img class="fi" alt="" src="{{feat_download.webp}}">' if (HERE / 'shots' / 'feat_download.webp').exists() else '⬇'
lbl = L3({'vi': 'Tải Greenbox Studio bản đầy đủ' + mb, 'en': 'Download Greenbox Studio (full)' + mb, 'ko': 'Greenbox Studio 전체 버전 다운로드' + mb})
if DL.get('full_url'):
    btn = '<a class="getbtn" href="%s" target="_blank" rel="noopener">%s%s</a>' % (html.escape(DL['full_url']), ico, lbl)
else:
    btn = '<button class="getbtn off" type="button" aria-disabled="true">%s%s<small>%s</small></button>' % (ico, lbl, L3({'vi': 'Link tải đang được cập nhật', 'en': 'Download link coming soon', 'ko': '다운로드 링크 준비 중'}))
sub = L3({'vi': 'Giải nén rồi mở Mo-Greenbox.command (Mac) hoặc Mo-Greenbox.bat (Windows). Bản mockup nhẹ (Greenbox-Mockup.zip, mở bằng double-click) đính kèm bài nộp.',
          'en': 'Unzip, then open Mo-Greenbox.command (Mac) or Mo-Greenbox.bat (Windows). The light mockup (Greenbox-Mockup.zip, opens by double-click) comes with the submission.',
          'ko': '압축을 풀고 Mo-Greenbox.command (Mac) 또는 Mo-Greenbox.bat (Windows)를 여세요. 가벼운 목업(Greenbox-Mockup.zip)은 제출물에 포함되어 있습니다.'})
# ✏️ the team loop laid out by hand (the page's ?edit mode saves loop-layout.json; put it here)
LL = HERE / 'loop-layout.json'
s = s.replace('<!--LOOPLAYOUT-->', '<script>window.__LOOP_LAYOUT=%s;</script>' % (json.dumps(json.loads(LL.read_text())) if LL.exists() else 'null'), 1)
s = s.replace('<!--DOWNLOAD-->', '<div class="getbox" id="get">%s<p class="getsub">%s</p></div>' % (btn, sub), 1)
s = re.sub(r'\{\{([\w.-]+)\}\}', lambda m: 'data:%s;base64,%s' % (MIME[pathlib.Path(m.group(1)).suffix], base64.b64encode(((HERE / 'videos') if m.group(1).endswith('.mp4') else (HERE / 'shots')).joinpath(m.group(1)).read_bytes()).decode()), s)
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(s)
print('%s: %.2f MB' % (OUT, OUT.stat().st_size / 1048576))
