# Digital Store

Monorepo bán và giao sản phẩm số qua Telegram. Backend dùng NestJS + Mongoose, kho được mã hóa bằng AES-256-GCM, tiền được lưu bằng số nguyên, và toàn bộ quy trình mua hàng chạy trong MongoDB Replica Set transaction.

> Chỉ nhập và phân phối sản phẩm/tài khoản thuộc quyền sở hữu hợp pháp của người vận hành và được phép chuyển giao theo điều khoản của dịch vụ liên quan.

## Cấu trúc

```text
apps/
  api/                 NestJS REST API + Swagger
  bot/                 Telegraf bot + BullMQ delivery worker
  admin-web/           Next.js/React/Tailwind admin
packages/
  config/              Kiểm tra biến môi trường
  database/
    src/schemas/       16 schema nghiệp vụ + migration record
    src/repositories/  Repository và atomic inventory operations
    src/migrations/    MongoDB migration runner
  encryption/          AES-256-GCM, versioned key ring, HMAC duplicate hash
  shared/              Enum và domain errors
tests/integration/     12 bài kiểm thử trên MongoMemoryReplSet
```

Các collection chính: `admins`, `roles`, `users`, `products`, `inventory_items`, `orders`, `wallet_transactions`, `payment_requests`, `support_tickets`, `warranty_requests`, `referrals`, `settings`, `notifications`, `audit_logs`, `refresh_tokens`, và `import_batches`.

## Bất biến an toàn

- `inventory_items.encryptedPayload` được mã hóa AES-256-GCM trước khi ghi và mặc định bị loại khỏi projection.
- `payloadHash` là HMAC-SHA-256 của dữ liệu đã chuẩn hóa; không thể dùng để khôi phục plaintext.
- Mỗi đơn vị hàng hóa là một document riêng. Unique `{ productId, payloadHash }` chặn nhập trùng.
- `findOneAndUpdate({ productId, status: AVAILABLE, deletedAt: null })` giữ đúng một item trong cùng transaction tạo order/trừ tiền.
- Wallet chỉ dùng integer minor unit. Mỗi biến động tạo một `wallet_transactions` có `balanceBefore`, `balanceAfter` và unique `idempotencyKey`.
- Job BullMQ có `jobId = orderId`. Retry không tạo order và không trừ tiền lại.
- Nếu kết quả gửi Telegram không rõ ràng, item vẫn `RESERVED` và order chuyển sang `DELIVERY_FAILED` để admin xử lý; hệ thống không tự đưa item về kho.
- API đọc payload đầy đủ yêu cầu `inventory.read_sensitive` và tạo audit log không chứa payload.
- Production đặt `autoIndex: false`; index được tạo bằng migration thay vì `syncIndexes()`.

## Development bằng Docker Compose

Yêu cầu Docker/Compose và một Telegram bot token hợp lệ.

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
7. enqueue delivery sau commit.

Worker claim order, giải mã trong memory, render template rồi gửi đúng `telegramId`. Sau xác nhận gửi thành công, transaction thứ hai chuyển inventory sang `SOLD` và order sang `DELIVERED`. Lỗi 429/5xx retry exponential; blocked/chat-not-found/dữ liệu-key lỗi dừng retry; lỗi timeout hoặc crash sau send được xem là mơ hồ và yêu cầu admin xử lý.

## JWT admin

`POST /api/admin/auth/login` trả access token ngắn hạn và refresh token. Mỗi refresh token chỉ được dùng một lần; reuse sẽ revoke toàn bộ token family. Role chứa permission strings; `*` dành cho super-admin. Các quyền hiện dùng:

- `inventory.import`
- `inventory.manage`
- `inventory.read_sensitive`
- `payments.approve`
- `orders.delivery_recover`

Delivery retry được cấu hình bằng `DELIVERY_ATTEMPTS` và `DELIVERY_BACKOFF_MS`. BullMQ bắt buộc sử dụng engine Redis tương thích IORedis ở bên trong; ứng dụng không khởi tạo IORedis trực tiếp vì BullMQ chưa hỗ trợ `Bun.RedisClient` làm connection adapter.

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
- Tách API, bot/worker và admin-web thành deployment riêng; scale worker bằng BullMQ concurrency.
- Dùng Redis HA/persistence, TLS, password/ACL và không public port.
- Terminate TLS ở load balancer/Nginx, rate-limit login/webhook, verify webhook signature ở edge.
- Không bake `.env` vào image. Dùng secret manager cho JWT, Telegram, webhook và encryption keys.
- Theo dõi order `DELIVERY_FAILED`, reservation quá hạn, low stock, queue stalled và transaction abort rate.
- Backup MongoDB và kiểm thử restore cùng toàn bộ encryption key version còn cần thiết.
