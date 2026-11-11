// `npm run db:reset`：清空並重建示範資料（後端要先關掉）
import { getDb } from './index.js';
import { seed } from './seed.js';

await seed({ reset: true });
console.log('示範資料已重置：5 家門市、30 項商品');
await (await getDb()).close();
