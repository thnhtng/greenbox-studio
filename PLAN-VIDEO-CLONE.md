# Kế hoạch: video playable → bản blockout chơi được trong Greenbox (chưa làm, chờ duyệt)

Ngày viết: 06/11/2026. Đọc cùng `GREENBOX-HANDOFF.md` (Round 67: một prompt → playable) và `gb-ai/README.md` mục 1c.

## Mục tiêu
Người dùng nói với Claude (Desktop / Code): *"Dựng lại playable từ ~/Downloads/xp-hero.mp4"*. Claude:
1. xem video (cắt thành khung hình có mốc giây);
2. viết ra **bản mô tả**: bố cục, vòng chơi, nhịp. Người dùng duyệt / sửa trong khung chat cạnh Greenbox;
3. dựng **sơ đồ 2D → map 3D chơi được** bằng nhân vật / vật thể của Greenbox hoặc của người dùng;
4. chơi thử, so ảnh với video, chỉnh;
5. xuất `greenbox-playable.html` (dưới 5 MB), như Round 67.

Kết quả là **cùng bố cục + vòng chơi + nhịp**, không phải bản sao từng pixel. Art, model, âm thanh, chữ của game gốc không được lấy ra (chỉ làm cấu trúc gameplay khi video là quảng cáo của game khác).

## Phần 1. Cho Claude "xem" video: công cụ MCP `gb_video_frames`
- Chạy ngay trong `greenbox_mcp.py`, dùng **ffmpeg** trên máy (đã có `/opt/homebrew/bin/ffmpeg`). Không có ffmpeg thì báo cách cài (`brew install ffmpeg`).
- Tham số: `path`, `every` (giây giữa 2 khung, mặc định 0.5), `max` (số khung tối đa, mặc định 24), `scene` (thêm khung khi cảnh đổi mạnh, mặc định bật), `from` / `to` (đoạn cần xem), `width` (mặc định 480 px cho nhẹ).
- Trả về: các khung JPEG (MCP image content) + dòng chữ mốc giây từng khung + thời lượng, kích thước, fps của video.
- Video dài: tự giãn `every` cho vừa `max`. Claude xem lại chi tiết một đoạn bằng `from` / `to`.

## Phần 2. Bản mô tả để người dùng duyệt (`gb_clone_brief`)
Claude điền một khung chuẩn, Greenbox hiện nó gọn trong khung chat cạnh bên (bảng nhỏ, sửa được bằng cách nhắn lại):
- **Góc camera**: từ trên xuống / chéo / sau lưng; khung 9:16 hay 16:9.
- **Khu vực** (theo thứ tự xuất hiện): ô bắt đầu, nguồn đồ (đồ gì, bao lâu ra 1 cái), máy biến đổi, quầy bán, ô $ mở khoá (giá), vật mở ra; vị trí tương đối trên một lưới thô.
- **Vòng chơi**: chuỗi bước 1 → n (nhặt → mang → bán → mở khoá → …).
- **Nhịp**: mốc giây của tay hướng dẫn, lần mở khoá đầu, cảnh kết, end card / nút CTA.
- **Ngoại cảnh**: kiểu map (cỏ, sa mạc, đường phố…), vật trang trí chính.
- Mục "Không chắc" để Claude hỏi lại người dùng (gb_inbox) thay vì đoán.

## Phần 3. Dựng và so sánh
- Từ bản mô tả, dựng `gb_map plan` (đã có các loại khối: player, source, machine, stack, counter, unlock, block, zone, camera và dây carry / belt / unlock). Đặt camera của playable theo góc trong video.
- Công cụ `gb_compare_view`: chụp Play test ở cùng góc camera, ghép **cạnh khung video tương ứng** thành một ảnh để Claude và người dùng so. Claude chỉnh vị trí / kích thước khối đến khi giống bố cục.
- Nhịp: tay hướng dẫn và thời điểm hiện nút CTA của playable lấy theo mốc giây trong bản mô tả. Phần này cần thêm 2 tuỳ chọn nhỏ vào runtime playable: thời điểm hiện CTA, và có / không có tay hướng dẫn.

## Phần 4. Công thức + prompt
- `gb_recipe` có thêm mục "clone from video"; prompt MCP mới `clone_playable {video, model?, link?}` (Claude Code: `/mcp__greenbox__clone_playable`).
- Trang Greenbox: không cần nút mới. Toàn bộ chạy qua Claude, người dùng xem trong khung chat cạnh bên.

## Kiểm tra sau khi làm
- Một video playable thật quay màn hình 20–40 giây: `gb_video_frames` trả 20–24 khung đúng mốc giây; khung cảnh đổi (mở khoá, end card) có mặt.
- Bản mô tả hiện trong khung chat; sửa 1 mục bằng tin nhắn → Claude cập nhật.
- Map dựng ra: ảnh so sánh cạnh video cho thấy cùng bố cục (thứ tự khu vực, hướng đi); chơi được hết vòng; file playable dưới 5 MB, CTA hiện đúng mốc giây (±1 s).
- Video không có ffmpeg / file hỏng: báo lỗi rõ ràng.

## Cần bạn chọn trước khi làm
1. Bạn có video quay sẵn của playable XP Hero để làm mẫu thử không (đặt trong `~/Downloads/XP Hero/`)?
2. Nhân vật cho bản dựng lại: dùng nhân vật mẫu của Greenbox, hay bạn đưa model riêng?
3. Phần 3 "so ảnh cạnh video" và nhịp CTA có cần ngay đợt đầu không, hay làm Phần 1 + 2 + 4 trước (xem video → mô tả → dựng map → xuất), rồi so sánh / nhịp làm đợt sau?
