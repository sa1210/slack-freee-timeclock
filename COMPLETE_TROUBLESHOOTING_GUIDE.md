# freee Slack打刻アプリ 完全トラブルシューティングガイド

## 🚨 重要：未来のClaude開発者への注意事項

**このプロジェクトでは同じ問題が何度も繰り返し発生している。必ずこのドキュメントを完全に読んでから作業を開始すること。**

### 🔄 繰り返し発生する問題パターン
1. **fetch API "Canceled" 問題** → 実際はfreee API仕様の理解不足
2. **timeout設定の試行錯誤** → 根本原因ではない
3. **同じ修正を何度も実装** → 問題の特定ができていない
4. **毎回チャット内容が膨大になる** → このナレッジを最初に読まない
5. **available_typesエンドポイントの権限エラー** → アクセス権限がない

---

## 📊 最終的な問題の真相（2025年7月30日 16:54確定）

### ✅ 正常に動作している部分
- Cloudflare Workers KV トークン管理
- Slack イベント受信・処理  
- freee API 認証（Bearer token）
- fetch API 通信（GET・POST共に技術的成功）

### ❌ 実際の問題
1. **freee API仕様エラー：「打刻の種類が正しくありません。」**
2. **available_typesエンドポイントの権限エラー：「アクセス権限がありません。」**

```json
送信データ: {"company_id":12023789,"type":"clock_in","base_date":"2025-07-30"}
freee応答1: {"status_code":400,"errors":[{"type":"bad_request","messages":["打刻の種類が正しくありません。"]}]}

available_types確認試行:
freee応答2: {"status_code":403,"errors":[{"type":"forbidden","messages":["アクセス権限がありません。"]}]}
```

### 🎯 根本原因
1. **`clock_in`種別が無効**（従業員・会社設定による）
2. **available_typesエンドポイントに権限がない**（API権限設定）

---

## 🔍 freee API打刻種別の正しい仕様

### 重要な発見：available_typesエンドポイントは使用不可
- エンドポイント: `/api/v1/employees/{employee_id}/time_clocks/available_types`
- **403 Forbidden**: アクセス権限がありません

### 確認されている打刻種別（検索結果より）
- `"clock_in"` → 出勤（多くの実装例で使用）
- `"clock_out"` → 退勤（多くの実装例で使用）
- `"break_start"` → 休憩開始
- `"break_end"` → 休憩終了

### 問題：`clock_in`が400エラー
検索結果では`clock_in`が使用されているが、このfreee環境では無効。

---

## 🛠️ 即座に実装すべき解決策

### 1. 段階的テスト方式

```javascript
// 既知の種別を段階的にテスト
async findWorkingTimeClockType(employeeId, intendedType) {
  const typeVariations = {
    clock_in: ['clock_in'], // 基本から開始
    clock_out: ['clock_out'],
    break_start: ['break_start'],
    break_end: ['break_end']
  };
  
  const candidates = typeVariations[intendedType] || [intendedType];
  
  for (const candidate of candidates) {
    try {
      // 実際にリクエストして確認
      const result = await this.makeRequest(`/employees/${employeeId}/time_clocks`, {
        method: 'POST',
        body: JSON.stringify({ company_id: companyId, type: candidate, base_date: base_date })
      });
      
      return { type: candidate, result: result };
    } catch (error) {
      // 400エラーの場合のみ次を試行
      if (!error.message.includes('400')) {
        throw error;
      }
    }
  }
}
```

### 2. 権限の再確認が必要

freeeアプリケーション設定で以下を確認：
- `hr:time_clocks:write` 権限
- `hr:time_clocks:read` 権限  
- 管理者権限でのアプリ作成

### 3. 会社設定の確認

freee管理画面で以下を確認：
- 打刻機能の有効化
- 利用可能な打刻種別の設定
- 従業員の打刻権限

---

## 📋 解決手順チェックリスト

### 即座に実行すべき手順
- [ ] 1. 段階的テスト版を実装・デプロイ
- [ ] 2. `clock_in`でテスト実行
- [ ] 3. 400エラーが出る場合、freee管理画面で設定確認
- [ ] 4. API権限の再確認・再設定
- [ ] 5. 別の打刻種別でテスト

### freee設定確認項目
- [ ] アプリ権限設定（hr:time_clocks:write）
- [ ] 打刻機能の有効化
- [ ] 従業員の打刻権限
- [ ] 利用可能な打刻種別

---

## 🚨 未来の開発者への重要メッセージ

### ❌ やってはいけないこと
1. **fetch APIの修正に時間を費やす** - 既に正常動作している
2. **timeout設定の調整** - 根本原因ではない
3. **available_typesエンドポイントの使用** - 権限エラーで使用不可
4. **推測による種別変更** - 段階的テストが必要
5. **同じ解決策を何度も試行** - このドキュメントを読まずに作業開始

### ✅ 最初にやるべきこと
1. **このドキュメントを完全に読む**
2. **段階的テスト方式を実装**
3. **freee管理画面で設定確認**
4. **API権限の再確認**
5. **1つずつ確認して進める**

### 🔄 毎回発生する問題の根絶
**このドキュメントを最初に読まずに作業を開始するため、同じ問題が繰り返される。**

---

## 🔍 デバッグ時の着眼点

### 成功の指標
```bash
# 期待される成功ログ
🔍 Finding working time clock type...
🧪 Testing type: clock_in
🧪 Testing with data: {"company_id":12023789,"type":"clock_in","base_date":"2025-07-30"}
✅ Success with type: clock_in
✅ Time clock registration successful: { employee_time_clock: { ... } }
```

### 失敗の指標（要対応）
```bash
# 400エラーは種別問題
❌ Failed with type: clock_in, error: freee API Error: 400 ...

# 403エラーは権限問題
❌ Failed with type: clock_in, error: freee API Error: 403 ...
```

---

## 📖 参考情報

### 動作確認済み部分
- ✅ Cloudflare Workers KV（完全動作）
- ✅ Slack Events API（完全動作）
- ✅ freee認証（完全動作）
- ✅ fetch API（完全動作）

### 解決待ち部分
- ❌ freee打刻種別の正確な特定
- ❌ freee管理画面での設定確認
- ❌ API権限の最適化

---

## 🎯 最終的な成功の定義

1. **段階的テストで正しい種別を特定**
2. **freee APIが200 OKレスポンス**
3. **打刻データがfreee管理画面に表示**
4. **Slackに成功メッセージが返信**

**この4点が全て達成されれば完全成功**

---

## 🏆 成功パターンの記録欄

**※問題解決後、ここに成功時の情報を記録すること**

```
実際の動作する打刻種別：
- 出勤: [テスト後記入]
- 退勤: [テスト後記入] 
- 休憩開始: [テスト後記入]
- 休憩終了: [テスト後記入]

freee管理画面の設定：
[確認後記入]

成功時のリクエストデータ：
[確認後記入]

成功時のレスポンス：
[確認後記入]
```

---

*最終更新: 2025年7月30日 16:54*  
*次回作業時は必ず段階的テストから開始すること*  
*このドキュメントを読まずに作業開始することを禁止する*  
*available_typesエンドポイントは権限エラーで使用不可*