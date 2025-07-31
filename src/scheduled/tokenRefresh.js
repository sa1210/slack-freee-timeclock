// 定期的なトークン更新とヘルスチェック

import { FreeeTokenManager } from '../lib/freeeTokenManager.js';

export async function handleScheduledTokenRefresh(env) {
  console.log('Starting scheduled token refresh (30分ごと)...');
  
  try {
    const tokenManager = new FreeeTokenManager(env);
    const status = await tokenManager.getTokenStatus();
    
    console.log('🔍 Token status check:', status);

    // 30分ごとに必ずリフレッシュ（最も確実）
    console.log('🔄 Performing scheduled token refresh...');
    try {
      await tokenManager.refreshAccessToken();
      console.log('✅ Token refresh successful');
      // 成功時はSlack通知を送らない（30分ごとなのでスパム防止）
    } catch (error) {
      console.error('❌ Automatic token refresh failed:', error);
      await sendSlackNotification(env, `❌ freeeアクセストークンの自動更新に失敗しました: ${error.message}`);
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
