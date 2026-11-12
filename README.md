# CCC家電 AI 智慧導購與門市營運管理系統

> ⚠️ 作品集模擬專案：以「3C 家電連鎖門市」營運情境為參考設計，**非任何企業官方系統、未經任何企業授權**，不連接任何真實內部系統。品牌名稱僅用於呈現情境；商品型號、規格、門市、價格、庫存、訂單皆為虛構測試資料，與各品牌官方無關。

## 功能模組
1. 商品主檔管理（MDM / PIM）
2. 價格與促銷管理
3. 多門市庫存管理（WMS）
4. 訂單管理（OMS）＋多商品購物車
5. AI 智慧導購（Claude API，只根據資料庫回答）
6. 營運分析儀表板

## 技術架構
| 層 | 技術 |
|---|---|
| 前端 | React + Vite |
| 後端 | Node.js + Express（REST API） |
| 資料庫 | PostgreSQL：本機開發用 PGlite（免安裝），上線用 Supabase |
| AI | Claude API（金鑰只放後端環境變數） |
| 部署 | 前端 Vercel／後端 Render |

詳細規劃見 [docs/規劃與盤點.md](docs/規劃與盤點.md)。

## 開發進度
- [x] 第一階段：開發環境與網站基本架構（前端、後端、本機資料庫）
- [x] 第二階段：商品資料庫與商品管理（商品清單、搜尋篩選、詳情、新增編輯、價格歷史）
  - [ ] 尚未做：價格促銷管理、登入權限（admin／staff）
- [x] 第三階段：多門市 WMS（庫存總表、進貨／展示機／瑕疵／報廢／盤點、門市調貨與總倉補貨、異動紀錄）
- [x] 第四階段：OMS 訂單與購物車（購物車建單、預留／出貨／完成／取消、防超賣、處理紀錄）
- [~] 第五階段：AI 智慧導購 — 導購畫面與「關鍵字模式」完成；Claude API（AI 模式）待設定金鑰後接上
- [~] 第六階段：營運分析儀表板完成；部署設定完成（Render），待上線與加入作品集

## 部署（Render，一個服務）

- `npm run build`（根目錄）：安裝並打包前端，安裝後端套件。
- `npm start`：啟動後端；後端偵測到 `client/dist` 就一起提供網頁，所以網頁和 API 是同一個網址，不需要另外設定 CORS。
- `render.yaml` 是 Render 的設定檔（免費方案、新加坡、健康檢查 `/api/health`）。
- **線上一定要用 Supabase**：PGlite 一啟動就要約 600MB 記憶體，超過 Render 免費方案的 512MB；改連 Supabase 後後端只用約 80MB。在 Render 的 Environment 設定 `DATABASE_URL`（Supabase → Connect → Session pooler 的連線字串，把 `[YOUR-PASSWORD]` 換成資料庫密碼），不要寫進程式碼。
- `DEMO_RESET_ON_START=true`：每次啟動（Render 免費方案閒置約 15 分鐘會休眠，下次開啟約需 1 分鐘喚醒）都重建示範資料，訪客改亂了也沒關係。
- 本機想測「連外部資料庫」的路徑，可以用 `@electric-sql/pglite-socket` 開一個假的 Postgres 伺服器，再把 `DATABASE_URL` 指到 `127.0.0.1`（本機連線不加密）。

## 本機開發

需要開**兩個終端機**，前端和後端各一個：

```bash
# 終端機 1：後端（http://localhost:3001）
cd server
npm install        # 第一次才需要
cp .env.example .env   # 第一次才需要
npm run dev

# 終端機 2：前端（http://localhost:5173）
cd client
npm install        # 第一次才需要
npm run dev
```

前端開發時會把 `/api` 開頭的請求轉給後端（設定在 `client/vite.config.js`）。
畫面右上角顯示「後端連線正常」就代表前後端接通了。

## 資料庫

- **沒設定 `DATABASE_URL`**：自動使用本機 PGlite，資料存在 `server/.data/`（不進版本紀錄）。第一次啟動會自動建立示範資料。
- **設定了 `DATABASE_URL`**（Supabase 連線字串）：改連 Supabase，程式不用改。
- 重置示範資料：後端關掉後執行 `npm run db:reset`，或在後端執行中呼叫 `POST /api/demo/reset`。

**商品規格範本**：每個分類有固定的規格欄位（設定在 `server/src/specTemplates.js`），例如冰箱必填容量、門數、能效。欄位類型有數字、下拉選單（`numeric: true` 的選項是數字，如電視尺寸 55 吋）、尺寸（寬 × 深 × 高三格，存成 `{ 寬, 深, 高 }`，舊的「68×70×178 cm」文字會自動轉換）、文字（可附建議清單）。保固也是下拉選單（1／2／3／5／10 年，「3年」會自動整理成「3 年」）。數字欄位存純數字（如 `容量: 480`），單位在範本裡；新增或修改商品時後端會依範本檢查，示範資料也一樣要通過檢查。要新增分類或欄位，改這個檔案就好。

**品牌清單**：每個分類有自己的品牌下拉選單（同一個檔案的 `BRANDS`），參考台灣家電通路常見品牌，最後一項都是「其他品牌」。品牌名稱僅用於呈現零售情境；型號一律以 `DM-`（Demo）開頭，規格、價格、庫存皆為虛構。

示範資料：5 家虛構門市、30 項商品，其中 1 項已停售並由新款取代、4 項低庫存；在途數量都有對應的「總倉補貨」調貨單。

