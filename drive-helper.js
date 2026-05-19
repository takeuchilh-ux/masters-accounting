/**
 * 画像ストレージヘルパー（Supabase Storage）
 * レシート画像をSupabase Storageにアップロードする
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const BUCKET = 'receipts';

// 遅延初期化（.env が読み込まれてから初めて使われる）
let _supabase = null;
function getClient() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
  return _supabase;
}

/**
 * ファイルをSupabase Storageにアップロードして公開URLを返す
 * @param {string} filePath - アップロードするファイルのパス
 * @param {string} filename - 保存するファイル名
 * @param {string} mimeType - MIMEタイプ
 * @returns {{ fileId, viewUrl, imageUrl }}
 */
async function uploadToDrive(filePath, filename, mimeType = 'image/jpeg') {
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filename) || '.jpg';
  const baseName = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const storageKey = `receipts/${Date.now()}_${baseName}${ext}`;

  const { error } = await getClient().storage
    .from(BUCKET)
    .upload(storageKey, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw new Error(`Supabase Storageアップロードエラー: ${error.message}`);

  const { data } = getClient().storage.from(BUCKET).getPublicUrl(storageKey);
  const publicUrl = data.publicUrl;

  return {
    fileId:   storageKey,
    viewUrl:  publicUrl,
    imageUrl: publicUrl,
  };
}

/**
 * Supabase StorageからファイルをIDで削除する
 * @param {string} fileId - Supabase StorageのstorageKey（例: "receipts/..."）
 */
async function deleteFromDrive(fileId) {
  if (!fileId) return;
  try {
    await getClient().storage.from(BUCKET).remove([fileId]);
  } catch(e) {
    console.warn('Supabase Storage削除エラー（無視）:', e.message);
  }
}

/**
 * URLからSupabase StorageのstorageKeyを抽出する
 */
function extractFileId(urlOrPath) {
  if (!urlOrPath) return null;
  // Supabase Storage URL: https://xxx.supabase.co/storage/v1/object/public/receipts/receipts/filename.jpg
  const m = urlOrPath.match(/\/object\/public\/receipts\/(.+)$/);
  if (m) return m[1];
  // すでにstorageKey形式（"receipts/..."）の場合
  if (!urlOrPath.startsWith('http') && !urlOrPath.startsWith('/')) return urlOrPath;
  return null;
}

/**
 * Supabase Storage内でファイルを移動（リネーム）する
 * @param {string} fromKey - 現在のstorageKey
 * @param {string} toKey   - 新しいstorageKey
 * @returns {{ fileId, url } | null}
 */
async function moveFile(fromKey, toKey) {
  try {
    const { error } = await getClient().storage.from(BUCKET).move(fromKey, toKey);
    if (error) {
      console.warn('Storage move failed:', error.message);
      return null;
    }
    const { data } = getClient().storage.from(BUCKET).getPublicUrl(toKey);
    return { fileId: toKey, url: data.publicUrl };
  } catch(e) {
    console.warn('Storage move error:', e.message);
    return null;
  }
}

module.exports = { uploadToDrive, deleteFromDrive, extractFileId, moveFile };
