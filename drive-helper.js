/**
 * Google Drive ヘルパー
 * レシート画像を指定フォルダにアップロードする
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1zHsRiuGkw_26r3h_3lEAINsdw5sWma2W';

let _driveClient = null;

async function getDriveClient() {
  if (_driveClient) return _driveClient;

  let credentials;
  const credPath = path.join(__dirname, 'google-credentials.json');
  if (fs.existsSync(credPath)) {
    credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } else if (process.env.GOOGLE_CREDENTIALS) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } else {
    throw new Error('Google認証情報が見つかりません');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
    ],
  });

  _driveClient = google.drive({ version: 'v3', auth });
  return _driveClient;
}

/**
 * ファイルをGoogle Driveにアップロードして公開URLを返す
 * @param {string} filePath - アップロードするファイルのパス
 * @param {string} filename - 保存するファイル名
 * @param {string} mimeType - MIMEタイプ（例: 'image/jpeg'）
 * @returns {{ fileId, viewUrl, imageUrl }} - Drive情報
 */
async function uploadToDrive(filePath, filename, mimeType = 'image/jpeg') {
  const drive = await getDriveClient();

  // ファイルをアップロード
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [FOLDER_ID],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: 'id, name',
  });

  const fileId = res.data.id;

  // 「リンクを知っている全員が閲覧可能」に設定
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return {
    fileId,
    viewUrl:  `https://drive.google.com/file/d/${fileId}/view`,
    imageUrl: `https://lh3.googleusercontent.com/d/${fileId}`,
  };
}

/**
 * Google DriveのファイルをIDで削除する
 * @param {string} fileId
 */
async function deleteFromDrive(fileId) {
  try {
    const drive = await getDriveClient();
    await drive.files.delete({ fileId });
  } catch (e) {
    console.warn('Drive削除エラー（無視）:', e.message);
  }
}

/**
 * URLまたはパスからDrive fileIdを抽出する
 * 例: https://drive.google.com/file/d/XXXX/view → XXXX
 *     https://lh3.googleusercontent.com/d/XXXX → XXXX
 */
function extractFileId(urlOrPath) {
  if (!urlOrPath) return null;
  const m = urlOrPath.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

module.exports = { uploadToDrive, deleteFromDrive, extractFileId };
