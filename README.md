# CCC家電 AI 智慧導購與門市營運管理系統

> ⚠️ 作品集模擬專案：以「3C 家電連鎖門市」營運情境為參考設計，**非任何企業官方系統、未經任何企業授權**，不連接任何真實內部系統。所有商品、門市、價格、庫存、訂單皆為虛構測試資料。

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
- [ ] 第三階段：多門市 WMS
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

示範資料：5 家虛構門市、30 項商品（6 個虛構品牌：晴川、森和、冬嶼、光禾、海拓、禾風），其中 1 項已停售並由新款取代、4 項低庫存。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 後端與資料庫狀態 |
| GET | `/api/stats` | 營運快照數字 |
| GET | `/api/stores` | 門市清單 |
| GET | `/api/categories` | 分類與商品數 |
| GET | `/api/products?q=&category=&status=` | 商品清單（含目前價格、全門市可售） |
| GET | `/api/products/:id` | 商品詳情（規格、各店庫存、價格歷史） |
| POST | `/api/products` | 新增商品（自動編號、各店建立 0 庫存） |
| PUT | `/api/products/:id` | 修改商品（價格有變會留下價格歷史） |
| POST | `/api/demo/reset` | 重置示範資料 |
