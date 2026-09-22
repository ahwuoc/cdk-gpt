# Digital Store

Monorepo bán và giao sản phẩm số qua Telegram. Backend dùng NestJS + Mongoose, kho được mã hóa bằng AES-256-GCM, tiền được lưu bằng số nguyên, và toàn bộ quy trình mua hàng chạy trong MongoDB Replica Set transaction.

> Chỉ nhập và phân phối sản phẩm/tài khoản thuộc quyền sở hữu hợp pháp của người vận hành và được phép chuyển giao theo điều khoản của dịch vụ liên quan.

## Cấu trúc

```text
apps/
  api/                 NestJS REST API + Swagger / serverless bridge
  bot/                 Telegraf bot + delivery/restock processors
  admin-web/           Next.js/React/Tailwind admin + Vercel routes
packages/
  config/              Kiểm tra biến môi trường
  database/
    src/schemas/       nghiệp vụ + migration record, bot session và runtime lease
    src/repositories/  Repository và atomic inventory operations
    src/migrations/    MongoDB migration runner
  encryption/          AES-256-GCM, versioned key ring, HMAC duplicate hash
  shared/              Enum và domain errors
tests/integration/     12 bài kiểm thử trên MongoMemoryReplSet
```

Các collection chính: `admins`, `roles`, `users`, `products`, `inventory_items`, `orders`, `wallet_transactions`, `payment_requests`, `support_tickets`, `warranty_requests`, `referrals`, `settings`, `notifications`, `audit_logs`, `refresh_tokens`, `import_batches`, `bot_sessions`, và `runtime_leases`.

## Bất biến an toàn

- `inventory_items.encryptedPayload` được mã hóa AES-256-GCM trước khi ghi và mặc định bị loại khỏi projection.
- `payloadHash` là HMAC-SHA-256 của dữ liệu đã chuẩn hóa; không thể dùng để khôi phục plaintext.
- Mỗi đơn vị hàng hóa là một document riêng. Unique `{ productId, payloadHash }` chặn nhập trùng.
- `findOneAndUpdate({ productId, status: AVAILABLE, deletedAt: null })` giữ đúng một item trong cùng transaction tạo order/trừ tiền.
- Wallet chỉ dùng integer minor unit. Mỗi biến động tạo một `wallet_transactions` có `balanceBefore`, `balanceAfter` và unique `idempotencyKey`.
- Docker/VPS dùng BullMQ `jobId = orderId`; Vercel dùng QStash at-least-once với cùng idempotency/order-state, nên retry không tạo order và không trừ tiền lại.
- Nếu kết quả gửi Telegram không rõ ràng, item vẫn `RESERVED` và order chuyển sang `DELIVERY_FAILED` để admin xử lý; hệ thống không tự đưa item về kho.
- API đọc payload đầy đủ yêu cầu `inventory.read_sensitive` và tạo audit log không chứa payload.
- Production đặt `autoIndex: false`; index được tạo bằng migration thay vì `syncIndexes()`.
- Telegram webhook lưu trạng thái nhập số lượng/nạp tiền vào MongoDB TTL thay vì RAM, nên cold start không làm mất hội thoại.
- Poll ngân hàng serverless dùng MongoDB lease; wallet ledger, `providerReference` và idempotency key vẫn là lớp chống cộng tiền trùng cuối cùng.

## Development bằng Docker Compose

Yêu cầu Docker/Compose. Telegram bot token có thể để trống lúc khởi động và cấu hình sau trong trang admin.

```bash
cp .env.example .env
# Thay toàn bộ giá trị [PLACEHOLDER]. Sinh secret ví dụ:
openssl rand -hex 32
docker compose up --build -d mongodb mongo-init-replica redis
docker compose run --rm api bun run migration:up
docker compose run --rm api bun run seed
docker compose up --build -d
```

`mongo-init-replica` khởi tạo single-node Replica Set `rs0`. Không đổi connection string thành MongoDB standalone vì transaction nhiều document sẽ không hoạt động.

- Admin: <http://localhost:8080/admin>
- Swagger: <http://localhost:8080/api/docs>
- Health: <http://localhost:8080/api/health>

Nếu chạy service trực tiếp:

