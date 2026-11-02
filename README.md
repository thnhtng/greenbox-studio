# Greenbox Studio

Ứng dụng web tĩnh dùng trực tiếp trong trình duyệt để quay, dựng và xuất nội dung Greenbox.

## Chạy trên máy

```bash
python3 -m http.server 8080
```

Sau đó mở `http://localhost:8080`.

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
- **Tạo dáng IK / FK** (tab Dùng model, sau Hoàn tất): mỗi tay / chân có công tắc IK ⇄ FK, đổi không làm nhảy dáng (`rig/PoseControls.ts`). Dáng tự đi kèm sang Blender (clip `Greenbox_Pose`) và rig Rigify có bảng **Greenbox IK / FK** y hệt (Blender: phím N → tab Greenbox; code ở `export/greenbox_controls.py`, lưu trong file .blend).
- Nút **‹ ›** ở mép bảng bên phải: ẩn / hiện bảng điều khiển để khung 3D rộng hơn (nhớ theo từng trang).
- Rigify: nút **🚀 Mở thẳng trong Blender** (khi mở bằng Mo-Greenbox) lưu bộ file vào `exports/` rồi tự mở Blender chạy script — không cần tải về, không cần vào Scripting. Không tìm thấy Blender thì đặt biến môi trường `GREENBOX_BLENDER` = đường dẫn tới Blender.
- Tab 3D bị ẩn trong Cockpit chỉ vẽ 4 khung/giây (đỡ lag); nền sao của Cockpit ngừng vẽ khi đang mở tab 3D / SFX. Ctrl+C trong cửa sổ Mo-Greenbox tắt server ngay, không báo lỗi.
- Mỗi tab 3D có nút **⟳** (tải lại tab đó) và **?** (hướng dẫn từng bước, tự chạy lần đầu mở trang / mỗi bước của Dùng model; nằm trong `rig3d/gb-base.js`).
- Các tab 3D trong Cockpit giữ nguyên trạng thái khi chuyển qua lại; nút **←** trên thanh 3D để quay lại tab trước.

## Cập nhật 30/10/2026

- **Mở được mọi file**: GLB, GLTF (+ .bin / texture chọn cùng lúc), FBX, **OBJ (+ .mtl)**, DAE, STL, PLY, 3MF, ZIP — ở mọi tab 3D (`rig3d-src/greenbox/common/AnyLoader.ts`). Trước đây OBJ không được nhận, .gltf thiếu .bin và FBX ASCII đời cũ (< 2013) lỗi im lặng; giờ có thông báo rõ lý do (vd. "FBX bản 6100 quá cũ, xuất lại FBX 2013+ Binary"), thiếu texture vẫn hiện model màu xám.
- **Phân tích model → điểm neo** (`rig/ModelAnalyzer.ts`): đồ thị bề mặt + khoảng cách geodesic + persistence (độ nhô) tìm các nhánh thật (bỏ qua ngón tay / nếp gấp), nhận loại người / thú 4 chân / xe / sinh vật khác, đặt tên đầu, tay, chân và **phụ kiện: tai, sừng, tóc, cánh, đuôi, áo choàng, vũ khí cầm tay**, mỗi nhánh có chuỗi khớp nằm **bên trong** mesh. Nút **🔎 Điểm neo** ở tab Dùng model; ở tab Xe cộ / model bất kỳ: **🔎 Phân tích model → điểm neo + xương** tự tạo chuỗi xương cho từng nhánh (rồng, chim, robot…), da ở khớp blend mềm.
- **Paint skin weight** (tab Dùng model, sau Hoàn tất → 🖌): cọ thêm, **gôm xoá**, làm mịn; chọn **điểm / cạnh / mặt / khối** (Shift thêm, Alt bớt, kéo = khung) để giới hạn cọ hoặc đặt 100% / 0% một lần; đối xứng T/P; thanh **Thử gập** xoay xương để thấy kết quả ngay; Ctrl+Z. Màu: xám = không ảnh hưởng, xanh → đỏ = 0 → 100%, hoặc "màu mọi xương". Quy tắc chống "tay lẹm đùi" (A-pose): gôm xương nào thì phần weight đó **trả về đúng xương vốn sở hữu vùng da đó** (xương xung quanh đang dùng, không bao giờ về "root"), nên chỉ phần đã chọn bị ảnh hưởng. Code: `skin/WeightPaint.ts`.
- **Xem lưới** (▦ Lưới / phím W) cho người, thú, xe, prop; **xem xương** xe (🦴 Xương).
- **Xe cộ**: nút ⏸ Tạm dừng / ⏹ Dừng hẳn (Space); **bánh xích**: ⛓ Tìm bánh xích tìm dải xích quanh các bánh mỗi bên — chạy được cả khi cả xe là **1 khối mesh** — rồi biến nó thành chuỗi xương chạy vòng quanh bánh (mắt xích leo qua bánh răng, chạy trên, xuống bánh dẫn hướng), xuất GLB/FBX/Blender như animation xương thường (`vehicle/Tracks.ts`). Nút "Xe tăng mẫu" để thử. **🦴 Đặt xương bằng chuột**: bấm lên model để đặt khớp (nằm giữa bề dày), **Shift+bấm** nối thành chuỗi, Ctrl+bấm lấy luôn khối vừa bấm, đặt tên tuỳ ý, chọn "Gắn vào" xương cha. **✂ Tách phần đang chọn + tự fill lỗ** (`common/MeshSplit.ts`: chỉ vá lỗ do vết cắt, không vá lỗ sẵn có của model).
- **Chơi thử**: nhân vật **chạm đất thật** (đo chân từ mesh đã skin ở khung idle, không dùng hộp bind-pose; mỗi frame ghim bàn chân thấp nhất xuống đất; nút 🦶). **Thiết kế map** kiểu game chiến thuật (`playtest/MapEditor.ts`): nâng / hạ / san phẳng / làm mịn địa hình, tô cỏ / đất / cát / đá / tuyết / đường / đáy nước, mực nước, đặt cây / bụi / đá / nhà / tháp / tường / rào / thùng / cờ, map mẫu (đồi, đảo, thung lũng, núi), tự lưu, lưu/mở .json, **xuất GLB và script Blender (.py)** dựng lại map trong Blender (địa hình có màu + từng vật có tên, trong collection "Greenbox Map"). Nhân vật đi trên đồi, va nhà, leo tường.
- **Thanh máu / HUD video** (Cockpit › Hậu kỳ › ❤️ Thanh máu / HUD, trang `hpbar.html`, lớp video riêng — không nằm trong 3D): avatar + khung, tên, cấp, thanh HP (vệt trễ khi mất máu, số bay -250, rung, nháy khi máu thấp), thanh mana bật/tắt, khung thanh máu, nền HUD, logo; bảng **"Hero bị tấn công lúc nào"** (giây, loại, lượng) hoặc bấm H / J / M khi đang phát để ghi đúng giây; video gốc chỉ để canh giây. Xuất **MP4 phông xanh** (keylight) hoặc **.MOV alpha** (PNG trong QuickTime, kéo thẳng vào AE / Premiere / CapCut). Bảng **kích thước ảnh** cho từng khung (trên video và cỡ nên gen ×2) + nút tải **template** đúng cỡ để gen ảnh rồi upload vào.
- **MCP cho bản web**: `gb-ai/greenbox_mcp.py` dùng được với **Claude Desktop, Claude Code, Codex** (và client MCP bất kỳ), cả khi Greenbox mở trên web (GitHub Pages): nó mở cầu nối trên 127.0.0.1, trang web kết nối sau khi nhập **mã ghép nối 6 số** (hỏi AI "kết nối Greenbox"). Công cụ mới: `gb_connect`, `gb_analyze`, `gb_vehicle` (xích, đặt xương, gán vùng, tách, build, play), `gb_map`, `gb_hpbar`. Xem `gb-ai/README.md`.
- Build lại phần 3D: `./rig3d-src/build.sh` (lần đầu `--setup`; cần Node). Script tự chép bản build vào `rig3d/`, gắn gb-base / gb-i18n, cập nhật `rig3d-src/greenbox/` và `rig3d/greenbox-easyrig.patch`.

## Cập nhật 30/10/2026 (đợt 2)

