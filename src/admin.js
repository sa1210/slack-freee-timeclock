// トークン初期化スクリプト
// 取得したトークンをKVに保存するためのワンタイムスクリプト

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // /init-tokens エンドポイント
    if (url.pathname === '/init-tokens' && request.method === 'POST') {
      const body = await request.json();
      
      const { access_token, refresh_token, expires_in } = body;
      
      if (!access_token || !refresh_token) {
        return new Response('Missing tokens', { status: 400 });
      }
      
      // KVにトークンを保存
      const tokenData = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: Date.now() + (expires_in * 1000),
        updatedAt: Date.now()
      };
      
      await env.TOKEN_STORE.put('freee_tokens', JSON.stringify(tokenData));
      
      return new Response('Tokens initialized successfully', { status: 200 });
    }
    
    // /status エンドポイント - 現在のトークン状況確認
    if (url.pathname === '/status' && request.method === 'GET') {
      const tokenData = await env.TOKEN_STORE.get('freee_tokens', 'json');
      
      if (!tokenData) {
        return new Response(JSON.stringify({ 
          status: 'no_tokens',
          message: 'No tokens found in KV'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const isValid = Date.now() < (tokenData.expiresAt - 5 * 60 * 1000);
      
      return new Response(JSON.stringify({
        status: isValid ? 'valid' : 'expired',
        expiresAt: new Date(tokenData.expiresAt).toISOString(),
        timeUntilExpiry: Math.max(0, tokenData.expiresAt - Date.now()),
        hasRefreshToken: !!tokenData.refreshToken
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
};
