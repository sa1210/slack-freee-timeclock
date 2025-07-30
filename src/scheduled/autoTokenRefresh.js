// 定期的なトークン自動更新（5時間ごと）

import { AutoRefreshFreeeClient } from '../lib/autoRefreshClient.js';

export async function handleTokenAutoRefresh(env) {
  console.log('🔄 Starting automatic token refresh...');
  
  try {
    const freeeClient = new AutoRefreshFreeeClient(env);
    
    // トークンをリフレッシュ
    const newTokenData = await freeeClient.refreshAccessToken();
    
    // Slack通知
    const SlackClient = (await import('../index.js')).SlackClient;
    const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);
    
    await slackClient.postMessage(
      env.TARGET_CHANNEL_ID,
      `🔄 freeeアクセストークンを自動更新しました\n` +
      `⏰ 次回更新: 5時間後\n` +
      `✅ システム正常稼働中`
    );
    
    console.log('✅ Automatic token refresh completed');
    
  } catch (error) {
    console.error('❌ Automatic token refresh failed:', error);
    
    // エラー通知
    try {
      const SlackClient = (await import('../index.js')).SlackClient;
      const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);
      
      await slackClient.postMessage(
        env.TARGET_CHANNEL_ID,
        `🚨 freeeトークンの自動更新に失敗しました\n` +
        `エラー: ${error.message}\n` +
        `手動での更新が必要です`
      );
    } catch (notifyError) {
      console.error('Failed to send error notification:', notifyError);
    }
  }
}
