# Kế hoạch: nhà nhiều tầng trong Play test (ĐÃ LÀM ngày 05/11/2026, xem Round 53 trong GREENBOX-HANDOFF.md)

Ngày viết: 05/11/2026. Người làm tiếp đọc file này cùng `GREENBOX-HANDOFF.md` (Round 50 = tường / cửa / mái).

## Hiện trạng

- Đã có: tường nhà (`hwall`), cửa, cửa sổ, mái tự khớp phòng kín (`MapEditor.add_roof_at`), mái và tường tự mờ khi nhân vật ở trong nhà (`MapEditor.cutaway`).
- **Chưa có tầng.** Mọi tường đều đặt ở mặt đất, không có sàn trên cao, không có cầu thang. Muốn lên cao hiện chỉ có cách leo: nhân vật leo được gờ cao tới 2.6 m (`CLIMB_MAX`), bước lên bậc cao tới 0.45 m (`STEP`).

## Mục tiêu

Người dùng chọn **Tầng 1, 2, 3…**, dựng tường như bình thường, đặt **sàn** và **cầu thang**, nhân vật đi bộ lên được. Mái tự đặt lên tầng cao nhất. Khi xây hoặc khi nhân vật ở tầng dưới thì các tầng trên tự ẩn, để luôn nhìn được bên trong.

## Cách làm

### Giai đoạn 1: chọn tầng + tường trên tầng + sàn
- Thêm ô **Tầng** (1 – 5) trong Trình sửa map, cạnh bảng vật thể. Mỗi tầng cao **2.8 m** (tường 2.6 m + sàn 0.2 m).
- Khi đang ở tầng N, mọi tường / cửa / cửa sổ / rào đặt ở độ cao `mặt đất + (N − 1) × 2.8`. Bóng mờ (ghost) và việc đặt theo dãy dùng cùng độ cao này.
- Lưu tầng của từng vật trong `map_extra.lv`. Độ cao đã nằm trong `p[1]` nên file .json cũ vẫn mở được (thiếu `lv` = tầng 1).
- Vật mới **Sàn**: bấm vào trong một phòng kín ở tầng N (N ≥ 2) → tấm sàn dày 0.2 m phủ đúng phòng. Dùng lại thuật toán flood fill của mái, chỉ xét tường của tầng bên dưới.
- `add_roof_at` chỉ xét tường của tầng đang chọn, và đặt mái lên đỉnh tầng đó.

### Giai đoạn 2: cầu thang
- Vật mới **Cầu thang**: dài 3 ô lưới (4.5 m), rộng 1 ô (1.5 m), 14 bậc × 0.2 m = 2.8 m (mỗi bậc thấp hơn `STEP` 0.45 m, nên nhân vật tự bước lên, không cần nhảy). Có tay vịn hai bên.
- Đặt bằng một cú bấm, phím Z xoay 90°. Đầu trên của cầu thang tự **khoét lỗ** trong tấm sàn của tầng trên (sàn được dựng lại thành các mảnh bao quanh lỗ), để nhân vật không đụng đầu.
- Phương án nhỏ hơn nếu cần nhanh: **thang leo** (ladder) dùng cơ chế leo sẵn có.

### Giai đoạn 3: nhìn xuyên tầng
- Lúc xây: các tầng **cao hơn** tầng đang chọn mờ đi (giống The Sims).
- Lúc chơi: biết nhân vật đang ở tầng nào (từ độ cao chân); khi ở trong nhà, mọi tầng phía trên và mái mờ đi. Mở rộng `cutaway()`, không cần hệ thống mới.

### Giai đoạn 4: hoàn thiện
- Xuất Blender (.py) và GLB có sàn và cầu thang.
- Lệnh AI `gb_map`: `add` nhận thêm `level`, `floor`, `stairs`.
- Thêm bước "Nhiều tầng" vào hướng dẫn (tour) của Play test; cập nhật README, bản dịch, log handoff.

## Kiểm tra sau khi làm
- Dựng nhà 2 tầng 12 × 9 m có cầu thang, nạp nhân vật mẫu `rig3d/animations/human-base-animations.glb`: đi từ cửa vào, lên cầu thang tới tầng 2 không cần nhảy, không kẹt đầu.
- Mái đặt đúng đỉnh tầng 2. Khi đứng ở tầng 1 thì tầng 2 và mái mờ đi.
- Lưu .json → mở lại → giống hệt. File .json cũ (chưa có tầng) vẫn mở được.
- Nhân vật ở cỡ 0.5× và 2× (📏 Kích thước) vẫn lên được cầu thang. Cần kiểm tra kỹ: `World.ground_at` dùng `STEP` 0.45 m cố định, còn `World.block` nhân `STEP` theo cỡ nhân vật, nên ở cỡ nhỏ bậc 0.2 m có thể bị coi là tường.

## Cần bạn chọn trước khi làm
1. Chiều cao mỗi tầng: cố định 2.8 m hay cho chỉnh?
2. Cầu thang thẳng (đẹp, chiếm chỗ 4.5 m) hay thang leo (gọn, làm nhanh)? Hay cả hai?
3. Tối đa mấy tầng (đề xuất 5)?

Ước lượng: giai đoạn 1 + 2 là phần chính, sau đó build và test như các đợt trước.
