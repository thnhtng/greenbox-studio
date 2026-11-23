# Greenbox AI (chat + MCP)

Hai cách để AI điều khiển Greenbox, dùng **chung một bộ công cụ** (`tools.js`):

| công cụ | làm gì |
|---|---|
| `gb_status` | đang mở tab nào, model, bước rig, số khớp, bánh/bộ phận xe, play test, mocap |
| `gb_screenshot` | ảnh khung 3D (AI tự kiểm tra kết quả) |
| `gb_open` | mở tab 3D (create / vehicle / playtest / mocap / retarget) |
| `gb_load_file` | nạp model / video vào tab |
| `gb_rig_auto`, `gb_joints_get`, `gb_joints_set`, `gb_rig_finish` | quét & đặt xương, đọc/sửa khớp, tính da |
| `gb_export` | xuất GLB/FBX (MCP lưu thẳng ra ổ đĩa) |
| `gb_click`, `gb_set_value`, `gb_run_js` | bấm nút / đổi ô / chạy JS trong trang (giống `execute_code` của Unity MCP) |
| `gb_connect` | (chỉ MCP) mã ghép nối cho bản web |
| `gb_analyze` | phân tích model: loại, đầu / tay / chân / phụ kiện (đuôi, cánh, tai, áo choàng…), toạ độ khớp; tab xe: tự tạo chuỗi xương |
| `gb_vehicle` | tab xe / model bất kỳ: quét bánh, tìm xích, đặt xương tại toạ độ, gán vùng theo hộp, tách + vá lỗ, build, play / stop |
| `gb_map` | map chơi thử: map mẫu, đặt vật, nâng/hạ/tô đất, mực nước, xuất GLB / script Blender |
| `gb_hpbar` | thanh máu / HUD: chỉnh thông số, mốc bị đánh theo giây, xuất .MOV alpha / MP4 phông xanh |
| `gb_sfx` | gắn SFX: nạp video, phân tích điểm va chạm, gắn 1 âm vào TẤT CẢ điểm (`add_all`, vd. "coin"), xuất MP4 có tiếng |
| `gb_say`, `gb_inbox` | (MCP) chat với người dùng trong khung **🔌 Claude / Codex** cạnh Greenbox: AI nhắn (`gb_say`), đọc tin bạn gõ (`gb_inbox`, chờ tới 50 giây) |

## 1. Chat trong Greenbox (nút **🤖 AI** góc phải dưới, ⇥ để ghim thành cột bên phải)
Chọn nhà cung cấp → nhập model + API key. Anthropic, OpenAI, Gemini, OpenRouter, Ollama (máy mình) hoặc URL OpenAI-compatible bất kỳ.
Đính kèm: 📸 ảnh khung 3D hiện tại, 📎 ảnh hoặc video (video được cắt thành 6 khung hình).
Key chỉ lưu trong trình duyệt (localStorage) và chỉ gửi tới nhà cung cấp đã chọn.
Lưu ý: đây là **dùng** model qua API, không phải fine-tune (fine-tune cần dữ liệu huấn luyện riêng).

## 1a. Chat bằng Claude Code / Codex CLI có sẵn trên máy (không cần API key)

Trong khung chat chọn **Claude Code** hoặc **Codex** (ô chọn dưới khung). Máy chủ Greenbox (`serve.py` → `cli_agent.py`) chạy CLI đã cài, gắn sẵn Greenbox MCP, nên AI điều khiển đúng trang đang mở. ✏️ = cho sửa file (mặc định tắt), ⏹ = dừng. Chỉ có ở bản chạy trên máy (Mo-Greenbox); sau khi cập nhật phải mở lại Mo-Greenbox. Thử song song: `GREENBOX_SIDE=1 python3 serve.py 8090` (chỉ ghi `.bridge-8090.json`), MCP đọc cổng qua `GREENBOX_PORT`.

