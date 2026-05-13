/**
 * 画像ストレージヘルパー（Cloudinary）
 * レシート画像をCloudinaryにアップロードする
 */
const cloudinary = require('cloudinary').v2;

// 認証情報は必ず環境変数から取得（ハードコード禁止）
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.warn('警告: Cloudinaryの環境変数が設定されていません。レシート画像のアップロードは無効です。');
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key:    CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

/**
 * ファイルをCloudinaryにアップロードして公開URLを返す
 * @param {string} filePath - アップロードするファイルのパス
 * @param {string} filename - 保存するファイル名（拡張子なし）
 * @returns {{ fileId, viewUrl, imageUrl }}
 */
async function uploadToDrive(filePath, filename, mimeType = 'image/jpeg') {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinaryの環境変数が設定されていません。');
  }

  const publicId = 'receipts/' + filename.replace(/\.[^.]+$/, '');

  const result = await cloudinary.uploader.upload(filePath, {
    public_id:     publicId,
    resource_type: 'image',
    overwrite:     true,
  });

  return {
    fileId:   result.public_id,
    viewUrl:  result.secure_url,
    imageUrl: result.secure_url,
  };
}

/**
 * CloudinaryからファイルをIDで削除する
 * @param {string} fileId - Cloudinaryのpublic_id
 */
async function deleteFromDrive(fileId) {
  try {
    await cloudinary.uploader.destroy(fileId, { resource_type: 'image' });
  } catch(e) {
    console.warn('Cloudinary削除エラー（無視）:', e.message);
  }
}

/**
 * URLからCloudinary public_idを抽出する
 */
function extractFileId(urlOrPath) {
  if (!urlOrPath) return null;
  // Cloudinary URL: https://res.cloudinary.com/cloud/image/upload/v123/receipts/filename.jpg
  const m = urlOrPath.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
  if (m) return m[1];
  // すでにpublic_id形式の場合
  if (!urlOrPath.startsWith('http') && !urlOrPath.startsWith('/')) return urlOrPath;
  return null;
}

module.exports = { uploadToDrive, deleteFromDrive, extractFileId };
