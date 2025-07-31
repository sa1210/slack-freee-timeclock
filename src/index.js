// Cloudflare Workers で動作するSlack freee打刻アプリ（非同期処理版）

// キーワードマッピング
const KEYWORDS = {
  clock_in: [
    'freee出勤', 'freee始業', 'f出勤', 'いn',
    '出勤', 'いん', 'しゅっきん', 'いん', 
    'おはようございます', 'in'
  ],
  clock_out: [
    'freee退勤', 'freee終業', 'f退勤', 'おうt',
    '退勤', '終業', 'たいきん', 'しゅうぎょう', 
    'お疲れ様', 'out'
  ],
  break_begin: [
    'freee休憩入り', 'f休憩入り',
    '休憩入り', '休憩開始', 'きゅうけいいり', 'きゅうけいかいし'
  ],
  break_end: [
    'freee休憩戻り', 'f休憩戻り',
    '休憩戻り', '休憩終了', 'きゅうけいもどり', 'きゅうけいしゅうりょう'
  ]
};

// freee API クライアント
import { AutoRefreshFreeeClient } from './lib/autoRefreshClient.js';

// Slack API クライアント（非同期対応版）
class SlackClient {
  constructor(botToken) {
    this.botToken = botToken;
    this.baseURL = 'https://slack.com/api';
  }

  async request(method, data = {}) {
    const response = await fetch(`${this.baseURL}/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Slack API Error: ${result.error}`);
    }

    return result;
  }

  async postMessage(channel, text, threadTs = null) {
    const data = {
      channel: channel,
      text: text
    };

    if (threadTs) {
      data.thread_ts = threadTs;
    }

    return await this.request('chat.postMessage', data);
  }

  // 処理中メッセージを投稿
  async postProcessingMessage(channel, action, threadTs = null) {
    const actionName = getActionDisplayName(action);
    const message = `⏳ ${actionName}処理中...`;
    
    return await this.postMessage(channel, message, threadTs);
  }

  // 成功メッセージを投稿
  async postSuccessMessage(channel, action, result, threadTs = null) {
    const actionName = getActionDisplayName(action);
    
    // freee APIのdatetimeから正しい時刻を取得
    // freee API: "2025-07-30T17:19:00.000+09:00" (既にJST)
    const freeeDateTime = result.employee_time_clock.datetime;
    
    // 文字列操作で正しい時刻を取得（タイムゾーン変換を避ける）
    const datePart = freeeDateTime.split('T')[0]; // "2025-07-30"
    const timePart = freeeDateTime.split('T')[1].split('.')[0]; // "17:19:00"
    const displayDateTime = `${datePart.replace(/-/g, '/')} ${timePart}`;
    
    const message = `✅ ${actionName}を記録しました！\n打刻時刻: ${displayDateTime}`;
    
    return await this.postMessage(channel, message, threadTs);
  }

  // エラーメッセージを投稿
  async postErrorMessage(channel, action, error, threadTs = null) {
    const actionName = getActionDisplayName(action);
    let message = `❌ ${actionName}の記録に失敗しました。\n`;
    
    if (error.message.includes('既に出勤済み')) {
      message += '既に出勤済みです。';
    } else if (error.message.includes('まだ出勤していない')) {
      message += 'まだ出勤していないか、既に退勤済みです。';
    } else if (error.message.includes('打刻の種類が正しくありません')) {
      message += '現在の打刻状況では、この操作はできません。';
    } else {
      message += 'システムエラーが発生しました。';
    }
    
    return await this.postMessage(channel, message, threadTs);
  }
}

// ハイブリッドマッチング機能（メールアドレス自動マッチング対応）
class HybridMatcher {
  constructor(env, freeeClient, loginUserEmployeeId = null) {
    this.env = env;
    this.freeeClient = freeeClient;
    this.loginUserEmployeeId = loginUserEmployeeId;
    this.cache = new Map();
    this.employeeCache = null; // freee従業員リストキャッシュ
  }