- **Thanh máu và Đếm ngược nằm trong nhóm Overlay gameplay** của Cockpit (cùng `hpbar.html`, hai tab ❤️ / ⏱ ở đầu panel).
  - Thanh máu hero chỉnh được: dài, dày, bo góc, vệt trắng (chờ bao lâu, tụt nhanh hay chậm), avatar bên phải (lật), toạ độ X/Y. Có nút căn nhanh 9 vị trí; phím mũi tên dịch 1 px, Shift + mũi tên dịch 10 px.
  - **Máu boss** là một thanh lớn có tên boss, %, số lớp ×3 (mỗi lớp một màu), viền, vân và khung ảnh riêng.
    - Trong bảng mốc chọn Hero / Boss cho từng dòng; khi đang phát, bấm **B** để ghi một cú đánh vào boss.
    - Có thể tắt HUD hero để xuất riêng thanh boss.
  - **Đếm ngược**: một con số đếm theo giây.
    - Đếm từ số nào đến số nào, bắt đầu ở giây bao nhiêu.
    - Kiểu số: 10 9 8…, mm:ss, 9.8, 9.75.
    - Kiểu chữ: cỡ, độ đậm, màu, viền, ánh sáng; nảy mỗi số; vòng tròn chạy; mấy số cuối đổi màu cảnh báo; chữ kết thúc (GO!) và giữ bao lâu.
    - Kéo để căn vị trí (tự hít vào giữa, giữ Alt để kéo tự do), mũi tên để dịch.
    - Xuất MP4 phông xanh hoặc .MOV alpha như thanh máu.
- **Âm thanh gacha hiện rõ**: mỗi chế độ (thẻ lần lượt, chọn 1/N, carousel, túi mù, rương) có mục 🔊 Âm thanh.
  - Bảng ghi từng tiếng: vang lúc nào và **lấy từ đâu** — có sẵn trong app (`SFX_DEF`), file bạn đổi (tên file), hay tạo bằng code (tiếng xé / vút).
  - Mỗi tiếng có nút ▶ nghe thử, Đổi… và Mặc định.
  - Có danh sách các tiếng trong take hiện tại theo từng giây.
- **Paint skin — thông số từng điểm (giống Component Editor của Maya)**: chọn điểm (⬚ + Điểm) để thấy điểm đó đang bị những xương nào kéo, bao nhiêu %.
  - Gõ số chính xác rồi Enter; phần còn lại tự chia cho các xương khác, tổng luôn 100%.
  - 🔒 Hold giữ nguyên một xương.
  - Mục "Từng điểm" cho bảng điểm × xương.
  - Có thể thêm một xương mới vào điểm, và bỏ các ảnh hưởng dưới 2%.
- **Tìm ngón tay** (`rig/FingerFinder.ts`, nút 🖐 *Find fingers in the mesh*, tự chạy khi Auto-fit). Cách làm:
  - Cắt vùng bàn tay quanh cổ tay, đo khoảng cách theo bề mặt từ cổ tay.
  - Đầu ngón là những chỗ nhô ra đủ dài (persistence); khớp đốt nằm bên trong ngón, ở 100 / 55 / 25 % chiều dài ngón.
  - Ngón cái là ngón nhập vào bàn tay gần cổ tay nhất; các ngón còn lại xếp từ phía ngón cái: trỏ, giữa, áp út, út. Tay hoạt hình 4 ngón: ngón út đi theo áp út.
  - Sau khi skin, **weight ngón được tô lại**: mỗi điểm thuộc lòng bàn tay hoặc đúng đốt ngón gần nhất, blend ở khớp. Nhờ vậy ngón gập riêng, không kéo ngón bên cạnh; tắt được bằng checkbox *Finger weights*.
  - Trên model người mẫu: tìm đủ 5 ngón hai tay. Đầu ngón 100% đốt 3, khớp giữa chia 70/30, lòng bàn tay 100% hand.
- **Chơi thử — camera**:
  - **Kéo chuột giữa = camera tự do** (xoay quanh), Shift + chuột giữa = dời, lăn chuột = zoom. Bấm đúp chuột giữa hoặc **F** để quay về theo nhân vật; F khi đang chọn vật = nhìn vào vật đó.
  - **Shot camera**: 📌 lưu góc đang nhìn thành shot.
    - Mỗi shot có giây bắt đầu, độ dài, FOV, cách vào shot (cắt thẳng / lướt 0.6 s / lướt chậm 1.5 s).
    - Ba kiểu shot: Cố định, Bám theo (đứng yên, xoay nhìn theo vật / nhân vật), Đi theo (chạy cùng vật / nhân vật).
    - ▶ Phát shot; **⏺ Quay theo các shot** để ra video.
    - Shot được lưu cùng map.
  - Sương mù tự giãn theo khoảng cách camera.
- **Chơi thử — map**:
  - **👆 Chọn / kéo**: bấm vào nhà, cây, file… để hiện tay kéo (di chuyển / xoay / phóng to).
  - **Z xoay 15°** (Shift+Z ngược, Alt+Z 90°). Z xoay vật sắp đặt (có bóng mờ xem trước), vật đang chọn, hoặc nhân vật.
  - **🧽 Gôm** dạng cọ, kéo để xoá mọi vật, file hoặc hộp dưới cọ; bấm vào nước đã đổ để rút nước.
  - **🕳 Khoét hố / rãnh**: hố đáy phẳng, bờ dốc; kéo để kẻ lòng sông.
  - **💧 Đổ nước**: bấm vào hố hoặc rãnh, nước tự dâng tới miệng (tìm điểm tràn); thanh "Nước đầy" chỉnh độ đầy.
  - Công tắc **Mực nước biển** (map phẳng mặc định tắt, nên hố đào vẫn khô cho tới khi đổ nước).
  - **＋ File 3D vào bảng vật**: GLB / FBX / OBJ của bạn vào bảng, bấm để đặt bao nhiêu cái cũng được. File được nhớ trong trình duyệt.
  - Sửa lỗi cũ: tấm nền phẳng che mất mọi chỗ thấp hơn 0. Giờ nó chừa lỗ đúng bằng map nên hố, sông và thung lũng hiện ra.
- **Ảnh layout 2D → map 3D** (`playtest/LayoutImport.ts`, mục 🖼 trong Thiết kế map): thả bản vẽ nhìn từ trên xuống, mỗi màu mang một nghĩa.
  - Mỗi màu ứng với nước, cát, đường, núi, rừng, nhà, tháp, tường, rào, đá, cờ…
  - Thuật toán đo từng mảng màu (vị trí, diện tích, hướng chính, dài / rộng). Từ đó:
    - Hình chữ nhật đỏ thành nhà đúng cỡ và hướng; dải đỏ dài thành dãy nhà.
    - Nét đen thành tường cắt từng đoạn 4 m, mỗi đoạn xoay theo đúng khúc nét (đi được góc chữ L, đường cong).
    - Mảng xanh đậm thành rừng trồng cây cách ~3 m; chấm thành 1 cây hoặc đá.
    - Núi cao dần từ mép vào giữa; hồ / sông sâu dần, có nước.
  - Chú thích màu sửa được: chọn dòng rồi bấm lên ảnh để lấy đúng màu, hoặc 🎨 lấy màu chính của ảnh.
  - Chỉnh được độ lệch màu, độ cao núi, cỡ map; có nút hiện ảnh lên mặt đất để so; nút tải **ảnh mẫu** có đủ các màu.
- **Xuất map kèm camera**:
  - **GLB** có camera glTF cho từng shot (Unity, Godot, Blender đọc được) và các vũng nước.
  - **Blender (.py)** dựng camera với Track To vào vật / nhân vật ("Player" là một empty), camera kiểu Đi theo gắn vào vật. Marker trên timeline tự đổi camera đúng giây; có vũng nước; file 3D riêng được import từ thư mục cạnh file .blend (biến `FILES_DIR`).
  - **Unity (.cs)**: script `GreenboxShots` phát các shot trên camera chính (cắt / lướt, bám / đi theo object cùng tên, "player" = object có tag Player).
- MCP:
  - `gb_map` thêm `dig`, `pour`, `sea`, `erase`, `shot_add`, `shots`, `shots_play`, `layout` (ảnh base64 → map), `export_unity`.
  - `gb_hpbar` thêm `page` (hp / count), máu boss (`who: "boss"`) và các thông số đếm ngược.

## Cập nhật 30/10/2026 (đợt 3)

