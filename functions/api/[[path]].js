// Cloudflare Workers API for Personal Finance Tracker
// 部署到 Cloudflare Pages Functions: functions/api/[[path]].js

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  
  // CORS 配置
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // 处理 OPTIONS 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 路由处理
    if (path === '/login' && request.method === 'POST') {
      return await handleLogin(request, env, corsHeaders);
    }
    
    // 需要认证的路由
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token || !await verifyToken(token, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    if (path === '/data' && request.method === 'GET') {
      return await getData(env, corsHeaders);
    }
    
    if (path === '/savings/add' && request.method === 'POST') {
      return await addSaving(request, env, corsHeaders);
    }
    
    if (path === '/savings/update-goal' && request.method === 'POST') {
      return await updateSavingsGoal(request, env, corsHeaders);
    }
    
    if (path === '/savings/update-rate' && request.method === 'POST') {
      return await updateInterestRate(request, env, corsHeaders);
    }
    
    if (path === '/entertainment/recharge' && request.method === 'POST') {
      return await rechargeEntertainment(request, env, corsHeaders);
    }
    
    if (path === '/entertainment/expense' && request.method === 'POST') {
      return await addExpense(request, env, corsHeaders);
    }
    
    if (path === '/rates/update' && request.method === 'GET') {
      return await updateExchangeRates(env, corsHeaders);
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse({ error: error.message }, 500, corsHeaders);
  }
}

// 登录处理
async function handleLogin(request, env, corsHeaders) {
  const { username, password } = await request.json();
  
  // 从环境变量读取用户名密码
  const validUsername = env.APP_USERNAME || 'admin';
  const validPassword = env.APP_PASSWORD || 'password123';
  
  if (username === validUsername && password === validPassword) {
    // 生成简单的 token (生产环境应使用 JWT)
    const token = btoa(`${username}:${Date.now()}`);
    
    return jsonResponse({ 
      success: true, 
      token 
    }, 200, corsHeaders);
  }
  
  return jsonResponse({ 
    success: false, 
    message: 'Invalid credentials' 
  }, 401, corsHeaders);
}

// 验证 token
async function verifyToken(token, env) {
  try {
    const decoded = atob(token);
    const [username] = decoded.split(':');
    return username === (env.APP_USERNAME || 'admin');
  } catch {
    return false;
  }
}

// 获取所有数据
async function getData(env, corsHeaders) {
  const db = env.DB;
  
  // 获取储蓄数据
  const savingsConfig = await db.prepare(
    'SELECT goal, interest_rate FROM savings_config WHERE id = 1'
  ).first();
  
  const savingsTotal = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM savings_records'
  ).first();
  
  const savingsRecords = await db.prepare(
    'SELECT id, amount, date FROM savings_records ORDER BY date DESC, id DESC LIMIT 5'
  ).all();
  
  // 获取娱乐消费数据
  const entertainmentBalance = await db.prepare(
    'SELECT COALESCE(balance, 0) as balance FROM entertainment_balance WHERE id = 1'
  ).first();
  
  const entertainmentRecords = await db.prepare(
    'SELECT id, amount, currency, note, date FROM entertainment_records ORDER BY date DESC, id DESC LIMIT 20'
  ).all();
  
  // 获取汇率
  const rates = await db.prepare(
    'SELECT currency, rate FROM exchange_rates WHERE currency IN ("CAD", "CNY")'
  ).all();
  
  const ratesMap = {};
  rates.results.forEach(r => {
    ratesMap[r.currency] = r.rate;
  });
  
  return jsonResponse({
    savings: {
      goal: savingsConfig?.goal || 50000,
      current: savingsTotal?.total || 0,
      interestRate: savingsConfig?.interest_rate || 4.5,
      records: savingsRecords.results || []
    },
    entertainment: {
      balance: entertainmentBalance?.balance || 0,
      records: entertainmentRecords.results || []
    },
    rates: ratesMap
  }, 200, corsHeaders);
}

// 添加储蓄记录
async function addSaving(request, env, corsHeaders) {
  const { amount } = await request.json();
  const db = env.DB;
  
  const date = new Date().toISOString().split('T')[0];
  
  await db.prepare(
    'INSERT INTO savings_records (amount, date) VALUES (?, ?)'
  ).bind(amount, date).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

// 更新储蓄目标
async function updateSavingsGoal(request, env, corsHeaders) {
  const { goal } = await request.json();
  const db = env.DB;
  
  await db.prepare(
    'UPDATE savings_config SET goal = ? WHERE id = 1'
  ).bind(goal).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

// 更新利率
async function updateInterestRate(request, env, corsHeaders) {
  const { rate } = await request.json();
  const db = env.DB;
  
  await db.prepare(
    'UPDATE savings_config SET interest_rate = ? WHERE id = 1'
  ).bind(rate).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

// 充值娱乐资金
async function rechargeEntertainment(request, env, corsHeaders) {
  const { amount } = await request.json();
  const db = env.DB;
  
  const date = new Date().toISOString().split('T')[0];
  
  // 更新余额
  await db.prepare(
    'UPDATE entertainment_balance SET balance = balance + ? WHERE id = 1'
  ).bind(amount).run();
  
  // 添加记录
  await db.prepare(
    'INSERT INTO entertainment_records (amount, currency, note, date) VALUES (?, ?, ?, ?)'
  ).bind(amount, 'USD', '充值', date).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

// 添加消费记录
async function addExpense(request, env, corsHeaders) {
  const { amount, currency, note } = await request.json();
  const db = env.DB;
  
  const date = new Date().toISOString().split('T')[0];
  
  // 获取汇率
  let rate = 1;
  if (currency !== 'USD') {
    const rateData = await db.prepare(
      'SELECT rate FROM exchange_rates WHERE currency = ?'
    ).bind(currency).first();
    rate = rateData?.rate || 1;
  }
  
  // 计算 USD 金额
  const usdAmount = amount / rate;
  
  // 更新余额
  await db.prepare(
    'UPDATE entertainment_balance SET balance = balance - ? WHERE id = 1'
  ).bind(usdAmount).run();
  
  // 添加记录
  await db.prepare(
    'INSERT INTO entertainment_records (amount, currency, note, date, exchange_rate) VALUES (?, ?, ?, ?, ?)'
  ).bind(-amount, currency, note || '消费', date, rate).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

// 更新汇率（从外部 API 获取）
async function updateExchangeRates(env, corsHeaders) {
  try {
    // 使用免费的汇率 API
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    
    const db = env.DB;
    
    // 更新 CAD 汇率
    if (data.rates.CAD) {
      await db.prepare(
        'INSERT OR REPLACE INTO exchange_rates (id, currency, rate, updated_at) VALUES (1, "CAD", ?, datetime("now"))'
      ).bind(data.rates.CAD).run();
    }
    
    // 更新 CNY 汇率
    if (data.rates.CNY) {
      await db.prepare(
        'INSERT OR REPLACE INTO exchange_rates (id, currency, rate, updated_at) VALUES (2, "CNY", ?, datetime("now"))'
      ).bind(data.rates.CNY).run();
    }
    
    return jsonResponse({ 
      success: true, 
      rates: {
        CAD: data.rates.CAD,
        CNY: data.rates.CNY
      }
    }, 200, corsHeaders);
  } catch (error) {
    return jsonResponse({ error: 'Failed to update rates' }, 500, corsHeaders);
  }
}

// JSON 响应辅助函数
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}