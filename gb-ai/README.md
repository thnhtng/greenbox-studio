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

## 1. Chat trong Greenbox (nút **🤖 AI** góc phải dưới, ⇥ để ghim thành cột bên phải)
Chọn nhà cung cấp → nhập model + API key. Anthropic, OpenAI, Gemini, OpenRouter, Ollama (máy mình) hoặc URL OpenAI-compatible bất kỳ.
Đính kèm: 📸 ảnh khung 3D hiện tại, 📎 ảnh hoặc video (video được cắt thành 6 khung hình).
Key chỉ lưu trong trình duyệt (localStorage) và chỉ gửi tới nhà cung cấp đã chọn.
Lưu ý: đây là **dùng** model qua API, không phải fine-tune (fine-tune cần dữ liệu huấn luyện riêng).

## 2. MCP (Claude Desktop / Cowork / client MCP bất kỳ)
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
