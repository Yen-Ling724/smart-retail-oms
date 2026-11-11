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
- [ ] 第四階段：OMS 訂單與購物車
- [ ] 第五階段：AI 智慧導購
- [ ] 第六階段：儀表板、測試、部署、作品集介紹

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

**商品規格範本**：每個分類有固定的規格欄位（設定在 `server/src/specTemplates.js`），例如冰箱必填容量、門數、能效。數字欄位存純數字（如 `容量: 480`），單位在範本裡；新增或修改商品時後端會依範本檢查，示範資料也一樣要通過檢查。要新增分類或欄位，改這個檔案就好。

**品牌清單**：每個分類有自己的品牌下拉選單（同一個檔案的 `BRANDS`），參考台灣家電通路常見品牌，最後一項都是「其他品牌」。品牌名稱僅用於呈現零售情境；型號一律以 `DM-`（Demo）開頭，規格、價格、庫存皆為虛構。

示範資料：5 家虛構門市、30 項商品，其中 1 項已停售並由新款取代、4 項低庫存；在途數量都有對應的「總倉補貨」調貨單。

**庫存規則**（`server/src/routes/inventory.js`）：
- 可售 = 實體 − 預留 − 展示 − 瑕疵；在途尚未到店，不算可售。
- 進貨、上／撤展示機、標記瑕疵、瑕疵報廢、盤點調整，每一次都寫進 `inventory_transactions`。
- 調貨：調出門市**立刻扣實體**、調入門市記「在途」；按「到貨」才轉成實體庫存，取消會退回調出門市。調出量不能超過調出門市的可售。
- 每次調整都在資料庫交易裡鎖住那一列庫存，避免兩個人同時調整算錯。
- 門市有「區域」（北區／中區／南區／東區，依縣市自動判斷，規則在 `server/src/regions.js`）。庫存總表可以切換「依門市／依區域」：區域檢視把各店加總，點進去再看該區門市。門市增加到全台時，欄位數仍維持在區域數量。

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
| POST | `/api/demo/reset` | 重置示範資料 |
