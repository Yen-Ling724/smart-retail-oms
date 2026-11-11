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

-- 調貨單：from_store_id 為空代表「總倉補貨」
CREATE TABLE IF NOT EXISTS stock_transfers (
  id            bigserial PRIMARY KEY,
  product_id    text NOT NULL REFERENCES products(product_id),
  from_store_id text REFERENCES stores(store_id),
  to_store_id   text NOT NULL REFERENCES stores(store_id),
  qty           integer NOT NULL CHECK (qty > 0),
  status        text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_store_id IS NULL OR from_store_id <> to_store_id)
);

-- 庫存異動紀錄：每次進貨、展示、瑕疵、報廢、盤點、調貨都留一筆
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id              bigserial PRIMARY KEY,
  store_id        text NOT NULL REFERENCES stores(store_id),
  product_id      text NOT NULL REFERENCES products(product_id),
  type            text NOT NULL,
  qty             integer NOT NULL,          -- 輸入的數量（盤點時為盤點後的實體數）
  qty_change      integer NOT NULL,          -- 實體庫存的變化量
  available_after integer NOT NULL,          -- 異動後的可售數
  note            text,
  ref_order_no    text,                      -- 之後訂單出貨會用到
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS ref_transfer_id bigint REFERENCES stock_transfers(id);
-- 異動類型清單（用 DROP + ADD，舊資料庫也能更新到最新清單）
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_type_check CHECK (type IN (
  'receive', 'display_add', 'display_remove', 'damage', 'scrap', 'count',
  'transfer_out', 'transfer_in', 'transfer_cancel'
));
CREATE INDEX IF NOT EXISTS inventory_tx_product ON inventory_transactions (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_tx_store ON inventory_transactions (store_id, created_at DESC);