- **Sơ đồ 2D → playable 3D** (Chơi thử › Thiết kế map › 📐 Sơ đồ 2D → playable; `playtest/PlanEditor.ts`, `Playable.ts`).
  - Vẽ hình chữ nhật / tròn, ghi chữ lên khối (T hoặc bấm đúp), nối dây flow (↝), kéo / đổi cỡ / xoay (nút tròn, Z / X), Ctrl+D nhân bản, có undo / redo riêng.
  - Ảnh layout làm nền để vẽ đè. **🪄 Tự nhận khối**: tìm các mảng màu trong ảnh (gộp màu chuyển, khung chữ nhật nhỏ nhất theo mọi góc, bỏ chữ / mảng méo), mỗi mảng thành một khối để bạn ghi tên.
  - Tên tự đặt vai trò: "Tree / Cây" → nguồn, "… maker / Máy" → máy, "Counter / Quầy" → quầy, "Stack" → chỗ xếp đồ, "$ …" → ô mở khoá, "Player" → chỗ bắt đầu, "Room / Phòng" → sàn. Đổi lại được trong panel; mỗi khối có món cho ra / nhận vào, số giây, giá, chiều cao, màu, hoặc dùng một vật / file 3D của bạn thay cho khối hộp.
  - Dây: **mang tay** (nét đứt vàng), **băng chuyền** (đồ tự chạy), **mở khoá** (trả tiền ô $ thì hiện phòng / máy mới).
  - **⚙ Dựng map 3D**: mỗi khối thành khối 3D có nhãn chữ, dây thành đường flow trên mặt đất. Lưu cùng map, undo được, xuất GLB / Blender.
  - **▶ Chơi playable**: đứng cạnh nguồn thì đồ chồng lên lưng (tối đa 12); đi qua máy thì đồ bay vào, máy làm ra món mới; quầy đổi ra tiền; ô $ trừ tiền để mở khoá. Có mũi tên vàng chỉ việc tiếp theo và ô đếm tiền. Chưa nạp nhân vật thì có nhân vật tạm hình viên nang (WASD). Máy làm từ file 3D có animation sẽ chạy animation khi đang làm.
- **WASD cho con vật và xe**: Chơi thử tự xoay model cho đầu con vật (xương đầu, hoặc hướng đi của animation walk) / đầu xe (bánh trước so với bánh sau) quay về hướng W; A rẽ trái, D rẽ phải, S lùi. Nếu vẫn lệch: nút ↻ Xoay hướng 90°.
- **Phím X** xoay ngược chiều với Z (vật sắp đặt, vật đang chọn, nhân vật). **🗑 Xoá hết mọi thứ** trên map (Ctrl+Z để lấy lại).
- **Paint skin**:
  - Hiện khung xương lên da khi paint; xương đang paint tô vàng kèm tên. Dùng 👆 (hoặc Ctrl + bấm) bấm gần một xương để chọn nó.
  - Weight tự động **mịn hơn**: sau bộ giải của Mesh2Motion có thêm vài vòng làm mịn theo đỉnh lân cận, giữ 4 xương mạnh nhất. Chỉnh bằng thanh "Độ mịn weight", rồi bấm ↻ Skin lại ngay.
  - **🦴 Sửa lại vị trí xương → skin lại**: quay về bước khớp, chỉnh, bấm Hoàn tất là tính lại weight theo khớp mới. Mặc định **giữ phần đã paint tay** (theo tên xương).
- **Đối xứng xương**:
  - Bước khớp có 🪞 Trái → phải / Phải → trái / Căn giữa xương sống. Ô "Mirror Left/Right Joints" có sẵn vẫn giữ hai bên đi cùng nhau khi kéo.
  - Tab Xe cộ / model bất kỳ có 🪞 Đối xứng xương T/P: xương một bên được nhân sang bên kia, tên _L / _R, xương cha cũng đối xứng.
- **Điểm neo** (🔎):
  - Đo trên đúng tư thế đang hiện trên màn hình. Trước đây đo trên tư thế gốc nên lệch khi nhân vật đang chạy animation; animation tạm dừng khi xem.
  - Với người đã có bộ xương: đầu, 2 tay, 2 chân lấy thẳng từ các khớp xương. Vùng da của mỗi nhánh tô màu theo weight thật (xương nào kéo đỉnh đó nhiều nhất). Phân tích hình học chỉ thêm phụ kiện (đuôi, cánh, tai…) không trùng tay / chân.
  - **Kéo được từng điểm neo**; ở bước khớp thì xương đi theo. Bấm một điểm: chỉ vùng da nhánh đó sáng.
- **Model đã có xương (Mixamo…)**: animation có sẵn trong file (ví dụ con cá đã bơi) hiện đầu danh sách với dấu ★. Chúng phát và xuất **nguyên bản, không retarget**, cùng với animation thư viện retarget lên cùng rig. Đã thử: 178 animation ★, xuất GLB giữ đúng tên.
- **Khớp Mixamo**: 65 / 66 xương người đổi đúng sang tên `mixamorig:*` khi xuất kiểu Mixamo. Riêng `root` được giữ làm xương cha của `Hips`; Unity Humanoid và Blender vẫn nhận.
- MCP `gb_map` thêm `plan` (dựng sơ đồ thành playable, `play: true` để chơi luôn) và `clear`.

## Cập nhật 30/10/2026 (đợt 4) — chất lượng rig kiểu P2M, playable xuất file, lấy xương từ file

- **Học từ thư viện P2M** (rig Rigify chuyên nghiệp):
  - Cấu tạo của P2M:
    - 126 xương deform; tay và chân chia 4 đoạn twist; có xương corrective ở khuỷu, gối, cổ tay, vai; có xương bàn tay (palm).
    - Mesh có modifier Corrective Smooth (hệ số 0.3, 5 vòng, kiểu SIMPLE, chỉ trên nhóm SMOOTH ở khớp); B-bone 10 đoạn; mỗi đỉnh chịu 3–5 xương.
  - Greenbox giờ làm theo cách đó:
    - **GLB / FBX:** thêm xương **twist cẳng tay** `lowerarm_twist_01_l/r` (tên chuẩn Unreal). Weight cẳng tay được chia dần từ khuỷu ra cổ tay. Mọi animation có track twist bằng một nửa góc xoay của bàn tay quanh trục cẳng tay, nên cổ tay không bị "giấy gói kẹo". Đã thử: cả 178 animation có track twist.
    - **Blender (Mở trong Blender với Rigify / Rigify kit):** tay và chân **4 đoạn twist** với weight trải theo chiều dài, nhóm **SMOOTH** ở các khớp, **Corrective Smooth** đúng thông số P2M, B-bone 10 đoạn. Đã chạy thử trong Blender thật.
- **Xương + animation từ file** (bước chọn khung xương › 📂 Xương + animation từ file…):
  - Thả một file đã có xương và animation (ví dụ con cá sấu đang đi). Phần thịt bỏ đi; bộ xương được canh theo hộp bao vào model của bạn; model được skin bằng weight lồng xương (cage, chạy với mọi bộ xương); animation của file chạy trên model của bạn. Track vị trí được dời theo các khớp bạn chỉnh.
  - Rig được lưu trong trình duyệt (🦴 tên file) để gắn cho model khác sau này.
  - Đã thử: xương + 178 animation của một nhân vật gắn sang con thỏ.
- **🧬 Clone rig (copy xương)** — Cockpit › 3D · Gắn xương › 🧬 Clone rig, hoặc nút cam viền sáng ở bước đầu trang Dùng model (hoặc mở `rig3d/create.html?clone=1`). Bảng hướng dẫn 4 bước, bước đang làm sáng viền cam:
  1. Thả file **có xương + animation**: hiện ngay model, khung xương và animation của file; bấm từng tên để xem.
  2. Thả model **chưa có xương**: hiện cạnh file rig.
  3. **🧬 Áp dụng rig vào model** (tuỳ chọn dừng ở bước khớp để chỉnh trước).
  4. **File base có rig**: ⬇ GLB / FBX (tên `<model>_rigged`), 🎮 Chơi thử, ↺ Gắn cho model khác.
  - **Hai thân khác nhau** (khác dài, khác chân, quay khác hướng): xương được khớp theo thân model (`rig/CloneFit.ts`):
    - Tìm hướng đầu của cả hai. File rig dựa vào xương đầu / hàm / cổ; model chưa có xương dựa vào mesh nhỏ rời như mắt, nếu không có thì lấy đầu to hơn (đuôi thon).
    - Xoay, co theo chiều dài, đặt đáy chạm đáy.
    - Ghép mốc: 12 điểm đường giữa thân, từng bàn chân (đảo đỉnh sát sàn, ghép trước / sau, trái / phải), chóp mõm và chóp đuôi.
    - Uốn thin-plate spline lên mọi khớp.
    - Ở bước 3 có tuỳ chọn "Uốn xương theo thân", "Đầu / đuôi bị ngược" và "Dừng ở bước khớp để chỉnh". Model tự đặt chạm sàn trước khi đo.
    - Đã thử: xương + 6 animation của `Crocodile_Green.fbx` (quay +Z, cao, chân dài) gắn sang `crocodile.glb` (quay +X, dài 9.5 m, dẹt, chân ngắn, mắt rời). Khớp 12 điểm thân và 4 chân; đầu, mắt và đuôi đi đúng.
  - Tab Xe cộ có nút **🧬 Clone rig từ file khác** mở cùng bảng hướng dẫn (bánh xe được tính như chân chạm sàn).
  - Rig đã dùng được nhớ lại, lần sau chỉ cần bấm tên. Đã thử với 2 file cá sấu: ra `croc_Base_rigged.glb` gồm 69 xương và 6 animation.