  async getEmployeeIdBySlackUser(slackUserId) {
    // キャッシュから確認
    if (this.cache.has(slackUserId)) {
      console.log(`Found cached mapping for ${slackUserId}: ${this.cache.get(slackUserId)}`);
      return this.cache.get(slackUserId);
    }

    // 手動マッピングを優先チェック
    const manualMapping = this.getManualMapping();
    if (manualMapping[slackUserId]) {
      console.log(`Found manual mapping for ${slackUserId}: ${manualMapping[slackUserId]}`);
      this.cache.set(slackUserId, manualMapping[slackUserId]);
      return manualMapping[slackUserId];
    }

    // 自動マッチング: メールアドレスベース
    console.log(`🔍 Attempting automatic matching for Slack user: ${slackUserId}`);
    const employeeId = await this.attemptEmailMatching(slackUserId);
    if (employeeId) {
      console.log(`✅ Auto-matched ${slackUserId} to employee ${employeeId}`);
      this.cache.set(slackUserId, employeeId);
      return employeeId;
    }

    // フォールバック: ログインユーザー自身のemployee_idを使用
    if (this.loginUserEmployeeId) {
      console.log(`Using cached login user's employee_id as fallback: ${this.loginUserEmployeeId}`);
      this.cache.set(slackUserId, this.loginUserEmployeeId);
      return this.loginUserEmployeeId;
    }

    console.log(`❌ No matching found for Slack user: ${slackUserId}`);
    return null;
  }

  // メールアドレスベース自動マッチング
  async attemptEmailMatching(slackUserId) {
    try {
      // Slackユーザーのメールアドレス取得
      const slackEmail = await this.getSlackUserEmail(slackUserId);
      if (!slackEmail) {
        console.log(`⚠️ Could not get email for Slack user: ${slackUserId}`);
        return null;
      }
      console.log(`📧 Slack user email: ${slackEmail}`);

      // 🔧 特別処理: sa@3bitter.com → sa2@3bitter.com のハードコードマッチング
      if (slackEmail.toLowerCase() === 'sa@3bitter.com') {
        console.log(`🔧 Special hardcoded mapping: sa@3bitter.com -> sa2@3bitter.com`);
        // sa2@3bitter.com のemployee_idを直接検索
        const employees = await this.getFreeeEmployees();
        const saEmployee = employees?.find(emp => 
          emp.email && emp.email.toLowerCase() === 'sa2@3bitter.com'
        );
        if (saEmployee) {
          console.log(`✅ Found sa2@3bitter.com employee: ${saEmployee.display_name} (ID: ${saEmployee.id})`);
          return saEmployee.id.toString();
        } else {
          console.log(`❌ Could not find sa2@3bitter.com in freee employees`);
        }
      }

      // freee従業員一覧を取得（キャッシュ利用）
      const employees = await this.getFreeeEmployees();
      if (!employees || employees.length === 0) {
        console.log(`⚠️ No freee employees found`);
        return null;
      }

      // 通常のメールアドレスでマッチング
      const matchedEmployee = employees.find(emp => {
        const freeeEmail = emp.email;
        if (!freeeEmail) return false;
        
        // 大文字小文字を無視して比較
        const match = freeeEmail.toLowerCase() === slackEmail.toLowerCase();
        if (match) {
          console.log(`🎯 Email match found: ${slackEmail} -> ${emp.display_name} (ID: ${emp.id})`);
        }
        return match;
      });

      if (matchedEmployee) {
        return matchedEmployee.id.toString();
      } else {
        console.log(`❌ No email match found for: ${slackEmail}`);
        console.log(`Available freee emails: ${employees.map(e => e.email).filter(e => e).join(', ')}`);
        return null;
      }

    } catch (error) {
      console.error(`❌ Email matching failed for ${slackUserId}:`, error);
      return null;
    }
  }

