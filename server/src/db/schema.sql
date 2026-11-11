-- CCC家電 資料表（第一、二階段：門市、商品、價格、庫存）
-- 訂單、促銷、使用者等資料表會在後續階段加入。

CREATE TABLE IF NOT EXISTS stores (
  store_id   text PRIMARY KEY,
  name       text NOT NULL,
  city       text NOT NULL,
  address    text NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  product_id  text PRIMARY KEY,
  category    text NOT NULL,
  brand       text NOT NULL,
  model       text NOT NULL UNIQUE,
  name        text NOT NULL,
  specs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_url   text,
  warranty    text,
  replaced_by text REFERENCES products(product_id),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 價格歷史：valid_to 為空的那一筆就是目前價格
CREATE TABLE IF NOT EXISTS product_prices (
  id          bigserial PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products(product_id),
  list_price  integer NOT NULL CHECK (list_price >= 0),
  sale_price  integer NOT NULL CHECK (sale_price >= 0 AND sale_price <= list_price),
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_price ON product_prices (product_id) WHERE valid_to IS NULL;

-- 各店庫存；可售 = 實體 - 預留 - 展示 - 瑕疵（在途不計入）
CREATE TABLE IF NOT EXISTS inventory (
  store_id    text NOT NULL REFERENCES stores(store_id),
  product_id  text NOT NULL REFERENCES products(product_id),
  on_hand     integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved    integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  display     integer NOT NULL DEFAULT 0 CHECK (display >= 0),
  damaged     integer NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  in_transit  integer NOT NULL DEFAULT 0 CHECK (in_transit >= 0),
  PRIMARY KEY (store_id, product_id),
  CHECK (on_hand >= reserved + display + damaged)
);