```bash
bun install
bun run dev:api
bun run dev:bot
bun run dev:admin
```

MongoDB local vẫn phải là Replica Set và Redis phải đang chạy.

## Deploy Vercel không cần VPS

Code hỗ trợ hai runtime:

| Runtime | Hạ tầng | Queue/bot |
| --- | --- | --- |
| `APP_RUNTIME=server` | Docker/VPS + Redis | Telegraf long-polling + BullMQ worker (giữ nguyên để tương thích) |
| `APP_RUNTIME=serverless` | Vercel + MongoDB Atlas Replica Set + QStash | Telegram webhook + QStash HTTP task; **không cần Redis** |

Để chạy hoàn toàn serverless, cần MongoDB Atlas/managed **Replica Set** (transaction mua hàng và cộng ví không chạy trên MongoDB standalone), một QStash token, và một domain HTTPS trên Vercel.

1. Tạo Vercel project, chọn **Root Directory** là `apps/admin-web` và bật **Include source files outside the Root Directory in the Build Step** vì Route Handler dùng chung source tại `apps/api` và `packages/*`. `apps/admin-web/vercel.json` đã khai báo Next build, Node.js functions 60 giây và cron bảo trì.
2. Trong Vercel Environment Variables (Production), đặt tối thiểu:

   ```dotenv
   NODE_ENV=production
   APP_RUNTIME=serverless
   MONGODB_URI=mongodb+srv://.../digital_store?retryWrites=true&w=majority
   MONGODB_MAX_POOL_SIZE=5
   WEB_APP_URL=https://shop.example.com
   BOT_API_SECRET=<random-secret-cho-Bot API noi bo>
   JWT_ACCESS_SECRET=<random>
   JWT_REFRESH_SECRET=<random>
   ENCRYPTION_KEY=<32-byte-key>
   PAYLOAD_HASH_KEY=<32-byte-HMAC-key>
   TELEGRAM_WEBHOOK_SECRET=<url-safe-random-secret-HMAC-seed>
   TASK_QUEUE_SECRET=<random-secret>
   CRON_SECRET=<random-secret>
   ```

   Không đặt `NEXT_PUBLIC_API_URL`: admin mặc định gọi cùng origin `/api`, tránh CORS và giữ refresh cookie ổn định. `REDIS_URL` không cần có ở chế độ này.
3. Chạy migration **một lần** từ máy local/CI với Atlas URI trước khi deploy (không chạy migration trong Vercel build):

   ```bash
   APP_RUNTIME=serverless MONGODB_URI='mongodb+srv://...' bun run migration:up
   ```