  // Slackユーザーのメールアドレス取得
  async getSlackUserEmail(slackUserId) {
    try {
      const response = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
        headers: {
          'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const data = await response.json();
      if (!data.ok) {
        console.error(`Slack API error:`, data.error);
        return null;
      }

      const email = data.user?.profile?.email;
      if (!email) {
        console.log(`⚠️ No email found in Slack profile for user: ${slackUserId}`);
        return null;
      }

      return email;
    } catch (error) {
      console.error(`Failed to get Slack user email:`, error);
      return null;
    }
  }

  // freee従業員一覧取得（キャッシュ付き）
  async getFreeeEmployees() {
    if (this.employeeCache) {
      console.log(`📝 Using cached freee employees (${this.employeeCache.length} employees)`);
      return this.employeeCache;
    }

    try {
      console.log(`🔍 Fetching freee employees...`);
      const companyId = this.freeeClient.cachedCompanyId;
      if (!companyId) {
        console.error(`❌ No company ID available`);
        return null;
      }

      const result = await this.freeeClient.getEmployees(companyId);
      
      // 🔧 バグ修正: freee APIレスポンスは配列が直接返される
      // result.employees ではなく result が配列
      const employees = Array.isArray(result) ? result : (result.employees || []);
      
      console.log(`📝 Fetched ${employees.length} freee employees`);
      employees.forEach(emp => {
        console.log(`  - ${emp.display_name} (ID: ${emp.id}, Email: ${emp.email || 'N/A'})`);
      });

      // キャッシュに保存（5分間有効）
      this.employeeCache = employees;
      setTimeout(() => {
        this.employeeCache = null;
        console.log(`🗑️ Employee cache expired`);
      }, 5 * 60 * 1000);

      return employees;
    } catch (error) {
      console.error(`❌ Failed to fetch freee employees:`, error);
      return null;
    }
  }

  getManualMapping() {
    try {
      return JSON.parse(this.env.USER_MAPPING || '{}');
    } catch (error) {
      console.error('Failed to parse USER_MAPPING:', error);
      return {};
    }
  }
}

// ユーティリティ関数
function detectAction(message) {
  const lowerMessage = message.toLowerCase().trim();
  
  for (const [action, keywords] of Object.entries(KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        return action;
      }
    }
  }
  
  return null;
}

function getActionDisplayName(action) {
  const names = {
    clock_in: '出勤',
    clock_out: '退勤',
    break_begin: '休憩開始',
    break_end: '休憩終了'
  };
  return names[action] || action;
}

// Slack署名検証
async function verifySlackSignature(body, signingSecret, timestamp, signature) {
  if (!signingSecret || !timestamp || !signature) {
    return false;
  }

  const time = parseInt(timestamp);
  const currentTime = Math.floor(Date.now() / 1000);
  
  if (Math.abs(currentTime - time) > 300) {
    return false;
  }
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBaseString = `v0:${timestamp}:${body}`;
  const mySignature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signatureBaseString)
  );
  
  const mySignatureHex = 'v0=' + Array.from(new Uint8Array(mySignature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return mySignatureHex === signature;
}

// バックグラウンド打刻処理
async function processTimeClockBackground(action, messageEvent, env) {
  const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);
  
  try {
    console.log('🚀 Starting background time clock processing...');
    
    // 処理中メッセージを投稿
    await slackClient.postProcessingMessage(messageEvent.channel, action, messageEvent.ts);
    
    // freee APIクライアント作成
    const freeeClient = new AutoRefreshFreeeClient(env);

    // 会社IDとユーザー情報を取得
    const userInfo = await freeeClient.getUserInfo();
    const companyId = userInfo.companies[0].id;
    const loginUserEmployeeId = userInfo.companies[0].employee_id;

    // ハイブリッドマッチャー作成（freeeClientを渡す）
    const matcher = new HybridMatcher(env, freeeClient, loginUserEmployeeId);

    // ✅ Company IDをキャッシュに設定（マッチング前に必要）
    freeeClient.cachedCompanyId = companyId;

    // 従業員IDを取得
    const employeeId = await matcher.getEmployeeIdBySlackUser(messageEvent.user);
    
    if (!employeeId) {
      console.log(`No matching employee found for Slack user: ${messageEvent.user}`);
      
      await slackClient.postMessage(
        messageEvent.channel,
        `❌ 従業員が見つかりません。\n` +
        `• 手動マッピング: 管理者に設定を依頼してください\n` +
        `• 自動マッチング: Slackプロフィールとfreeeのメールアドレスが一致している必要があります`,
        messageEvent.ts
      );
      
      return;
    }

    // 打刻実行
    console.log(`Registering time clock: ${action} for employee ${employeeId}`);
    const result = await freeeClient.registerTimeClock(employeeId, action);
    
    // 成功メッセージを投稿
    await slackClient.postSuccessMessage(messageEvent.channel, action, result, messageEvent.ts);

    console.log(`✅ Time clock registered successfully: ${action} for employee ${employeeId}`);

  } catch (error) {
    console.error('❌ Failed to process time clock:', error);
    
    // エラーメッセージを投稿
    try {
      await slackClient.postErrorMessage(messageEvent.channel, action, error, messageEvent.ts);
    } catch (slackError) {
      console.error('Failed to post error message to Slack:', slackError);
    }
  }
}

