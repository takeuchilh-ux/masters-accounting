/**
 * Google Sheets をデータベースとして使用するアダプター
 * nedb-promises 互換APIを提供します
 */
const { google } = require('googleapis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '11fBvu9LOyF1-426rg0QNxKXg03yB2tprKMuUSus9Jtg';

// 各コレクションのシート定義
const SCHEMAS = {
  pettyCash: {
    sheet: '小口精算',
    cols:    ['_id','no','date','store','payee','item_name','account_category',
              'quantity','unit_price','amount','tax_rate','tax_amount','total_amount',
              'tax_category','notes','receipt_image','created_at','updated_at'],
    headers: ['ID','No','日付','事業所','支払先','品目名','勘定科目',
              '数量','単価','金額','税率','消費税額','合計金額',
              '税区分','備考','領収書画像','作成日時','更新日時'],
    nums: ['no','quantity','unit_price','amount','tax_amount','total_amount'],
  },
  payments: {
    sheet: '支払明細',
    cols:    ['_id','no','payment_date','bank_account','payee','description',
              'debit_amount','credit_amount','account_category','payment_method',
              'notes','summary_month','key_code','check_status','created_at','updated_at'],
    headers: ['ID','No','支払日','銀行口座','支払先','摘要',
              '出金額','入金額','勘定科目','支払方法',
              '備考','集計月','キーコード','チェック状態','作成日時','更新日時'],
    nums: ['no','debit_amount','credit_amount'],
  },
  commissions: {
    sheet: '業務委託料明細',
    cols:    ['_id','no','invoice_month','received_date','client','period',
              'invoice_amount','tax_amount','total_amount','received_amount',
              'payment_method','notes','created_at','updated_at'],
    headers: ['ID','No','請求月','入金日','請求先','期間',
              '請求金額','消費税額','合計請求額','入金額',
              '支払方法','備考','作成日時','更新日時'],
    nums: ['no','invoice_amount','tax_amount','total_amount','received_amount'],
  },
  transfers: {
    sheet: '資金移動明細',
    cols:    ['_id','transfer_date','from_account','to_account','amount','purpose','notes','created_at','updated_at'],
    headers: ['ID','移動日','移動元口座','移動先口座','金額','目的','備考','作成日時','更新日時'],
    nums: ['amount'],
  },
  masters: {
    sheet: 'マスタ',
    cols:    ['_id','type','value','order','created_at'],
    headers: ['ID','種別','値','順序','作成日時'],
    nums: ['order'],
  },
};

const DEFAULT_MASTERS = [
  { type:'store', value:'藤沢事業所', order:1 },
  { type:'store', value:'藤沢市民病院', order:2 },
  { type:'store', value:'藤沢湘南台病院', order:3 },
  { type:'store', value:'平塚市民病院', order:4 },
  { type:'store', value:'西横浜国際総合病院', order:5 },
  { type:'store', value:'休日診療所', order:6 },
  { type:'account_category', value:'現金', order:1 },
  { type:'account_category', value:'普通預金', order:2 },
  { type:'account_category', value:'消耗品費', order:3 },
  { type:'account_category', value:'事務用品費', order:4 },
  { type:'account_category', value:'旅費交通費', order:5 },
  { type:'account_category', value:'通信費', order:6 },
  { type:'account_category', value:'水道光熱費', order:7 },
  { type:'account_category', value:'地代家賃', order:8 },
  { type:'account_category', value:'福利厚生費', order:9 },
  { type:'account_category', value:'法定福利費', order:10 },
  { type:'account_category', value:'広告宣伝費', order:11 },
  { type:'account_category', value:'交際費', order:12 },
  { type:'account_category', value:'車両費', order:13 },
  { type:'account_category', value:'租税公課', order:14 },
  { type:'account_category', value:'支払い手数料', order:15 },
  { type:'account_category', value:'支払利息', order:16 },
  { type:'account_category', value:'長期借入金', order:17 },
  { type:'account_category', value:'短期借入金', order:18 },
  { type:'account_category', value:'預り金', order:19 },
  { type:'account_category', value:'立替金', order:20 },
  { type:'account_category', value:'従業員立替金', order:21 },
  { type:'account_category', value:'差入保証金', order:22 },
  { type:'account_category', value:'未払消費税', order:23 },
  { type:'account_category', value:'受取利息', order:24 },
  { type:'account_category', value:'営業外利益', order:25 },
  { type:'account_category', value:'貸付金', order:26 },
  { type:'account_category', value:'給与代り金', order:27 },
  { type:'account_category', value:'寄付金', order:28 },
  { type:'account_category', value:'雑費', order:29 },
  { type:'bank_account', value:'横浜銀行・横浜駅前支店', order:1 },
  { type:'bank_account', value:'横浜銀行・藤沢中央支店', order:2 },
  { type:'bank_account', value:'みずほ銀行', order:3 },
  { type:'payment_method', value:'口座引落', order:1 },
  { type:'payment_method', value:'口座振込', order:2 },
  { type:'payment_method', value:'引出し', order:3 },
  { type:'payment_method', value:'入金', order:4 },
  { type:'payment_method', value:'収入印紙支払い', order:5 },
  { type:'tax_category', value:'課税', order:1 },
  { type:'tax_category', value:'軽減税率（8%）', order:2 },
  { type:'tax_category', value:'非課税', order:3 },
  { type:'tax_category', value:'不課税', order:4 },
];

// ── 認証 ────────────────────────────────────────────────────────
let _sheetsClient = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  let credentials;
  const credPath = path.join(__dirname, 'google-credentials.json');
  if (fs.existsSync(credPath)) {
    credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } else if (process.env.GOOGLE_CREDENTIALS) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } else {
    throw new Error('Google認証情報が見つかりません。SETUP.md を参照して google-credentials.json を配置してください。');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

// ── クエリマッチング ─────────────────────────────────────────────
function matchQuery(doc, query) {
  for (const [key, val] of Object.entries(query)) {
    if (key === '$or') {
      if (!val.some(q => matchQuery(doc, q))) return false;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      const dv = doc[key];
      if (val.$gte !== undefined && (dv === undefined || dv === '' || dv < val.$gte)) return false;
      if (val.$lte !== undefined && (dv === undefined || dv === '' || dv > val.$lte)) return false;
      if (val.$in  !== undefined && !val.$in.includes(dv)) return false;
      if (val instanceof RegExp && !val.test(String(dv ?? ''))) return false;
    } else if (val instanceof RegExp) {
      if (!val.test(String(doc[key] ?? ''))) return false;
    } else {
      if (String(doc[key] ?? '') !== String(val ?? '')) return false;
    }
  }
  return true;
}

// ── カーソル（sort/limit/skip 対応） ────────────────────────────
class SheetCursor {
  constructor(collection, query) {
    this._col = collection;
    this._query = query;
    this._sortSpec = null;
    this._limitVal = null;
    this._skipVal = null;
  }

  sort(spec)  { this._sortSpec = spec; return this; }
  limit(n)    { this._limitVal = n;    return this; }
  skip(n)     { this._skipVal = n;     return this; }

  then(resolve, reject)  { return this._exec().then(resolve, reject); }
  catch(fn)              { return this._exec().catch(fn); }
  finally(fn)            { return this._exec().finally(fn); }

  async _exec() {
    let results = (await this._col._getRows()).filter(doc => matchQuery(doc, this._query));

    if (this._sortSpec) {
      results.sort((a, b) => {
        for (const [field, dir] of Object.entries(this._sortSpec)) {
          const av = a[field] ?? '', bv = b[field] ?? '';
          if (av < bv) return -dir;
          if (av > bv) return dir;
        }
        return 0;
      });
    }
    if (this._skipVal)  results = results.slice(this._skipVal);
    if (this._limitVal) results = results.slice(0, this._limitVal);
    return results;
  }
}

// ── コレクション ─────────────────────────────────────────────────
class SheetCollection {
  constructor(schema) {
    this._schema = schema;
    this._lastCol = String.fromCharCode(64 + schema.cols.length);
    this._range = `'${schema.sheet}'!A:${this._lastCol}`;
  }

  // 全行取得（ヘッダー行除く）
  async _getRows() {
    const sheets = await getSheetsClient();
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: this._range,
      });
      const rows = res.data.values || [];
      if (rows.length <= 1) return [];
      return rows.slice(1).map(row => {
        const doc = {};
        this._schema.cols.forEach((col, i) => {
          let v = row[i] ?? '';
          if (v !== '' && this._schema.nums.includes(col)) {
            const n = Number(v);
            v = isNaN(n) ? v : n;
          }
          doc[col] = v;
        });
        return doc;
      });
    } catch (e) {
      if (e.message?.includes('Unable to parse range') || e.code === 400) return [];
      throw e;
    }
  }

  // 全行書き戻し（日本語ヘッダー含む）
  async _writeAllRows(docs) {
    const sheets = await getSheetsClient();
    const values = [
      this._schema.headers,
      ...docs.map(doc => this._schema.cols.map(c => {
        const v = doc[c];
        return (v === null || v === undefined) ? '' : String(v);
      })),
    ];
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: this._schema.sheet,
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${this._schema.sheet}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }

  // ── NeDB互換API ──────────────────────────────────────────────
  find(query = {}) {
    return new SheetCursor(this, query);
  }

  async findOne(query = {}) {
    const rows = await this._getRows();
    return rows.find(doc => matchQuery(doc, query)) ?? null;
  }

  async count(query = {}) {
    const rows = await this._getRows();
    return rows.filter(doc => matchQuery(doc, query)).length;
  }

  async insert(docOrDocs) {
    const isArray = Array.isArray(docOrDocs);
    const inputs = isArray ? docOrDocs : [docOrDocs];
    const rows = await this._getRows();
    const inserted = inputs.map(doc => ({
      ...doc,
      _id: doc._id || crypto.randomUUID(),
    }));
    rows.push(...inserted);
    await this._writeAllRows(rows);
    return isArray ? inserted : inserted[0];
  }

  async update(query, updateOp, options = {}) {
    const rows = await this._getRows();
    let count = 0;
    const multi = options.multi !== false; // デフォルトは全件更新
    const updated = rows.map(doc => {
      if (!matchQuery(doc, query)) return doc;
      if (!multi && count > 0) return doc;
      count++;
      if (updateOp.$set) return { ...doc, ...updateOp.$set };
      const { _id } = doc;
      return { _id, ...updateOp };
    });
    await this._writeAllRows(updated);
    return count;
  }

  async remove(query, options = {}) {
    const rows = await this._getRows();
    let count = 0;
    const multi = options.multi !== false;
    const filtered = rows.filter(doc => {
      if (!matchQuery(doc, query)) return true;
      if (!multi && count > 0) return true;
      count++;
      return false;
    });
    await this._writeAllRows(filtered);
    return count;
  }
}

