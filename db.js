const Datastore = require('nedb-promises');
const path = require('path');
const fs   = require('fs');

// ── Google Sheets モード判定 ─────────────────────────────────────
const credPath = path.join(__dirname, 'google-credentials.json');
const useSheets = fs.existsSync(credPath) || !!process.env.GOOGLE_CREDENTIALS;

if (useSheets) {
  console.log('📊 Google Sheets モードで起動します');
} else {
  console.log('💾 ローカルDB (NeDB) モードで起動します');
  console.log('   → Google Sheetsに切り替えるには SETUP.md を参照してください');
}

// ── NeDB (ローカルDB) ────────────────────────────────────────────
const pettyCashDB   = Datastore.create({ filename: path.join(__dirname, 'data_petty_cash.db'),  autoload: true });
const paymentsDB    = Datastore.create({ filename: path.join(__dirname, 'data_payments.db'),    autoload: true });
const commissionsDB = Datastore.create({ filename: path.join(__dirname, 'data_commissions.db'), autoload: true });
const transfersDB   = Datastore.create({ filename: path.join(__dirname, 'data_transfers.db'),   autoload: true });
const mastersDB     = Datastore.create({ filename: path.join(__dirname, 'data_masters.db'),     autoload: true });

// ── デフォルトマスタデータ ───────────────────────────────────────
const DEFAULT_MASTERS = [
  // 事業所
  { type:'store', value:'藤沢事業所', order:1 },
  { type:'store', value:'藤沢市民病院', order:2 },
  { type:'store', value:'藤沢湘南台病院', order:3 },
  { type:'store', value:'平塚市民病院', order:4 },
  { type:'store', value:'西横浜国際総合病院', order:5 },
  { type:'store', value:'休日診療所', order:6 },
  // 勘定科目
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
  // 銀行口座
  { type:'bank_account', value:'横浜銀行・横浜駅前支店', order:1 },
  { type:'bank_account', value:'横浜銀行・藤沢中央支店', order:2 },
  { type:'bank_account', value:'みずほ銀行', order:3 },
  // 支払方法
  { type:'payment_method', value:'口座引落', order:1 },
  { type:'payment_method', value:'口座振込', order:2 },
  { type:'payment_method', value:'引出し', order:3 },
  { type:'payment_method', value:'入金', order:4 },
  { type:'payment_method', value:'収入印紙支払い', order:5 },
  // 税区分
  { type:'tax_category', value:'課税', order:1 },
  { type:'tax_category', value:'軽減税率（8%）', order:2 },
  { type:'tax_category', value:'非課税', order:3 },
  { type:'tax_category', value:'不課税', order:4 },
];

async function initNeDBMasters() {
  const count = await mastersDB.count({});
  if (count === 0) {
    await mastersDB.insert(DEFAULT_MASTERS.map(d => ({ ...d, created_at: new Date().toISOString() })));
    console.log('マスタデータを初期化しました (NeDB)');
  }
}

// ── エクスポート ─────────────────────────────────────────────────
let pettyCash, payments, commissions, transfers, masters, initMasters;

if (useSheets) {
  const sheetsDb = require('./sheets-db');
  pettyCash   = sheetsDb.pettyCash;
  payments    = sheetsDb.payments;
  commissions = sheetsDb.commissions;
  transfers   = sheetsDb.transfers;
  masters     = sheetsDb.masters;
  initMasters = sheetsDb.initSheets;
} else {
  pettyCash   = pettyCashDB;
  payments    = paymentsDB;
  commissions = commissionsDB;
  transfers   = transfersDB;
  masters     = mastersDB;
  initMasters = initNeDBMasters;
}

module.exports = { pettyCash, payments, commissions, transfers, masters, initMasters, useSheets };
