.PHONY: dev down ps logs restart build clean-logs db-shell

# Docker 環境の起動
dev:
	docker compose up -d

# Docker 環境の停止
down:
	docker compose down

# コンテナの状態確認
ps:
	docker compose ps

# ログの表示（フォロー）
logs:
	docker compose logs -f $(SVC)

# 特定サービスの再起動
restart:
	docker compose restart $(SVC)

# Docker イメージのビルド
build:
	docker compose build $(SVC)

# Docker ログのクリア（コンテナ再作成）
clean-logs:
	docker compose down && docker compose up -d

# PostgreSQL に接続
db-shell:
	docker exec -it analysis-db psql -U jupyter -d analysis_db
