// Cloudflare Workers API for Liberty Ledger
// 部署到 Cloudflare Pages Functions: functions/api/[[path]].js

// --- JWT and Crypto Helpers ---

const encoder = new TextEncoder();

// Helper to create a base64url encoded string from a JSON object
const base64url = (source) => {
  let string = JSON.stringify(source);
  // Normal base64 to base64url conversion
  string = btoa(string).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return string;
}

// Imports or generates a secret key for HMAC signing and verification
async function getSecretKey(env) {
  // IMPORTANT: Set a strong, long, random secret in your Cloudflare environment variables as JWT_SECRET
  const secret = env.JWT_SECRET || 'a-very-weak-secret-please-change-me-in-prod';
  const keyData = encoder.encode(secret);
  return await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// Signs a payload to create a JWT
async function sign(payload, env) {
  const key = await getSecretKey(env);
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(header);
  const encodedPayload = base64url(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  
  // Convert ArrayBuffer to Base64URL string
  const signatureBase64url = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
  return `${data}.${signatureBase64url}`;
}

// Verifies a JWT
async function verify(token, env) {
  if (!token) return null;
  try {
    const key = await getSecretKey(env);
    const [header, payload, signature] = token.split('.');
    
    const data = `${header}.${payload}`;
    const signatureArrayBuffer = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify('HMAC', key, signatureArrayBuffer, encoder.encode(data));
    if (!isValid) {
      return null;
    }

    const decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    
    // Check for token expiration
    if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
      console.log('Token expired');
      return null;
    }
    
    return decodedPayload;
  } catch (e) {
    console.error('Token verification failed:', e);
    return null;
  }
}


// --- Main Request Handler ---

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (path === '/login' && request.method === 'POST') {
      return await handleLogin(request, env, corsHeaders);
    }
    
    // This endpoint is public for cron jobs or manual refresh
    if (path === '/rates/update' && request.method === 'GET') {
      return await updateExchangeRates(env, corsHeaders);
    }

    // --- Protected Routes ---
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    const payload = await verify(token, env);
    
    if (!payload) {
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
    
    if (path === '/savings/delete' && request.method === 'POST') {
      return await deleteSaving(request, env, corsHeaders);
    }
    
    if (path === '/entertainment/delete' && request.method === 'POST') {
      return await deleteExpense(request, env, corsHeaders);
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse({ error: error.message }, 500, corsHeaders);
  }
}

// --- API Functions ---

async function handleLogin(request, env, corsHeaders) {
  const { username, password } = await request.json();
  
  const validUsername = env.APP_USERNAME || 'admin';
  const validPassword = env.APP_PASSWORD || 'your-password';
  
  if (username === validUsername && password === validPassword) {
    const payload = {
      user: username,
      // Set token to expire in 24 hours
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24),
    };
    const token = await sign(payload, env);
    return jsonResponse({ success: true, token }, 200, corsHeaders);
  }
  
  return jsonResponse({ success: false, message: 'Invalid credentials' }, 401, corsHeaders);
}

async function getData(env, corsHeaders) {
  const db = env.DB;
  
  const savingsConfig = await db.prepare('SELECT goal, interest_rate FROM savings_config WHERE id = 1').first();
  const savingsTotal = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM savings_records').first();
  const savingsRecords = await db.prepare('SELECT id, amount, date, rate_cad, rate_cny FROM savings_records ORDER BY date DESC, id DESC').all();
  const entertainmentBalance = await db.prepare('SELECT COALESCE(balance, 0) as balance FROM entertainment_balance WHERE id = 1').first();
  const entertainmentRecords = await db.prepare('SELECT id, amount, currency, note, date, rate_cad, rate_cny FROM entertainment_records ORDER BY date DESC, id DESC').all();
  const ratesQuery = await db.prepare('SELECT currency, rate, updated_at FROM exchange_rates WHERE currency IN ("CAD", "CNY")').all();
  
  const ratesMap = {};
  let updatedAt = null;
  if (ratesQuery.results) {
    ratesQuery.results.forEach(r => {
      ratesMap[r.currency] = r.rate;
      if (r.updated_at) updatedAt = r.updated_at;
    });
  }
  
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
    rates: {
      CAD: ratesMap.CAD || 1.36,
      CNY: ratesMap.CNY || 7.12,
      updatedAt: updatedAt
    }
  }, 200, corsHeaders);
}

