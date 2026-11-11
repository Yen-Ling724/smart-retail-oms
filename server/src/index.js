import express from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(express.json());

// 健康檢查：讓前端確認後端有在運作
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'smart-retail-oms-server', time: new Date().toISOString() });
});

// 找不到的 API 一律回 404 JSON
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: '找不到這個 API' });
});

app.listen(PORT, () => {
  console.log(`後端已啟動：http://localhost:${PORT}`);
});
