# Google Sheets DB 連携セットアップ手順

スプレッドシートURL:  
https://docs.google.com/spreadsheets/d/11fBvu9LOyF1-426rg0QNxKXg03yB2tprKMuUSus9Jtg/

---

## ① Google Cloud でサービスアカウントを作成

1. https://console.cloud.google.com/ を開く
2. 上部のプロジェクト選択 → **新しいプロジェクト** を作成（例: `accounting-app`）
3. 左メニュー → **APIとサービス** → **ライブラリ**
4. 「Google Sheets API」を検索 → **有効にする**
5. 左メニュー → **APIとサービス** → **認証情報**
6. **認証情報を作成** → **サービスアカウント**
7. 名前を入力（例: `accounting-app-sa`）→ **作成して続行** → **完了**
8. 作成したサービスアカウントをクリック
9. **キー** タブ → **鍵を追加** → **新しい鍵を作成** → **JSON** → **作成**
10. JSONファイルがダウンロードされる

---

## ② JSONファイルを配置

ダウンロードしたJSONファイルを以下にリネームして配置:

```
C:\Users\81909\accounting-app\google-credentials.json
```

---

## ③ スプレッドシートを共有

1. JSONファイルを開いて `"client_email"` の値をコピー  
   例: `accounting-app-sa@accounting-app-xxxxx.iam.gserviceaccount.com`

2. スプレッドシートを開く:  
   https://docs.google.com/spreadsheets/d/11fBvu9LOyF1-426rg0QNxKXg03yB2tprKMuUSus9Jtg/

3. 右上の **共有** ボタン → コピーしたメールアドレスを入力  
   権限: **編集者** → **送信**

---

## ④ サーバー再起動

```powershell
cd C:\Users\81909\accounting-app
node server.js
```

起動時に以下が表示されれば成功:
```
📊 Google Sheets モードで起動します
✅ Google Sheets DB 接続完了
```

アプリのデータはすべてスプレッドシートの以下のシートに保存されます:
- `小口精算` — 小口精算データ
- `支払明細` — 支払明細データ
- `業務委託料明細` — 業務委託料データ
- `資金移動明細` — 資金移動データ
- `マスタ` — マスタデータ（事業所・勘定科目など）

---

## NeDB（ローカルDB）に戻す場合

`google-credentials.json` を削除またはリネームするだけでNeDBに自動切り替えされます。
