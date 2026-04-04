# document-server Dockerfile
# AI Data Analysis Platform - カタログ・用語集・ロジック管理API

FROM python:3.11-slim

WORKDIR /app

# 依存関係のインストール（ランタイムのみ）
COPY document-server/requirements.txt .
RUN pip install --no-cache-dir fastapi uvicorn[standard] pyyaml pydantic

# アプリケーションコードの配置
COPY document-server/src ./src
COPY document-server/data ./data

# ヘルスチェック用にcurlをインストール
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3002

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3002"]