## 1b. Khung chat cạnh Greenbox cho Claude / Codex (MCP)
🤖 AI → nút **🔌** (đổi chế độ) → **⇥** ghim thành cột bên phải (trang Greenbox tự thu hẹp nhường chỗ, giống thanh bên của extension Chrome).
- Lời AI hiện thành bong bóng có tên app (Claude Code, Codex, Claude, Cursor…), các lệnh AI chạy hiện dòng xanh "🔌 Codex → gb_map …".
- Bạn gõ ở ô dưới: AI đọc bằng `gb_inbox` ("👀 Codex đã đọc 1 tin"). Khi AI hỏi và chờ, có dòng "⏳ … đang chờ bạn trả lời".
- Nhắn AI trong app của nó một lần: "trả lời tôi trong khung chat Greenbox" (MCP cũng tự dặn AI điều này).

## 1c. Một câu prompt → một playable (Claude Desktop / Claude Code)
1. Mở Greenbox bằng **Mo-Greenbox**, bật khung chat cạnh bên (🤖 AI → 🔌 → ⇥) để xem AI làm gì.
2. Trong Claude:
   - **Claude Code:** gõ `/mcp__greenbox__make_playable`, điền `model` (đường dẫn file 3D), `game` (ý tưởng, vd. "nhặt tiền mở nhà"), `link` (link cửa hàng cho nút Chơi ngay).
   - **Claude Desktop:** chọn prompt *make_playable* của Greenbox.
   - Hoặc nhắn thường: "Dùng Greenbox làm playable từ ~/Downloads/hero.glb, nhặt tiền mở khoá nhà, nút Chơi ngay trỏ về <link>". AI tự đọc `gb_recipe`.
3. AI làm lần lượt, báo từng bước trong khung chat Greenbox; bạn thấy trang tự đổi theo:
   1. Nạp model, tự gắn xương, tự kiểm tra ảnh, tính da + 178 animation.
   2. `gb_to_playtest`: nhân vật thành người chơi.
   3. Dựng map + trang trí, rồi gameplay bằng sơ đồ 2D (nguồn tiền → quầy → ô mở khoá → ngôi nhà).
   4. Chơi thử.
   5. `gb_map export_playable`: lưu `exports/greenbox-playable.html` và báo dung lượng (nên dưới 5 MB).
4. Khi cần bạn quyết (khớp lệch, ý tưởng game), AI hỏi trong khung chat và chờ bạn trả lời.

Công cụ mới: `gb_to_playtest`, `gb_recipe`, `gb_map` action `export_playable {cta}`; prompt MCP `make_playable {model, game, link}`.

## 2. MCP — Claude Desktop / Claude Code / Codex / Cowork (bản máy và bản web)
`greenbox_mcp.py` (chỉ cần Python 3.8+, không cài gì) + `tools.json` để chung một thư mục. Cấu hình (đường dẫn đầy đủ):

| App | Cách gắn |
|---|---|
| Claude Desktop | Settings → Developer → Edit config: `{"mcpServers": {"greenbox": {"command": "python3", "args": ["/ĐƯỜNG/DẪN/gb-ai/greenbox_mcp.py"]}}}` |
| Claude Code | `claude mcp add greenbox -- python3 /ĐƯỜNG/DẪN/gb-ai/greenbox_mcp.py` |
| Codex CLI | `~/.codex/config.toml`: `[mcp_servers.greenbox]` · `command = "python3"` · `args = ["/ĐƯỜNG/DẪN/gb-ai/greenbox_mcp.py"]` |

Trong Greenbox: 🤖 AI → ⚙ → mục **Claude / Codex (MCP)** có nút copy sẵn 3 cấu hình trên và link tải 2 file (cho bản web).

- **Mở bằng Mo-Greenbox** (localhost): tự kết nối như trước, không cần mã.
- **Bản web** (GitHub Pages…): `greenbox_mcp.py` mở cầu nối ở `127.0.0.1:47827` (đổi bằng biến `GREENBOX_MCP_PORT`). Nhắn AI "kết nối Greenbox" → nó gọi `gb_connect` và đưa **mã 6 số** → nhập vào ô *Mã ghép nối* → 🔗. Trình duyệt chỉ nói chuyện với 127.0.0.1; chỉ tab biết mã mới nhận lệnh; chỉ nhận trang từ localhost hoặc `*.github.io` (thêm domain khác bằng biến `GREENBOX_ORIGINS=https://ten-mien.com`). Dùng Chrome / Edge (Safari có thể chặn trang https gọi localhost).
- Nhiều app AI cùng lúc (vd. Claude + Codex): app mở sau dùng chung cầu nối của app mở trước (`~/.greenbox/relay.json`, chỉ chủ máy đọc được).

