// KV対応 freeeトークンマネージャー（永続化実装）

export class FreeeTokenManager {
  constructor(env) {
    this.env = env;
    this.kvStore = env.TOKEN_STORE; // KVストレージ
    this.clientId = env.FREEE_CLIENT_ID;
    this.clientSecret = env.FREEE_CLIENT_SECRET;
    
    // デバッグ: CLIENT_SECRETの存在確認
    console.log('🔍 Debug: CLIENT_SECRET exists:', !!this.clientSecret);
    console.log('🔍 Debug: CLIENT_SECRET length:', this.clientSecret ? this.clientSecret.length : 0);
    console.log('🔍 Debug: CLIENT_SECRET first 10 chars:', this.clientSecret ? this.clientSecret.substring(0, 10) + '...' : 'N/A');
    
    // KVキー名
    this.ACCESS_TOKEN_KEY = 'freee_access_token';
    this.REFRESH_TOKEN_KEY = 'freee_refresh_token';
    this.TOKEN_EXPIRES_AT_KEY = 'freee_token_expires_at';
    this.LAST_REFRESH_KEY = 'freee_last_refresh';
  }

  // アクセストークンをKVから取得
  async getAccessToken() {
    if (!this.kvStore) {
      console.warn('KV storage not available, using environment variables');
      return this.env.FREEE_ACCESS_TOKEN;
    }

    try {
      console.log('🔍 KV Debug: Attempting to read from KV...');
      console.log('🔍 KV Debug: ACCESS_TOKEN_KEY =', this.ACCESS_TOKEN_KEY);
      
      const token = await this.kvStore.get(this.ACCESS_TOKEN_KEY);
      console.log('🔍 KV Debug: Retrieved token =', token ? `${token.substring(0, 10)}...` : 'null');
      
      const expiresAt = await this.kvStore.get(this.TOKEN_EXPIRES_AT_KEY);
      console.log('🔍 KV Debug: Retrieved expiresAt =', expiresAt);
      
      if (!token) {
        console.log('No access token found in KV, using environment variable');
        return this.env.FREEE_ACCESS_TOKEN;
      }

      // 期限チェック（5分前にリフレッシュ）
      if (expiresAt) {
        const expiryTime = parseInt(expiresAt);
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;
        
        if (now >= (expiryTime - fiveMinutes)) {
          console.log('🔄 Token expires soon, refreshing...');
          return await this.refreshAccessToken();
        }
      }

      console.log('✅ Using valid access token from KV');
      return token;
    } catch (error) {
      console.error('❌ Error reading from KV:', error);
      return this.env.FREEE_ACCESS_TOKEN;
    }
  }

  // リフレッシュトークンをKVから取得
  async getRefreshToken() {
    if (!this.kvStore) {
      return this.env.FREEE_REFRESH_TOKEN;
    }

    try {
      const token = await this.kvStore.get(this.REFRESH_TOKEN_KEY);
      return token || this.env.FREEE_REFRESH_TOKEN;
    } catch (error) {
      console.error('❌ Error reading refresh token from KV:', error);
      return this.env.FREEE_REFRESH_TOKEN;
    }
  }

