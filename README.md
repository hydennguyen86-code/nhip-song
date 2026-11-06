# Nhịp Sống

Ứng dụng web cho cả nhà xem mỗi sáng: **hôm nay cơ thể hồi phục tới đâu và nên làm gì**. App chạy trên một máy Mac trong nhà, mọi người mở bằng trình duyệt trên điện thoại. Dữ liệu nằm trên máy của bạn.

App **cần HRV rMSSD mỗi đêm**. Không có HRV thì không có điểm và không có lời khuyên, vì HRV là tín hiệu chính của thuật toán (xem [Thiết bị dùng được](#thiết-bị-dùng-được)). Số đi vào tự động theo đường **đồng hồ HUAWEI → Health Sync → Intervals.icu → Nhịp Sống**. Nhập tay chỉ để bù một số còn thiếu trong ngày.

> Đây **không phải WHOOP** và **không phải thiết bị y tế**. Điểm 0–100 là chỉ số tham khảo có công thức công khai, tính theo mức nền của chính bạn. Cảm giác của bạn luôn được ưu tiên hơn số đồng hồ.

<img src="docs/images/tong-quan.jpg" alt="Trang Hôm nay trên máy tính với điểm hồi phục, kết luận, số của hôm nay và phần giải thích điểm" width="760">

*Mọi ảnh trong README đều chụp từ dữ liệu giả, không phải dữ liệu sức khoẻ thật.*

## Tính năng

| Nhóm | App làm được gì |
| --- | --- |
| **Buổi sáng** | Khi có HRV: điểm hồi phục 0–100 và một hành động cụ thể cho hôm nay: giữ kế hoạch, giảm tải, ưu tiên hồi phục hoặc nghỉ |
| **Minh bạch** | Thẻ *Vì sao điểm này?* nêu từng yếu tố, số điểm đóng góp, phần còn thiếu và mức tin cậy |
| **Nguồn dữ liệu** | Hai mục *Tự động* và *Nhập tay*. Số đồng bộ thật sẽ thay số tay khi về sau |
| **Nhập tay** | Nhịp tim nghỉ, giờ ngủ, HRV, nhịp thở, điểm ngủ, số bước, SpO2, cân nặng. Quản trị ghi được cho người nhà |
| **Giấc ngủ** | So với nhu cầu của bạn, có kế hoạch tối nay cần ngủ bao nhiêu |
| **Vận động** | Danh sách buổi tập và mục tiêu tải tuần theo mức hồi phục |
| **Cần HRV** | Không có HRV rMSSD thì app không chấm điểm, không gợi ý tập, và nói rõ lý do: thiết bị không đo HRV, đang dựng nền, hay thiếu đêm qua |
| **Cảnh báo** | Nhịp thở tăng cùng nhịp tim nghỉ tăng hoặc HRV giảm thì chặn điểm ở 50. Báo triệu chứng nặng thì ẩn điểm và nhắc gọi 115. HRV cao bất thường (z > 2,5) không được cộng điểm. Số bất thường kéo dài (HRV cao 2 đêm liền, hoặc nhịp tim nghỉ cao 3 ngày liền) chỉ ghi "Nên hỏi bác sĩ" |
| **Xu hướng** | Biểu đồ 7, 30, 90 ngày và mức nền cá nhân. Đánh dấu được số sai để loại khỏi nền |
| **Nhật ký** | Ghi cảm giác và thói quen hằng ngày |
| **Bối cảnh** | Ghi nhanh hôm qua tập gì, mức tạ, xông hơi, cà phê, rượu bia, giờ lên giường, căng thẳng |
| **Quy luật** | Code so sáng hôm sau với ngày có và không có yếu tố đó: HRV theo % và SWC, nhịp tim nghỉ, giấc ngủ, số ngày HRV còn thấp, độ chắc |
| **AI (Haiku 5.5)** | Giải thích hôm nay, hỏi đáp, tóm tắt tuần Chủ nhật. Phân tích quý bằng Sonnet khi bấm |
| **Gia đình** | Mỗi người một tài khoản, dữ liệu tách riêng. Quản trị thấy các số trong form nhập tay của thành viên để nhập hộ, nhưng không xem được điểm, nhật ký hay buổi tập của họ |
| **Riêng tư** | Dữ liệu nằm trên máy Mac của bạn. Chỉ tính năng AI gửi số liệu đã rút gọn ra ngoài. API key Intervals.icu được mã hoá, có sao lưu, nhập CSV, không cần cài thư viện npm |

<img src="docs/images/xu-huong.jpg" alt="Trang Xu hướng với biểu đồ điểm hồi phục, HRV, nhịp tim nghỉ và giấc ngủ" width="760">

## Bắt đầu nhanh

Cần **Node.js 22.5 trở lên**. Người trong nhà chỉ cần trình duyệt, không phải cài gì.

```bash
git clone https://github.com/hydennguyen86-code/nhip-song.git
```

```bash
cd nhip-song
```

```bash
bash scripts/nhip start
```

Lệnh sẽ in địa chỉ để mở trên Mac và trên điện thoại. Lần đầu mở, app yêu cầu **tạo tài khoản quản trị**. Sau đó vào **Cài đặt → Quản lý gia đình** để tạo tài khoản cho từng người.

Muốn bật tính năng AI, làm theo [Cài API key](#cài-api-key-không-đưa-lên-github). Không có key, mọi tính năng khác vẫn chạy.

**Muốn xem thử bằng dữ liệu giả, không đụng dữ liệu thật:**

```bash
NHIP_DATA_DIR=./demo-data node scripts/seed-demo.mjs
```

```bash
PORT=8901 NHIP_DATA_DIR=./demo-data node server/index.mjs
```

Mở `http://127.0.0.1:8901`, đăng nhập bằng `admin`, `demo` hoặc `khonghrv` (người không có HRV, để xem màn hình *Cần HRV*), mật khẩu `demo-1234`. Xong thì xoá thư mục `demo-data`.

## Thiết bị dùng được

**Luật: thiết bị phải đo được HRV rMSSD trong lúc ngủ, và số đó phải về được Intervals.icu.** HRV là tín hiệu chính của thuật toán. Nhịp tim nghỉ và giấc ngủ một mình không đủ nhạy để cho phép tập nặng, nên app không đoán khi thiếu HRV.

| Thiết bị | Dùng được? |
| --- | --- |
| Đồng hồ HUAWEI (ví dụ Watch Fit 4 Pro) qua **Health Sync → Intervals.icu** | **Có.** Intervals.icu nhận HRV dạng rMSSD |
| Mi Band 1–7, Xiaomi Smart Band 7 Pro, 8, 8 Pro, 9, 9 Pro, 10 (bản thường) | **Không.** Các đời này không đo HRV |
| Xiaomi Smart Band 10 Pro, Smart Band 11 bản Trung Quốc | **Chưa hỗ trợ.** Có HRV khi ngủ, nhưng Xiaomi không nói là rMSSD hay SDNN, nên không so được với mức nền |
| Xiaomi Smart Band 11 bản quốc tế | **Chưa hỗ trợ.** Trang sản phẩm quốc tế không ghi HRV |

Apple Health **không** nằm trong đường dữ liệu: Apple Health lưu HRV dạng SDNN, là một đại lượng khác rMSSD và không đổi qua lại được. App chỉ dùng rMSSD; nếu nguồn có gửi SDNN thì chỉ lưu, không tính.

Khi chưa có HRV, trang Hôm nay hiện thẻ **Cần HRV** với một trong ba lý do:

- **Thiết bị không gửi HRV**: không có đêm rMSSD nào trong 60 ngày.
- **Đang dựng nền**: có HRV nhưng chưa đủ 14 đêm, app hiện tiến độ `x/14 đêm`.
- **Thiếu HRV gần đây**: có nền nhưng thiếu đêm qua và chưa đủ 3 đêm trong 7 ngày.

| Màn hình Cần HRV | Người quản trị nhập hộ | Mục Tự động khi còn thiếu số |
| --- | --- | --- |
| <img src="docs/images/can-hrv.jpg" width="220" alt="Thẻ Cần HRV khi thiết bị không gửi HRV"> | <img src="docs/images/quan-tri-ghi-cho.jpg" width="220" alt="Ô Ghi cho để quản trị chọn người cần nhập"> | <img src="docs/images/tu-dong.jpg" width="220" alt="Mục Tự động báo số còn thiếu và nút nhập tay phần thiếu"> |

## AI phân tích (Claude Haiku 5.5)

AI trong app **chỉ diễn đạt lại**. Điểm, kết luận và quy luật đều do code tính. AI chỉ đọc các con số đó rồi viết vài câu tiếng Việt.

Có ba lớp:

1. **Điểm hằng ngày** do code tính theo công thức ở mục 7.1. **Không dùng AI.**
2. **Quy luật** do code tính theo thống kê (xem [Ghi bối cảnh và đọc quy luật](#ghi-bối-cảnh-và-đọc-quy-luật)). AI chỉ đọc bảng kết quả và viết lại.
3. **Giải thích hôm nay, hỏi đáp và tóm tắt tuần** dùng **Claude Haiku 5.5**. Tóm tắt tuần có từ 18h Chủ nhật. **Phân tích quý** dùng **Sonnet 5.5**, chỉ chạy khi bạn bấm.

### Dữ liệu gửi cho AI

Gói dữ liệu chỉ có **số và nhãn**:

- Ngày, điểm hồi phục, mức, độ tin cậy, kết luận của code, và có cần HRV hay không.
- Từng yếu tố: tên, giá trị, mức nền, z, trạng thái. Có cờ nếu HRV cao bất thường.
- Số liệu theo ngày: HRV, nhịp tim nghỉ, giờ ngủ, điểm. Lấy 14 ngày gần nhất. Hỏi đáp lấy 28 ngày, phân tích quý lấy 90 ngày.
- Bối cảnh các ngày, dạng nhãn như "Tập chân" hay "Cà phê 3 ly". Trường riêng tư không bao giờ được gửi.
- Quy luật: tên yếu tố, số lần, độ chắc, số liệu sáng hôm sau.
- Dòng "nên hỏi bác sĩ" nếu có.

**Không bao giờ gửi**: tên, tên đăng nhập, ghi chú tự do, triệu chứng, bệnh sử.

Khi hỏi đáp, **câu hỏi bạn gõ cũng được gửi đi**. Đừng gõ tên người hay thông tin cá nhân vào đó.

### Rào an toàn

Các lớp này nằm trong code, không chỉ là lời nhắc gửi cho AI:

- **Câu hỏi y khoa** (thuốc, bệnh, chẩn đoán) được trả lời ngay trên máy: "nên hỏi bác sĩ". **Không gọi API.**
- **Câu trả lời của AI được lọc theo từng câu.** Câu nhắc đến chủ đề y khoa, hoặc giục "đẩy mạnh", "tăng tạ", đều bị bỏ. Nếu không còn câu nào, app hiện một câu cố định.
- **Lời nhắc "nên hỏi bác sĩ"** do `alerts.mjs` tạo, không do AI tạo.
- AI **không có công cụ** nào. Nó chỉ trả về chữ. Nó không đổi được lịch tập hay bất kỳ số liệu nào.

### Chi phí và giới hạn

- Giá dùng để ước tính chi phí trong app, tính theo USD cho mỗi triệu token (prompt tối đa 100k token):
  - **Haiku 5.5**: $0,10 đầu vào, $0,50 đầu ra.
  - **Sonnet 5.5**: $2 đầu vào, $10 đầu ra.
- **Kết quả được lưu lại**, nên không gọi lại khi dữ liệu không đổi:
  - Giải thích hôm nay: lưu theo ngày và dữ liệu. Dữ liệu đổi thì tính lại.
  - Tóm tắt tuần: lưu theo tuần.
  - Phân tích quý: lưu theo ngày và dữ liệu.
  - Hỏi đáp **không** lưu, nên mỗi câu tốn một lượt. Câu hỏi y khoa trả lời trên máy thì không tốn.
  - Kết quả lấy từ cache không tốn lượt.
- **Giới hạn mặc định**:
  - 15 lượt mỗi người mỗi ngày.
  - 80 lượt cả server mỗi ngày.
  - Phân tích quý (Sonnet): 2 lần mỗi người mỗi tháng.
  - Tất cả chỉnh được trong `.env`, xem `.env.example`.
- Mức dùng và chi phí ước tính hiện trong **Cài đặt**.
- Nên đặt thêm **giới hạn chi tiêu hằng tháng** cho workspace Anthropic trong **Claude Console**. Đó là lớp bảo vệ thứ hai, ngoài giới hạn của app.

## Cài API key (không đưa lên GitHub)

Tính năng AI cần API key của Anthropic. Key chỉ nằm trong file `.env` trên máy Mac chạy server. Các tính năng khác không cần key.

Trong thư mục app, trên Mac chạy server:

```bash
cp .env.example .env
```

Mở `.env` và điền dòng:

```
ANTHROPIC_API_KEY=...
```

Thay `...` bằng key của bạn. Sau đó khởi động lại:

```bash
bash scripts/nhip restart
```

Quy tắc:

- `.env` nằm trong `.gitignore`, không được đưa lên GitHub.
- Chỉ server đọc key. Key **không** gửi xuống trình duyệt, **không** lưu trong database, **không** ghi vào log.
- App **không có ô nhập key trên web**. Đây là thiết kế có chủ đích.
- Không dán key vào chat, commit hay ảnh chụp màn hình. Nếu lỡ dán, vào Claude Console thu hồi key đó rồi tạo key mới.

## Ghi bối cảnh và đọc quy luật

Bối cảnh là những việc xảy ra trong ngày: buổi tập, mức tạ, xông hơi, cà phê, rượu bia, giờ lên giường, căng thẳng. App dùng chúng để xem các buổi sáng sau đó khác đi thế nào.

### Cách ghi

- Trang **Hôm nay** có thẻ **"Hôm qua bạn đã làm gì?"** ngay dưới thẻ *Số của hôm nay*. Chạm chọn là xong, khoảng 15 giây. Dải 14 chấm bên dưới cho thấy ngày nào còn thiếu.
- Ghi theo **ngày việc đã xảy ra**. Buổi chân hôm qua thì ghi vào hôm qua.
- Tác động được đọc vào **các buổi sáng +1, +2, +3** sau đó. Ví dụ: tập chân hôm nay, app xem HRV và giấc ngủ của 3 buổi sáng kế tiếp.
- Ghi bù được tối đa 60 ngày trước.
- Ngày **chưa ghi** bối cảnh không được tính là "không có yếu tố". Buổi sáng chỉ được dùng khi 3 ngày trước đó đều đã ghi, nên **ghi đều mỗi ngày** quan trọng hơn ghi thật chi tiết.
- Kết quả xem ở tab **Quy luật**.

**Trường ghi triệu chứng sau tập** là trường riêng tư. App chỉ đếm số ngày có đánh dấu trong 90 ngày gần nhất, để bạn đưa cho bác sĩ. App **không phân tích** trường này và **không gửi** cho AI.

### Cách app đọc quy luật (bằng lời thường)

- Mỗi buổi sáng được so với **mức nền của chính bạn**: HRV, nhịp tim nghỉ, giấc ngủ.
- App tính **cùng lúc mọi yếu tố** bằng hồi quy theo độ trễ: buổi sáng = mức chung + ảnh hưởng của từng yếu tố xảy ra 1, 2, 3 ngày trước. Nhờ vậy ảnh hưởng của tập chân được tách khỏi pickleball hay tập ngực nếu chúng hay đi liền nhau. (Cách so "ngày có / ngày không có" đơn giản bị nhiễu: ngày đối chứng của tập ngực lại toàn ngày sau tập chân, nên tập ngực trông như làm HRV *tăng*.)
- Mỗi con số có **khoảng tin cậy 95%**. Khoảng nằm hẳn một phía của 0 thì mới gọi là khác biệt rõ. Yếu tố có dưới 4 lần thì chưa tính.
- **1 SWC** là mức thay đổi HRV nhỏ nhất có ý nghĩa, bằng nửa độ lệch chuẩn của chính bạn.
- Kết quả là **mô tả trên dữ liệu của bạn, không phải nhân quả**.
- Nếu một yếu tố khác xuất hiện trong **ít nhất 40%** số lần và nhiều hơn hẳn bình thường (≥ 1,5 lần tỉ lệ thường ngày), app ghi là "thường đi kèm" để bạn biết hai thói quen hay đi cùng nhau. Nếu chúng **luôn** đi cùng nhau thì không thuật toán nào tách được; muốn biết riêng thì thỉnh thoảng làm tách ra.

Mức độ chắc, theo HRV sáng hôm sau:

| Mức | Khi nào |
| --- | --- |
| **rõ** | Ít nhất 8 lần có yếu tố, khoảng tin cậy **99%** không chứa 0 (chặt hơn vì app thử nhiều yếu tố cùng lúc), chênh lệch ≥ 1 SWC |
| **có thể** | Chênh lệch ≥ 1 SWC nhưng ít hơn 8 lần, hoặc khoảng tin cậy còn chứa 0 |
| **chưa thấy ảnh hưởng** | Ít nhất 8 lần, chênh lệch dưới 0,5 SWC, khoảng tin cậy nằm trong ±1 SWC |
| **chưa rõ** | Các trường hợp còn lại, kể cả khi yếu tố **luôn trùng** với một yếu tố khác ("chưa tách được", ví dụ lịch cứng: tuần nào tập vai cũng đúng 2 ngày trước tập chân) |
| **chưa đủ dữ liệu** | Dưới 4 lần có yếu tố, hoặc chưa đủ buổi sáng có 3 ngày ghi bối cảnh liền trước |

> **Thật thà về tốc độ.** Buổi tập chân khoảng một lần mỗi tuần. Để đủ 8 lần, cần ghi đều đặn khoảng 2–3 tháng. Trước đó, kết quả thường chỉ ở mức "có thể", "chưa rõ" hoặc "chưa đủ dữ liệu". Đó không phải lỗi của app.

---

## 1. Chạy lần đầu trên Mac

Xem [Bắt đầu nhanh](#bắt-đầu-nhanh) ở trên. Lệnh start in ra:

- URL trên chính Mac: `http://127.0.0.1:8899`
- URL cho iPhone cùng Wi-Fi: `http://192.168.x.x:8899` (đọc từ `ipconfig getifaddr en0`)
- URL qua Tailscale nếu cả nhà dùng từ xa ([mục 18](#18-truy-cập-từ-xa-bằng-tailscale-tuỳ-chọn))

Nếu Node không có sẵn:

```bash
brew install node
```

Node nằm ngoài `PATH` thì đặt `NHIP_NODE` trỏ tới file chạy `node`.

Với HUAWEI Watch, dữ liệu đi theo đường HUAWEI Health → Intervals.icu, và HRV qua Health Sync. App **chỉ đọc**, không bao giờ sửa hoặc xoá dữ liệu trên Intervals.icu.

## 2. Lệnh vận hành

| Lệnh | Ý nghĩa |
| --- | --- |
| `bash scripts/nhip start` | Khởi động app (chạy nền) |
| `bash scripts/nhip stop` | Dừng |
| `bash scripts/nhip restart` | Dừng rồi chạy lại |
| `bash scripts/nhip status` | Đang chạy? in `/api/health` |
| `bash scripts/nhip logs [N]` | Xem N dòng log cuối (mặc định 80) |
| `bash scripts/nhip test` | Chạy bộ test unit |
| `bash scripts/nhip seed` | Nạp dữ liệu giả để xem UI |
| `bash scripts/nhip backup` | Sao lưu database + secret.key sang `backups/` |

Bật lại sau khi Mac khởi động: thêm `bash <thư-mục-app>/scripts/nhip start` vào *System Settings → General → Login Items* (dạng script, dùng Shortcut app hoặc launchagent tuỳ bạn). Không cần cài lại gì, dữ liệu nằm trong `data/`.

## 3. Tạo tài khoản

**Lần chạy đầu, chưa có ai** → app tự hiện form tạo admin. Điền tên đăng nhập (chữ thường, 3–32 ký tự), tên hiển thị và mật khẩu (≥ 6 ký tự, số cũng được).

**Thêm người nhà**: admin đăng nhập → tab **Cài đặt** → phần *Quản lý gia đình* → nhập tên đăng nhập, tên hiển thị và mật khẩu tạm. Người nhà mở app bằng URL LAN, đăng nhập bằng mật khẩu tạm, **app bắt buộc đổi mật khẩu lần đầu**.

Admin **không** mặc định xem được điểm, nhật ký hay buổi tập của thành viên. Mọi endpoint trả dữ liệu đều lọc theo user_id của phiên đăng nhập. Ngoại lệ duy nhất là thẻ nhập tay: admin chọn được người ở ô *Ghi cho* để nhập hộ, nên thấy 30 ngày gần nhất của 8 chỉ số trong form đó. Tính năng chia sẻ chủ động (người sở hữu cho phép rồi thu hồi) để ở giai đoạn sau.

## 4. Kết nối Intervals.icu cho từng người

Mỗi người tự làm 4 bước này, **không gửi key cho ai** (kể cả qua chat):

1. Mở `https://intervals.icu/settings` bằng tài khoản Intervals.icu của chính mình.
2. Kéo xuống cuối trang, mục **Developer Settings** — ở đó có **API Key** (chuỗi ~25 ký tự) và **Athlete ID**. Copy cả hai.
3. Ghi nhớ **Athlete ID** (dạng `i123456`, thấy ở cùng trang).
4. Trong app Nhịp Sống, tab **Cài đặt → Kết nối Intervals.icu**, dán Athlete ID và API key → bấm **Lưu và thử kết nối**.

App sẽ gọi `GET /api/v1/athlete/{id}` để xác minh key. Key lưu trong SQLite đã mã hoá **AES-256-GCM**, với khoá nằm ở `data/secret.key` (quyền 0600, `.gitignore`). Key không bao giờ ghi ra log, không nằm trong frontend, không nằm trong backup JSON.

Đồng bộ kéo `wellness` và `activities` theo khoảng ngày; lần đầu lấy 120 ngày để có đủ 30 ngày nền.

## 5. Đồng bộ

- **Thủ công**: nút *Đồng bộ ngay* trong thẻ *Số của hôm nay*, mục *Tự động*.
- **Tự động**: admin đặt giờ (mặc định **06:30 Asia/Ho_Chi_Minh**) trong tab Cài đặt. Máy Mac phải bật và app phải chạy thì lịch mới kích hoạt.
- Sync lỗi (key sai, timeout, rate limit) → hiển thị thông báo nhưng **giữ nguyên dữ liệu cũ**.

### Tự động hay nhập tay

Buổi sáng không phải chờ Intervals.icu. Trang **Hôm nay** có thẻ **Số của hôm nay** với hai mục, người dùng tự chọn. Mỗi máy nhớ lựa chọn riêng; chưa chọn thì có kết nối Intervals.icu sẽ mở **Tự động**, chưa có sẽ mở **Nhập tay**.

- **Tự động**: hiện số hôm nay đã có và số còn thiếu (HRV rMSSD, nhịp tim nghỉ, giấc ngủ). Còn thiếu thì app tự hỏi Intervals.icu khi mở trang, tối đa 15 phút một lần, và có nút *Nhập tay phần thiếu*.
- **Nhập tay**: điền cả ngày trên một form. Kết luận buổi sáng tính lại ngay sau khi lưu.

Dù chọn mục nào, khi Intervals.icu có số thật cho đúng ngày, **số thật thay số tay**.

HRV đi vào tự động qua Health Sync → Intervals.icu. Form nhập tay để bù một ngày còn thiếu số, gồm:

| Chỉ số | Đơn vị, khoảng nhận | App dùng vào |
| --- | --- | --- |
| Nhịp tim nghỉ | 30–110 bpm | Điểm hồi phục (25%), cần ≥ 7 ngày nền |
| Giờ ngủ | giờ + phút, tối đa 16 giờ | Điểm hồi phục (30%) |
| HRV rMSSD | 1–300 ms | **Bắt buộc để có kết luận.** Điểm hồi phục (45%), cần ≥ 14 ngày nền. Không nhập SDNN |
| Nhịp thở khi ngủ | 6–30 lần/phút | Chỉ là cờ cảnh báo, cần ≥ 7 đêm nền |
| Điểm ngủ | 0–100 | Hiển thị, xu hướng |
| Số bước | số nguyên | Hiển thị, xu hướng |
| SpO2 | 70–100% | Xu hướng |
| Cân nặng | 20–300 kg | Xu hướng |

Quy tắc:

- Chọn **ngày thức dậy**. HRV rMSSD là bắt buộc để ngày đó có kết luận; các ô khác điền nếu có. Một ô sai thì cả form không lưu.
- Tài khoản **quản trị** chọn người ở ô **Ghi cho**. Thành viên thường chỉ ghi cho chính mình. Có thể nhập bù tối đa 30 ngày.
- Số tay vào ngay điểm hồi phục và mức nền. Để trống ô `tự nhập` rồi lưu là xoá số đó; số đồng bộ không bị đụng tới.
- Sync trả `null` thì số tay được giữ. Sync hoặc CSV có số thật cho đúng ngày thì **số thật thay số tay**.

## 6. Nhập CSV (nếu chưa muốn đồng bộ API)

Intervals.icu cho phép xuất CSV:

- Wellness CSV: *Settings → Export → Wellness CSV*
- Activities CSV: menu *Activities → Download CSV*

Trong app: tab **Cài đặt → Nhập CSV** → chọn file → bấm *Xem trước & nhập*. App hiển thị **số dòng hợp lệ và khoảng ngày**; chỉ ghi vào DB khi bạn bấm *Xác nhận nhập*. Ngày / activity ID trùng sẽ **cập nhật** (không tạo bản sao). Trường trống trong CSV **không** xoá dữ liệu cũ.

### Nguồn khác nhau về cùng một ngày

Đã gặp: HUAWEI Health hiển thị 5h31, bảng Intervals cũ hiện 28 phút, Wellness CSV ghi 5h59. App **không tự chọn một số làm sự thật**. Cách xử lý:

1. Vào tab **Mức nền** hoặc trang Xu hướng.
2. Bấm dòng ngày bất ổn → *Đánh dấu là sai* và chọn trường (sleep_secs, hrv_rmssd, …).
3. Trường bị đánh dấu sẽ bị loại khỏi phép tính mức nền, nhưng **bản gốc vẫn nằm trong `raw_json`**. Huỷ đánh dấu bất cứ lúc nào.

## 7. Màn hình hôm nay

Trang **Hôm nay** trả lời ba câu: hôm nay nên làm gì, vì sao, và cần ngủ bao nhiêu.

### 7.1 Chỉ số hồi phục 0–100 (công thức công khai, v2 — 30/10/2026)

Vòng lớn ở giữa là **chỉ số hồi phục tham khảo**, không phải điểm WHOOP. Mô hình từng tín hiệu nằm trong `server/signals.mjs`, phép cộng điểm trong `server/recovery.mjs`:

| Thành phần | Trọng số | Cách tính |
| --- | --- | --- |
| HRV rMSSD (**bắt buộc**) | 45% | **ln(rMSSD)**. 60% đêm qua + 40% trung bình 7 ngày, z so với **trung vị 60 ngày** (độ lệch = 1,4826 × MAD, sàn 0,07 ≈ 7%). Báo vùng **SWC** = nền ± 0,5 độ lệch và **CV 7 ngày** (cảnh báo khi ≥ 1,5 × CV thường lệ). |
| Nhịp tim nghỉ | 25% | đêm qua so với **trung vị 30 ngày**, độ lệch MAD (sàn 1 bpm); **đảo dấu** vì cao hơn là xấu |
| Giấc ngủ | 30% | **so với nhu cầu, không so với trung bình của bạn**: % = ngủ / nhu cầu. Nhu cầu = nền (TB 30 đêm, kẹp 7h30–8h30; < 7 đêm thì 8h) + 20% nợ ngủ 7 đêm trước (tối đa 60 phút) + tối đa 45 phút nếu hôm qua tập nhiều hơn TB 28 ngày. 85% nhu cầu = 50 điểm; mỗi 10% ≈ 22 điểm. |
| Nhịp thở | **0%** | **Cờ cảnh báo một chiều**, không cộng điểm. Bật khi đêm qua cao hơn trung vị 30 đêm ≥ max(1,5; 2 × độ lệch) lần/phút. Thở chậm hơn **không** được cộng điểm. Chưa có số → hiện "chưa có số", **không** hạ độ tin cậy. Có thể nhập tay từ HUAWEI Health ở thẻ *Số của hôm nay*, mục *Nhập tay*. |

Mỗi phần đổi thành điểm con `50 + z × 22`, kẹp 2–99 (giấc ngủ: `50 + (% − 0,85) × 220`). Điểm cuối là trung bình có trọng số. **Không có HRV thì không có điểm** và không có lời khuyên. Thiếu nhịp tim nghỉ hoặc giấc ngủ thì **chia lại trọng số** và hạ độ tin cậy (3/3 = cao, 2 = vừa, 1 = thấp; HRV còn "sơ bộ" < 28 ngày thì tối đa "vừa"). Dải màu: **67–100 sẵn sàng**, **34–66 trung bình**, **0–33 cần hồi phục**.

**Mẫu hình ốm**: nhịp thở tăng **cùng lúc** với nhịp tim nghỉ tăng (z ≥ 1) hoặc HRV giảm (z ≤ −1) → điểm bị chặn ở 50 và kết luận buổi sáng ít nhất là "ưu tiên hồi phục".

**HRV cao bất thường** (z > 2,5) không được cộng điểm. Một đêm HRV vọt lên có thể do nhịp không đều hoặc đo sai, không phải hồi phục tốt hơn.

**Làm sạch nền**: giá trị vô lý (ngủ < 3h hoặc > 14h, RHR ngoài 30–110, HRV ngoài 5–250 ms, nhịp thở ngoài 6–30) và **ngày bạn báo "đang bệnh"** không vào mức nền. Đêm ngủ < 3h của *hôm nay* vẫn được tính (có thể là thức trắng thật) nhưng có ghi chú "nếu là lỗi đồng bộ, hãy đánh dấu sai".

Vì sao đổi (v1 → v2):
- v1 so giấc ngủ với trung bình của chính bạn, nên thiếu ngủ kéo dài trông "bình thường". v2 so với nhu cầu nên thấy được khoản thiếu này.
- v1 tính nhịp thở 10% kể cả khi không có dữ liệu, nên độ tin cậy có thể kẹt ở 3/4.
- v1 dùng trung bình 7 ngày HRV làm "hôm nay", nên một đêm rất thấp gần như không đổi điểm.

Vì sao nhịp thở không cộng điểm (tra PubMed, 4/11/2026):
- Bằng chứng mạnh nhất là **phát hiện bệnh**, chủ yếu nghiên cứu COVID-19, không phải đo mức hồi phục. Nhịp thở ban đêm tăng được ghi nhận trước và trong khi có triệu chứng ([Miller 2020](https://doi.org/10.1371/journal.pone.0243693), [Risch 2022](https://doi.org/10.1136/bmjopen-2021-058274)). Tổng quan hệ thống cho thấy độ chính xác dao động lớn, AUC 0,52–0,92, và nhịp tim là dấu hiệu được báo nhiều nhất ([Mitratza 2022](https://doi.org/10.1016/S2589-7500(22)00019-X)).
- Chưa tìm thấy nghiên cứu cho thấy thêm nhịp thở vào điểm hồi phục giúp dự đoán tốt hơn. Nghiên cứu vận động viên gần nhất chỉ là phân cụm mô tả 17 người ([Foucaud 2025](https://doi.org/10.3389/fspor.2025.1629924)).
- Sai số số trung bình cả đêm từ cổ tay khoảng 0,65–1,1 lần/phút ([Natarajan 2021](https://doi.org/10.1038/s41746-021-00493-6), [Jung 2023](https://doi.org/10.3390/s23187976)), nên ngưỡng cờ là +1,5 thay vì +1,0. Mức "tăng mạnh" bắt đầu từ +3, đúng mức Natarajan dùng. Đây là lựa chọn thiết kế, chưa kiểm trên dữ liệu thật của gia đình.
- Dễ báo nhầm: nhịp thở còn đổi theo căng thẳng, nóng, lạnh, gắng sức ([Nicolò 2020](https://doi.org/10.3390/s20216396)) và theo chu kỳ kinh nguyệt ([Goodale 2019](https://doi.org/10.2196/13404)). Vì vậy một mình nhịp thở chỉ tính là 1 cảnh báo; phải đi cùng nhịp tim nghỉ tăng hoặc HRV giảm mới chặn điểm.

Cảm giác chủ quan luôn thắng: báo **đang bệnh** → điểm tối đa 30; **mệt / ngủ kém** → tối đa 50; báo triệu chứng nặng → **ẩn điểm** và hiện cảnh báo gọi 115. Khi mức chặn thực sự làm giảm điểm, app hiện cả **điểm thô** và **điểm sau chặn** (ví dụ 63 → 50) để không che mất dữ liệu.

Thẻ **Vì sao điểm này?** liệt kê từng yếu tố: giá trị, nền, z-score, điểm con, số điểm đóng góp và lý do thiếu. Tổng đóng góp xấp xỉ `điểm − 50` trước khi bị chặn bởi cảm giác. Lịch sử 30 ngày được tô màu theo dải để thấy xu hướng, không chỉ một con số.

### 7.2 Kết luận và hành động

Năm mức kết luận, cộng cấp cứu:

| Kết luận | Khi nào |
| --- | --- |
| **NGƯNG TẬP — cần hỗ trợ y tế** | Người dùng báo đau ngực, khó thở rõ, ngất hoặc gần ngất. App hiện số 115 và **không** gợi ý "sẵn sàng tập". |
| **Hôm nay nên nghỉ hoàn toàn** | Báo "đang bệnh", hoặc ≥ 2 chỉ số xấu rõ rệt (RHR z > 2, HRV z < −2, ngủ < 70% nhu cầu, nhịp thở tăng mạnh), hoặc ≥ 3 cảnh báo. |
| **Nên ưu tiên hồi phục** | Báo "mệt / ngủ kém", hoặc ≥ 2 chỉ số xấu hơn nền. |
| **Nên giảm nhẹ giáo án** | 1 chỉ số lệch nền. |
| **Có thể theo kế hoạch vừa sức** | Các chỉ số trong khoảng nền. |
| **Chưa đủ dữ liệu để kết luận** | Không có đủ RHR / HRV / ngủ để so. |

Mỗi kết luận đi kèm **một hành động cụ thể cho hôm nay** (giữ kế hoạch, giảm 20–30%, chỉ vận động nhẹ, hoặc nghỉ hoàn toàn), không chỉ là nhãn màu.

Ngưỡng z (mặc định 1.0 cho RHR/HRV, 2.0 cho mức "rõ rệt") chỉnh được trong Cài đặt → **Ngưỡng gợi ý buổi sáng**; có thể tắt từng chỉ số. Giấc ngủ dùng ngưỡng cố định: < 85% nhu cầu = cảnh báo, < 70% = rõ rệt. Chỉ **hướng xấu** của một chỉ số mới được tính là cảnh báo (HRV cao bất thường không còn bị đếm là "lệch rõ rệt"). Nhịp thở tăng ≥ 1,5 lần/phút = 1 cảnh báo; tăng kèm RHR tăng hoặc HRV giảm = "ưu tiên hồi phục".

Thẻ hôm nay luôn hiển thị:

- Ngày và **giờ đồng bộ gần nhất** (dữ liệu sáng nay hay cũ).
- Danh sách *Vì sao* — mỗi dòng ghi rõ chỉ số nào so với mức nền nào, bao nhiêu ngày nền.
- Danh sách *Thiếu* — chỉ số nào chưa có, chưa đủ ngày, hay chưa đồng bộ.
- Nút *Đồng bộ ngay* và các nút *Bình thường / Mệt / Bệnh / Nặng*.
- Cảm giác của bạn **luôn thắng** kết luận từ đồng hồ.

### 7.3 Kế hoạch ngủ — Peak / Perform / Get By

Ba mức thời lượng ngủ cho đêm nay, giống cấu trúc Sleep Planner của WHOOP nhưng tính từ dữ liệu của bạn:

- **Nền** = trung bình ngủ 30 ngày, kẹp trong 7h30–8h30 để không đẩy ai vào mục tiêu phi thực tế.
- **Nợ ngủ** 7 đêm gần nhất, trả dần — tối đa khoảng 1 giờ cộng thêm cho một đêm.
- **Điều chỉnh theo tập luyện**: hôm qua tập nhiều hơn trung bình 28 ngày → cộng thêm tối đa 45 phút.
- **Get By** = tối thiểu để tỉnh táo; **Perform** = hồi phục tốt; **Peak** = đỉnh phong độ.
- Giờ đi ngủ được tính ngược từ **giờ thức** bạn đặt trên máy (lưu trong `localStorage`), không gửi lên server.

Giới hạn: `sleepSecs` là tổng thời gian ngủ, không có cấu trúc giấc ngủ; tập sức mạnh/bơi/yoga có thể bị đếm thiếu phút.

### 7.4 Mục tiêu tải tuần

Tải 7 ngày gần nhất chia cho trung bình tuần 28 ngày, hiển thị theo %:

- Hồi phục xanh: **90–125%** — tải vừa đến cao.
- Hồi phục vàng: **50–85%** — tải nhẹ đến vừa.
- Hồi phục đỏ: **0–45%** — ưu tiên hồi phục.

Tải dùng `icu_training_load`; app nói rõ đây không phải thước đo đầy đủ cho tập sức mạnh, bơi hay yoga.

### 7.5 Cảm giác hằng ngày và bối cảnh

Mỗi buổi sáng ghi cảm giác (bình thường / mệt / bệnh / triệu chứng nặng). Cảm giác luôn thắng số đồng hồ. Thói quen và buổi tập ghi ở thẻ **"Hôm qua bạn đã làm gì?"**, xem [Ghi bối cảnh và đọc quy luật](#ghi-bối-cảnh-và-đọc-quy-luật). Các tag nhật ký cũ (rượu, cà phê sau 14h, căng thẳng, ăn muộn, tập sau 19h) đã ghi trước đây vẫn được tính vào quy luật.

## 8. Mức nền — cách tính thật

| Chỉ số | Cách tính trong app | Ghi chú |
| --- | --- | --- |
| **RHR** | **Trung vị** + độ lệch MAD của 30 ngày hợp lệ **trước** ngày đang đánh giá (loại ngày báo ốm, giá trị ngoài 30–110) | Ngày đang đánh giá không tự tính vào mức nền của chính nó. |
| **HRV rMSSD** | ln(rMSSD); nền **60 ngày**, cần ≥ 14 ngày (14–27 = "sơ bộ", ≥ 28 = "ổn định"); trung vị + MAD. So sánh: 60% đêm qua + 40% TB 7 ngày (≥ 3 ngày); kèm SWC và CV 7 ngày. | Chỉ dùng rMSSD; SDNN không được tính. Sàn độ lệch 7% để một đêm nhiễu không gây báo động giả. |
| **Ngủ** | Trung bình phút/đêm 30 ngày (loại đêm < 3h) — chỉ dùng để đặt **nền nhu cầu** 7h30–8h30, không dùng làm chuẩn so sánh | `sleepSecs` có thể gồm ngủ trưa; app nêu rõ giới hạn này. |
| **Nhịp thở** | Trung vị 30 đêm, cần ≥ 7 đêm | Cờ cảnh báo một chiều khi **tăng**; không cộng điểm. |
| **Bước** | Trung bình ngày | Không coi 10.000 là mốc. Ngày hôm nay **chưa kết thúc** → không dùng làm số bước hôm nay. |
| **Tải tập** | Tổng `icu_training_load` 7 ngày qua, so với trung bình tuần 28 ngày | Cảnh báo: không phản ánh đủ tập sức mạnh, bơi, yoga. |
| **Chỉ số hồi phục** | HRV 45%, RHR 25%, ngủ (so với nhu cầu) 30% | Công thức công khai; nhịp thở là cờ, không phải điểm. Không phải thuật toán WHOOP. |

Không dùng nhãn `HIIT` làm bằng chứng cường độ cao (Intervals.icu lấy tên type từ file, chưa chắc đã phản ánh HR/pace thực). Không dùng HRmax mặc định (220 − tuổi) làm chuẩn đã kiểm chứng.

Mức nền là **thống kê mô tả**, không phải ngưỡng chẩn đoán.

## 9. An toàn

- Có triệu chứng nặng → màn hình hôm nay hiện **thông báo đỏ, hướng dẫn gọi 115**, không cho phép "bỏ qua để tập".
- App không chẩn đoán bệnh, không khẳng định "phục hồi tốt" chỉ vì HRV cao.
- **Số bất thường kéo dài** (HRV cao 2 đêm liền, hoặc nhịp tim nghỉ cao 3 ngày liền) → app chỉ ghi **Nên hỏi bác sĩ**, không giải thích nguyên nhân.
- App **không** phải thiết bị y tế; đây là công cụ tham khảo cho cá nhân.

## 10. Mạng & quyền riêng tư

- App chạy trên Mac trong nhà. Mặc định **chỉ trong mạng LAN**. **Không tự động mở cổng router.**
- Mọi endpoint API **bắt buộc session cookie HttpOnly**. Nếu mất cookie, không đọc được dữ liệu người khác.
- Không tắt xác thực.
- `data/`, `backups/`, `secret.key`, `*.env` đều ở `.gitignore`.
- **Từ ngoài mạng**: dùng Tailscale, xem [Một server cho cả nhà](#một-server-cho-cả-nhà-qua-tailscale). Không dùng port-forward 8899 lên Internet.
- **Tính năng AI là ngoại lệ**: khi dùng, gói số liệu đã rút gọn và câu hỏi bạn gõ được gửi tới API của Anthropic. Không gửi tên, ghi chú hay triệu chứng. Database vẫn nằm trên Mac của bạn.
- **OAuth**: nếu sau này app cho nhiều người ngoài gia đình dùng, chuyển sang OAuth 2.0 để mỗi người không phải dán API key. API key cá nhân **đủ cho bản gia đình**, chưa cần.

## 11. Sao lưu / khôi phục

**Backup**:

```bash
bash scripts/nhip backup
# hoặc bấm "Tải backup JSON (dữ liệu của riêng bạn)" trong Cài đặt
```

- `nhip backup` dùng `VACUUM INTO` của SQLite → không cần dừng server, không hỏng file đang chạy. Lưu vào `backups/`, kể cả `secret.key` (để mở DB sau này).
- Tải JSON trong Cài đặt chỉ chứa dữ liệu của bạn, **không chứa API key**.

**Khôi phục JSON**: tab Cài đặt → *Khôi phục từ backup* → chọn file → ghi đè theo từng dòng (upsert).

**Khôi phục cả hệ thống**:

```bash
bash scripts/nhip stop
cp backups/nhip-song-<TS>.db data/nhip-song.db
cp backups/secret.key-<TS> data/secret.key
chmod 600 data/secret.key
bash scripts/nhip start
```

## 12. Cập nhật app

```bash
bash scripts/nhip stop
# thay/sửa code, rồi:
bash scripts/nhip test    # 134 test unit
bash scripts/nhip start   # dữ liệu vẫn nguyên trong data/
```

## 13. Lỗi thường gặp

| Hiện tượng | Nguyên nhân & cách xử lý |
| --- | --- |
| `Cannot find module 'node:sqlite'` | Node cũ hơn 22.5. `node --version` kiểm tra. |
| iPhone không mở được URL LAN | Mac và iPhone phải **cùng Wi-Fi**; bật *System Settings → Wi-Fi → Low Data Mode* tắt. Tường lửa macOS: cho phép node nhận kết nối. |
| "API key không được chấp nhận" | Dán thiếu / key thuộc tài khoản khác. Thử lại. |
| "Intervals.icu tạm chặn" | Đã bấm *Đồng bộ ngay* quá nhiều lần trong ít phút. Chờ 60 giây. |
| Sync lỗi nhưng dữ liệu mất | Không xảy ra theo thiết kế; nếu thấy, gửi log `scripts/nhip logs`. |
| Quảng cáo đổi mật khẩu hiện liên tục | Bạn vẫn còn `must_change_pw=1` — vào Cài đặt → *Đổi mật khẩu*. |
| "Chưa cấu hình ANTHROPIC_API_KEY" | Chưa điền key trong `.env`. Xem [Cài API key](#cài-api-key-không-đưa-lên-github). |
| "API key không hợp lệ hoặc đã bị thu hồi" | Key sai hoặc đã bị thu hồi. Tạo key mới, sửa `.env`, rồi chạy `bash scripts/nhip restart`. |
| "API đang giới hạn tốc độ hoặc đã chạm hạn mức chi tiêu" | Chờ một lúc. Kiểm tra hạn mức chi tiêu trong Claude Console. |
| "Hôm nay bạn đã dùng hết … lượt AI" | Đã chạm giới hạn mỗi người mỗi ngày. Mai dùng tiếp, hoặc chỉnh `AI_USER_DAILY_CALLS` trong `.env`. |
| Điện thoại không mở được `http://100.x.y.z:8899` | Kiểm tra Tailscale đã bật và điện thoại đã vào cùng tailnet. Mac phải đang thức và app đang chạy. |

## 14. Chi phí

- **0 đồng** cho bản dùng trong nhà không có AI. Node.js, SQLite, Intervals.icu API đều miễn phí; máy Mac bạn đã có.
- **Tính năng AI** tính tiền theo lượt dùng của API Anthropic. Xem [AI phân tích](#ai-phân-tích-claude-haiku-55).
- Tailscale Personal miễn phí cho 6 người dùng, đủ cho gói gia đình. Tailscale Pro là tuỳ chọn nếu cần nhiều hơn.

## 15. Cấu trúc mã

```
server/
  index.mjs       HTTP server, routing, session cookie, static
  db.mjs          SQLite, schema, khoá mã hoá, giờ Asia/Ho_Chi_Minh
  auth.mjs        scrypt + session token + cookie
  store.mjs       user, wellness (HRV rMSSD; SDNN nếu có chỉ lưu), activities, checkins, exclusions
  icu.mjs         Intervals.icu client (GET only) — HTTP Basic API_KEY
  sync.mjs        syncUser (kéo wellness + activities, giữ dữ liệu cũ khi lỗi)
  scheduler.mjs   lịch đồng bộ hằng ngày (múi giờ VN)
  csv.mjs         parser + preview CSV
  baseline.mjs    thống kê mô tả theo người
  recovery.mjs    chỉ số hồi phục 0–100, kế hoạch ngủ, mục tiêu tải tuần
  journal.mjs     thói quen + tương quan điểm hồi phục sáng hôm sau
  advice.mjs      quy tắc quyết định sáng, có red-flag
  signals.mjs     hàm thống kê dùng chung (median, MAD, ngày, dữ liệu hợp lệ)
  context.mjs     bối cảnh hằng ngày và các yếu tố có/không cho quy luật
  patterns.mjs    quy luật: sáng hôm sau khi có yếu tố so với đối chứng
  alerts.mjs      số bất thường: HRV cao, nhịp tim nghỉ cao → nên hỏi bác sĩ
  ai.mjs          lớp AI: gói số liệu, rào an toàn, cache, giới hạn, chi phí
  routes-ext.mjs  route bối cảnh, quy luật và AI
  security.mjs    IP qua proxy, header bảo mật, khoá đăng nhập
  env.mjs         đọc file .env (biến đã có sẵn thì giữ nguyên)
public/
  index.html, styles.css, app.js  — vanilla JS, responsive (sidebar + bottom nav), SVG chart
test/
  all.test.mjs, recovery.test.mjs, signals.test.mjs, insights.test.mjs  — 134 unit test (node:test)
scripts/nhip, backup.sh, seed-demo.mjs
```

Không có `node_modules`. Không build. Không Docker (nếu bạn muốn Docker, mình thêm `Dockerfile` khi cần).

**API chính** (mọi endpoint đều cần session cookie và lọc theo `user_id`):

- `GET /api/dashboard?history=30` — một payload cho trang Hôm nay: `recovery`, `advice`, `sleepPlan`, `load`, `history`, `metrics`, `recent`, `checkin`, `hrvLog`.
- `GET /api/wellness/hrv?user=<id>` — 14 ngày HRV kèm nhãn tự nhập; `user` chỉ dành cho quản trị (ghi hộ), thành viên gọi cho người khác sẽ nhận 403.
- `POST /api/wellness/hrv` — nhập/xoá HRV rMSSD thủ công cho một ngày (`{ date, value }`, `value: null` để xoá, thêm `user` khi ghi hộ).
- `GET|POST /api/checkin` — nhật ký, tags thói quen và insights.
- `GET /api/wellness`, `GET /api/activities`, `GET /api/baseline`, `GET /api/config/icu`, `POST /api/sync`.
- `GET|POST /api/context` — bối cảnh một ngày (`{ date, data }`; `data` rỗng để xoá).
- `GET /api/patterns` — bảng quy luật.
- `GET /api/ai/status`, `POST /api/ai/explain`, `POST /api/ai/ask`, `GET /api/ai/weekly` (thêm `?generate=1` để tạo), `POST /api/ai/quarter`.

## 16. Kiểm thử

```bash
bash scripts/nhip test
```

Bao phủ (đặc tả mục 11):

- CSV parser (quote/CRLF/BOM), preview đúng cột, từ chối CSV thiếu cột ngày.
- Không đếm trùng ngày, không trùng activity ID.
- Thiếu dữ liệu → NULL, không thành 0.
- Baseline đúng khoảng, **loại ngày đang đánh giá**.
- Không tính baseline HRV khi < 14 ngày rMSSD hợp lệ; SDNN không qua được cổng HRV.
- Cổng HRV: không có rMSSD thì không điểm, không lời khuyên, nêu đúng lý do (không có thiết bị HRV / đang dựng nền / thiếu đêm qua).
- Chỉ số hồi phục: đảo dấu RHR/nhịp thở, chia lại trọng số khi thiếu nhịp tim nghỉ/giấc ngủ, chặn bởi mệt/bệnh, ẩn khi có red-flag, HRV không tắt được, yếu tố bị tắt hiện là "đã tắt" chứ không phải "thiếu".
- Kế hoạch ngủ: nền kẹp 7h30–8h30, nợ ngủ 7 đêm, tăng mức khi hôm qua tập nặng.
- Mục tiêu tải tuần: loại ngày hôm nay, đúng dải theo màu hồi phục.
- Nhật ký: chỉ hiện tương quan khi ≥ 3 ngày có thói quen và ≥ 3 ngày không có; thẻ lạ bị loại.
- Advice: red-flag → emergency, tired beats HRV, thiếu dữ liệu → UNKNOWN.
- Sync: không có key → skipped, giữ nguyên dữ liệu; API key trống → IcuError.
- Session, đổi mật khẩu, vai trò member không đọc được endpoint admin.
- Bối cảnh: trường lạ hoặc giá trị sai bị từ chối.
- Quy luật: engine tìm đúng tác động của buổi tập chân đã gài sẵn trong dữ liệu thử.
- HRV cao bất thường không được cộng điểm.
- Cảnh báo bác sĩ: HRV cao 2 đêm liền, hoặc nhịp tim nghỉ cao 3 ngày liền.
- Lọc AI: câu nhắc chủ đề y khoa và câu giục tăng cường độ bị bỏ.
- Câu hỏi y khoa được trả lời trên máy, không gọi API.
- API key không bao giờ được trả về trong phản hồi.

**Chưa tự kiểm thử được**:

- Kết nối Intervals.icu **thật bằng tài khoản của bạn** — cần bạn tự nhập API key trong app.
- UI trên iPhone thật — cần bạn mở bằng Safari điện thoại và phản hồi.
- Rate limit 429 thật — mock đã test, nhưng Intervals.icu docs không nêu con số cụ thể; code xử lý an toàn (giữ dữ liệu, thông báo, chờ).
- Chất lượng câu trả lời AI trên dữ liệu thật của gia đình — cần bạn đọc và đánh giá.

## 17. So với WHOOP và khoa học

App **không** sao chép thuật toán WHOOP (bí mật độc quyền, không ai ngoài WHOOP biết trọng số chính xác). Đây là bảng đối chiếu trung thực:

| Vấn đề | WHOOP | App này | Khoa học nói gì |
| --- | --- | --- | --- |
| Điểm phục hồi 0–100 | Có, thuật toán kín, trọng số riêng | **Có, công thức công khai**: 45% HRV / 25% RHR / 30% ngủ so với nhu cầu, nhịp thở chỉ là cờ, hiện từng đóng góp và hạ độ tin cậy khi thiếu | Một chỉ số tổng hợp tiện theo dõi, nhưng trọng số là lựa chọn thiết kế, không phải chân lý sinh lý. Minh bạch quan trọng hơn một con số kín. |
| Mức nền | 30 ngày cuộn, cập nhật liên tục | 30 ngày **trước** ngày đánh giá, cá nhân hoá | Nền ngắn hạn bắt kịp thay đổi tập luyện; nền phải loại chính ngày đánh giá. |
| HRV | 1 đêm (giấc ngủ sóng chậm), so nền | **Trung bình cuộn 7 ngày**, so nền 30 ngày | Plews et al.: trung bình 7 ngày (hoặc log 7 ngày) đáng tin hơn 1 đêm — một đêm thấp thường là nhiễu. |
| Số ngày tối thiểu cho HRV | Không công bố | 14 ngày → mức "sơ bộ"; ≥ 28 ngày → mức "ổn định" | Plews et al.: cần ≥ 4 tuần để nền HRV dùng được cho quyết định. |
| RHR, ngủ | 1 đêm, so nền | 1 đêm, so nền (z-score) | Các chỉ số này ít nhiễu hơn HRV, dùng 1 đêm chấp nhận được. |
| Nhịp thở | Có, một trong các yếu tố | Có khi dữ liệu có, chỉ là **gợi ý bổ sung**, không quyết định một mình | Nhịp thở tăng là dấu hiệu bệnh nhưng độ ồn cao từ cảm biến đeo tay; chỉ nên là tín hiệu phụ. |
| Cảm giác chủ quan | Không | **Luôn thắng** dữ liệu đồng hồ (mệt/bệnh → hồi phục) | RPE/cảm giác là dữ liệu hợp lệ; "cảm giác khỏe" không phủ nhận số, nhưng "cảm giác bệnh" thì không nên tập. |
| Đau ngực / khó thở / ngất | Không thay bác sĩ | Màn hình đỏ + gọi 115, không bao giờ gợi ý tập | Tuyệt đối không để thuật toán "cho phép" tập khi có triệu chứng báo động. |
| Ngưỡng | Cố định, kín | **Người dùng chỉnh được** từng hệ số z (0.2–5) hoặc tắt nhịp tim nghỉ / giấc ngủ (HRV không tắt được) | Không có ngưỡng z nào là chuẩn y khoa; cho người dùng kiểm soát là minh bạch hơn. |
| Loại HRV | Không công bố | **Chỉ rMSSD**, không dùng SDNN | Hai đại lượng khác nhau, không đổi qua lại được; trộn làm sai nền. |

Những gì app **biết là chưa làm được** (giới hạn trung thực):

- Chỉ số hồi phục **không trộn tải tập** vào điểm; tải chỉ dùng cho kế hoạch ngủ và mục tiêu tuần. WHOOP dùng strain theo cách riêng mà họ không công bố.
- Không đo giấc ngủ theo giai đoạn (REM/sâu) — `sleepSecs` tổng là tất cả những gì có.
- Độ chính xác cảm biến quang học ở cổ tay thấp hơn đai ngực/thiết bị y tế; mọi z-score chỉ có ý nghĩa tương đối với chính người đó.
- Đồng hồ Huawei gửi dữ liệu qua Huawei Health → Health Sync → Intervals.icu: mỗi khâu có thể làm tròn, đổi đơn vị, bỏ sót. App hiển thị nguồn gốc để bạn tra cứu.

Tóm lại: app dùng **cùng hướng khoa học** (nền cá nhân, z-score, HRV cuộn 7 ngày, tôn trọng triệu chứng) nhưng **công khai toàn bộ công thức** thay vì sao chép một thuật toán kín — và không giả vờ đạt độ chính xác của WHOOP.

Nguồn tham khảo chính: Bellenger et al. 2022 (tổng quan độ tin cậy WHOOP, PMC9505647), Plews & Laursen (baseline HRV tối thiểu 4 tuần, trung bình cuộn 7 ngày), Schmitt et al. 2015 (LnRMSSD, tần suất đo HRV), tài liệu công khai của WHOOP về Recovery.

## Một server cho cả nhà qua Tailscale

Cách dùng hiện tại. Chỉ có **một server** trên Mac ở nhà. Cả nhà vào cùng một địa chỉ từ 4G hay wifi khác. App **không lộ ra Internet**: không mở cổng router, không cần tên miền.

1. **Mac ở nhà** chạy app như bình thường (`HOST=0.0.0.0`, mặc định). Cài Tailscale trên Mac và bật *Start on login*.
2. **Mời từng người** vào tailnet: trong Tailscale admin console, chọn *Invite external users* và nhập email của từng người. Khoảng 6 người là đủ cho gói Personal.
3. **Mỗi người** cài Tailscale trên điện thoại, đăng nhập bằng email được mời và bật VPN.
4. **Mở địa chỉ** `http://<IP Tailscale của Mac>:8899`. Địa chỉ có dạng `100.x.y.z`, lệnh `scripts/nhip start` sẽ in ra. Thêm vào màn hình chính điện thoại.
5. **Admin tạo tài khoản** cho từng người trong **Cài đặt → Quản lý gia đình**. Mỗi người một tài khoản riêng.

Lưu ý:

- Điện thoại phải bật Tailscale. Mac phải đang thức và app đang chạy. Chi tiết xem [mục 18](#18-truy-cập-từ-xa-bằng-tailscale-tuỳ-chọn).
- Địa chỉ `100.x.y.z` chỉ vào được khi thiết bị nằm trong tailnet. **Không mở cổng 8899 trên router.**
- Các lớp bảo vệ của app vẫn áp dụng: khoá đăng nhập sau 8 lần sai trong 15 phút (theo IP và theo tên đăng nhập), header bảo mật, cookie HttpOnly.
- Code có thể chạy sau Cloudflare Tunnel về sau (`TRUST_PROXY=1`, `HOST=127.0.0.1`), nhưng hiện **không** dùng cách đó.

## Máy ở công ty (chỉ để test)

Máy ở công ty chỉ dùng để thử nghiệm, với dữ liệu giả. Chạy một bản riêng:

```bash
NHIP_DATA_DIR=./demo-data node scripts/seed-demo.mjs
```

```bash
PORT=8901 NHIP_DATA_DIR=./demo-data node server/index.mjs
```

- Bản test có `.env` riêng, và có thể dùng chung API key.
- Dữ liệu thật chỉ nằm trên Mac ở nhà. **Không đồng bộ** hai database với nhau.

---

## 18. Truy cập từ xa bằng Tailscale (tuỳ chọn)

Đây là cách hiện tại để cả nhà mở app khi ra ngoài. Các bước mời người nhà nằm ở mục [Một server cho cả nhà](#một-server-cho-cả-nhà-qua-tailscale).

Dùng **Tailscale** — mạng riêng ảo mã hoá đầu-cuối, gói Personal miễn phí cho **6 người dùng** (từ 04/2026), không cần tên miền, không tốn phí.

**Trên Mac (chủ máy chạy app):**

- Cài Tailscale vào `/Applications`, bật "Start on login" trong menu Tailscale để tự chạy sau khi khởi động lại.
- Địa chỉ mạng riêng của Mac có dạng `100.x.y.z`, cố định dù đổi Wi-Fi. `bash scripts/nhip start` sẽ in ra địa chỉ này.
- Trang quản lý thành viên: https://login.tailscale.com/admin/users → *Invite external users* → nhập email của những người còn lại (mỗi người một tài khoản riêng).

**Trên iPhone từng người:**

1. App Store → cài **Tailscale** (miễn phí).
2. Mở app → *Log in* bằng đúng email được mời → bật VPN (có thể bật on-demand để tự kết nối).
3. Safari → mở `http://100.x.y.z:8899` → Chia sẻ → *Thêm vào MH chính*. Địa chỉ này không bao giờ đổi, kể cả ở nhà. Đừng lưu địa chỉ `192.168.x.x`: router cấp lại số khác sau mỗi lần khởi động.
4. Đăng nhập tài khoản Nhịp Sống của riêng mình (admin tạo trong app, mục Cài đặt).

**Lưu ý:**

- Mac phải **đang thức và app Nhịp Sống đang chạy** thì mới truy cập được. Bật *System Settings → Lock Screen → "Prevent automatic sleeping when display is off"* nếu muốn dùng 24/7.
- Điện thoại phải **bật Tailscale** trước khi mở app. Tắt Tailscale là mất kết nối (đúng như thiết kế riêng tư).
- Tailscale cần app nghe trên `0.0.0.0` (mặc định). Đừng đặt `HOST=127.0.0.1` khi dùng Tailscale.
- Toàn bộ dữ liệu đi trong đường hầm mã hoá của Tailscale; app không phát sóng ra internet công cộng, không cần mở cổng router.