**庫存規則**（`server/src/routes/inventory.js`）：
- 可售 = 實體 − 預留 − 展示 − 瑕疵；在途尚未到店，不算可售。
- 進貨、上／撤展示機、標記瑕疵、瑕疵報廢、盤點調整，每一次都寫進 `inventory_transactions`。
- 調貨：調出門市**立刻扣實體**、調入門市記「在途」；按「到貨」才轉成實體庫存，取消會退回調出門市。調出量不能超過調出門市的可售。
- 每次調整都在資料庫交易裡鎖住那一列庫存，避免兩個人同時調整算錯。
- 門市有「區域」（北區／中區／南區／東區，依縣市自動判斷，規則在 `server/src/regions.js`）。庫存總表可以切換「依門市／依區域」：區域檢視把各店加總，點進去再看該區門市。門市增加到全台時，欄位數仍維持在區域數量。

**訂單規則**（`server/src/routes/orders.js`）：
- 狀態：待確認 → 已預留（扣可售、加預留）→ 已出貨（扣實體、扣預留）→ 已完成；出貨前可取消，已預留的會釋放。
- **防超賣**：預留時用條件式更新 `UPDATE inventory SET reserved = reserved + n WHERE … AND 可售 >= n`，任何一項更新不到就丟錯，整張訂單在同一個交易裡回復原狀。兩張訂單同時搶最後一件，只有一張會成功。
- 價格用下單當下的售價存進 `order_items.unit_price`，之後改價不影響舊訂單。
- 同一支手機視為同一位顧客（`customers.phone` 唯一）。訂單編號格式 `SO + 台灣日期 + 流水號`。
- 「預留」數量只能由訂單產生；示範資料的預留都來自示範訂單。升級前就存在的預留，會自動補建 `SO-LEGACY-xxx` 訂單，讓帳對得起來。

**智慧導購（關鍵字模式）**（`server/src/assistant/`）：
- `parse.js` 從中文問句抓出分類、預算（2萬、兩萬五、一萬五千、15000 元）、坪數、吋數、人數（小家庭、租屋族…）、品牌（含「國際牌」等別名）與偏好（省電、冷暖、滾筒、烘乾、4K、便宜）。追問時沿用上一輪條件，支援「預算多 5 千」「少一萬」等相對調整，偏好會累加。
- `recommend.js` 只從**上架中、全台有庫存**的商品挑選，依規格範本評分（例如人數 → 冰箱容量範圍、坪數 → 冷氣適用坪數），指定門市時優先推現貨。完全符合的沒有時會放寬條件，並逐項列出**不符合的地方**（例如「是直立式，不是滾筒式」），不會假裝符合。
- 看不懂的問句會請顧客說清楚，不會亂推。
- 之後在 `server/.env` 設定 `ANTHROPIC_API_KEY` 再加入 AI 模式；沒有金鑰或額度用完時仍使用關鍵字模式。

**測試用資料庫**：設定 `PGLITE_DIR` 可以讓後端用另一個資料夾，例如 `PORT=3002 PGLITE_DIR=../tmp-db node src/index.js`；前端用 `API_PROXY=http://localhost:3002 npx vite --port 5181` 接過去，就不會動到平常的資料。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 後端與資料庫狀態 |
| GET | `/api/stats` | 營運快照數字 |
| GET | `/api/stores` | 門市清單 |
| GET | `/api/categories` | 分類與商品數 |
| GET | `/api/catalog-config` | 各分類的規格欄位與品牌清單 |
| GET | `/api/products?q=&category=&brand=&status=` | 商品清單（含目前價格、全門市可售） |
| GET | `/api/products/:id` | 商品詳情（規格、各店庫存、價格歷史、最近 10 筆庫存異動） |
| POST | `/api/products` | 新增商品（自動編號、各店建立 0 庫存） |
| PUT | `/api/products/:id` | 修改商品（價格有變會留下價格歷史） |
| GET | `/api/inventory?store=&category=&q=&status=` | 庫存列表（商品 × 門市） |
| POST | `/api/inventory/adjust` | 調整庫存：`receive`／`display_add`／`display_remove`／`damage`／`scrap`／`count` |
| GET | `/api/inventory/movements?store=&product=&limit=` | 庫存異動紀錄 |
| GET | `/api/transfers?status=&store=` | 調貨單列表 |
| POST | `/api/transfers` | 建立調貨單（`from_store_id` 空白＝總倉補貨） |
| POST | `/api/transfers/:id/receive` | 調貨到貨入庫 |
| POST | `/api/transfers/:id/cancel` | 取消調貨（退回調出門市） |
| GET | `/api/orders?status=&store=&q=` | 訂單列表（`status=open` 為進行中），附各狀態數量 |
| GET | `/api/orders/:no` | 訂單詳情（商品、顧客、處理紀錄） |
| POST | `/api/orders` | 建立訂單；`reserve_now: true` 會立即預留（失敗時訂單留在待確認並回傳原因） |
| POST | `/api/orders/:no/confirm` | 確認並預留庫存 |
| POST | `/api/orders/:no/ship` | 出貨／顧客取貨 |
| POST | `/api/orders/:no/complete` | 完成 |
| POST | `/api/orders/:no/cancel` | 取消（已預留的會釋放） |
| GET | `/api/assistant/status` | 導購模式（目前為 `keyword`） |
| POST | `/api/assistant/ask` | 導購問答：`{ question, store_id?, context? }` → 理解的需求、回答、推薦商品（理由與不符合處） |
| POST | `/api/demo/reset` | 重置示範資料 |
