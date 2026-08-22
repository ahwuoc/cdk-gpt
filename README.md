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

`/api/internal/cron` **không kiểm tra giao dịch bank**. Lịch `0 0 * * *` chỉ chạy bảo trì mỗi ngày lúc 00:00 UTC: nhả reservation hết hạn và republish delivery bị lỡ sau commit, nên tương thích Vercel Hobby. Nút **Kiểm tra tiền** trên bot chỉ đọc trạng thái mới nhất đã được Cake callback cập nhật.

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

## Quy trình mua và giao hàng

`PurchaseService.purchase()` thực hiện trong một session transaction:

1. kiểm tra idempotency, user active, product active, giá, limit và số dư;
2. atomic reserve một inventory item;
3. tạo order bằng ObjectId đã cấp trước;
4. atomic debit số dư;
5. tạo wallet ledger và gắn vào order;
6. commit với majority write concern;
7. enqueue delivery sau commit (BullMQ ở `server`; QStash ở `serverless`).

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
