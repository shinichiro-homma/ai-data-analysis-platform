# jupyter_server_config.py

import os
import sys

# カスタム拡張機能のパスを追加
sys.path.insert(0, '/home/jovyan/extensions')

c = get_config()

# =============================================================================
# トークン認証
# =============================================================================
# 環境変数 JUPYTER_TOKEN から認証トークンを取得
jupyter_token = os.environ.get('JUPYTER_TOKEN', '')

# トークンが未設定の場合はエラーで起動を中止
if not jupyter_token:
    print("ERROR: JUPYTER_TOKEN environment variable is required but not set.", file=sys.stderr)
    print("Please set JUPYTER_TOKEN in your .env file or environment.", file=sys.stderr)
    sys.exit(1)

c.ServerApp.token = jupyter_token

# =============================================================================
# CORS 設定
# =============================================================================
# jupyter-mcp (ポート 3001) からのアクセスを許可
# 開発環境では全オリジンを許可（本番では制限推奨）
c.ServerApp.allow_origin = '*'

# 認証情報（Cookie等）を含むリクエストを許可
c.ServerApp.allow_credentials = True

# =============================================================================
# ネットワーク設定
# =============================================================================
# すべてのネットワークインターフェースでリッスン（コンテナ環境用）
c.ServerApp.ip = '0.0.0.0'

# ポート（docker-compose.yml と一致させる）
c.ServerApp.port = 8888

# ブラウザの自動起動を無効化（コンテナ環境では不要）
c.ServerApp.open_browser = False

# =============================================================================
# ワークスペース設定
# =============================================================================
# デフォルトの作業ディレクトリ
c.ServerApp.root_dir = '/home/jovyan/work'

# =============================================================================
# カスタム拡張機能
# =============================================================================
# カスタム REST API 拡張機能を有効化
c.ServerApp.jpserver_extensions = {
    'custom_api': True,
}
