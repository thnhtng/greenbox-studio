# Kế hoạch: 🎬 AI Drama trong Greenbox (DramaClaw + Higgsfield) — chưa làm, chờ duyệt

Ngày viết: 07/11/2026. Mục tiêu: một phim AI ngắn (drama / quảng cáo) làm được **~80 % trong Greenbox**. Claude làm
phần viết và điều khiển; Higgsfield chỉ dùng cho bước tạo ảnh / video; DramaClaw là kho dự án + canvas cho team.

## Ai làm gì

| Phần | Làm gì |
|---|---|
| **Greenbox (phần chính)** | bảng shot; dựng cảnh 3D cho từng shot (nhân vật đã rig, map Play test, động tác, góc máy) → chụp khung hình đầu + quay animatic; dựng phim: timeline Video FX nối shot + chuyển cảnh, SFX, phụ đề từ thoại, overlay; xuất MP4 |
| **Claude** | viết kịch bản, chia shot, viết prompt; điều khiển Greenbox (MCP `gb_*`), DramaClaw (MCP `dramaclaw_*`) và Higgsfield (trình duyệt) |
| **Higgsfield** | ảnh nhân vật, ảnh khung đầu từ previz, video từng shot. Dùng tài khoản + credit của bạn; bạn đăng nhập trong pane |
| **DramaClaw** (đã cài, chạy local `:8780`) | lưu dự án, canvas node cho team, kho nhân vật / bối cảnh. Không dùng nút "generate" của nó (cần key gateway trả phí) |

## Luồng làm 1 phim

1. **Kịch bản → bảng shot** (Greenbox "🎬 Drama"): Claude chia shot: nhân vật, bối cảnh, góc máy, động tác, thoại, số giây.
2. **Nhân vật**: dùng nhân vật có sẵn hoặc tạo ảnh trên Higgsfield → model 3D → rig trong Greenbox. Cùng một model cho
   mọi shot = nhân vật giữ nguyên mặt, dáng (chỗ AI video hay sai nhất).
3. **Previz**: mỗi shot dựng trong Play test (map, nhân vật, clip / mocap, camera) → chụp khung đầu + quay animatic.
4. **Tạo ảnh / video**: Claude mang khung previz + prompt lên Higgsfield, tạo, tải về, gắn vào ô shot.
5. **Dựng**: gửi các shot sang Video FX: nối, chuyển cảnh, SFX, phụ đề, lồng tiếng.
6. **Đồng bộ DramaClaw**: đẩy ảnh / video vào canvas dự án (đã thử: upload ảnh vào canvas chạy được, không cần key).
7. **Xuất** MP4 9:16 hoặc 16:9.

## Cần làm trong Greenbox

- Tính năng mới **🎬 AI Drama** trong Cockpit: bảng shot (thêm, sửa, kéo đổi thứ tự); mỗi ô có prompt, ảnh previz,
  ảnh / video đã tạo, thoại, số giây; nút "Dựng cảnh" (mở Play test đúng shot) và "Gửi sang Video FX".
- MCP mới: `gb_drama` (đọc / ghi bảng shot), `gb_previz_shot` (dựng + chụp khung), `gb_drama_attach` (gắn file đã tải),
  `gb_drama_dramaclaw` (đẩy dự án sang DramaClaw).
- Công thức trong `gb_recipe`: "phim AI từ kịch bản".

## Giới hạn, cần bạn quyết

- **Higgsfield**: bạn phải đăng nhập trong pane (tôi không đăng nhập hộ). Mỗi lần tạo tốn credit. Đề xuất: tôi hỏi
  trước mỗi đợt (vd. "8 video × 5 s").
- **DramaClaw**: phần tự tạo ảnh / video / giọng của nó cần key trả phí. Kế hoạch này không dùng phần đó.
- **License DramaClaw (Elastic 2.0)**: Greenbox chỉ nói chuyện với nó qua API, không chép code. Nếu sau này nhúng giao
  diện của nó vào Greenbox thì phải ghi "Powered by DramaClaw", và không được bán dưới dạng dịch vụ SaaS.
- **Cổng**: Greenbox `:8080`, DramaClaw API `:8780`; giao diện web của DramaClaw cần thêm pnpm (chưa cài).

## Đã có sẵn (07/11)

- DramaClaw: `~/gb-build/dramaclaw`, `uv sync` xong, chạy API:
  `cd ~/gb-build/dramaclaw && DRAMACLAW_LOCAL_AGENT_TRUST=1 uv run novelvideo api --host 127.0.0.1 --port 8780`
- MCP DramaClaw cho Claude Code: `~/Downloads/greenbox studio/.mcp.json` (4 tool get / post / patch / delete trên REST
  API, bật ở phiên sau); skill `dramaclaw-workflows` trong `~/.claude/skills`.
- 77 skill làm game (awesome-gamedev-agent-skills) + router trong `~/.claude/skills` (three.js, Unity, game feel…).
