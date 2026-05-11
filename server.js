const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const heicConvert = require('heic-convert');

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

const { pettyCash, payments, commissions, transfers, masters, initMasters } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function buildQuery(filters) {
  const q = {};
  if (filters.store)            q.store = filters.store;
  if (filters.bank_account)     q.bank_account = filters.bank_account;
  if (filters.account_category) q.account_category = filters.account_category;
  if (filters.from || filters.to) {
    const dateField = filters.dateField || 'date';
    q[dateField] = {};
    if (filters.from) q[dateField].$gte = filters.from;
    if (filters.to)   q[dateField].$lte = filters.to;
  }
  if (filters.q) {
    const re = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ payee: re }, { item_name: re }, { description: re }, { notes: re }];
  }
  return q;
}

// ── マスタ ─────────────────────────────────────────────────────
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

// ── 小口精算 ────────────────────────────────────────────────────
app.get('/api/petty-cash', async (req, res) => {
  try {
    const q = buildQuery({ ...req.query, dateField: 'date' });
    const rows = await pettyCash.find(q).sort({ date: -1, _id: -1 });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/petty-cash/export/csv', async (req, res) => {
  try {
    const q = buildQuery({ store: req.query.store, from: req.query.from, to: req.query.to, dateField: 'date' });
    const rows = await pettyCash.find(q).sort({ date: 1, no: 1 });
    const headers = ['No.','日付','事業所','支払先（店名など）','品名','勘定科目','数量','単価','金額','税率','消費税額','合計金額','税区分','備考'];
    const lines = ['﻿' + headers.join(',')];
    for (const r of rows) {
      lines.push([r.no,r.date,r.store,r.payee,r.item_name,r.account_category,r.quantity,r.unit_price,r.amount,r.tax_rate,r.tax_amount,r.total_amount,r.tax_category,r.notes]
        .map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(','));
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
    const inserted = await pettyCash.insert({ ...req.body, created_at: new Date().toISOString() });
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
      const imgPath = path.join(__dirname, 'uploads', path.basename(row.receipt_image));
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    await pettyCash.remove({ _id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── レシートOCR ───────────────────────────────────────────────
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
      const jpegPath = path.join(__dirname, 'uploads', jpegFilename);
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
        const rotatedPath = path.join(__dirname, 'uploads', rotated);
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
{
  "date": "YYYY-MM-DD形式の日付",
  "payee": "店名・支払先",
  "item_name": "品名・商品名（複数ある場合は代表的なものをまとめて）",
  "account_category": "日本の会計勘定科目（消耗品費/旅費交通費/接待交際費/通信費/水道光熱費/福利厚生費/雑費など、レシート内容から最適なものを1つ推測してください）",
  "amount": 税抜金額（数値のみ、不明ならnull）,
  "tax_rate": "税率（\"10%\" または \"8%\"、不明なら\"10%\"）",
  "tax_amount": 消費税額（数値のみ、不明ならnull）,
  "total_amount": 合計金額（数値のみ、不明ならnull）,
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
    parsed.receipt_image = `/uploads/${imageFilename}`;
    res.json(parsed);
  } catch(err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: `OCR処理失敗: ${err.message}`, receipt_image: `/uploads/${imageFilename}` });
  }
});

// ── 支払明細 ────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => {
  try {
    const q = buildQuery({ ...req.query, dateField: 'payment_date' });
    const rows = await payments.find(q).sort({ payment_date: -1, _id: -1 });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/payments/export/csv', async (req, res) => {
  try {
    const q = buildQuery({ bank_account: req.query.bank_account, account_category: req.query.account_category, from: req.query.from, to: req.query.to, dateField: 'payment_date' });
    const rows = await payments.find(q).sort({ payment_date: 1, no: 1 });
    const headers = ['No.','支払日','支払先','支払内容（摘要）','出金額（円）','入金額（円）','会計科目','支払方法','備考','集計月','キー','自動会計科目','自動支払方法','チェック','銀行口座'];
    const lines = ['﻿' + headers.join(',')];
    for (const r of rows) {
      lines.push([r.no,r.payment_date,r.payee,r.description,r.debit_amount,r.credit_amount,r.account_category,r.payment_method,r.notes,r.summary_month,r.key_code,r.auto_account,r.auto_payment_method,r.check_status,r.bank_account]
        .map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send(lines.join('\r\n'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/payments/:id', async (req, res) => {
  try {
    const row = await payments.findOne({ _id: req.params.id });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payments', async (req, res) => {
  try {
    const inserted = await payments.insert({ ...req.body, created_at: new Date().toISOString() });
    res.json({ id: inserted._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/payments/:id', async (req, res) => {
  try {
    const update = { ...req.body, updated_at: new Date().toISOString() };
    delete update._id;
    await payments.update({ _id: req.params.id }, { $set: update });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/payments/:id', async (req, res) => {
  try {
    await payments.remove({ _id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 業務委託料明細 ──────────────────────────────────────────────
app.get('/api/commissions', async (req, res) => {
  try {
    const q = {};
    if (req.query.client)  q.client  = req.query.client;
    if (req.query.from)    q.invoice_month = q.invoice_month || {};
    if (req.query.from || req.query.to) {
      q.invoice_month = {};
      if (req.query.from) q.invoice_month.$gte = req.query.from;
      if (req.query.to)   q.invoice_month.$lte = req.query.to;
    }
    const rows = await commissions.find(q).sort({ invoice_month: -1, _id: -1 });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/commissions/export/csv', async (req, res) => {
  try {
    const rows = await commissions.find({}).sort({ invoice_month: 1, no: 1 });
    const headers = ['No.','請求月','入金日','請求先','対象期間','請求金額（税抜）','消費税額','合計請求額','入金額','支払方法','備考'];
    const lines = ['﻿' + headers.join(',')];
    for (const r of rows) {
      lines.push([r.no,r.invoice_month,r.received_date,r.client,r.period,r.invoice_amount,r.tax_amount,r.total_amount,r.received_amount,r.payment_method,r.notes]
        .map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="commissions.csv"');
    res.send(lines.join('\r\n'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/commissions/:id', async (req, res) => {
  try {
    const row = await commissions.findOne({ _id: req.params.id });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/commissions', async (req, res) => {
  try {
    const inserted = await commissions.insert({ ...req.body, created_at: new Date().toISOString() });
    res.json({ id: inserted._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/commissions/:id', async (req, res) => {
  try {
    const update = { ...req.body, updated_at: new Date().toISOString() };
    delete update._id;
    await commissions.update({ _id: req.params.id }, { $set: update });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/commissions/:id', async (req, res) => {
  try {
    await commissions.remove({ _id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 資金移動明細 ────────────────────────────────────────────────
app.get('/api/transfers', async (req, res) => {
  try {
    const q = {};
    if (req.query.from || req.query.to) {
      q.transfer_date = {};
      if (req.query.from) q.transfer_date.$gte = req.query.from;
      if (req.query.to)   q.transfer_date.$lte = req.query.to;
    }
    const rows = await transfers.find(q).sort({ transfer_date: -1, _id: -1 });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transfers/export/csv', async (req, res) => {
  try {
    const rows = await transfers.find({}).sort({ transfer_date: 1 });
    const headers = ['日付','移動元口座','移動先口座','金額（円）','目的','備考'];
    const lines = ['﻿' + headers.join(',')];
    for (const r of rows) {
      lines.push([r.transfer_date,r.from_account,r.to_account,r.amount,r.purpose,r.notes]
        .map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transfers.csv"');
    res.send(lines.join('\r\n'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transfers/:id', async (req, res) => {
  try {
    const row = await transfers.findOne({ _id: req.params.id });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/transfers', async (req, res) => {
  try {
    const inserted = await transfers.insert({ ...req.body, created_at: new Date().toISOString() });
    res.json({ id: inserted._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/transfers/:id', async (req, res) => {
  try {
    const update = { ...req.body, updated_at: new Date().toISOString() };
    delete update._id;
    await transfers.update({ _id: req.params.id }, { $set: update });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/transfers/:id', async (req, res) => {
  try {
    await transfers.remove({ _id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ダッシュボード集計 ──────────────────────────────────────────
app.get('/api/summary', async (req, res) => {
  try {
    const pcQuery = {};
    const pyQuery = {};
    if (req.query.store)        pcQuery.store        = req.query.store;
    if (req.query.bank_account) pyQuery.bank_account = req.query.bank_account;

    const [pcAll, pyAll, cmAll, trAll] = await Promise.all([
      pettyCash.find(pcQuery), payments.find(pyQuery),
      commissions.find({}), transfers.find({})
    ]);

    const pettyCashCount = pcAll.length;
    const pettyCashTotal = pcAll.reduce((s, r) => s + (r.total_amount || 0), 0);
    const paymentsCount  = pyAll.length;
    const debitTotal     = pyAll.reduce((s, r) => s + (r.debit_amount  || 0), 0);
    const creditTotal    = pyAll.reduce((s, r) => s + (r.credit_amount || 0), 0);

    // 勘定科目別集計（支払明細）
    const accMap = {};
    for (const r of pyAll) {
      if (r.account_category && r.debit_amount) {
        accMap[r.account_category] = (accMap[r.account_category] || 0) + r.debit_amount;
      }
    }
    const byAccount = Object.entries(accMap)
      .map(([account_category, total]) => ({ account_category, total }))
      .sort((a, b) => b.total - a.total).slice(0, 10);

    // 事業所別集計（小口精算）
    const storeMap = {};
    for (const r of pcAll) {
      const s = r.store || '不明';
      storeMap[s] = (storeMap[s] || 0) + (r.total_amount || 0);
    }
    const byStore = Object.entries(storeMap)
      .map(([store, total]) => ({ store, total }))
      .sort((a, b) => b.total - a.total);

    // 銀行口座別集計（支払明細）
    const bankMap = {};
    for (const r of pyAll) {
      const b = r.bank_account || '不明';
      if (!bankMap[b]) bankMap[b] = { debit: 0, credit: 0 };
      bankMap[b].debit  += r.debit_amount  || 0;
      bankMap[b].credit += r.credit_amount || 0;
    }
    const byBank = Object.entries(bankMap)
      .map(([bank_account, v]) => ({ bank_account, ...v }))
      .sort((a, b) => b.debit - a.debit);

    // 業務委託料集計
    const commissionsCount    = cmAll.length;
    const commissionTotal     = cmAll.reduce((s, r) => s + (r.total_amount    || 0), 0);
    const commissionReceived  = cmAll.reduce((s, r) => s + (r.received_amount || 0), 0);
    // 資金移動集計
    const transfersCount  = trAll.length;
    const transferTotal   = trAll.reduce((s, r) => s + (r.amount || 0), 0);

    res.json({ pettyCashCount, pettyCashTotal, paymentsCount, debitTotal, creditTotal,
               commissionsCount, commissionTotal, commissionReceived, transfersCount, transferTotal,
               byAccount, byStore, byBank });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

initMasters().then(() => {
  app.listen(PORT, () => console.log(`会計管理アプリ起動中: http://localhost:${PORT}`));
});
