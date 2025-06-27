# Slack freee 打刻ボット

Slackの特定キーワード(AKASHI踏襲)でfreee人事労務に自動打刻を行うCloudflare Workersアプリケーション

## 🚀 機能

- **自動打刻**: Slackメッセージから出勤・退勤・休憩の打刻を自動実行
- **メールアドレス自動マッチング**: Slackユーザーとfreee従業員を自動で紐付け
- **手動マッピング対応**: メールアドレスが設定されていないユーザーも手動設定可能
- **エラーハンドリング**: 重複打刻や権限エラーを適切に処理してSlackに通知
- **署名検証**: Slack署名検証によるセキュリティ確保

## 📝 対応キーワード

| 動作 | キーワード |
|------|------------|
| **出勤** | `出勤`, `始業`, `しゅっきん`, `しぎょう`, `おはようございます`, `in` |
| **退勤** | `退勤`, `終業`, `たいきん`, `しゅうぎょう`, `お疲れ様`, `out` |
| **休憩開始** | `休憩入り`, `休憩開始`, `きゅうけいいり`, `きゅうけいかいし` |
| **休憩終了** | `休憩戻り`, `休憩終了`, `きゅうけいもどり`, `きゅうけいしゅうりょう` |

## 🛠 セットアップ

### 前提条件

- [Cloudflareアカウント](https://cloudflare.com/)
- [freee人事労務](https://www.freee.co.jp/hr/)のベーシックプラン以上
- Slackワークスペースの管理者権限
- [Node.js](https://nodejs.org/) 18以上

### 1. プロジェクトのクローンと準備

```bash
git clone https://github.com/yourusername/slack-freee-timeclock.git
cd slack-freee-timeclock
npm install -g wrangler
wrangler login
```

### 2. freeeアプリの作成

1. [freeeアプリストア開発者ページ](https://app.secure.freee.co.jp/developers)にアクセス
2. 「アプリ管理」→「新規追加」
3. アプリ情報を入力し、スコープで `read`, `write` を選択
4. Client IDとClient Secretを取得

### 3. freeeアクセストークンの取得

```bash
# ブラウザで認証URLにアクセス（CLIENT_IDを置換）
https://accounts.secure.freee.co.jp/public_api/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=read%20write

# 認証コードを使ってアクセストークンを取得
curl -X POST https://accounts.secure.freee.co.jp/public_api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&code=YOUR_AUTH_CODE&redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

### 4. Slackアプリの作成

1. [Slack API](https://api.slack.com/apps)で新しいアプリを作成
2. **OAuth & Permissions**で以下のスコープを追加：
   - `channels:history`
   - `chat:write`
   - `users:read`
   - `users:read.email`
3. 「Install to Workspace」でアプリをインストール
4. Bot User OAuth TokenとSigning Secretを取得

### 5. 環境変数の設定

```bash
# freeeアクセストークン
wrangler secret put FREEE_ACCESS_TOKEN

# Slackボットトークン
wrangler secret put SLACK_BOT_TOKEN

# Slack署名検証シークレット
wrangler secret put SLACK_SIGNING_SECRET

# 対象チャンネルID
wrangler secret put TARGET_CHANNEL_ID

# 手動ユーザーマッピング（オプション）
wrangler secret put USER_MAPPING
# 例: {"U1234567890": 12345, "U0987654321": 67890}
```

### 6. デプロイ

```bash
wrangler deploy
```

### 7. Slack Event Subscriptionsの設定

1. Slack API管理画面 → **Event Subscriptions**
2. **Request URL**にデプロイ後のWorkers URLを設定
3. **Subscribe to bot events**に `message.channels` を追加
4. 設定を保存

### 8. ボットをチャンネルに招待

対象チャンネルで以下を実行：
```
/invite @your-bot-name
```

## 🔧 設定

### ユーザーマッピング

#### 自動マッチング（推奨）
Slackプロフィールのメールアドレスとfreee従業員のメールアドレスが一致する場合、自動でマッピングされます。

#### 手動マッピング
```bash
wrangler secret put USER_MAPPING
# JSON形式で入力: {"SlackユーザーID": freee従業員ID}
```

### チャンネルID取得方法
1. Slackでチャンネルを右クリック
2. 「リンクをコピー」
3. URLの最後の部分（`C1234567890`）がチャンネルID

## 📊 使用例

```
ユーザー: おはようございます
ボット: ✅ 出勤を記録しました！

ユーザー: 休憩入り  
ボット: ✅ 休憩開始を記録しました！

ユーザー: お疲れ様
ボット: ✅ 退勤を記録しました！
```

## 🚨 エラーハンドリング

### 重複打刻
```
ユーザー: 出勤
ボット: ❌ 打刻の記録に失敗しました: 既に出勤済みです
```

### ユーザーマッピングなし
```
ボット: ❌ 従業員が見つかりません。
• 手動マッピング: 管理者に設定を依頼してください
• 自動マッチング: Slackプロフィールとfreeeのメールアドレスが一致している必要があります
```

## 🐛 トラブルシューティング

### ログ確認
```bash
wrangler tail
```

### よくある問題

#### ボットが反応しない
- [ ] ボットがチャンネルに参加しているか
- [ ] Event Subscriptionsが正しく設定されているか
- [ ] チャンネルIDが正しいか

#### 署名検証エラー
```bash
# Signing Secretを再確認
wrangler secret list
```

#### freee API エラー
- アクセストークンの有効期限（6時間）を確認
- 必要に応じてrefresh_tokenで更新

## 🏗 アーキテクチャ

```
Slack → Slack Events API → Cloudflare Workers → freee人事労務API
```

### 技術スタック
- **Runtime**: Cloudflare Workers
- **Language**: JavaScript (ES2022)
- **APIs**: Slack Events API, freee人事労務API
- **Authentication**: OAuth 2.0, Slack Signature Verification

## 📜 ライセンス

MIT License

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. Pull Requestを作成

## 📞 サポート

- 📧 Email: your-email@example.com
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/slack-freee-timeclock/issues)
- 📖 Documentation: [freee人事労務API](https://developer.freee.co.jp/reference/hr)

## ⚠️ 注意事項

- freee人事労務のタイムレコーダー機能はベーシックプラン以上で利用可能
- アクセストークンは6時間で有効期限が切れます
- 本アプリは非公式ツールです。freee社による公式サポートはありません

---

Made with ❤️ for efficient time tracking
