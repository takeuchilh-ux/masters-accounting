const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { uploadToDrive, deleteFromDrive, extractFileId, moveFile } = require('./drive-helper');

const STORE_PREFIX = {
  '藤沢事業所':         'F',
  '藤沢市民病院':       'FM',
  '藤沢湘南台病院':     'FS',
  '平塚市民病院':       'HM',
  '西横浜国際総合病院': 'NY',
  '休日診療所':         'K',
};

// .env 読み込み
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const [k, ...v] = line.trim().split('=');
      if (k && v.length && !process.env[k]) process.env[k] = v.join('=');
    });
  }
} catch(_) {}

const { pettyCash, masters, initSupabase } = require('./supabase-db');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'masters-accounting-secret-key-2026';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

const USERS = [
  { email: 'takeuchi.lh@gmail.com',         passwordHash: hashPassword('0000') },
  { email: 'y.nakajima@master-staff.co.jp', passwordHash: hashPassword('1111') },
];

function requireAuth(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

const uploadDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 認証 ─────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = USERS.find(u => u.email === email && u.passwordHash === hashPassword(password));
  if (!user) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('auth_token', token, {
    httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax', secure: !!process.env.VERCEL,
  });
  res.json({ ok: true, email: user.email });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ email: req.user.email });
});

app.use('/api', requireAuth);

