/**
 * Supabase PostgreSQL をデータベースとして使用するアダプター
 * NeDB互換APIを提供します（server.js の変更を最小限に）
 */
const { createClient } = require('@supabase/supabase-js');

// 遅延初期化（.env が読み込まれてから初めて使われる）
let _supabase = null;
function supabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
  return _supabase;
}

// ── ドキュメント正規化（id ↔ _id 変換） ──────────────────────────
function normalizeDoc(doc) {
  if (!doc) return null;
  const { id, ...rest } = doc;
  return { _id: id, ...rest };
}

// ── NeDBクエリ → Supabaseフィルター変換 ──────────────────────────
function applyQuery(sb, query) {
  for (const [key, val] of Object.entries(query)) {
    // $or 条件（検索キーワードのOR）
    if (key === '$or') {
      const orParts = val.map(clause => {
        const [field, cond] = Object.entries(clause)[0];
        const col = field === '_id' ? 'id' : field;
        if (cond instanceof RegExp) return `${col}.ilike.%${cond.source}%`;
        return `${col}.eq.${cond}`;
      });
      sb = sb.or(orParts.join(','));
      continue;
    }
    const col = key === '_id' ? 'id' : key;
    // 範囲・IN条件
    if (val && typeof val === 'object' && !(val instanceof RegExp) && !Array.isArray(val)) {
      if (val.$gte !== undefined) sb = sb.gte(col, val.$gte);
      if (val.$lte !== undefined) sb = sb.lte(col, val.$lte);
      if (val.$lt  !== undefined) sb = sb.lt(col, val.$lt);
      if (val.$gt  !== undefined) sb = sb.gt(col, val.$gt);
      if (val.$in  !== undefined) sb = sb.in(col, val.$in);
    } else if (val instanceof RegExp) {
      sb = sb.ilike(col, `%${val.source}%`);
    } else {
      sb = sb.eq(col, String(val));
    }
  }
  return sb;
}

// ── カーソル（sort / limit / skip 対応） ─────────────────────────
class SupabaseCursor {
  constructor(collection, query) {
    this._col      = collection;
    this._query    = query;
    this._sortSpec = null;
    this._limitVal = null;
    this._skipVal  = null;
  }

  sort(spec)  { this._sortSpec = spec; return this; }
  limit(n)    { this._limitVal = n;    return this; }
  skip(n)     { this._skipVal  = n;    return this; }

  then(resolve, reject)  { return this._exec().then(resolve, reject); }
  catch(fn)              { return this._exec().catch(fn); }
  finally(fn)            { return this._exec().finally(fn); }

  async _exec() {
    let sb = supabase().from(this._col.table).select('*');
    sb = applyQuery(sb, this._query);

    if (this._sortSpec) {
      for (const [field, dir] of Object.entries(this._sortSpec)) {
        const col = field === '_id' ? 'id' : field;
        sb = sb.order(col, { ascending: dir === 1 });
      }
    }
    if (this._skipVal && this._limitVal) {
      sb = sb.range(this._skipVal, this._skipVal + this._limitVal - 1);
    } else if (this._skipVal) {
      sb = sb.range(this._skipVal, this._skipVal + 9999);
    } else if (this._limitVal) {
      sb = sb.limit(this._limitVal);
    }

    const { data, error } = await sb;
    if (error) throw new Error(error.message);
    return (data || []).map(normalizeDoc);
  }
}

// ── コレクション ─────────────────────────────────────────────────
class SupabaseCollection {
  constructor(tableName) {
    this.table = tableName;
  }

  find(query = {}) {
    return new SupabaseCursor(this, query);
  }

  async findOne(query = {}) {
    let sb = supabase().from(this.table).select('*');
    sb = applyQuery(sb, query);
    const { data, error } = await sb.limit(1);
    if (error) throw new Error(error.message);
    return data && data.length > 0 ? normalizeDoc(data[0]) : null;
  }

  async count(query = {}) {
    let sb = supabase().from(this.table).select('*', { count: 'exact', head: true });
    sb = applyQuery(sb, query);
    const { count, error } = await sb;
    if (error) throw new Error(error.message);
    return count || 0;
  }

  async insert(docOrDocs) {
    const isArray = Array.isArray(docOrDocs);
    const inputs  = isArray ? docOrDocs : [docOrDocs];
    const now     = new Date().toISOString();

    const rows = inputs.map(({ _id, ...rest }) => ({
      ...(rest.created_at ? {} : { created_at: now }),
      updated_at: now,
      ...rest,
    }));

    const { data, error } = await supabase().from(this.table).insert(rows).select();
    if (error) throw new Error(error.message);
    const result = data.map(normalizeDoc);
    return isArray ? result : result[0];
  }

  async update(query, updateOp, options = {}) {
    // 対象IDを取得
    let sb = supabase().from(this.table).select('id');
    sb = applyQuery(sb, query);
    const { data: rows, error: fetchErr } = await sb;
    if (fetchErr) throw new Error(fetchErr.message);
    if (!rows || rows.length === 0) return 0;

    const toUpdate = options.multi === false ? [rows[0]] : rows;
    const now = new Date().toISOString();

    for (const row of toUpdate) {
      const patch = updateOp.$set
        ? { ...updateOp.$set, updated_at: now }
        : { ...updateOp, updated_at: now };
      delete patch._id;
      const { error } = await supabase().from(this.table).update(patch).eq('id', row.id);
      if (error) throw new Error(error.message);
    }
    return toUpdate.length;
  }

  async remove(query, options = {}) {
    let sb = supabase().from(this.table).select('id');
    sb = applyQuery(sb, query);
    const { data: rows, error: fetchErr } = await sb;
    if (fetchErr) throw new Error(fetchErr.message);
    if (!rows || rows.length === 0) return 0;

    const toDelete = options.multi === false ? [rows[0]] : rows;
    const ids = toDelete.map(r => r.id);
    const { error } = await supabase().from(this.table).delete().in('id', ids);
    if (error) throw new Error(error.message);
    return toDelete.length;
  }
}

// ── 初期化 ───────────────────────────────────────────────────────
async function initSupabase() {
  const { error } = await supabase().from('masters').select('id').limit(1);
  if (error) throw new Error(`Supabase接続エラー: ${error.message}`);
  console.log('✅ Supabase DB 接続完了');
}

// ── コレクションインスタンス ─────────────────────────────────────
const collections = {
  pettyCash:   new SupabaseCollection('petty_cash'),
  payments:    new SupabaseCollection('payments'),
  commissions: new SupabaseCollection('commissions'),
  transfers:   new SupabaseCollection('transfers'),
  masters:     new SupabaseCollection('masters'),
  users:       new SupabaseCollection('app_users'),
};

module.exports = { ...collections, initSupabase };
