// KV対応 完全自動リフレッシュ機能付きfreeeクライアント（最終版）

import { FreeeTokenManager } from './freeeTokenManager.js';

export class AutoRefreshFreeeClient {
  constructor(env) {
    this.env = env;
    this.baseURL = 'https://api.freee.co.jp/hr/api/v1';
    this.tokenManager = new FreeeTokenManager(env);
  }

  // 最小限のfetch実装
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    // 最新のアクセストークンを取得
    let accessToken = await this.tokenManager.getAccessToken();
    
    console.log('🚀 Starting API request to:', url);
    console.log('🚀 Request options:', { method: options.method || 'GET', hasBody: !!options.body });
    
    const requestInit = {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (options.body) {
      requestInit.body = options.body;
    }

    console.log('🔍 Final request init:', {
      method: requestInit.method,
      hasAuth: requestInit.headers.Authorization.startsWith('Bearer'),
      hasBody: !!requestInit.body,
      bodyLength: requestInit.body ? requestInit.body.length : 0
    });

    try {
      const response = await fetch(url, requestInit);

      console.log('🚀 Received response:', { 
        status: response.status, 
        statusText: response.statusText 
      });

      // 401エラーの場合、リフレッシュして再試行
      if (response.status === 401) {
        console.log('🔄 Token expired, refreshing and retrying...');
        
        accessToken = await this.tokenManager.refreshAccessToken();
        requestInit.headers.Authorization = `Bearer ${accessToken}`;
        
        const retryResponse = await fetch(url, requestInit);
        console.log('🔄 Retry response:', { status: retryResponse.status, statusText: retryResponse.statusText });
        
        if (!retryResponse.ok) {
          const errorText = await retryResponse.text();
          throw new Error(`freee API Error: ${retryResponse.status} ${errorText}`);
        }

        const result = await retryResponse.json();
        console.log('✅ freee API Success (after retry):', result);
        return result;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ freee API Error:', { status: response.status, error: errorText });
        throw new Error(`freee API Error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ freee API Success:', result);
      return result;
      
    } catch (error) {
      console.error('❌ Complete error details:', {
        name: error.name,
        message: error.message
      });
      throw error;
    }
  }

  // 打刻API（シンプル版 - 事前確認なし）
  async registerTimeClock(employeeId, type, location = 'Slack') {
    console.log(`Starting registerTimeClock for employee ${employeeId}, type: ${type}`);
    
    try {
      // 会社IDは一度だけ取得してキャッシュ
      if (!this.cachedCompanyId) {
        console.log('Getting user info...');
        const userInfo = await this.getUserInfo();
        this.cachedCompanyId = userInfo.companies[0].id;
      }
      const companyId = this.cachedCompanyId;
      console.log('Company ID:', companyId);
      
      // 日本時間での日付取得
      const now = new Date();
      const jstOffset = 9 * 60; // JST = UTC+9
      const jstTime = new Date(now.getTime() + (jstOffset * 60 * 1000));
      
      const year = jstTime.getFullYear();
      const month = String(jstTime.getMonth() + 1).padStart(2, '0');
      const day = String(jstTime.getDate()).padStart(2, '0');
      const base_date = `${year}-${month}-${day}`;
      
      console.log('Base date:', base_date);
      
      const timeClockData = {
        company_id: companyId,
        type: type,
        base_date: base_date
      };

      console.log('🚀 Time clock data:', JSON.stringify(timeClockData));
      console.log('Making API request to freee...');
      
      const result = await this.makeRequest(`/employees/${employeeId}/time_clocks`, {
        method: 'POST',
        body: JSON.stringify(timeClockData)
      });
      
      console.log('✅ Time clock registration successful:', result);
      return result;
      
    } catch (error) {
      console.error('❌ Time clock registration failed:', error);
      
      // freee APIエラーメッセージを分析して適切なメッセージに変換
      if (error.message.includes('打刻の種類が正しくありません')) {
        if (type === 'clock_in') {
          throw new Error('既に出勤済みです。');
        } else if (type === 'clock_out') {
          throw new Error('まだ出勤していないか、既に退勤済みです。');
        } else {
          throw new Error('現在の打刻状況では、この操作はできません。');
        }
      }
      
      throw error;
    }
  }

  // ユーザー情報取得
  async getUserInfo() {
    console.log('Getting user info...');
    return await this.makeRequest('/users/me');
  }

  // 従業員一覧取得
  async getEmployees(companyId) {
    return await this.makeRequest(`/companies/${companyId}/employees`);
  }

  // 打刻履歴取得
  async getTimeClocks(employeeId, fromDate, toDate) {
    const params = new URLSearchParams({
      from_date: fromDate,
      to_date: toDate
    });
    
    return await this.makeRequest(`/employees/${employeeId}/time_clocks?${params}`);
  }

  // トークン状態確認
  async getTokenStatus() {
    return await this.tokenManager.getTokenStatus();
  }

  // プロアクティブトークン更新
  async proactiveTokenRefresh() {
    return await this.tokenManager.proactiveRefresh();
  }
}