# jupyter-server Dockerfile
# AI Data Analysis Platform - Jupyter環境

# digest 固定: jupyter/scipy-notebook:python-3.11 (2026-07-10 時点)
FROM jupyter/scipy-notebook:python-3.11@sha256:fca4bcc9cbd49d9a15e0e4df6c666adf17776c950da9fa94a4f0a045d5c4ad33

# 追加のPythonパッケージをインストール
COPY jupyter-server/requirements.txt /home/jovyan/requirements.txt
RUN pip install --no-cache-dir -r /home/jovyan/requirements.txt && \
    rm /home/jovyan/requirements.txt

# 互換性のない拡張機能をアンインストール
RUN pip uninstall -y nbdime jupyterlab-git && \
    jupyter labextension uninstall nbdime-jupyterlab @jupyterlab/git || true

# 作業ディレクトリの作成
USER root
RUN mkdir -p /home/jovyan/data /home/jovyan/output && \
    chown -R jovyan:users /home/jovyan/data /home/jovyan/output
USER jovyan

# カスタム拡張機能の配置
COPY jupyter-server/extensions/custom_api /home/jovyan/extensions/custom_api

# テンプレートファイルの配置
COPY jupyter-server/templates /home/jovyan/templates

# JupyterLab AI Sync 拡張のインストール
USER root
COPY jupyterlab-ai-sync /tmp/jupyterlab-ai-sync
RUN cd /tmp/jupyterlab-ai-sync && \
    npm ci && \
    npm run build && \
    pip install . && \
    rm -rf /tmp/jupyterlab-ai-sync
USER jovyan

# 設定ファイルの配置
COPY jupyter-server/jupyter_config/jupyter_server_config.py /home/jovyan/.jupyter/

# matplotlib 日本語フォント自動設定（kernel spec に exec_lines を追加）
RUN python -c "\
import json, pathlib; \
p = pathlib.Path('/opt/conda/share/jupyter/kernels/python3/kernel.json'); \
spec = json.loads(p.read_text()); \
spec['argv'] += ['--InteractiveShellApp.exec_lines=[\"import japanize_matplotlib\"]']; \
p.write_text(json.dumps(spec, indent=2))"

# ヘルスチェックスクリプトの配置
USER root
COPY jupyter-server/scripts/healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/healthcheck.sh
USER jovyan

# ヘルスチェック設定
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=60s \
  CMD ["/usr/local/bin/healthcheck.sh"]

# ポート公開
EXPOSE 8888

# デフォルトの作業ディレクトリ
WORKDIR /home/jovyan/work