- **Tab Xe cộ** có **🖌 Paint skin weight** giống phần người: cọ, gôm, làm mịn, chọn điểm / cạnh / mặt, thông số từng điểm, hiện xương, Ctrl / Cmd + Z.
- **Sơ đồ 2D:** vẽ xong một khối tự trở về **con trỏ ➚** để chọn / kéo (giữ Shift để vẽ tiếp). Ctrl+Z / Cmd+Z và Ctrl+Shift+Z / Cmd+Shift+Z trong trình vẽ.
- **🔗 Dây flow: hiện / ẩn** trên map 3D (ẩn thì không có trong lúc chơi và khi xuất).
- **⬇ File playable (.html):** một file HTML duy nhất chạy được ngay (không cần server):
  - Gồm map, nhân vật kèm đúng những animation bộ điều khiển dùng, và sơ đồ.
  - Bấm-kéo ở đâu cũng thành joystick (hoặc WASD); có nhãn khối, mũi tên chỉ đường, ô tiền.
  - Nút CTA mở link cửa hàng (dùng `mraid.open` trong mạng quảng cáo).
  - Kích thước khoảng 1.2 MB nếu dùng nhân vật tạm, khoảng 3.7 MB với nhân vật thật.
  - Bộ chạy nằm ở `rig3d/playable-runtime.js` (build bằng `vite.playable.config.ts`).

## Cập nhật 30/10/2026 (đợt 5) — bàn tay, clone rig xe, xe mẫu, giao diện gọn, hình 2D

- **Bàn tay (auto rig):**
  - Quét cánh tay chỉ lấy "ống tay" quanh bàn tay, nên quần short / váy rộng không còn kéo vai xuống hông (lỗi trên mẫu chibi `jay.glb`).
  - Cổ tay đặt ở chỗ tay thắt nhỏ nhất ngay trước lòng bàn tay, nên tay chibi to vẫn đúng.
  - Nếu ngón tay không tách rời, lòng bàn tay được đo trực tiếp:
    - Mỗi ngón nằm trên một "gờ" của độ vươn đầu ngón, mỗi ngón một chuỗi khớp riêng, không còn dồn cục.
    - Ngón cái đặt ở phần nhô ra phía ngoài ngón trỏ.
    - Chuỗi ngón bị ngược hoặc dồn cục sẽ bị loại.
  - Khớp ngón tay **mặc định không khoá**: bấm hoặc quét chọn từng đốt rồi kéo như mọi khớp. Ô "Khoá ngón theo bàn tay" vẫn còn nếu muốn.
  - Đã thử với `jay.glb` (chibi), `male.glb` và `monster.glb`.
- **🧬 Clone rig xe** (tab Xe cộ, khung viền cam):
  - Lấy bánh, bánh lái, cửa, xích, tháp pháo, cần, gàu, móc… **và animation** từ một xe đã rig (GLB / FBX) hoặc từ xe mẫu, gắn sang model của bạn.
  - Hai xe được đặt cùng hệ (dài theo Z, đầu xe +Z) và co về hộp đơn vị. Mỗi đỉnh của xe đích lấy bộ phận của đỉnh gần nhất bên xe nguồn.
  - Tên node cho biết bộ phận (`wheel`, `rim`, `door`, `hood`, `turret`, `track`…). Phần tròn, thấp, đứng thẳng thì là bánh.
  - Xe đích có bánh rời thì giữ nguyên bánh của nó. Một node nguồn điều khiển cả 2 bánh của một trục thì được tách trái / phải.
  - Animation gốc được chuyển thành độ xoay / dời so với tư thế nghỉ, nên không phụ thuộc trục xương của file nguồn. Tên animation có tiền tố `SRC_`. Chuyển động tịnh tiến của thân xe được chuyển sang gốc (cả xe cùng chạy).
  - Bỏ qua cảnh xung quanh (bục, cầu, đường) bằng cách chỉ giữ phần quanh các bánh.
  - Khi thả file rig xe vào 🧬 Clone rig cho sinh vật (hoặc "rig từ file"), trang sẽ báo và chuyển sang Clone rig xe. Trước đây cách này làm vỡ xe (xương đỏ tua tủa).
  - Đã thử: `car__animation.glb` (McLaren, có animation bánh + chạy) sang `concept_car.glb` cho ra 4 bánh đúng; animation SRC chạy được và mesh không vỡ.
- **🚗 Xe mẫu đủ chức năng** (14 loại), mỗi bộ phận là một mesh có tên nên tự rig hết:
  - Xe con (4 cửa, capo, cốp, ăng-ten), xe thể thao (cửa cánh chim), bán tải (bửng sau), xe buýt 6 bánh, xe trộn bê tông (bồn quay), xe cẩu (cabin xoay, cần, cáp, móc), xe nâng (càng nâng).
  - Xe tăng (xích, tháp pháo, nòng), xe ủi (xích, lưỡi ủi), máy xúc (xích, cabin, cần, tay, gàu), xe lu (trống), xe máy (2 bánh, bánh trước lái), trực thăng (cánh quạt chính + đuôi), tàu (chân vịt, radar).
  - Model tải lên có bộ phận đặt tên kiểu này cũng được nhận ngay.
- **Máy quét bánh xe:**
  - Bỏ ống xả, đèn, ốc, đĩa phanh tròn nhỏ; phần nhỏ nằm trong bánh to thì gộp vào bánh đó.
  - Xe máy: bánh ở giữa và mỏng thì gọi là `wheel_F` / `wheel_R`, không phải trống lu.
  - Sửa lỗi xe đôi khi bị xoay ngược 180° khi nạp.
- **Giao diện gọn:**
  - Panel bên phải cố định 320 px (trước đây giãn theo nội dung, chiếm 2/3 màn hình).
  - "Xương + animation từ file" thành mục gập, đặt dưới nút Back / Edit.
  - Panel chỉnh khớp gập thành các mục: Cách dùng, Chuột / phím, Lồng giải phẫu, Đối xứng, Ngón tay (mở sẵn), Số xương.
  - Bảng 🧬 Clone rig chuyển sang bên trái, rộng 300 px, có nút — để thu gọn chỉ còn bước đang làm.
  - Tab Xe cộ: công cụ chọn vùng và xương thêm gập lại.
- **Lồng giải phẫu:** mặc định ẩn hình lồng (vẫn dùng để tính skin weight), gập trong mục "nâng cao".
- **Sơ đồ 2D:**
  - Thêm hình: bo góc, tam giác, thoi, ngũ giác, lục giác, bát giác, ngôi sao, chữ thập, mũi tên. Có trên thanh công cụ, đổi được trong ô "Hình", và dựng khối đúng hình trong 3D.
  - Bảng 18 màu tô nhanh.
  - **Ô $ mở khoá / nâng cấp và ô xếp đồ hiện bằng hình**, không còn khung gạch đứt. Mặc định là đồng xu $ kèm giá, hoặc thùng hàng. Bấm "🖼 Ảnh cho ô…" để dùng ảnh của bạn. Ảnh được nằm trên mặt ô trong map 3D và trong file playable.

