-- Auto-generated from catalog YAML. DO NOT EDIT MANUALLY.
-- Generated at: 2026-03-24 09:42:20

-- customer_master: 会員マスタ
CREATE TABLE IF NOT EXISTS "customer_master" (
    "customer_id" VARCHAR(16) NOT NULL,
    "customer_name" VARCHAR(100) NOT NULL,
    "gender" VARCHAR(4) NOT NULL,
    "birth_date" DATE,
    "postal_code" VARCHAR(8),
    "prefecture" VARCHAR(10),
    "loyalty_rank" VARCHAR(10) NOT NULL,
    "registration_date" DATE NOT NULL,
    "email" VARCHAR(200),
    "phone" VARCHAR(20)
);

-- product_master: 商品マスタ
CREATE TABLE IF NOT EXISTS "product_master" (
    "product_code" VARCHAR(13) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "jan_code" VARCHAR(13),
    "category_large" VARCHAR(50) NOT NULL,
    "category_medium" VARCHAR(50) NOT NULL,
    "category_small" VARCHAR(50),
    "unit_price" INTEGER NOT NULL,
    "cost_price" INTEGER,
    "supplier_name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL,
    "registered_date" DATE NOT NULL
);

-- purchase_history: 購買履歴
CREATE TABLE IF NOT EXISTS "purchase_history" (
    "transaction_detail_id" SERIAL NOT NULL,
    "transaction_id" VARCHAR(20) NOT NULL,
    "customer_id" VARCHAR(16) NOT NULL,
    "product_code" VARCHAR(13) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "transaction_time" TIME,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "discount_amount" INTEGER NOT NULL,
    "store_code" VARCHAR(10) NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "payment_method" VARCHAR(20),
    "point_used" INTEGER NOT NULL
);
