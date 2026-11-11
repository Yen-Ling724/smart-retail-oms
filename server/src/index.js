import express from 'express';
import { getDb } from './db/index.js';
import { replaceLegacyOrders, seed } from './db/seed.js';
import assistantRoutes from './routes/assistant.js';
import inventoryRoutes from './routes/inventory.js';
import orderRoutes from './routes/orders.js';
import productRoutes from './routes/products.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(express.json());

// 健康檢查：讓前端確認後端和資料庫都有在運作
app.get('/api/health', async (req, res) => {
  const db = await getDb();
  await db.query('SELECT 1');
  res.json({ ok: true, service: 'smart-retail-oms-server', database: db.kind, time: new Date().toISOString() });
});

app.use('/api', productRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', orderRoutes);
app.use('/api', assistantRoutes);

// 重置示範資料（公開展示時訪客可能改亂資料）。之後加入登入後只開放給 admin。
app.post('/api/demo/reset', async (req, res) => {
  await seed({ reset: true });
  res.json({ ok: true, message: '示範資料已重置' });
});

// 刪除系統補建的 SO-LEGACY 訂單並補上示範訂單（不動其他資料）
app.post('/api/demo/replace-legacy-orders', async (req, res) => {
  const result = await replaceLegacyOrders();
  res.json({ ok: true, ...result });
});

// 找不到的 API 一律回 404 JSON
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: '找不到這個 API' });
});

// 錯誤處理：已知錯誤回對應訊息，其他回 500
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: '資料格式不正確' });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ ok: false, error: err.message });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: '伺服器發生錯誤，請稍後再試' });
});

const db = await getDb();
const seeded = await seed();
console.log(`資料庫：${db.kind === 'local' ? '本機 PGlite（server/.data）' : 'Supabase'}${seeded ? '，已建立示範資料' : ''}`);

app.listen(PORT, () => {
  console.log(`後端已啟動：http://localhost:${PORT}`);
});