## Cập nhật 02/11/2026 (đợt 21–22) — màu xanh lá, game bắn rơi khối, MCP cho Codex
- **Màu chủ đạo xanh lá** (đúng chất Greenbox) cho Cockpit, các trang 3D, thanh máu, SFX và trang giới thiệu.
- **🎯 Bắn rơi khối** (nhóm Blockout game): vẽ bức tường lon / hộp trên bàn (4 màu, mẫu tường / kim tự tháp / tháp / caro / ngẫu nhiên), súng ở giữa, bấm để bắn với vật lý thật, ⚡ bắn tự động, quay video blockout 9:16, rồi copy prompt để Seedance làm đẹp theo chủ đề (kẹo, siêu thị, đồ chơi, công trường, sci-fi).
- **MCP**: khung AI có nút gắn cho **Claude Desktop, Codex, Claude Code** (file cũ được sao lưu). Lệnh mới `gb_smash`.
- **End card / carousel**: bấm phần tử trên khung để kéo (cả khi xem lại take), Shift = khoá trục như After Effects, thẻ xếp chồng khung 16:9.
- **Trang giới thiệu**: vòng quy trình hình tròn; bước UA + AI (chọn hướng & test nhanh, AI lo phần edit râu ria, người lo pacing và kịch bản chơi) và bước AI đa dạng hoá creative; thêm "Tự vẽ map & game blockout".

## Cập nhật 02/11/2026 (đợt 20) — chỉnh từng phần tử end card, carousel xếp chồng, quay mọi tính năng
- **End card + carousel**: app icon, logo / tên game, nút PLAY mỗi cái chỉnh riêng: cỡ, khoảng cách phía trên, lệch X/Y, **điểm neo (anchor) như After Effects**, nút căn giữa phần tử / cả khối, khoảng cách đều. Bấm phần tử trên khung xem trước để chọn và kéo.
- **Carousel** có thêm kiểu **xếp chồng dọc** (vuốt lên/xuống, mũi tên ⌃ ⌄) và **làm mờ video nền**; mặc định logo/icon ở trên, nút PLAY ở dưới.
- **Greenbox Arena tạm dừng** (sẽ làm lại 3D với nhân vật + animation của phần chơi thử). XP vẫn được tính.
- **Trang giới thiệu**: thêm mục "Mọi tính năng" (17 clip quay tự động) và mục "Quy trình của team" (PM → Art → Dev → map 3D → UA → AI, máy làm phần tay chân, người duyệt).

## Cập nhật 02/11/2026 (đợt 19) — giao diện tối có dải màu, chữ Roboto, End card đơn giản, Greenbox Arena
- **Giao diện mặc định** quay lại nền tối, điểm nhấn dải màu tím → hồng → xanh, bo góc 15px. Nút ◐ đổi qua: tối có dải màu → sáng → tối cũ.
- **Chữ tiếng Việt** dùng font Roboto ở mọi trang (hết lỗi dấu).
- **End card** đơn giản như mẫu: nền game làm mờ, app icon, logo (hoặc tên game chữ lớn viền đen), nút PLAY NOW! xanh lá. Vẫn chỉnh được giây, kiểu nảy, chữ nút; xuất .MOV alpha / MP4.
- **Greenbox Arena** (nhóm Giải trí): bóng rổ 60 giây (dẫn bóng, crossover, ném đúng vùng xanh, 3 điểm ngoài vạch) và sút luân lưu 60 giây (ngắm góc, lấy lực, đánh lừa thủ môn).
- **XP**: dùng web càng nhiều càng lên cấp — +2 mỗi phút làm việc, +5 mở tính năng (mỗi ngày), +15 mỗi lần xuất file. Mỗi cấp 1 điểm để nâng kỹ năng (dẫn bóng, ném rổ, lắt léo, ném 3 điểm, lực sút, chính xác, đánh lừa, cứa lòng). Ô ⭐ Lv trên thanh trên cùng mở game.

## Cập nhật 02/11/2026 (đợt 18) — giao diện mới, End card, tự rig xe biết học
- **Giao diện mới (mặc định):** nền trắng, chữ đen, một màu nhấn đỏ, nút bo tròn, phẳng, font Inter / Public Sans. Nút ◐ trên thanh trên cùng chuyển về giao diện tối cũ. Trang hpbar, SFX và các trang 3D đổi theo.
- **Cửa sổ nhỏ:** thanh trên cùng không xuống dòng nữa, danh sách tính năng (kiểu ☰) chỉ còn 1 hàng cuộn ngang, bảng hướng dẫn Clone rig không bị cắt đáy, bảng kích thước ảnh nằm trên thanh trên cùng.
- **End card** (nhóm mới): 🏁 End card đơn giản — thẻ phóng 0 → 100% theo số giây đặt, rồi logo, app icon, tên game, sao, nút PLAY NOW / DOWNLOAD NOW lần lượt bật ra; thêm ảnh của bạn (logo, icon, nhân vật, nền); kéo để đặt; xuất .MOV alpha hoặc MP4. Endcard carousel chuyển vào nhóm này.
- **Xe: ⚡ Tự rig + keyframe** một nút, và **chấm điểm ★ 1–5**. Rig được 4–5 ★ được lưu cùng hình dạng xe; lần sau xe có hình dạng giống, ⚡ Tự rig dùng lại loại xe, bộ phận còn thiếu và thông số đã chỉnh. Xuất / nhập bộ nhớ (.json) để cả nhóm dùng chung. AI (MCP) gọi được `gb_vehicle` `auto_rig` và `rate`.
- **Video FX:** nối nhiều video trên một timeline, chỗ nối tự có chuyển cảnh (đợt 17).

## Cập nhật 01/11/2026 (đợt 16) — nhân vật chibi, Mocap có video mẫu, ảnh lớn có mũi tên

- **Trang giới thiệu (3,5 MB):**
  - Ảnh lớn có mũi tên **‹ ›** và chấm tròn để lướt qua từng ảnh (vuốt trên điện thoại cũng được). Bấm ảnh nhỏ thì nó lên ảnh lớn; bấm ảnh lớn để xem toàn màn hình.
  - Video gắn xương, chơi thử và map 2D→3D quay lại với **nhân vật chibi**.
  - Thêm video **Mocap: video → 3D**: nhân vật chibi đánh theo clip kickboxing.
- **Mocap có video mẫu:** nút **▶ Try the sample video** nạp clip kickboxing có sẵn (`rig3d/samples/mocap-sample.mp4`), thử được ngay không cần video riêng. Bản mockup .zip cũng có clip này (vẫn 4,85 MB).
- Lưu ý: model chibi xuất ra nhìn sang ngang và lơ lửng. Ở bước đầu bấm xoay **Y** (3 lần) cho mặt nhìn về phía trước, rồi **Auto-align to floor**.

## Cập nhật 01/11/2026 (đợt 15) — video demo, AI tự lái theo video, 1 thanh xuất

- **Trang giới thiệu (`introduction.html`, 3,1 MB):**
  - Ảnh chụp đều bằng **tiếng Anh**. Bấm ảnh để xem lớn, lướt ← → hoặc vuốt.
  - Mục mới **"See it in action"** có 5 video:
    - AI qua MCP gắn vô lăng + bàn đạp vào video TruckCliff rồi xuất (file xuất thật).
    - Gắn xương Hero (FBX T-pose).
    - Rig xe ủi `BulldozerAnimated.fbx` bằng 🪄 Tự cắt.
    - Chơi thử Hero.
    - Map 2D → 3D chơi được: AI đọc ảnh layout, bỏ phòng End card.
- **AI tự lái theo video (Lái xe):** AI đọc chuyển động của video: cảnh trượt ngang = đánh lái, hình đổi nhanh / chậm = ga / phanh. Từ đó nó tạo take và xuất video hoàn chỉnh.
  - Lệnh MCP mới `gb_drive`: load → auto → export. Ví dụ nhắn Claude: "gắn vô lăng và bàn đạp vào video này rồi xuất MP4".
- **Chỉ còn 1 thanh xuất video** (thanh trên đầu mỗi tính năng). Khung xuất cũ bên dưới chỉ hiện ra khi đang xuất, để xem tiến trình và lưu file.
- Công cụ quay demo: `dev/axhero/rec.mjs` + kịch bản trong `dev/axhero/scenes/` (cần `python3 serve.py 8080` và ffmpeg).

## Cập nhật 01/11/2026 (đợt 14) — bài nộp AX Hero, vô lăng đơn giản, kích thước ảnh chuẩn, gắn SFX 1 nút

- **Bài nộp AX Hero** (thư mục `ax-hero/`):
  - `Greenbox-Mockup.zip` (4,6 MB): cả tool. Giải nén, bấm đúp `Greenbox-Cockpit.html`, không cần server.
    - Có: Cockpit, overlay, lái xe, gacha, HP bar / Video FX, SFX, gắn xương, xe, chơi thử.
    - Thư viện rút gọn: 11 model mẫu, khoảng 100 animation, vũ khí XP Hero.
    - Mocap cần Internet để tải model nhận dáng.
  - `introduction.html` (0,7 MB): trang giới thiệu VI / EN / 한국어. Đủ 5 mục (ảnh, vấn đề, giải pháp, hiệu quả, giới hạn & nguồn lực) và phần MCP.
  - Làm lại: `python3 dev/axhero/pack.py` (mockup) và `python3 dev/axhero/intro.py` (trang giới thiệu).