### Cách cũ (chỉ Claude Desktop, khi mở bằng Mo-Greenbox)

Không cần API key. Claude Desktop / Cowork là "giao diện chat", Greenbox là nơi thao tác; mọi lệnh Claude gửi hiện trong khung **🤖 AI** của Greenbox (dòng xanh "🔌 Claude → …", chấm xanh trên nút = vừa có lệnh).

Cách nhanh: mở Greenbox bằng **Mo-Greenbox** → **🤖 AI** → ⚙ → **🔌 Gắn vào Claude Desktop** (tự sửa `claude_desktop_config.json`, sao lưu file cũ thành `.greenbox-backup-…`) → tắt hẳn Claude Desktop rồi mở lại.

Cách tay:
1. Mở Greenbox bằng **Mo-Greenbox** (tab trình duyệt phải mở: công cụ chạy trong đó).
2. Claude Desktop → Settings → Developer → Edit config (hoặc nút **📋 Copy config**), thêm:
```json
{ "mcpServers": { "greenbox": { "command": "python3", "args": ["/ĐƯỜNG/DẪN/Greenbox/gb-ai/greenbox_mcp.py"] } } }
```
3. Khởi động lại Claude Desktop. File xuất mặc định lưu ở `Greenbox/exports/`.

An toàn: nút gắn Claude Desktop chỉ chạy từ chính trang Greenbox (header riêng + Origin localhost). Cầu nối chỉ nhận lệnh từ chính máy này và cần token ngẫu nhiên tạo mỗi lần chạy (`gb-ai/.bridge.json`, không đưa lên git).

`tools.json` được sinh từ `tools.js` (danh sách cho MCP). Sửa `tools.js` xong thì sinh lại:
`node -e "global.window={};global.document={body:{dataset:{}}};eval(require('fs').readFileSync('gb-ai/tools.js','utf8'));require('fs').writeFileSync('gb-ai/tools.json',JSON.stringify(window.__gbTools.list,null,1))"`

### Gắn một nút (bản chạy trên máy)
Trong khung AI của Cockpit có 3 nút: **🔌 Claude Desktop**, **🔌 Codex**, **🔌 Claude Code**. Mỗi nút ghi Greenbox vào file cấu hình MCP của app đó (file cũ được sao lưu `*.greenbox-backup-<giờ>`):
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Codex: `~/.codex/config.toml` (mục `[mcp_servers.greenbox]`, các mục khác giữ nguyên)
- Claude Code: `~/.claude.json` (`mcpServers.greenbox`)
Sau đó mở lại app đó. Nếu nút báo "máy chủ cũ", tắt và chạy lại Mo-Greenbox.

### Cài 1 lệnh (bản web và bản máy đều dùng được)
Trong Greenbox: 🤖 AI → ⚙ → mục **Claude / Codex (MCP)** có nút copy lệnh. Hoặc gõ thẳng (thay `SITE` bằng địa chỉ trang Greenbox của bạn):
- Mac / Linux (Terminal): `curl -fsSL SITE/gb-ai/install.sh | sh -s -- SITE`
- Windows (PowerShell): `$env:GREENBOX_SITE='SITE'; irm SITE/gb-ai/install.ps1 | iex`

Lệnh tải `greenbox_mcp.py`, `tools.json`, `install_mcp.py` về `~/.greenbox/mcp`, rồi tự gắn Greenbox vào Claude Desktop, Codex và Claude Code nếu có trên máy (file cũ được sao lưu). Sau đó: mở lại app AI → nhắn "kết nối Greenbox" → nhập mã 6 số vào Greenbox. Cần Python 3.
Khi đưa lên web, nhớ đưa kèm 3 file `gb-ai/install.sh`, `gb-ai/install.ps1`, `gb-ai/install_mcp.py`.
