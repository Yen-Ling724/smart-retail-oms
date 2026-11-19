// `npm run db:reset`：清空並重建示範資料（後端要先關掉）
import { getDb } from './index.js';
import { seed } from './seed.js';

await seed({ reset: true });
console.log('示範資料已重置：20 間門市、1,093 項商品');
await (await getDb()).close();
