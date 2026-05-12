/**
 * 画像ストレージヘルパー（Cloudinary）
 * レシート画像をCloudinaryにアップロードする
 */
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME || 'ddlkul4s3',
  api_key:     process.env.CLOUDINARY_API_KEY    || '863228547375371',
  api_secret:  process.env.CLOUDINARY_API_SECRET || 'OVvmcw2GMPtydNSft0XmxdPIvyY',
});

/**
 * ファイルをCloudinaryにアップロードして公開URLを返す
 * @param {string} filePath - アップロードするファイルのパス
 * @param {string} filename - 保存するファイル名（拡張子なし）
 * @returns {{ fileId, viewUrl, imageUrl }}
 */
async function uploadToDrive(filePath, filename, mimeType = 'image/jpeg') {
  const publicId = 'receipts/' + filename.replace(/\.[^.]+$/, '');

  const result = await cloudinary.uploader.upload(filePath, {
    public_id:    publicId,
    resource_type: 'image',
    overwrite:    true,
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