4. Deploy lần đầu, vào `/admin` → **Bot & thanh toán** → **Cấu hình runtime** để lưu tên shop, admin Telegram ID, API URL, Telegram webhook URL, QStash URL/token và task base URL vào MongoDB. QStash token được mã hóa và có thể đổi realtime; để trống token khi sửa lần sau sẽ giữ token cũ. Sau đó lưu Telegram token. API xác minh token, lưu mã hóa và gọi `setWebhook` tới URL vừa lưu. Header secret Telegram được HMAC riêng theo từng bot từ `TELEGRAM_WEBHOOK_SECRET`; khi đổi bot, webhook bot cũ được tắt trước nên update cũ/in-flight không bị xử lý bằng token bot mới.
   Các giá trị thường đổi như `TOKEN_API_BANK` cũng lưu từ form. Chỉ khóa bootstrap (`MONGODB_URI`, `ENCRYPTION_KEY`, JWT, `BOT_API_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `TASK_QUEUE_SECRET`, `CRON_SECRET`) phải nằm trong Vercel Environment Variables.
5. Trong nhà cung cấp Cake, đặt Webhook Callback là `POST https://<domain>/api/webhooks/bank/cake`, `Content-Type: application/json` và header `signature` bằng đúng `TOKEN_API_BANK` đã lưu. Callback lặp được khử trùng theo `transactionID`; không tạo cron/QStash Schedule để quét giao dịch bank.
6. Tạo một đơn thử, nhập kho và thử `/start`, nạp tiền, giao hàng. QStash sẽ gọi các route nội bộ có `TASK_QUEUE_SECRET`; không public secret vào frontend.

`/api/internal/cron` **không kiểm tra giao dịch bank**. Lịch `0 0 * * *` chạy bảo trì mỗi ngày lúc 00:00 UTC: nhả reservation hết hạn, republish delivery bị lỡ sau commit và đánh dấu yêu cầu QR hết hạn, nên tương thích Vercel Hobby. Nút **Kiểm tra tiền** trên bot đọc trạng thái yêu cầu tương ứng.

Callback ngân hàng trên Vercel xử lý khoản tiền nhận được mà không đợi dọn yêu cầu hết hạn của khách khác; tình huống trả tiền muộn vẫn được xác định và xử lý trong transaction của chính khoản tiền đó. Kiểm tra trạng thái chỉ dọn yêu cầu thuộc đúng khách. Bảo trì cập nhật hàng loạt nạp tiền thường/QR SOFT không giữ hàng; tối đa 25 QR cũ có giữ hàng được xử lý riêng bằng transaction. Runtime Docker giữ bước dọn có giới hạn sau khi xử lý tiền vào; lỗi dọn không biến khoản tiền đã ghi nhận thành callback thất bại.

Không deploy `apps/bot/src/main.ts` hay worker Docker lên Vercel: chúng dành cho runtime `server` chạy dài hạn. Sau khi đã test webhook/QStash/cron ở Production, có thể tắt VPS và Redis.

## Migration và seed

```bash
bun run migration:status
bun run migration:up
bun run migration:down   # rollback migration mới nhất
bun run seed
```

Migration runner ghi tên, checksum, thời gian chạy vào `schema_migrations`. `001-create-indexes` tạo index đã khai báo trong schema bằng `createIndexes()`; `002-backfill-safe-defaults` minh họa backfill có thể rollback. Không sửa migration đã chạy; hãy thêm migration mới.

Seed tạo role `super-admin`, admin, demo user, product và ba inventory item đã mã hóa. Nếu không đặt `SEED_ADMIN_PASSWORD`, script in một mật khẩu development dùng một lần.

## Import kho

Admin web nhận JSON array hoặc JSONL. API thực hiện:

1. bỏ dòng rỗng và chuẩn hóa theo `product.fieldDefinitions`;
2. validate required/type/email/URL;
3. tính HMAC hash và loại trùng trong file;
4. so trùng trong MongoDB;
5. trả masked preview;
6. mã hóa AES-GCM;
7. `bulkWrite` theo batch 500, unordered;
8. ghi báo cáo vào `import_batches`.

Không gửi plaintext vào log, BullMQ job, notification hay audit log.

Trong **Kho hàng**, có thể dán tối đa 100 từ khóa khác nhau (mỗi từ khóa tối đa 120 ký tự), mỗi dòng một email, tên sản phẩm hoặc ID hàng/lô. Dạng `email----password----2fa` chỉ lấy phần email/login để tìm; mật khẩu và 2FA không được gửi trong yêu cầu tìm kiếm. Dữ liệu quá giới hạn hoặc thiếu email/login sẽ báo lỗi và giữ nguyên bộ lọc đang áp dụng.

Ở chế độ tìm chuỗi con, nếu mọi dòng đều là ObjectId (24 ký tự hex), tìm kiếm chỉ khớp chính xác ID hàng hoặc ID lô và dùng các index có sẵn, không quét dữ liệu xem trước. Khi có dòng văn bản, tìm kiếm vẫn khớp một phần dữ liệu xem trước/tên sản phẩm, không phân biệt hoa thường, đồng thời tìm các ID đi kèm. Tìm email/login theo chuỗi con vẫn có thể chậm trên kho lớn.

Với danh sách email/login đầy đủ, chọn **Khớp chính xác (nhanh)** để tìm toàn bộ giá trị xem trước hoặc ID hàng/lô bằng chỉ mục; chế độ này không tìm tên sản phẩm. **Chứa từ / tên sản phẩm** giữ cách tìm chuỗi con và vẫn là mặc định. API nhận `searchMode: "exact" | "contains"`; nếu bỏ qua, hành vi cũ được giữ nguyên. Giá trị tìm chính xác được cắt khoảng trắng và chuyển chữ thường từ `maskedPreview`, không lấy từ payload đã giải mã. Dữ liệu nhạy cảm bị che vẫn chỉ tìm được theo phần đã che.

Migration `013-inventory-search` tạo chỉ mục tìm chính xác, chỉ mục phân trang theo trạng thái/sản phẩm và backfill dữ liệu xem trước theo lô 500. Trong lúc triển khai, các bản ghi chưa có giá trị tìm kiếm vẫn được tra qua nhánh tương thích chỉ đọc những bản ghi thiếu này. Sau khi bản mới được đưa lên và các instance cũ đã kết thúc (Vercel hiện tối đa 60 giây mỗi invocation), **phải chạy** `backfillInventorySearchValues(connection, { includeExisting: true })` từ migration này một lần để sửa cả bản ghi đã backfill nhưng còn bị instance cũ ghi đè. Hàm có thể chạy lại an toàn, so sánh bản xem trước và giá trị chỉ mục trước khi ghi, bỏ qua hàng đã đúng, không thay đổi timestamp nghiệp vụ. Giữ chế độ tìm chuỗi con trong khoảng chuyển tiếp nếu chưa chạy bước sửa đầy đủ này.

Khi triển khai theo từng bước, chạy riêng `createInventorySearchIndexes(connection)` trước khi đưa bản mới lên, chưa backfill và chưa ghi migration hoàn tất. Sau khi chuyển sang bản mới và chờ instance cũ kết thúc ít nhất 60 giây, chạy migration runner rồi bước sửa đầy đủ ở trên. Cách này chuẩn bị chỉ mục sẵn nhưng giữ dữ liệu cũ trên nhánh tương thích trong thời gian chuyển tiếp.

Giao diện gửi tìm kiếm qua `POST /api/admin/inventory/search` với JSON body để tránh giới hạn độ dài URL. Endpoint dùng cùng bộ lọc, phân trang và quyền `inventory.manage` hoặc `inventory.import` như `GET /api/admin/inventory`; GET vẫn được hỗ trợ.

## Tốc độ thông báo Telegram

Ba luồng thông báo (admin gửi toàn bộ, hàng về và có khách mua hàng) xử lý tối đa 12 người nhận đồng thời. Chúng dùng chung bộ giới hạn trong collection `telegram_broadcast_rates`: tối đa 25 lần bắt đầu gửi trong mỗi cửa sổ trượt 1 giây, kể cả khi chạy nhiều worker hoặc nhiều instance Vercel. Khoảng cách cho cùng một chat là ít nhất 1 giây (group: 3 giây). Hạn mức này dành riêng cho thông báo hàng loạt, để lại khoảng trống cho tin nhắn giao hàng và tương tác với bot.

Collection giới hạn tốc độ chỉ giữ một document cho cửa hàng, với tối đa khoảng 75 lượt gửi gần nhất. MongoDB dùng đồng hồ máy chủ và index `_id` có sẵn; không cần Redis hoặc migration bổ sung. Tốc độ thực tế còn phụ thuộc độ trễ Telegram/MongoDB và lưu lượng tương tác khác.

Worker ghi nhớ thời điểm hạn mức chung chưa mở để tránh hỏi lại MongoDB liên tục; mọi lần được phép gửi vẫn phải được MongoDB cấp quyền. Thông báo mua hàng mới tạo và giữ quyền gửi trong cùng một thao tác, giảm từ ba xuống hai lần ghi trạng thái cho mỗi người nhận, giữ nguyên khóa chống gửi trùng và cơ chế retry.

Danh sách người nhận vẫn phân trang theo `_id` tăng dần, nên khách có bản ghi được tạo sớm thường được xếp trước. Đây là thứ tự trong mã nguồn, không phải Telegram ưu tiên người đăng ký trước. Các lượt gửi được xử lý song song trong mỗi trang nên thứ tự nhận thực tế không được bảo đảm. Nếu duy trì 25 tin/giây, 1.000 người nhận tương ứng khoảng 40 giây; đây là ước tính công suất, không phải cam kết thời gian giao tin. Nhiều chiến dịch đồng thời chia sẻ hạn mức này.

Telegram Bot API không có endpoint nhận nhiều `chat_id` để gửi tin nhắn riêng trong một request. `sendMediaGroup`, `forwardMessages` và `copyMessages` gom nhiều nội dung cho **một** chat. Mức miễn phí khoảng 30 tin/giây; paid broadcasts có thể nâng lên 1.000 tin/giây nhưng tính phí Stars. Mã này không bật `allow_paid_broadcast`. Tham khảo [Telegram Bot FAQ](https://core.telegram.org/bots/faq#broadcasting-to-users) và [sendMessage](https://core.telegram.org/bots/api#sendmessage).

Khi nhận 429, sender chia sẻ thời gian nghỉ `retry_after` cho mọi worker. Cooldown dài được đưa lại vào hàng đợi ở đúng trang người nhận hiện tại, không bỏ qua khách phía sau. Bản ghi `SENT` và lỗi cuối cùng `FAILED` không được gửi lại khi trang chạy lại; lỗi mạng không rõ kết quả được giữ để kiểm tra, tránh tự động gửi trùng. Claim `SENDING` ngăn hai lượt xử lý cùng gửi cho một khách và có thể thu hồi sau 5 phút nếu worker dừng đột ngột.

Kiểm tra bằng bot giả lập, MongoDB và Redis tạm, không gửi Telegram thật (test hàng đợi tích hợp cần `redis-server`):

```bash
bun test tests/broadcast-sender.test.ts tests/broadcast-processors.test.ts tests/broadcast-queue-retry.test.ts
RUN_INTEGRATION=1 bun test tests/broadcast-rate-store.test.ts tests/broadcast-queue-retry.test.ts
BROADCAST_BENCHMARK=1 bun test tests/broadcast-processors.test.ts --test-name-pattern 'broadcast benchmark'
```

## Phiếu giảm giá và phân tích kinh doanh

Admin có mục **Voucher giảm giá** để tạo, sửa và bật/tắt mã. Hỗ trợ giảm theo phần trăm hoặc số tiền cố định, đơn tối thiểu, trần tiền giảm, thời gian áp dụng theo giờ Việt Nam, giới hạn tổng lượt dùng/mỗi khách và danh sách sản phẩm được áp dụng. Mã không phân biệt chữ hoa/thường; mỗi đơn chỉ dùng một mã. Quyền quản lý là `products.manage`, thao tác được ghi audit.

Trong bot, chọn sản phẩm và số lượng sẽ mở **báo giá**, chưa trừ tiền. Khách nhập/bỏ mã, xem tổng sau giảm rồi xác nhận mua bằng ví hoặc tạo QR. Coupon dùng trên giá bán hiện tại (kể cả giá sale), số tiền giảm được làm tròn xuống và không vượt tổng đơn. QR phải có số tiền lớn hơn 0; đơn được giảm về 0 dùng luồng ví, không phát sinh bút toán ví giá trị 0.

Lượt dùng coupon được ghi cùng transaction giữ hàng/tạo đơn/trừ ví, tính một lượt cho cả lần mua nhiều sản phẩm. Báo giá và QR chưa thanh toán không giữ lượt dùng. Nếu mã hết hạn, bị tắt/hết lượt hoặc mức giảm thay đổi trước callback QR, tiền đã chuyển được bảo toàn trong ví; hệ thống không tự thu phần chênh lệch. Retry cùng đơn không dùng mã/trừ tiền lần nữa. Hoàn/hủy đơn không tự khôi phục lượt coupon; số tiền hoàn chỉ là số thực đã trừ.

Mục **Phân tích** có khoảng ngày (tối đa 366 ngày), doanh thu theo ngày, giá trị mua trung bình, top khách chi tiêu và top sản phẩm. Xếp hạng dựa trên tiền của đơn đã giao, không phải số dư hay tiền nạp ví. Đơn hủy/hoàn/chưa giao không tính doanh thu. Một lần mua nhiều hàng được gộp theo mã nhóm giao dịch; dữ liệu cũ không có mã nhóm tính từng đơn. Doanh thu theo ngày giao ở `Asia/Ho_Chi_Minh`; đơn cũ thiếu ngày giao dùng ngày tạo. Tiền nạp ví được hiển thị riêng.

Báo cáo mặc định từ đầu tháng đến hôm nay, có lựa chọn tháng trước và 7/30/90 ngày. Tỷ lệ mua lặp lại = khách có ít nhất hai lượt mua / khách đã mua trong kỳ. Tỷ lệ khách hoạt động có mua dùng tập khách có tương tác được ghi nhận hoặc đơn đã giao; không phải tỷ lệ trên toàn bộ khách đăng ký và hiển thị “—” khi kỳ chưa có dữ liệu tương tác. Trang **Tổng quan** cũng có bảng top 20 chi tiêu với bộ lọc ngày và liên kết lịch sử đơn theo khách.

Mục **Mua lại theo sản phẩm** lọc cùng khách mua cùng sản phẩm theo **khoảng số ngày liên tiếp tùy chọn**, từ 2 đến 366 ngày, trong kỳ báo cáo. Nhập số ngày tối thiểu và tối đa (ví dụ 2–7); để trống tối đa nếu chỉ cần ít nhất N ngày. Bộ lọc áp dụng cho chuỗi dài nhất của mỗi cặp khách–sản phẩm: khoảng 2–7 không gồm chuỗi từ 8 ngày trở lên. Mỗi ngày phải có ít nhất một lượt mua thành công; nhiều lượt mua cùng ngày chỉ tính một ngày, có ngày trống thì chuỗi bị ngắt. Chuỗi 3 ngày cũng đạt bộ lọc tối thiểu 2 ngày khi không đặt giới hạn trên. Đây là ngày lịch Việt Nam (`Asia/Ho_Chi_Minh`), không phải khoảng 48/72 giờ giữa hai lần mua.

Gộp theo khách, sản phẩm và mã thanh toán QR hoặc mã nhóm mua bằng ví; mỗi nhóm phải có đơn hiện đã giao mới được tính là một lượt mua. Chỉ cộng số lượng và chi tiêu của phần đã giao, nhưng lấy ngày tạo sớm nhất của toàn bộ nhóm làm ngày mua trước khi lọc kỳ, kể cả khi phần tạo trước chưa giao hoặc đã hoàn. Việc giao nhiều phần vào các ngày khác nhau không tạo lượt mua lại hay dịch ngày mua. Chuỗi chỉ tính các ngày nằm trong kỳ đã chọn. Tỷ lệ = số khách có chuỗi đạt điều kiện / số khách đã mua trong kỳ với bộ lọc sản phẩm hiện tại; chọn tất cả sản phẩm vẫn đếm mỗi khách một lần trong tỷ lệ, còn bảng có một dòng cho mỗi cặp khách–sản phẩm. Không có khách mua thì tỷ lệ hiển thị “—”. Ngày mua ở mục này có thể khác ngày giao dùng cho doanh thu phía trên.

API `GET /admin/analytics/product-repeat-purchases` dùng quyền `analytics.read`, nhận `from`, `to`, `days` là số ngày tối thiểu (mặc định 2), `maxDays` là tối đa tùy chọn (cả hai là số nguyên 2–366, tối đa không nhỏ hơn tối thiểu), `productId` tùy chọn, `page` và `limit` (tối đa 100). Bảng phân trang hiển thị khách, sản phẩm, chuỗi dài nhất, các ngày mua, tổng lượt mua và tiền mua trong kỳ. Danh sách chọn sản phẩm gồm các sản phẩm có lượt mua trong kỳ, không giới hạn ở top 20 doanh thu.

Thống kê hành vi gồm khách hoạt động, khách mới/quay lại/mua lặp, lượt khách xem sản phẩm/bắt đầu thanh toán, tỷ lệ mua sau hành vi và QR hết hạn chưa thanh toán. Bot chỉ ghi loại sự kiện, khách, sản phẩm, mã update và thời gian máy chủ; không ghi nội dung tin nhắn, mật khẩu hoặc hội thoại hỗ trợ. Dữ liệu hành vi bắt đầu từ khi triển khai tính năng; không dựng lịch sử lượt xem từ đơn hàng cũ. Tỷ lệ chuyển đổi dùng khách có đơn giao sau hành vi trong cùng kỳ, không phải mô hình quy kết quảng cáo.

Các migration mới nhất là `012-operational-query-indexes`, `013-inventory-search` và `014-message-query-indexes`. Chúng bổ sung index cho người nhận thông báo, lịch sử chiến dịch, QR hết hạn, nhóm checkout, khiếu nại, kho và hội thoại. Migration 013 có dữ liệu dẫn xuất cần được sửa đầy đủ sau khi phiên bản cũ kết thúc; khi triển khai cuốn chiếu, làm theo các bước ở mục kho phía trên thay vì backfill trong lúc các instance cũ vẫn ghi dữ liệu.

Dashboard và báo cáo mua liên tiếp dùng cache 15 giây trong mỗi tiến trình, tối đa 32 bộ lọc; các yêu cầu trùng đang chạy dùng chung kết quả. Nút tải lại/thử lại gửi `refresh=1` để lấy dữ liệu mới. Cache chỉ áp dụng cho báo cáo đọc, không tham gia thanh toán hay cập nhật số dư. Phân trang lịch sử không tìm từ khóa lấy trang trước rồi mới nối dữ liệu liên quan; tìm từ khóa vẫn giữ đầy đủ kết quả và tổng đếm. Trung tâm tin nhắn ngừng tải nền khi tab ẩn, tránh request chồng nhau và bỏ kết quả của request đã bị thay thế.

Báo cáo mua liên tiếp thăm dò tối đa 101 đơn trong kỳ. Kỳ nhỏ dùng index ngày rồi tra đủ các phần của nhóm thanh toán, kể cả phần nằm ngoài kỳ; kỳ lớn gom lịch sử một lần để tránh hàng nghìn lượt lookup. Kết quả ngày mua và tiền sau hoàn/giảm giá không đổi. Danh sách hội thoại dùng cache 5 giây, được xóa khi gửi/nhận tin trên cùng tiến trình; `refresh=1` luôn lấy mới. Truy vấn gom ID/ngày/count từ index rồi chỉ tải nội dung tin nhắn cho trang cần xem.

Kiểm tra bằng dữ liệu tạm, không gửi Telegram/ngân hàng thật:

```bash
bun test tests/shop-bot-coupons.test.ts tests/analytics-insights.test.ts
RUN_INTEGRATION=1 bun test tests/integration/coupons.integration.test.ts
RUN_INTEGRATION=1 bun test tests/analytics-insights.test.ts tests/integration/analytics-top-customers.integration.test.ts
RUN_INTEGRATION=1 bun test tests/product-repeat-purchases.test.ts
```

## Quy trình mua và giao hàng

`PurchaseService.purchase()` thực hiện trong một session transaction:

1. kiểm tra idempotency, user active, product active, giá, limit và số dư;
2. atomic reserve một inventory item;
3. tạo order bằng ObjectId đã cấp trước;
4. atomic debit số dư;
5. tạo wallet ledger và gắn vào order;
6. commit với majority write concern;
7. enqueue delivery sau commit (BullMQ ở `server`; QStash ở `serverless`).

Với một lần mua nhiều hàng bằng ví, các yêu cầu đưa đơn vào hàng đợi sau commit chạy tối đa 4 yêu cầu cùng lúc, vẫn đợi tất cả hoàn tất và giữ cơ chế phục hồi khi publish lỗi. Nhóm QR vẫn chỉ tạo một tác vụ giao hàng. Không chạy các thao tác trừ ví/giữ hàng song song bên trong transaction.

Worker/task claim order, giải mã trong memory, render template rồi gửi đúng `telegramId`. Sau xác nhận gửi thành công, transaction thứ hai chuyển inventory sang `SOLD` và order sang `DELIVERED`. Lỗi 429/5xx retry exponential; blocked/chat-not-found/dữ liệu-key lỗi dừng retry; lỗi timeout hoặc crash sau send được xem là mơ hồ và yêu cầu admin xử lý.

## JWT admin

`POST /api/admin/auth/login` trả access token ngắn hạn và refresh token. Mỗi refresh token chỉ được dùng một lần; reuse sẽ revoke toàn bộ token family. Role chứa permission strings; `*` dành cho super-admin. Các quyền hiện dùng:

- `inventory.import`
- `inventory.manage`
- `inventory.read_sensitive`
- `payments.approve`
- `orders.delivery_recover`
- `bot.manage`
- `products.manage`
- `analytics.read`
- `users.read`
- `wallet.read`
- `audit.read`
- `warranty.manage`

Delivery retry được cấu hình bằng `DELIVERY_ATTEMPTS` và `DELIVERY_BACKOFF_MS`. BullMQ bắt buộc sử dụng engine Redis tương thích IORedis ở bên trong; ứng dụng không khởi tạo IORedis trực tiếp vì BullMQ chưa hỗ trợ `Bun.RedisClient` làm connection adapter.

## Đổi Telegram bot token không cần build lại

Mở trang admin, vào thẻ **Telegram bot token**, dán token mới từ `@BotFather` và chọn **Lưu token**. API sẽ:

1. kiểm tra token trực tiếp với Telegram trước khi nhận;
2. mã hóa token bằng AES-256-GCM rồi lưu tại setting `telegram.bot_token`;
3. chỉ trả masked token về giao diện;
4. ghi audit log `TELEGRAM_BOT_TOKEN_UPDATED` không chứa token;
5. runtime Docker tự kiểm tra setting và chuyển token trong tối đa `BOT_CONFIG_POLL_SECONDS` giây; runtime Vercel cấu hình Telegram webhook ngay khi lưu.

Không cần build image hoặc restart container. `BOT_TOKEN` trong environment chỉ là token bootstrap/fallback khi database chưa có cấu hình. Chỉ role có quyền `bot.manage` được xem trạng thái hoặc cập nhật token.

Không dùng `ADMIN_SECRET` query parameter cũ.

## Key management

`ENCRYPTION_KEY` phải giải mã thành đúng 32 byte. Payload envelope lưu `v`, `alg`, `iv`, authentication tag và ciphertext. Khi rotate:

1. thêm key mới và tất cả key cũ vào `ENCRYPTION_KEYS_JSON`;
2. tăng `ENCRYPTION_KEY_VERSION`;
3. deploy để dữ liệu mới dùng version mới;
4. chạy migration re-encrypt theo batch trước khi gỡ key cũ.

Giữ `PAYLOAD_HASH_KEY` ổn định để duplicate detection tiếp tục hoạt động. Trong production dùng KMS/secret manager, TLS cho MongoDB/Redis, secret rotation, backup được kiểm thử và network policy.

## Test

```bash
bun run typecheck
bun test                         # unit/default; integration bị skip
RUN_INTEGRATION=1 bun test tests/integration
```

Integration suite khởi tạo MongoDB Replica Set thật bằng `MongoMemoryReplSet` và kiểm tra: tranh item cuối, request đồng thời, duyệt nạp đồng thời, webhook lặp, worker idempotent, abort transaction, mất kết nối MongoDB, restart Redis worker, reservation hết hạn, import trùng, sai key version và RBAC dữ liệu nhạy cảm.

## Production

- Dùng MongoDB managed hoặc Replica Set ít nhất 3 data-bearing nodes; **không dùng standalone**.
- Chạy migration trước khi rollout API mới; chỉ bật một migration job.
- Với Docker/VPS: tách API, bot/worker và admin-web; scale worker bằng BullMQ concurrency; dùng Redis HA/persistence, TLS, password/ACL và không public port.
- Với Vercel: dùng `APP_RUNTIME=serverless`, MongoDB Atlas Replica Set, QStash và Telegram webhook; không chạy polling/worker process dài hạn hoặc Redis chỉ để queue.
- Cấu hình callback Cake có header `signature`; không dùng timer, Vercel Cron hay QStash Schedule để quét lịch sử giao dịch ngân hàng.
- Terminate TLS ở load balancer/Nginx, rate-limit login/webhook, verify webhook signature ở edge.
- Không bake `.env` vào image. Dùng secret manager cho JWT, Telegram, webhook và encryption keys.
- `TOKEN_API_BANK` là bí mật dùng để xác thực header `signature` của callback Cake; đặt trong form quản trị hoặc secret manager, tuyệt đối không commit giá trị thật.
- Theo dõi order `DELIVERY_FAILED`, reservation quá hạn, low stock, queue stalled và transaction abort rate.
- Backup MongoDB và kiểm thử restore cùng toàn bộ encryption key version còn cần thiết.