- **Vô lăng & bàn đạp:** mặc định chỉ còn **1 vô lăng + 2 bàn đạp**. Taplo, tay cầm, cần số, đồng hồ vẫn bật lại được trong "Ẩn / hiện element".
- **📐 Kích thước ảnh chuẩn để gen:** mỗi tính năng có bảng kích thước ảnh nên gen. Ví dụ: vô lăng 1024×1024, bàn đạp 256×512, thẻ 600×900, rương 1024×1024, icon 256×256. Ảnh là PNG nền trong suốt, chừa lề ~8%.
- **Danh sách tính năng gập / mở được:** bấm tên nhóm (Overlay gameplay, Lái xe, Gacha…) để gập. Lần sau mở vẫn giữ trạng thái.
- **Thanh máu:** nút chính là **⬇ .MOV alpha (không nền)**. Thay cho keyframe trong After Effects: kéo thẳng lên video, không cần Keylight.
- **Gắn SFX 1 nút:** bấm chọn âm thích, rồi bấm **⚡ Gắn âm đang chọn vào TẤT CẢ điểm va chạm**. Bấm lại không bị trùng.
  - Qua MCP, nhắn Claude ví dụ "gắn tiếng coin vào mọi điểm va chạm rồi xuất MP4". Lệnh mới `gb_sfx`: load → analyze → add_all → export.

## Cập nhật 01/11/2026 (đợt 13) — 🪄 tự cắt bộ phận xe, sửa gàu xúc bị nhận là bánh, xích mượt, chân không chìm

- **🪄 Tự cắt tất cả bộ phận** (nút đầu tiên ở bước 4 trang Xe): một cú bấm tự tìm theo HÌNH DẠNG, không cần tên trong file:
  - **Bánh xe:** mảnh tròn thật, sát đất, ở hai bên.
  - **Xích:** dải chạy vòng quanh 2+ bánh mỗi bên.
  - **Lưỡi ủi / gàu xúc:** mảnh rộng, thấp, nhô ra trước (hoặc sau) thân. Có thanh dài nối từ thân tới nó thì là **gàu + tay nâng** (gàu đi theo tay nâng).
  - **Tháp pháo + nòng** (xe xích có nòng dài), **cánh quạt** (đĩa phẳng trên nóc).
  - Phần nào hàn dính thân thì tự cắt ra mesh riêng và vá lỗ, rồi dựng rig và chạy thử ngay.
  - Sai phần nào: bấm vào phần đó rồi chọn lại bằng phím 1–8, hoặc dùng ⬚ 4 điểm.
- **Gàu xúc / cabin bị gắn vòng bánh xe và quay như bánh (xe xúc lật):**
  - Nguyên nhân: chỉ xét khung hộp "gần vuông khi nhìn ngang" nên gàu, cabin cũng lọt.
  - Sửa: thêm phép thử **tròn thật**: các điểm của mảnh không được lấp góc hộp (bánh/trống thì không, gàu/cabin thì có). Bánh còn phải sát đất. Áp dụng cho quét bánh, copy rig và bánh trong xích. Xích vì vậy cũng chỉ chạy quanh bánh thật, không dính sang gàu.
  - Sửa thêm: xe có 2 dải xích to từng bị tưởng là "2 xe trong một pack" và bỏ mất một nửa xe.
- **Xích bị răng cưa / gãy khi chạy:**
  - Nguyên nhân: mỗi mắt xích rời bị chia cho 2 xương, nên khi vòng qua bánh răng mắt xích bị bẻ cong.
  - Sửa: xích làm từ các mắt rời thì **mỗi mắt có một xương riêng** và đi cứng theo xương đó (Bulldozer 27–38 mắt mỗi bên).
- **Chỉnh số đốt xích (vòng xương):** chọn phần ⛓ Xích, kéo thanh **"Số đốt xích"** (0 = tự động). Thả ra là dựng lại rig và chạy thử. Muốn một vòng xương quay tròn cho thứ khác (băng chuyền, xích cẩu…): khoanh vùng nó bằng ⬚ 4 điểm, chọn phím **5 (Bánh xích)**, xương tự xếp thành vòng theo hình của vùng đó và có sẵn animation chạy vòng.
- **Chân Jay (và nhân vật chân dài khác) chìm xuống đất:**
  - Nguyên nhân: độ cao hông trong animation làm cho khung gốc; chân của model dài hơn thì bàn chân lún.
  - Sửa: mỗi animation được chạy thử trên khung thật. Nếu bàn chân thấp hơn mặt đất lúc đứng yên thì nâng hông lên đúng bằng phần lún. Animation nhảy vẫn giữ nguyên.
- **Sửa lỗi:** cắt mesh rất lớn bị lỗi "Maximum call stack"; mở file mới không còn giữ kiểu xe (xích) của file trước; tên bộ phận đổi thì phần treo trên nó vẫn theo đúng.

## Cập nhật 01/11/2026 (đợt 12) — sửa xe bị xé khi chạy, sửa khung XP Hero gắn sai trên nhân vật khác

- **Xe bị xé khi chạy sau khi copy rig:**
  - Nguyên nhân 1: bộ clone gán bộ phận cho TỪNG ĐIỂM, nên một mảnh (thanh khung, tấm thép) bị chia nửa cho bánh, nửa cho thân. Bánh quay là kéo rách mảnh đó.
  - Sửa: mỗi mảnh rời đi theo TRỌN một bộ phận (bộ phận chiếm đa số điểm trong mảnh). Chỉ khi một mảnh hàn liền chiếm phần lớn cả xe thì mới chia theo từng điểm.
  - Chỉ mảnh có hình TRÒN mới thành bánh; thanh, tấm, khung bị gán nhầm vào bánh thì trả về thân.
  - Nguyên nhân 2: xích hàn liền với thân trong cùng một mesh (`Bulldozer.glb`).
  - Sửa: sau khi copy rig, bộ phận nào còn dính tam giác với bộ phận khác sẽ tự được cắt thành mesh riêng và trám lỗ, rồi mới dựng rig.
  - Đã thử: `BulldozerAnimated.fbx` → `bulldozer.fbx` và thẻ "Xe ủi" → `Bulldozer.glb` đều còn **0 đường nối xé**; xích, lưỡi ủi chạy sạch (răng cưa trên xích là hình mắt xích có sẵn của model).
- **Khung XP Hero gắn hỏng trên nhân vật khác:**
  - Nguyên nhân: bộ đo cơ thể chỉ hiểu tên xương kiểu Greenbox (upperarm_l, thigh_l…). Khung XP Hero dùng tên kiểu Mixamo (LeftArm, LeftUpLeg, Spine1…) nên chỉ bị phóng to cả khối, khớp lệch hẳn khỏi cơ thể.
  - Sửa: thêm bảng đối chiếu tên kiểu Mixamo / Unity → khớp vai, khuỷu, cổ tay, hông, gối, chân, cột sống, cổ, đầu được đặt theo cơ thể như khung người chuẩn. Khung Mixamo khác cũng được lợi.
  - Đã thử trên jay (chibi): khớp đúng chỗ, chạy animation không méo. Xương áo choàng / đuôi / vũ khí không lấy da của người không có áo choàng / đuôi.

## Cập nhật 31/10/2026 (đợt 11) — tối ưu cho Mac, clone rig một chạm

- **Trackpad Mac** (mọi trang 3D: Dùng model, Dùng model đã rig, Xe, Mocap, Chơi thử; và bản đồ 2D):
  - **Vuốt 2 ngón = xoay khung nhìn**, không cần chuột phải hay chuột giữa.
  - **Shift + vuốt 2 ngón = dời.**
  - **Chụm 2 ngón = zoom mượt.**
  - Chuột thường vẫn như cũ (lăn chuột để zoom).
  - Ở bản đồ 2D, vuốt 2 ngón để dời bản đồ, chụm để zoom.
  - Lần đầu mở mỗi trang trên Mac sẽ hiện một dòng nhắc thao tác vài giây.