// ── シート初期化 ─────────────────────────────────────────────────
async function initSheets() {
  const sheets = await getSheetsClient();

  // 既存シート名を取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingTitles = meta.data.sheets.map(s => s.properties.title);

  // 不足しているシートを作成
  const toCreate = Object.values(SCHEMAS).filter(s => !existingTitles.includes(s.sheet));
  if (toCreate.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: toCreate.map(s => ({ addSheet: { properties: { title: s.sheet } } })),
      },
    });
    console.log(`シートを作成しました: ${toCreate.map(s => s.sheet).join(', ')}`);
  }

  // 各シートのヘッダー行を確認・設定（日本語ヘッダー）
  for (const schema of Object.values(SCHEMAS)) {
    const lastCol = String.fromCharCode(64 + schema.cols.length);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${schema.sheet}!A1:${lastCol}1`,
    });
    const firstRow = (res.data.values || [])[0] || [];
    // ヘッダーが日本語「ID」でない場合（英語「_id」や空の場合）は更新
    if (firstRow[0] !== 'ID') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${schema.sheet}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [schema.headers] },
      });
      console.log(`ヘッダー設定: ${schema.sheet}`);
    }
  }

  // マスタデータ初期化
  const mastersCol = collections.masters;
  const masterCount = await mastersCol.count({});
  if (masterCount === 0) {
    await mastersCol.insert(DEFAULT_MASTERS.map(d => ({ ...d, created_at: new Date().toISOString() })));
    console.log('マスタデータをGoogle Sheetsに初期化しました');
  }

  console.log(`✅ Google Sheets DB 接続完了 (ID: ${SPREADSHEET_ID})`);
}

// ── コレクションインスタンス ─────────────────────────────────────
const collections = {
  pettyCash:   new SheetCollection(SCHEMAS.pettyCash),
  payments:    new SheetCollection(SCHEMAS.payments),
  commissions: new SheetCollection(SCHEMAS.commissions),
  transfers:   new SheetCollection(SCHEMAS.transfers),
  masters:     new SheetCollection(SCHEMAS.masters),
};

module.exports = { ...collections, initSheets, SPREADSHEET_ID };
