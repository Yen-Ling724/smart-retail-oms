import { Router } from 'express';
import { query } from '../db/index.js';
import { describeNeed, recommend } from '../assistant/recommend.js';
import { mergeContext, parseQuestion } from '../assistant/parse.js';
import { HttpError } from './products.js';

const router = Router();

const fmt = (n) => Number(n).toLocaleString('zh-TW');

// 目前只有關鍵字模式；之後在 .env 設定 ANTHROPIC_API_KEY 再加上 AI 模式
router.get('/assistant/status', (req, res) => {
  res.json({ ok: true, mode: 'keyword', ai_configured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

router.post('/assistant/ask', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) throw new HttpError(400, '請輸入想找的商品或需求');
  if (question.length > 300) throw new HttpError(400, '問題最多 300 字');

  const storeId = req.body?.store_id || null;
  let storeName = null;
  if (storeId) {
    const [store] = await query('SELECT name FROM stores WHERE store_id = $1', [storeId]);
    if (!store) throw new HttpError(400, '找不到這家門市');
    storeName = store.name;
  }

  const parsed = parseQuestion(question);
  const need = mergeContext(parsed, req.body?.context);
  const understood = describeNeed(need);

  // 追問時這句話沒有任何可用的條件（例如「你好」）：不要默默重複上一次的推薦
  const hasSignal = ['category', 'budget', 'budgetDelta', 'ping', 'inch', 'people', 'brand', 'prefs'].some((k) => parsed[k] != null);
  if (!hasSignal && req.body?.context && understood.length) {
    return res.json({
      ok: true,
      mode: 'keyword',
      need,
      understood,
      answer: `這句我沒有看懂想調整什麼。目前的條件是「${understood.join('・')}」，可以說「預算多 5 千」「要省電的」「便宜一點的」，或直接換一種商品。`,
      products: [],
    });
  }

  // 什麼都沒聽懂：請顧客說清楚，不亂推
  if (!need.category && !need.budget && !need.brand && !need.ping && !need.inch) {
    return res.json({
      ok: true,
      mode: 'keyword',
      need,
      understood,
      answer: '我還不確定你想找哪一類家電。可以告訴我商品種類，再加上預算、坪數或家裡幾個人嗎？例如「預算 2 萬、小家庭的冰箱」。',
      products: [],
    });
  }

  const { picks, total, relaxed } = await recommend(need, storeId);
  let answer;
  if (!picks.length) {
    answer = `依照你的需求（${understood.join('・')}），目前資料庫裡沒有符合且有庫存的商品。可以放寬預算或條件再問我一次。`;
  } else {
    const where = storeName ? `，並優先考慮${storeName}的現貨` : '';
    answer = relaxed
      ? `完全符合「${understood.join('・')}」的商品目前沒有，我稍微放寬條件${where}，找到這 ${picks.length} 項比較接近的：`
      : `依照你的需求（${understood.join('・')}）${where}，從 ${fmt(total)} 項有庫存的商品中推薦這 ${picks.length} 項：`;
  }

  res.json({
    ok: true,
    mode: 'keyword',
    need,
    understood,
    relaxed,
    answer,
    products: picks.map((p) => ({
      product_id: p.product_id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      category: p.category,
      price: p.price,
      list_price: p.list_price,
      reasons: p.reasons,
      misses: p.misses,
      available_here: storeId ? p.available_here : null,
      available_total: p.available_total,
      stores: p.stores.sort((a, b) => b.available - a.available).slice(0, 3),
    })),
  });
});

export default router;
