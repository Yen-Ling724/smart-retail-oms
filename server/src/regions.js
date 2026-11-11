// 門市區域：依縣市分成北、中、南、東四區（全台展店時用來彙總庫存）
export const REGIONS = ['北區', '中區', '南區', '東區'];

const CITY_REGION = {
  北區: ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣'],
  中區: ['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'],
  南區: ['嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣'],
  東區: ['宜蘭縣', '花蓮縣', '台東縣'],
};

export function regionForCity(city) {
  const normalized = String(city ?? '').replace('臺', '台');
  return REGIONS.find((r) => CITY_REGION[r].includes(normalized)) ?? '其他';
}

// 門市排序：先北中南東，同區再依門市代碼
export const STORE_ORDER_SQL = (alias = 's') =>
  `array_position(ARRAY['北區','中區','南區','東區']::text[], ${alias}.region), ${alias}.store_id`;
