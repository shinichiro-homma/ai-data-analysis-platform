# document-server Dockerfile
# AI Data Analysis Platform - カタログ・用語集・ロジック管理API

# digest 固定: python:3.11-slim (2026-07-10 時点)
FROM python:3.11-slim@sha256:e031123e3d85762b141ad1cbc56452ba69c6e722ebf2f042cc0dc86c47c0d8b3

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