// メイン処理（非同期版）
async function processSlackEvent(event, env, ctx) {
  // URL verification（初回設定時）
  if (event.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: event.challenge }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // メッセージイベントのみ処理
  if (event.type !== 'event_callback' || event.event.type !== 'message') {
    return new Response('OK');
  }

  const messageEvent = event.event;
  
  // ボットメッセージや編集メッセージは無視
  if (messageEvent.subtype || messageEvent.bot_id) {
    return new Response('OK');
  }

  // 対象チャンネルかチェック
  const targetChannelId = env.TARGET_CHANNEL_ID || 'C06CZLP64GJ';
  console.log('Debug channel check:', {
    messageChannel: messageEvent.channel,
    envTargetChannel: env.TARGET_CHANNEL_ID,
    targetChannelId: targetChannelId,
    comparison: messageEvent.channel === targetChannelId
  });

  if (messageEvent.channel !== targetChannelId) {
    console.log(`Ignoring message from channel: ${messageEvent.channel}, expected: ${targetChannelId}`);
    return new Response('OK');
  }

  // アクション判定
  const action = detectAction(messageEvent.text);
  if (!action) {
    console.log(`No action detected for message: ${messageEvent.text}`);
    return new Response('OK');
  }

  console.log(`🎯 Action detected: ${action} for message: "${messageEvent.text}"`);

  // バックグラウンドで打刻処理を実行（非同期）
  ctx.waitUntil(processTimeClockBackground(action, messageEvent, env));

  // 即座にSlackに200レスポンスを返す
  return new Response('OK');
}

import { handleScheduledTokenRefresh, handleHealthCheck } from './scheduled/tokenRefresh.js';

// Cloudflare Workers エントリーポイント
export default {
  async fetch(request, env, ctx) {
    // CORS対応
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Slack-Signature, X-Slack-Request-Timestamp'
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await request.text();
      const timestamp = request.headers.get('X-Slack-Request-Timestamp');
      const signature = request.headers.get('X-Slack-Signature');

      console.log('Request received:', {
        timestamp,
        hasSignature: !!signature,
        bodyLength: body.length
      });

      // Slack署名検証
      if (env.SLACK_SIGNING_SECRET) {
        const isValid = await verifySlackSignature(
          body,
          env.SLACK_SIGNING_SECRET,
          timestamp,
          signature
        );

        if (!isValid) {
          console.error('Invalid Slack signature');
          return new Response('Unauthorized', { status: 401 });
        }
      } else {
        console.warn('SLACK_SIGNING_SECRET not set - signature verification skipped');
      }

      const event = JSON.parse(body);
      console.log('Event type:', event.type);
      
      return await processSlackEvent(event, env, ctx);

    } catch (error) {
      console.error('Error processing request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  // スケジュール実行
  async scheduled(controller, env, ctx) {
    console.log('Scheduled event triggered:', controller.cron);
    
    switch (controller.cron) {
      case '*/30 * * * *': // 30分ごと: トークンリフレッシュ
        console.log('🔄 Running 30-minute token refresh');
        await handleScheduledTokenRefresh(env);
        break;
      case '0 9 * * *': // 毎日9時: トークン期限チェック
        console.log('🌅 Running daily 9am token check');
        await handleScheduledTokenRefresh(env);
        break;
      case '0 */6 * * *': // 6時間ごと: ヘルスチェック
        console.log('💰 Running 6-hour health check');
        await handleHealthCheck(env);
        break;
      default:
        console.log('Unknown scheduled event:', controller.cron);
    }
  }
};