- **🧬 Clone rig một chạm:**
  - Thả **model mới chưa có xương** vào ô bước 1, lưới **rig có sẵn** hiện ra: Người, Cáo, Chim, Rồng, Kaiju, Nhện, Rắn, Cá, Ngựa, XP Hero, Snake Clash, kèm các rig bạn đã dùng trước đây (có animation).
  - **Bấm một ô là xong:** tự đặt khớp vào model, skin, rồi sang bước xuất với đủ animation. Đã thử: model người + "Human" ra 178 animation.
  - Muốn chỉnh khớp trước thì tick "Dừng ở bước khớp".
  - Thả file **có xương** thì vẫn như cũ (lấy xương + animation của file đó).

## Cập nhật 31/10/2026 (đợt 10) — trang Xe gọn theo 5 bước, máy ủi / xích, XP Hero, Snake Clash, chuyển cảnh

- **Trang Xe sắp lại theo đúng thứ tự làm việc:**
  1. **Rig mẫu để copy:** 15 thẻ xe mẫu (thêm "Xe khoan"), hoặc "⬆ Xe ĐÃ có rig", hoặc "— Không dùng".
  2. **Xe của bạn (chưa rig):** nút tải lên, xoay / lật, danh sách vật trong file. File có nhiều xe (ví dụ bộ 10 xe `fab.fbx`) thì có nút chọn từng chiếc.
  3. **Copy rig:** tự chạy khi đủ bước 1 và 2.
  4. **Chỉnh bộ phận:**
     - Chỉ còn ⬚ Chọn 4 điểm và 🖌 Paint weight.
     - Chọn xong, menu hỏi "Đây là bộ phận gì?": mui xe (capo), bánh xe, cửa xe (tự kèm kính và tay nắm bên trong khung), cốp xe, bánh xích, mũi khoan, lưỡi ủi / gàu, cabin xoay. Phím 1–8 cũng chọn được.
     - Danh sách bộ phận ghi bằng chữ dễ hiểu ("Bánh trước trái", "Cửa sau phải", "Bánh xích trái"…), không còn wheel_FR.
     - Cửa / cốp chỉnh đơn giản: góc mở, ▶ Thử, mở chiều ngược, bản lề.
  5. **Thử animation & xuất:** chỉ hiện khi xe đã có rig.
  - Mọi công cụ cũ vẫn còn, gom trong "⚙ Nâng cao" (đóng sẵn).
- **Máy ủi / xe xích (đã thử với 4 file của bạn):**
  - Đọc thêm tên "Whell" (viết sai), "Ladle" (lưỡi ủi), "Hydraulics" (xi-lanh), "drill / auger" (mũi khoan).
  - Tên mesh vô nghĩa (pPipe2, polySurface…) thì đọc tên node cha ("track_anim_grp", "wheel_stuff").
  - Bộ phận có tên rõ ràng được ưu tiên hơn bánh đoán. Xe có xích thì bỏ bánh đoán; khung xích ("track_foundament") tính là thân.
  - Bánh tròn nằm trong vòng xích tự quay theo.
  - Clone giữ lại xích có tên sẵn của xe đích.
  - `bulldozer.fbx`: 2 dải xích (27 mắt), lưỡi ủi, 19 animation, xích chạy liền không rách.
  - Clone `BulldozerAnimated.fbx` (có animation) → `bulldozer.fbx`: 4 bánh xích, 2 tay lưỡi ủi, 2 xi-lanh, 2 dải xích, animation gốc (lưỡi ủi chuyển động).
  - Thẻ mẫu "Xe ủi" → `Bulldozer.glb` (mesh vô danh): 2 dải xích (51 mắt), lưỡi ủi, 8 bánh.
  - Mũi khoan quay quanh trục dài của nó. Có thêm xe mẫu "Xe khoan".
- **Bộ 10 xe hơi `fab.fbx`:** tách đúng 10 xe (mỗi xe một thân và 4 bánh), có nút chọn xe muốn rig.
- **XP Hero (nhân vật):**
  - Thêm vào ô "Skeleton template" và "Reference model" của trang gắn xương.
  - Bộ xương 29 xương (Hips, Spine…, Cape, Tail) và 2 xương gắn vũ khí theo tay, kèm đủ **44 animation** (đánh kiếm, súng, nỏ, chạy, nhảy, chết…).
  - 3 vũ khí của nhân vật (rìu, cuốc, kiếm XP) có trong danh sách vũ khí gắn tay, dùng được cho Human / Kaiju / XP Hero.
- **Snake Clash:**
  - Thêm loại xương "Snake Clash (head, body, tail)": root → đầu (hàm trên + hàm dưới), thân, đuôi.
  - Model mẫu là con rắn cầu vồng ghép đủ 3 phần, kèm animation Idle, eat (há miệng), eat_backup.
  - Rắn mới chỉ cần chọn loại xương này là có rig sẵn.
- **Layout (trang Video FX):**
  - **🎬 Chuyển cảnh kiểu Motion Bro**, 10 kiểu: zoom giật, lia máy (whip), chớp trắng, tối đen, nhiễu glitch, rung máy, xoay, khép tròn, mờ vào / ra, loé sáng.
  - Bấm một kiểu để thêm ở giây đang xem, chỉnh giây / độ dài, ▶ xem lại. Có trên timeline (màu tím) và trong file MP4 xuất ra.
  - Bảng bên gom thành các mục mở / đóng theo thứ tự: Video → Làm mờ / che → Khung ảnh / video → Chuyển cảnh → Viền đỏ → Xuất. Mask đang chọn hiện ngay trong mục của nó.
  - Các trang Thanh máu / Đếm ngược: bấm tiêu đề mục để thu gọn (có ghi nhớ).
- **Script Blender** dựng XP Hero / Snake Clash / vũ khí: `dev/blender/` (xem README trong đó).

## Cập nhật 31/10/2026 (đợt 9) — "train" kỹ phần tay và xe, log bàn giao

- **Trang kiểm tra tự động** (chỉ để phát triển, không thuộc app):
  - `dev/hand-test.html`: chạy auto-rig trên cả 29 mẫu người và chấm điểm từng bàn tay theo 4 tiêu chí: khớp nằm trong da, ngón không dồn cục, đầu ngón tới đầu tay, khớp đi đúng chiều.
  - `dev/vehicle-test.html`: kiểm tra 14 xe mẫu, 8 cặp clone giữa xe mẫu, và file xe thả vào. Các mục kiểm: số bánh, bánh chạm đất, bánh có cặp trái / phải, bộ phận, rig dựng được, animation.
- **Tay: điểm trung bình 79.5 → 92.7 / 100.**
  - Tóc dài che cổ làm máy tưởng eo là cổ, nên tay giang ngang bị bỏ. Giờ máy tìm lại cổ phía trên tay. female_9 / monster_3 / monster_4 từ 35–55 lên 92–100.
  - Tay mảnh không còn bị bỏ qua.
  - Làn ngón không lấn sang ngón cái nữa.
  - Đầu ngón không bị cắt cụt ở tay ít điểm lưới (female_8, female_31 đạt 98).
  - Thấy ít hơn 4 ngón rời mà lòng bàn tay có rõ 4 gờ thì dùng kết quả đo lòng bàn tay (sintel 76 → 99).
- **Xe:**
  - Bánh dự phòng nằm ngang trên nóc / trong cốp không còn bị tính là bánh.
  - Clone từ file rig thật (`car_rig_capoA…fbx`, 23 animation) sang xe khác giờ đúng 4 bánh. Bánh quay khi chạy, trục lái bẻ khi rẽ / drift, capo mở 60°.
  - Sửa 3 lỗi đọc xe nguồn: bộ phận rỗng (từng đếm thành 10 bánh), node gốc bị coi là trục lái, và node trùng tên trong FBX ghi đè lên bánh.
- **Log bàn giao:** `GREENBOX-HANDOFF.md` (cấu trúc, cách build / test, việc đã làm, việc còn mở, điểm số) và `CLAUDE.md` (tài khoản Claude khác mở thư mục này sẽ tự đọc).

## Cập nhật 30/10/2026 (đợt 8) — blur mạnh trên mọi trình duyệt, chọn xong hỏi "mảnh này là gì"

- **Làm mờ (Video FX):**
  - Nguyên nhân mờ yếu: hiệu ứng dùng bộ lọc `filter` của canvas, mà Safari bỏ qua nên không mờ gì; còn ở Chrome, 22 px trên khung 1080 khi xem thu nhỏ trông rất nhẹ.
  - Giờ làm mờ bằng cách thu nhỏ video rồi phóng lại (chạy trên mọi trình duyệt); Chrome làm mịn thêm một lớp.
  - Độ mờ mặc định 50, tối đa 160.