async function addSaving(request, env, corsHeaders) {
  const { amount } = await request.json();
  const db = env.DB;
  const date = new Date().toISOString().split('T')[0];
  
  const rates = await db.prepare('SELECT currency, rate FROM exchange_rates WHERE currency IN ("CAD", "CNY")').all();
  const rateCAD = rates.results.find(r => r.currency === 'CAD')?.rate || 1.36;
  const rateCNY = rates.results.find(r => r.currency === 'CNY')?.rate || 7.12;
  
  await db.prepare('INSERT INTO savings_records (amount, date, rate_cad, rate_cny) VALUES (?, ?, ?, ?)').bind(amount, date, rateCAD, rateCNY).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function updateSavingsGoal(request, env, corsHeaders) {
  const { goal } = await request.json();
  await env.DB.prepare('UPDATE savings_config SET goal = ? WHERE id = 1').bind(goal).run();
  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function updateInterestRate(request, env, corsHeaders) {
  const { rate } = await request.json();
  await env.DB.prepare('UPDATE savings_config SET interest_rate = ? WHERE id = 1').bind(rate).run();
  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function rechargeEntertainment(request, env, corsHeaders) {
  const { amount } = await request.json();
  const db = env.DB;
  const date = new Date().toISOString().split('T')[0];
  
  const rates = await db.prepare('SELECT currency, rate FROM exchange_rates WHERE currency IN ("CAD", "CNY")').all();
  const rateCAD = rates.results.find(r => r.currency === 'CAD')?.rate || 1.36;
  const rateCNY = rates.results.find(r => r.currency === 'CNY')?.rate || 7.12;
  
  await db.prepare('UPDATE entertainment_balance SET balance = balance + ? WHERE id = 1').bind(amount).run();
  await db.prepare('INSERT INTO entertainment_records (amount, currency, note, date, rate_cad, rate_cny) VALUES (?, ?, ?, ?, ?, ?)').bind(amount, 'USD', '充值', date, rateCAD, rateCNY).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function addExpense(request, env, corsHeaders) {
  const { amount, currency, note } = await request.json();
  const db = env.DB;
  const date = new Date().toISOString().split('T')[0];
  
  const rates = await db.prepare('SELECT currency, rate FROM exchange_rates WHERE currency IN ("CAD", "CNY")').all();
  const rateCAD = rates.results.find(r => r.currency === 'CAD')?.rate || 1.36;
  const rateCNY = rates.results.find(r => r.currency === 'CNY')?.rate || 7.12;
  
  let rate = 1;
  if (currency === 'CAD') rate = rateCAD;
  else if (currency === 'CNY') rate = rateCNY;
  
  const usdAmount = amount / rate;
  
  await db.prepare('UPDATE entertainment_balance SET balance = balance - ? WHERE id = 1').bind(usdAmount).run();
  await db.prepare('INSERT INTO entertainment_records (amount, currency, note, date, rate_cad, rate_cny) VALUES (?, ?, ?, ?, ?, ?)').bind(-amount, currency, note || '消费', date, rateCAD, rateCNY).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function deleteSaving(request, env, corsHeaders) {
  const { id } = await request.json();
  const db = env.DB;
  
  const record = await db.prepare('SELECT amount FROM savings_records WHERE id = ?').bind(id).first();
  if (!record) {
    return jsonResponse({ error: 'Record not found' }, 404, corsHeaders);
  }
  
  // This is a simple delete. For full accuracy, you might want to adjust total savings.
  // However, the current logic recalculates totals on every load, so just deleting is fine.
  await db.prepare('DELETE FROM savings_records WHERE id = ?').bind(id).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function deleteExpense(request, env, corsHeaders) {
  const { id } = await request.json();
  const db = env.DB;
  
  const record = await db.prepare('SELECT amount, currency, rate_cad, rate_cny FROM entertainment_records WHERE id = ?').bind(id).first();
  if (!record) {
    return jsonResponse({ error: 'Record not found' }, 404, corsHeaders);
  }
  
  let rate = 1;
  if (record.currency === 'CAD' && record.rate_cad) rate = record.rate_cad;
  else if (record.currency === 'CNY' && record.rate_cny) rate = record.rate_cny;
  
  const usdAmount = Math.abs(record.amount) / rate;
  
  // If it was a debit (expense), add the amount back. If it was a credit (recharge), subtract it.
  const balanceAdjustment = record.amount < 0 ? usdAmount : -record.amount;

  await db.prepare('UPDATE entertainment_balance SET balance = balance + ? WHERE id = 1').bind(balanceAdjustment).run();
  await db.prepare('DELETE FROM entertainment_records WHERE id = ?').bind(id).run();
  
  return jsonResponse({ success: true }, 200, corsHeaders);
}

export async function onScheduled(event, env, ctx) {
  ctx.waitUntil(updateExchangeRates(env, {}));
}

async function updateExchangeRates(env, corsHeaders) {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!response.ok) throw new Error(`API responded with status ${response.status}`);
    const data = await response.json();
    
    const db = env.DB;
    const now = new Date().toISOString();
    
    if (data.rates.CAD) {
      await db.prepare('INSERT OR REPLACE INTO exchange_rates (id, currency, rate, updated_at) VALUES (1, "CAD", ?, ?)').bind(data.rates.CAD, now).run();
    }
    if (data.rates.CNY) {
      await db.prepare('INSERT OR REPLACE INTO exchange_rates (id, currency, rate, updated_at) VALUES (2, "CNY", ?, ?)').bind(data.rates.CNY, now).run();
    }
    
    return jsonResponse({ success: true, rates: { CAD: data.rates.CAD, CNY: data.rates.CNY }}, 200, corsHeaders);
  } catch (error) {
    console.error('Failed to update rates:', error);
    return jsonResponse({ error: 'Failed to update rates', details: error.message }, 500, corsHeaders);
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
