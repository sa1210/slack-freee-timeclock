// 定期的なトークン更新とヘルスチェック

import { FreeeTokenManager } from '../lib/freeeTokenManager.js';

export async function handleScheduledTokenRefresh(env) {
  console.log('Starting scheduled token refresh check...');
  
  try {
    const tokenManager = new FreeeTokenManager(env);
    const currentTokens = await tokenManager.getTokenFromKV();
    
    // トークンの残り有効期限をチェック
    const now = Date.now();
    const timeUntilExpiry = currentTokens.expiresAt - now;
    const daysUntilExpiry = timeUntilExpiry / (1000 * 60 * 60 * 24);
    
    console.log(`Token expires in ${daysUntilExpiry.toFixed(2)} days`);
    
    // 7日以内に期限切れの場合は警告
    if (daysUntilExpiry < 7) {
      await sendSlackNotification(env, `⚠️ freeeアクセストークンが${Math.floor(daysUntilExpiry)}日で期限切れになります。手動で更新してください。`);
    }
    
    // 1日以内に期限切れの場合は緊急警告
    if (daysUntilExpiry < 1) {
      await sendSlackNotification(env, `🚨 URGENT: freeeアクセストークンが本日期限切れになります！すぐに更新してください。`);
    }
    
    // リフレッシュトークンが利用可能な場合は自動更新を試行
    if (currentTokens.refreshToken && daysUntilExpiry < 3) {
      try {
        console.log('Attempting automatic token refresh...');
        await tokenManager.refreshAccessToken();
        await sendSlackNotification(env, '✅ freeeアクセストークンが自動で更新されました。');
        console.log('Token refresh successful');
      } catch (error) {
        console.error('Automatic token refresh failed:', error);
        await sendSlackNotification(env, `❌ freeeアクセストークンの自動更新に失敗しました: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('Scheduled token refresh check failed:', error);
    await sendSlackNotification(env, `❌ トークンチェックでエラーが発生しました: ${error.message}`);
  }
}

// API健康性チェック
export async function handleHealthCheck(env) {
  console.log('Starting API health check...');
  
  try {
    const tokenManager = new FreeeTokenManager(env);
    const freeeClient = new (await import('../lib/freeeTokenManager.js')).FreeeHRClientWithTokenManagement(env);
    
    // freee APIの接続テスト
    const userInfo = await freeeClient.getUserInfo();
    console.log('freee API health check: OK');
    
    // Slack APIの接続テスト  
    const slackClient = new (await import('../index.js')).SlackClient(env.SLACK_BOT_TOKEN);
    await slackClient.postMessage(env.TARGET_CHANNEL_ID, '🔍 定期ヘルスチェック: システム正常');
    
    console.log('All systems healthy');
    
  } catch (error) {
    console.error('Health check failed:', error);
    
    // エラー通知（可能であれば）
    try {
      const slackClient = new (await import('../index.js')).SlackClient(env.SLACK_BOT_TOKEN);
      await slackClient.postMessage(env.TARGET_CHANNEL_ID, `❌ システムヘルスチェックエラー: ${error.message}`);
    } catch (notifyError) {
      console.error('Failed to send error notification:', notifyError);
    }
  }
}

// Slack通知ヘルパー
async function sendSlackNotification(env, message) {
  try {
    const SlackClient = (await import('../index.js')).SlackClient;
    const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);
    await slackClient.postMessage(env.TARGET_CHANNEL_ID, message);
  } catch (error) {
    console.error('Failed to send Slack notification:', error);
  }
}
