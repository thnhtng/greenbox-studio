# Greenbox Studio

Ứng dụng web tĩnh dùng trực tiếp trong trình duyệt để quay, dựng và xuất nội dung Greenbox.

## Gói HTML

Toàn bộ giao diện và logic hiện có được đóng gói trong một tệp HTML duy nhất:

- `Greenbox-Cockpit.html` — tệp ứng dụng chính, gồm Joystick, các thanh overlay, bộ điều khiển vô lăng/bàn đạp và các chế độ Gacha/Endcard.
- `index.html` — trang mở nhanh, tự chuyển tới tệp ứng dụng chính.

Có thể mở `Greenbox-Cockpit.html` trực tiếp trong trình duyệt hoặc chạy qua HTTP server để bật đầy đủ các tính năng media/export.

## Chạy trên máy

```bash
python3 serve.py 8080
```

Sau đó mở `http://localhost:8080`. Máy chủ này tắt cache để bản cập nhật hiện ngay và bật AI Bridge/MCP trên máy local.

## Triển khai

Repository được cấu hình để tự động triển khai lên GitHub Pages khi có thay đổi trên nhánh `main`.

## Các tab

- **Overlay gameplay / Lái xe / Gacha**: nằm trong `Greenbox-Cockpit.html`.
- **Hậu kỳ › Gắn SFX**: trang riêng `sfx-bench.html`, được nhúng vào Cockpit bằng iframe và chỉ tải khi mở tab lần đầu. Mở trực tiếp `sfx-bench.html` vẫn chạy độc lập.
- Thư viện của SFX nằm trong `vendor/` (`mp4box.all.min.js`, `fflate.umd.js`, `mp4-muxer-5.1.3.js`), không phụ thuộc CDN.
- **3D · Gắn xương**: thư mục `rig3d/` là bản build của [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) (code MIT, asset CC0, giấy phép đi kèm trong `rig3d/LICENSE-MIT.MD` và `rig3d/LICENSE-CC0.MD`). Greenbox thêm 2 file: `rig3d/gb-base.js` (cho app chạy được trong thư mục con) và `rig3d/gb-i18n.js` (giao diện VI / EN / KO theo ngôn ngữ của Cockpit).
  - Greenbox có sửa mã nguồn Mesh2Motion để thêm **Chế độ dễ** (tự khớp cỡ + vị trí khung xương vào model, quét chọn nhiều khớp, kéo cả nhóm, chọn nhanh tay/chân/thân/đầu). Bản vá nằm ở `rig3d/greenbox-easyrig.patch`.
  - Cập nhật Mesh2Motion: `git clone` repo đó, `git apply rig3d/greenbox-easyrig.patch`, `npm ci && npm run build`, chép `dist/` đè vào `rig3d/` (bỏ `*.map`), rồi gắn lại 2 dòng `<script>` gb-base / gb-i18n vào `create.html`, `index.html`, `retarget/index.html`.


- **Greenbox 3D – mã nguồn riêng của Greenbox**: `rig3d-src/greenbox/` (bản sao để đọc; bản build nằm trong `rig3d/`):
  - `rig/` chế độ dễ, quét cơ thể (cả tay giơ ra trước kiểu zombie), phím kiểu Blender (G/X/Y/Z, 1/3/7, F, A), **giảm số xương** (`BoneReduce.ts`: tắt khớp → gộp vào khớp cha, bake animation, chỉ áp vào bản skin/export)
  - `skin/` lồng giải phẫu (chỉ cho người; thú dùng trọng lượng gốc của Mesh2Motion), chỉnh độ dày từng bộ phận, xem vùng da theo màu (`CageRegions.ts`)
  - `export/` tên xương Rigify, script Rigify cho Blender: tự đặt meta-rig, generate rig, gắn model (bộ "Rigify kit" = GLB + .py)
  - `vehicle/` 23 khung có sẵn (bánh, trống lu, cửa các kiểu, tháp pháo, nòng, lưỡi ủi, cần, tay máy xúc, gầu, móc, cáp, chân vịt, rotor, radar, bồn trộn, piston, thang, ăng-ten); chọn vùng bằng mảnh / khung / lasso / pen / cọ; loại xe car / truck / tracked / roller có bộ animation riêng
  - `playtest/` tab Chơi thử (WASD, nhảy, lộn, combo, đỡ, cúi, leo gờ, bấm-đất-để-đi kiểu mobile, quay video), map: thả GLB làm vật thể, kéo/xoay/phóng to, đi trên vật thể; thú; lái xe rig từ tab Xe cộ
  - `common/ViewButtons.ts` 4 góc camera (Trước / Ngang / Trên / 3D)
  - `mocap/` video → animation (MediaPipe Pose, Apache-2.0, chạy trong trình duyệt; file ở `rig3d/vendor/mediapipe-pose/`)
  - `common/` ngôn ngữ, chuyển file giữa các tab, ma-nơ-canh
- **AI chat + MCP**: thư mục `gb-ai/` (xem `gb-ai/README.md`).
- Bản GitHub Pages vẫn dùng được AI chat qua API của nhà cung cấp; AI Bridge/MCP và nút mở Blender chỉ hoạt động khi chạy local bằng `serve.py`.
- Rigify: nút **🚀 Mở thẳng trong Blender** (khi mở bằng Mo-Greenbox) lưu bộ file vào `exports/` rồi tự mở Blender chạy script — không cần tải về, không cần vào Scripting. Không tìm thấy Blender thì đặt biến môi trường `GREENBOX_BLENDER` = đường dẫn tới Blender.
- Tab 3D bị ẩn trong Cockpit chỉ vẽ 4 khung/giây (đỡ lag); nền sao của Cockpit ngừng vẽ khi đang mở tab 3D / SFX. Ctrl+C trong cửa sổ Mo-Greenbox tắt server ngay, không báo lỗi.
- Mỗi tab 3D có nút **⟳** (tải lại tab đó) và **?** (hướng dẫn từng bước, tự chạy lần đầu mở trang / mỗi bước của Dùng model; nằm trong `rig3d/gb-base.js`).
- Các tab 3D trong Cockpit giữ nguyên trạng thái khi chuyển qua lại; nút **←** trên thanh 3D để quay lại tab trước.

## Mở trên máy (không cần mạng)

Launcher dùng `serve.py` (server nhỏ có tắt cache, cập nhật bản mới là thấy ngay).

Tab **3D · Gắn xương** không chạy khi bấm đúp mở `Greenbox-Cockpit.html` (file://), vì trình duyệt chặn module và việc tải model. Thay vào đó:
- macOS: bấm đúp `Mo-Greenbox.command` (lần đầu: chuột phải → Open).
- Windows: bấm đúp `Mo-Greenbox.bat`.
