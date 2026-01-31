# jupyter-server Dockerfile
# AI Data Analysis Platform - Jupyter環境

FROM jupyter/scipy-notebook:python-3.11

# 追加のPythonパッケージをインストール
COPY requirements.txt /home/jovyan/requirements.txt
RUN pip install --no-cache-dir -r /home/jovyan/requirements.txt && \
    rm /home/jovyan/requirements.txt

# 作業ディレクトリの作成
USER root
RUN mkdir -p /home/jovyan/data /home/jovyan/output && \
    chown -R jovyan:users /home/jovyan/data /home/jovyan/output
USER jovyan

# カスタム拡張機能の配置
COPY extensions/custom_api /home/jovyan/extensions/custom_api

# 設定ファイルの配置
COPY jupyter_config/jupyter_server_config.py /home/jovyan/.jupyter/

# ヘルスチェックスクリプトの配置
USER root
COPY scripts/healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/healthcheck.sh
USER jovyan

# ヘルスチェック設定
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=60s \
  CMD ["/usr/local/bin/healthcheck.sh"]

# ポート公開
EXPOSE 8888

# デフォルトの作業ディレクトリ
WORKDIR /home/jovyan/work
