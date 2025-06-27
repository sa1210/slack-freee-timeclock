// Cloudflare Workers で動作するSlack freee打刻アプリ（ハイブリッドマッチング版）

// キーワードマッピング（akashi競合回避版）
const KEYWORDS = {
  clock_in: [
    'freee出勤', 'freee始業', 'f出勤', 'f始業',
    '出勤', '始業', 'しゅっきん', 'しぎょう', 
    'おはようございます', 'in'
  ],
  clock_out: [
    'freee退勤', 'freee終業', 'f退勤', 'f終業',
    '退勤', '終業', 'たいきん', 'しゅうぎょう', 
    'お疲れ様', 'out'
  ],
  break_start: [
    'freee休憩入り', 'f休憩入り',
    '休憩入り', '休憩開始', 'きゅうけいいり', 'きゅうけいかいし'
  ],
  break_end: [
    'freee休憩戻り', 'f休憩戻り',
    '休憩戻り', '休憩終了', 'きゅうけいもどり', 'きゅうけいしゅうりょう'
  ]
};

// freee API クライアント
class FreeeHRClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://api.freee.co.jp/hr/api/v1';
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`freee API Error: ${response.status} ${error}`);
    }

    return response.json();
  }

  async registerTimeClock(employeeId, type, location = 'Slack') {
    const endpoint = `/employees/${employeeId}/time_clocks`;
    const timeClockData = {
      type: type,
      datetime: new Date().toISOString(),
      location: location
    };

    return await this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify({ time_clock: timeClockData })
    });
  }

  async getUserInfo() {
    return await this.request('/users/me');
  }

  async getEmployees(companyId) {
    return await this.request(`/companies/${companyId}/employees`);
  }
}

// Slack API クライアント
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

  async getUserInfo(userId) {
    return await this.request('users.info', { user: userId });
  }
}

// ハイブリッドマッチング機能
class HybridMatcher {
  constructor(freeeClient, slackClient, companyId, env) {
    this.freeeClient = freeeClient;
    this.slackClient = slackClient;
    this.companyId = companyId;
    this.env = env;
    this.cache = new Map(); // キャッシュ用
  }

  async getEmployeeIdBySlackUser(slackUserId) {
    // キャッシュから確認
    if (this.cache.has(slackUserId)) {
      return this.cache.get(slackUserId);
    }

    // 1. 手動マッピングを優先チェック
    const manualMapping = this.getManualMapping();
    if (manualMapping[slackUserId]) {
      console.log(`Found manual mapping for ${slackUserId}: ${manualMapping[slackUserId]}`);
      this.cache.set(slackUserId, manualMapping[slackUserId]);
      return manualMapping[slackUserId];
    }

    // 2. メールアドレス自動マッチング
    try {
      const employeeId = await this.matchByEmail(slackUserId);
      if (employeeId) {
        this.cache.set(slackUserId, employeeId);
        return employeeId;
      }
    } catch (error) {
      console.error('Email matching failed:', error);
    }

    // 3. マッチング失敗
    console.log(`No matching found for Slack user: ${slackUserId}`);
    return null;
  }

  getManualMapping() {
    try {
      return JSON.parse(this.env.USER_MAPPING || '{}');
    } catch (error) {
      console.error('Failed to parse USER_MAPPING:', error);
      return {};
    }
  }

  async matchByEmail(slackUserId) {
    // Slackユーザー情報取得
    const slackUser = await this.slackClient.getUserInfo(slackUserId);
    const slackEmail = slackUser.user.profile.email;
    
    if (!slackEmail) {
      console.log(`No email found for Slack user: ${slackUserId}`);
      return null;
    }

    console.log(`Slack user email: ${slackEmail}`);

    // freee従業員一覧取得
    const employeesResponse = await this.freeeClient.getEmployees(this.companyId);
    const employees = employeesResponse.employees || employeesResponse;

    // メールアドレスでマッチング
    const matchedEmployee = employees.find(emp => 
      emp.email && emp.email.toLowerCase() === slackEmail.toLowerCase()
    );

    if (matchedEmployee) {
      console.log(`Email matched employee: ${matchedEmployee.display_name} (ID: ${matchedEmployee.id})`);
      return matchedEmployee.id;
    } else {
      console.log(`No freee employee found with email: ${slackEmail}`);
      return null;
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
    break_start: '休憩開始',
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

// メイン処理
async function processSlackEvent(event, env) {
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

  // 対象チャンネルかチェック（デバッグ情報追加）
  console.log('Debug channel check:', {
    messageChannel: messageEvent.channel,
    envTargetChannel: env.TARGET_CHANNEL_ID,
    envTargetChannelType: typeof env.TARGET_CHANNEL_ID,
    envKeys: Object.keys(env),
    comparison: messageEvent.channel === env.TARGET_CHANNEL_ID,
    messageChannelLength: messageEvent.channel.length,
    envChannelLength: env.TARGET_CHANNEL_ID ? env.TARGET_CHANNEL_ID.length : 'undefined'
  });

  if (messageEvent.channel !== env.TARGET_CHANNEL_ID) {
    console.log(`Ignoring message from channel: ${messageEvent.channel}, expected: ${env.TARGET_CHANNEL_ID}`);
    return new Response('OK');
  }

  // アクション判定
  const action = detectAction(messageEvent.text);
  if (!action) {
    console.log(`No action detected for message: ${messageEvent.text}`);
    return new Response('OK');
  }

  try {
    // freee APIクライアント作成
    const freeeClient = new FreeeHRClient(env.FREEE_ACCESS_TOKEN);
    const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);

    // 会社IDを取得
    const userInfo = await freeeClient.getUserInfo();
    const companyId = userInfo.companies[0].id;

    // ハイブリッドマッチャー作成
    const matcher = new HybridMatcher(freeeClient, slackClient, companyId, env);

    // 従業員IDを取得（手動マッピング優先、次にメール自動マッチング）
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
      
      return new Response('OK');
    }

    // 打刻実行
    console.log(`Registering time clock: ${action} for employee ${employeeId}`);
    await freeeClient.registerTimeClock(employeeId, action);
    
    // Slackに確認メッセージ投稿
    const actionName = getActionDisplayName(action);
    const confirmMessage = `✅ ${actionName}を記録しました！`;
    
    await slackClient.postMessage(
      messageEvent.channel,
      confirmMessage,
      messageEvent.ts
    );

    console.log(`Time clock registered successfully: ${action} for employee ${employeeId}`);
    return new Response('OK');

  } catch (error) {
    console.error('Failed to process time clock:', error);
    
    // エラーメッセージをSlackに投稿
    try {
      const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);
      const errorMessage = error.message.includes('freee API Error') 
        ? `❌ 打刻の記録に失敗しました: ${error.message}`
        : `❌ 打刻の記録に失敗しました: システムエラーが発生しました`;
        
      await slackClient.postMessage(
        messageEvent.channel,
        errorMessage,
        messageEvent.ts
      );
    } catch (slackError) {
      console.error('Failed to post error message to Slack:', slackError);
    }
    
    return new Response('OK');
  }
}

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
      
      return await processSlackEvent(event, env);

    } catch (error) {
      console.error('Error processing request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};