- **Cắt nhanh xe:** chọn xong (bấm mảnh / 4 điểm / khoanh tròn) thì hiện menu "Mảnh này là…":
  - **1** bánh xe · **2** cửa · **3** nắp capo · **4** nắp cốp · **5** cửa cánh chim · **6** cửa mở ngược · **7** tháp pháo · **8** nòng.
  - Ô "Loại khác…" có thêm trống lu, lưỡi ủi, cần, tay xúc, gàu, móc, cánh quạt, càng nâng, ăng-ten, xương tự do.
  - Mảnh được cắt thành mesh riêng, tự fill lỗ, kèm đúng bản lề (ví dụ capo bản lề ở kính lái).
  - Menu còn có ✋ Kéo ra (G) và 🗑 Xoá. Bấm phím số cũng được.

## Cập nhật 30/10/2026 (đợt 7) — xe mẫu gắn thẳng vào xe của bạn, sửa giao diện bị lẹm

- **Xe mẫu → xe của bạn:**
  - Ở trang Xe, chọn xe mẫu trong ô "🧬 Clone rig xe". Xe mẫu hiện ra và chạy thử animation.
  - Bấm ⬆ tải xe CỦA BẠN lên thì rig và animation của xe mẫu được gắn vào ngay (ô "Gắn ngay vào xe tôi tải lên tiếp theo", mặc định bật). Nếu xe của bạn đã có sẵn trên trang, chọn mẫu là áp dụng luôn.
- **Khung 🧬 Clone rig xe nằm đầu trang Xe**, chia 3 bước rõ ràng:
  1. **Rig nguồn**: chọn xe mẫu, hoặc file xe ĐÃ có rig.
  2. **Xe mới của bạn** (chưa có xương): bấm "⬆ Tải xe mới lên".
  3. Đủ cả hai là tự áp dụng.
  - Mỗi bước có dòng ✓ cho biết đang dùng gì.
  - Lỡ tải xe chưa rig vào ô nguồn (không có xương, không có animation) thì tự được dùng làm xe mới, không bị ngược.
- **Bảng 🧬 Clone rig (trang gắn xương):**
  - Có ô "Là xe? Dùng xe mẫu", bấm → để sang trang Xe với mẫu đã chọn.
  - Thả file rig xe (như Mercedes) vào bước 1 sẽ chuyển thẳng sang trang Xe và dùng file đó làm nguồn, không hỏi lại.
- **Giao diện:**
  - Trang "Dùng model đã rig" không còn bị lẹm: độ rộng gọn 320 px chỉ áp cho trang "Dùng model của bạn".
  - Bảng Clone rig không còn mất phần đáy: bước chưa tới chỉ hiện 1 dòng tiêu đề, phần giới thiệu ẩn sau bước 1, tên file dài được cắt "…".

## Cập nhật 30/10/2026 (đợt 6) — cắt nhanh bộ phận xe, bỏ vật thừa, Video FX, đếm ngược theo giờ

- **🧹 Bỏ vật thừa khi nạp file 3D:**
  - **Tab Xe cộ** có mục "Vật trong file": ✕ để xoá, ◎ để chọn, ↺ để lấy lại. Sàn và cảnh ở xa vẫn tự bị bỏ, nhưng giờ hiện gạch ngang và lấy lại được.
  - **Trang gắn xương** (bước tải xương) có mục "🧹 Vật trong model": 👁 ẩn / hiện, ✕ bỏ trước khi rig.
- **✂ Cắt nhanh bộ phận xe** (khung viền hồng ở bước 2):
  - Cách chọn:
    - Bấm vào một mảnh trên model để chọn (màu hồng), Shift+bấm để chọn thêm.
    - Hoặc dùng **⬚ 4 điểm**: bấm 4 góc.
    - Hoặc **◯ Khoanh tròn**: kéo từ tâm ra.
  - Phím tắt:
    - **X**: tách thành bộ phận (loại lấy theo ô loại bộ phận). Mảnh được cắt thành mesh riêng và tự fill lỗ.
    - **Shift+X**: tách thành bánh.
    - **G**: kéo mảnh ra khỏi thân xe. Bấm hoặc Enter để xong, Esc hoặc chuột phải để huỷ.
    - **Delete**: xoá khỏi model (cột đèn, nhà, sàn…).
    - **Esc**: bỏ chọn.
    - **[ / ]**: thu nhỏ / phóng to vòng bánh xe; **O**: ẩn / hiện vòng.
  - Ctrl+Z hoàn tác được mọi bước.
- **🎬 Video FX** (tab thứ 3 của trang Thanh máu / Đếm ngược, mục mới trong Cockpit):
  - **Mask làm mờ** hoặc **vỡ hạt**:
    - 8 hình: chữ nhật, bo góc, tròn, thoi, lục giác, sao, tim, 4 điểm tự do (kéo từng góc).
    - Chỉ vùng trong mask bị mờ; có thanh độ mờ và độ tối.
  - **Tracking:**
    - **🎯 Tự bám vật** từ giây hiện tại tới hết video (dò mẫu ảnh từng khung).
    - Hoặc bật **⏺ Kéo tay ghi mốc**, phát video rồi kéo mask theo vật.
    - Kéo mask ở giây nào thì sửa mốc của giây đó.
    - Đã thử với video có hình vuông chạy chéo: mask bám đúng đến từng pixel.
  - **Khung chứa ảnh / video:** chọn hình khung, bấm ⬆ hoặc kéo thả file vào khung. Ảnh / video chỉ nằm gọn trong khung; có tuỳ chọn lấp đầy / hiện đủ, viền màu, thời gian hiện.
  - **Viền đỏ khi trúng đòn:**
    - Chỉnh màu, độ đậm, độ lấn vào và thời gian mỗi cú.
    - Có danh sách giây trúng đòn (phím **V** thêm tại giây hiện tại), lấy luôn các cú đánh ở trang Thanh máu, và chế độ nhấp nháy liên tục khi sắp chết.
    - Viền cũng hiện ở trang Thanh máu, trang Đếm ngược và trong .MOV alpha.
  - **Xuất:** MP4 ở trang này là video gốc kèm mask, khung và viền đỏ (không có tiếng); .MOV alpha chỉ gồm khung ảnh và viền đỏ.
- **⏱ Đếm ngược theo giờ:**
  - Ô "Từ / đến" nhận 90, 59:30 hoặc 1:00:00.
  - Kiểu số mới: **Tự động** (59 → 59:59 → 1:00:00) và **giờ:phút:giây**.
  - Số dài tự thu nhỏ cho vừa khung. Video dài tối đa 3600 s.

## Hoàn tác / làm lại (undo / redo)

- **Ctrl+Z** (Windows) / **Cmd+Z** (Mac) = hoàn tác; **Ctrl+Shift+Z** / **Cmd+Shift+Z** = làm lại (Ctrl+Y cũng làm lại). Có thêm nút ↶ ↷.
- Có ở:
  - Gắn xương: bước sửa khớp và Paint skin weight. Đã sửa lỗi cũ: Shift làm phím ra chữ "Z" hoa nên Ctrl/Cmd+Shift+Z trước đây không làm lại được.
  - Xe cộ: tô bánh / bộ phận, xoá, tách, đổi loại xe, đặt xương.
  - Chơi thử: địa hình, nước, vật, file, hộp, kéo gizmo, xoay Z, gôm, shot camera.
  - Thanh máu / Đếm ngược: mọi thông số, mốc bị đánh, kéo vị trí.
- Mỗi cú bấm hoặc nét kéo là một bước. Đang gõ trong ô chữ thì phím tắt để trình duyệt tự hoàn tác chữ.
- Code: `rig3d-src/greenbox/common/UndoKeys.ts`.
- Chưa có ở các panel overlay cũ của Cockpit (joystick, tiến hoá, gacha, SFX).

## Mở trên máy (không cần mạng)

Launcher dùng `serve.py` (server nhỏ có tắt cache, cập nhật bản mới là thấy ngay).

Tab **3D · Gắn xương** không chạy khi bấm đúp mở `Greenbox-Cockpit.html` (file://), vì trình duyệt chặn module và việc tải model. Thay vào đó:
- macOS: bấm đúp `Mo-Greenbox.command` (lần đầu: chuột phải → Open).
- Windows: bấm đúp `Mo-Greenbox.bat`.