  // 新しいアクセストークンを取得してKVに保存
  async refreshAccessToken() {
    console.log('🔄 Starting token refresh process...');
    
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    // デバッグ: リフレッシュパラメータの確認
    console.log('🔍 Debug: Refresh params:');
    console.log('  - client_id:', this.clientId);
    console.log('  - client_secret exists:', !!this.clientSecret);
    console.log('  - client_secret length:', this.clientSecret ? this.clientSecret.length : 0);
    console.log('  - refresh_token:', refreshToken ? refreshToken.substring(0, 10) + '...' : 'N/A');
    console.log('  - redirect_uri:', 'urn:ietf:wg:oauth:2.0:oob');
    
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'  // ←修正: redirect_uri追加
    });
    
    // デバッグ: URLSearchParamsの内容確認
    console.log('🔍 Debug: URLSearchParams string:', params.toString().replace(/client_secret=[^&]+/, 'client_secret=***'));

    try {
      const response = await fetch('https://accounts.secure.freee.co.jp/public_api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('❌ Debug: Refresh failed response:');
        console.error('  - Status:', response.status);
        console.error('  - Error:', error);
        console.error('  - Headers:', Object.fromEntries(response.headers.entries()));
        throw new Error(`Token refresh failed: ${response.status} ${error}`);
      }

      const tokenData = await response.json();
      console.log('✅ Token refresh successful');
      console.log('🔍 Debug: New token data:');
      console.log('  - access_token:', tokenData.access_token ? tokenData.access_token.substring(0, 10) + '...' : 'N/A');
      console.log('  - refresh_token:', tokenData.refresh_token ? tokenData.refresh_token.substring(0, 10) + '...' : 'N/A');
      console.log('  - expires_in:', tokenData.expires_in);
      
      // KVに新しいトークンを保存
      await this.saveTokens(tokenData);
      
      return tokenData.access_token;
    } catch (error) {
      console.error('❌ Token refresh failed:', error);
      throw error;
    }
  }

  // トークンをKVに保存
  async saveTokens(tokenData) {
    const now = Date.now();
    const expiresAt = now + (tokenData.expires_in * 1000); // ミリ秒に変換
    
    if (!this.kvStore) {
      console.warn('KV storage not available, updating environment variables only');
      this.env.FREEE_ACCESS_TOKEN = tokenData.access_token;
      this.env.FREEE_REFRESH_TOKEN = tokenData.refresh_token;
      return;
    }

    try {
      // すべてのトークン情報をKVに保存
      await Promise.all([
        this.kvStore.put(this.ACCESS_TOKEN_KEY, tokenData.access_token),
        this.kvStore.put(this.REFRESH_TOKEN_KEY, tokenData.refresh_token),
        this.kvStore.put(this.TOKEN_EXPIRES_AT_KEY, expiresAt.toString()),
        this.kvStore.put(this.LAST_REFRESH_KEY, now.toString())
      ]);

      console.log('✅ Tokens saved to KV storage');
      console.log(`📅 Token expires at: ${new Date(expiresAt).toISOString()}`);
      
      // 環境変数も更新（フォールバック用）
      this.env.FREEE_ACCESS_TOKEN = tokenData.access_token;
      this.env.FREEE_REFRESH_TOKEN = tokenData.refresh_token;
      
    } catch (error) {
      console.error('❌ Error saving tokens to KV:', error);
      throw error;
    }
  }

  // 初期トークンをKVに設定（初回セットアップ用）
  async initializeTokens(initialAccessToken, initialRefreshToken, expiresIn = 21600) {
    const tokenData = {
      access_token: initialAccessToken,
      refresh_token: initialRefreshToken,
      expires_in: expiresIn
    };

    await this.saveTokens(tokenData);
    console.log('✅ Initial tokens saved to KV');
  }

  // トークン状態の確認
  async getTokenStatus() {
    if (!this.kvStore) {
      return {
        storage: 'environment_variables',
        hasAccessToken: !!this.env.FREEE_ACCESS_TOKEN,
        hasRefreshToken: !!this.env.FREEE_REFRESH_TOKEN
      };
    }

    try {
      const accessToken = await this.kvStore.get(this.ACCESS_TOKEN_KEY);
      const refreshToken = await this.kvStore.get(this.REFRESH_TOKEN_KEY);
      const expiresAt = await this.kvStore.get(this.TOKEN_EXPIRES_AT_KEY);
      const lastRefresh = await this.kvStore.get(this.LAST_REFRESH_KEY);

      const status = {
        storage: 'kv_store',
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        expiresAt: expiresAt ? new Date(parseInt(expiresAt)).toISOString() : null,
        lastRefresh: lastRefresh ? new Date(parseInt(lastRefresh)).toISOString() : null,
        timeUntilExpiry: null
      };

      if (expiresAt) {
        const timeUntilExpiry = parseInt(expiresAt) - Date.now();
        status.timeUntilExpiry = Math.max(0, Math.floor(timeUntilExpiry / 1000 / 60)); // 分単位
      }

      return status;
    } catch (error) {
      console.error('❌ Error checking token status:', error);
      return { storage: 'error', error: error.message };
    }
  }

  // プロアクティブなトークン更新（スケジュール実行用）
  async proactiveRefresh() {
    try {
      const status = await this.getTokenStatus();
      console.log('🔍 Token status check:', status);

      // 30分以内に期限切れの場合、リフレッシュ
      if (status.timeUntilExpiry !== null && status.timeUntilExpiry <= 30) {
        console.log('⚠️ Token expires in 30 minutes or less, refreshing...');
        await this.refreshAccessToken();
        return true;
      }

      console.log('✅ Token is still valid, no refresh needed');
      return false;
    } catch (error) {
      console.error('❌ Proactive refresh failed:', error);
      return false;
    }
  }
}
