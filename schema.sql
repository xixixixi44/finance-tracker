-- Cloudflare D1 数据库初始化脚本

-- 储蓄配置表
CREATE TABLE IF NOT EXISTS savings_config (
    id INTEGER PRIMARY KEY,
    goal REAL NOT NULL DEFAULT 50000,
    interest_rate REAL NOT NULL DEFAULT 4.5,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认配置
INSERT INTO savings_config (id, goal, interest_rate) 
VALUES (1, 50000, 4.5)
ON CONFLICT(id) DO NOTHING;

-- 储蓄记录表
CREATE TABLE IF NOT EXISTS savings_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 创建日期索引
CREATE INDEX IF NOT EXISTS idx_savings_date ON savings_records(date DESC);

-- 娱乐资金余额表
CREATE TABLE IF NOT EXISTS entertainment_balance (
    id INTEGER PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认余额
INSERT INTO entertainment_balance (id, balance) 
VALUES (1, 0)
ON CONFLICT(id) DO NOTHING;

-- 娱乐消费记录表
CREATE TABLE IF NOT EXISTS entertainment_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    note TEXT,
    date TEXT NOT NULL,
    exchange_rate REAL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 创建日期索引
CREATE INDEX IF NOT EXISTS idx_entertainment_date ON entertainment_records(date DESC);

-- 汇率表
CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY,
    currency TEXT NOT NULL UNIQUE,
    rate REAL NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认汇率（这些会被自动更新）
INSERT INTO exchange_rates (id, currency, rate) 
VALUES 
    (1, 'CAD', 1.36),
    (2, 'CNY', 7.12)
ON CONFLICT(id) DO UPDATE SET 
    rate = excluded.rate,
    updated_at = CURRENT_TIMESTAMP;