// ── マスタ ────────────────────────────────────────────────────────
app.get('/api/masters', async (req, res) => {
  try {
    const q = req.query.type ? { type: req.query.type } : {};
    const rows = await masters.find(q).sort({ type: 1, order: 1, value: 1 });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/masters', async (req, res) => {
  try {
    const { type, value } = req.body;
    if (!type || !value) return res.status(400).json({ error: 'type と value が必要です' });
    const existing = await masters.findOne({ type, value });
    if (existing) return res.json({ id: existing._id, existing: true });
    const maxOrder = await masters.find({ type }).sort({ order: -1 });
    const order = maxOrder.length > 0 ? (maxOrder[0].order || 0) + 1 : 1;
    const inserted = await masters.insert({ type, value, order, created_at: new Date().toISOString() });
    res.json({ id: inserted._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/masters/:id', async (req, res) => {
  try {
    await masters.update({ _id: req.params.id }, { $set: { value: req.body.value, order: req.body.order } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/masters/:id', async (req, res) => {
  try {
    await masters.remove({ _id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 小口精算 CRUD ─────────────────────────────────────────────────
async function renameReceiptFile(storeName, fileId) {
  if (!storeName || !fileId) return null;
  const prefix = STORE_PREFIX[storeName] || storeName[0].toUpperCase();
  try {
    const existing = await pettyCash.find({ store: storeName });
    const count = existing.filter(r => r.receipt_image).length + 1;
    const seq = String(count).padStart(3, '0');
    const ext = path.extname(fileId) || '.jpg';
    const newKey = `receipts/${prefix}_${seq}${ext}`;
    const result = await moveFile(fileId, newKey);
    return result;
  } catch(e) {
    console.warn('renameReceiptFile error:', e.message);
    return null;
  }
}

app.get('/api/petty-cash', async (req, res) => {
  try {
    const q = {};
    if (req.query.store)            q.store = req.query.store;
    if (req.query.account_category) q.account_category = req.query.account_category;
    if (req.query.purchaser)        q.purchaser = req.query.purchaser;
    if (req.query.from || req.query.to) {
      q.date = {};
      if (req.query.from) q.date.$gte = req.query.from;
      if (req.query.to)   q.date.$lte = req.query.to;
    }
    if (req.query.q) {
      const re = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [{ payee: re }, { item_name: re }, { notes: re }];
    }
    const rows = await pettyCash.find(q).sort({ date: -1, _id: -1 });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/petty-cash/export/csv', async (req, res) => {
  try {
    const q = {};
    if (req.query.store) q.store = req.query.store;
    if (req.query.from || req.query.to) {
      q.date = {};
      if (req.query.from) q.date.$gte = req.query.from;
      if (req.query.to)   q.date.$lte = req.query.to;
    }
    const rows = await pettyCash.find(q).sort({ date: 1, no: 1 });
    const headers = ['No.','日付','事業所','購入者','支払先','品名','勘定科目','数量','単価','10%税抜金額','10%消費税','8%税抜金額','8%消費税','合計金額（税込）','税区分','備考'];
    const lines = ['﻿' + headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.no, r.date, r.store, r.purchaser, r.payee, r.item_name, r.account_category,
        r.quantity, r.unit_price,
        r.amount_10, r.tax_amount_10, r.amount_8, r.tax_amount_8,
        r.total_amount, r.tax_category, r.notes
      ].map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="petty_cash.csv"');
    res.send(lines.join('\r\n'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/petty-cash/:id', async (req, res) => {
  try {
    const row = await pettyCash.findOne({ _id: req.params.id });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/petty-cash', async (req, res) => {
  try {
    const data = { ...req.body, created_at: new Date().toISOString() };
    // 採番: YYYYMMDD-NNN（同日の連番）
    const dateStr = (data.date || new Date().toISOString().split('T')[0]).replace(/-/g, '');
    const sameDate = await pettyCash.find({ date: data.date });
    const seq = String(sameDate.length + 1).padStart(3, '0');
    data.no = `${dateStr}-${seq}`;
    if (data.store && data.receipt_image) {
      const fileId = extractFileId(data.receipt_image);
      if (fileId) {
        const renamed = await renameReceiptFile(data.store, fileId);
        if (renamed) { data.receipt_image = renamed.url; data.receipt_drive_url = renamed.url; }
      }
    }
    const inserted = await pettyCash.insert(data);
    res.json({ id: inserted._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/petty-cash/:id', async (req, res) => {
  try {
    const update = { ...req.body, updated_at: new Date().toISOString() };
    delete update._id;
    await pettyCash.update({ _id: req.params.id }, { $set: update });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/petty-cash/:id', async (req, res) => {
  try {
    const row = await pettyCash.findOne({ _id: req.params.id });
    if (row?.receipt_image) {
      const fileId = extractFileId(row.receipt_image);
      if (fileId) await deleteFromDrive(fileId).catch(() => {});
    }
    await pettyCash.remove({ _id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── レシートOCR ────────────────────────────────────────────────────
app.post('/api/ocr', upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルが必要です' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEYが設定されていません' });

  let imagePath = req.file.path;
  let imageFilename = req.file.filename;

  try {
    const isHeic = req.file.mimetype === 'image/heic' || req.file.mimetype === 'image/heif' ||
                   /\.(heic|heif)$/i.test(req.file.originalname);
    if (isHeic) {
      const jpegFilename = imageFilename.replace(/\.(heic|heif)$/i, '') + '_conv.jpg';
      const jpegPath = path.join(uploadDir, jpegFilename);
      const inputBuffer = await fs.promises.readFile(imagePath);
      let outputBuffer;
      try {
        outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.92 });
      } catch(_) {
        const images = await heicConvert.all({ buffer: inputBuffer, format: 'JPEG' });
        if (!images || images.length === 0) throw new Error('HEICのデコードに失敗しました');
        outputBuffer = await images[0].convert();
      }
      await fs.promises.writeFile(jpegPath, Buffer.from(outputBuffer));
      imagePath = jpegPath;
      imageFilename = jpegFilename;
    } else {
      try {
        const rotated = imageFilename + '_r.jpg';
        const rotatedPath = path.join(uploadDir, rotated);
        await sharp(imagePath).rotate().jpeg({ quality: 92 }).toFile(rotatedPath);
        imagePath = rotatedPath;
        imageFilename = rotated;
      } catch(_) {}
    }

    const ext = path.extname(imageFilename).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const base64 = fs.readFileSync(imagePath).toString('base64');

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `このレシートから以下の情報をJSON形式で抽出してください。

【重要ルール】
- レシートに明記されている値だけを抽出してください
- 計算・推測・逆算は一切しないでください
- 書かれていない項目はnullにしてください

{
  "date": "YYYY-MM-DD形式の日付（なければnull）",
  "payee": "店名・支払先",
  "item_name": "品名・商品名（複数ある場合は代表的なものをまとめて）",
  "account_category": "日本の会計勘定科目（消耗品費/旅費交通費/接待交際費/通信費/水道光熱費/福利厚生費/雑費など、レシート内容から最適なものを1つ推測）",
  "amount_10": 10%対象の税抜金額（レシートに明記されている場合のみ数値。なければnull）,
  "tax_amount_10": 10%の消費税額（レシートに明記されている場合のみ数値。なければnull）,
  "amount_8": 8%対象の税抜金額（レシートに明記されている場合のみ数値。なければnull）,
  "tax_amount_8": 8%の消費税額（レシートに明記されている場合のみ数値。なければnull）,
  "total_amount": 合計金額（税込）（レシートに記載の最終合計額を数値で。なければnull）,
  "tax_category": "課税区分（課税/軽減税率（8%）/非課税/不課税）"
}
JSONのみ返してください。` }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON解析失敗');
    const parsed = JSON.parse(jsonMatch[0]);

    const mimeTypeDrive = ext === '.png' ? 'image/png' : 'image/jpeg';
    try {
      const driveResult = await uploadToDrive(imagePath, imageFilename, mimeTypeDrive);
      parsed.receipt_image = driveResult.imageUrl;
      parsed.receipt_drive_url = driveResult.viewUrl;
      try { fs.unlinkSync(req.file.path); } catch(_) {}
      try { if (imagePath !== req.file.path) fs.unlinkSync(imagePath); } catch(_) {}
    } catch(driveErr) {
      console.warn('Storage upload failed:', driveErr.message);
      parsed.receipt_image = null;
    }

    res.json(parsed);
  } catch(err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: `OCR処理失敗: ${err.message}` });
  }
});

// ── ダッシュボード集計 ─────────────────────────────────────────────
app.get('/api/summary', async (req, res) => {
  try {
    const q = {};
    if (req.query.store) q.store = req.query.store;
    if (req.query.month) { q.date = { $gte: req.query.month + '-01', $lte: req.query.month + '-31' }; }

    const all = await pettyCash.find(q);
    const total = all.reduce((s, r) => s + (r.total_amount || 0), 0);

    const storeMap = {};
    for (const r of all) {
      const s = r.store || '不明';
      if (!storeMap[s]) storeMap[s] = { total: 0, count: 0 };
      storeMap[s].total += r.total_amount || 0;
      storeMap[s].count += 1;
    }
    const byStore = Object.entries(storeMap)
      .map(([store, v]) => ({ store, ...v }))
      .sort((a, b) => b.total - a.total);

    const accMap = {};
    for (const r of all) {
      const a = r.account_category || '不明';
      accMap[a] = (accMap[a] || 0) + (r.total_amount || 0);
    }
    const byAccount = Object.entries(accMap)
      .map(([account_category, total]) => ({ account_category, total }))
      .sort((a, b) => b.total - a.total).slice(0, 10);

    res.json({ count: all.length, total, byStore, byAccount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

initSupabase().then(() => {
  if (require.main === module) {
    app.listen(PORT, () => console.log(`小口精算システム起動: http://localhost:${PORT}`));
  }
}).catch(console.error);

module.exports = app;
