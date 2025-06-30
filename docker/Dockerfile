# ベースイメージを指定
FROM python:3.8-slim

# 作業ディレクトリを設定
WORKDIR /

# 必要なファイルをコピー
COPY requirements.txt .

# Pythonパッケージをインストール
RUN pip install --no-cache-dir -r requirements.txt

# その他のファイルをコピー
COPY . .

# ポートを公開
EXPOSE 80

# サーバーを実行
CMD ["python", "server.py"]
