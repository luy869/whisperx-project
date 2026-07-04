# VoiceLens デプロイ手順（自宅サーバー）

自宅サーバー（`luy-XA7C-R38`、既に chat_bot / palette-vein / Ollama / CLIP が稼働中）に
バックエンドを移設するランブック。フロントエンドは Cloudflare Pages のまま変更不要
（ホスト名 `voicelens-api.luy869.net` を維持するため）。

## 構成

```
[ブラウザ] --HTTPS--> voicelens.luy869.net (Cloudflare Pages・フロントは変更なし)
                          │ fetch
                          ▼
                voicelens-api.luy869.net (Cloudflare Tunnel)
                          │
                          ▼
        127.0.0.1:8001 (FastAPI・ホストで直接起動)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
   WhisperX (large-v3 + align)   pyannote (話者分離)
              GTX 1660 Ti (GPU 0・CLIPと共有・6GB)
```

- **GPU互換の理由で GTX 1070 は使えない**（`run-voicelens.sh` 内コメント参照。torch cu128 が
  Pascal/sm_61 を非対応にしているため）。CLIP と同じ GTX 1660 Ti(GPU 0) に固定する。
- CLIP（常時 ~1.9GB）と同居するため、VRAM 競合の可能性がある。まず組み込んで実際に動かし、
  OOM が起きたら対処する方針（詳細は homelab リポジトリの DEVLOG 2026-07-05 参照）。
- 認証・DB は Supabase（変更なし）。
- 公開は既存の `voicelens-api.luy869.net` の **DNS ルートをサーバー側のトンネルへ張り替える**
  だけ（専用トンネル `voicelens-api` はローカル機用に残したまま停止扱いにする）。

## 0. 前提

- `uv`、NVIDIA ドライバ + CUDA（サーバーに導入済み）
- ホストポート **8001** が空いていること

## 1. 環境変数

```bash
cp .env.example .env
# HF_TOKEN / SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY /
# gemini_api_key / ALLOWED_ORIGINS を実際の値に設定
```

## 2. 依存関係インストール

```bash
uv sync
```

## 3. ホストで起動（GPU）

```bash
# GTX 1660 Ti に固定して起動（CLIPと同じGPU。番号は nvidia-smi -L で確認）
CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=0 ./run-voicelens.sh
```

- 起動ログに「モデルの読み込み完了」が出ればOK。
- `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8001/jobs/dummy` → 401(認証必須) が返れば疎通OK。
- CLIP と同時に動かして VRAM 不足（OOM）が出ないか確認する。

## 4. Cloudflare Tunnel の DNS を張り替える

既存の `voicelens-api.luy869.net` は専用トンネル（ローカル機用）を向いているため、
サーバー側で稼働中のトンネル（`rag-platform`）に ingress ルールを1行追加し、
DNS を張り替える。

```bash
# サーバー上の ~/.cloudflared/config.yml の ingress: に追加（catch-all の手前）
#   - hostname: voicelens-api.luy869.net
#     service: http://localhost:8001

cloudflared tunnel route dns <rag-platform のトンネルID> voicelens-api.luy869.net --overwrite-dns
sudo systemctl restart cloudflared
```

- フロントエンド（Cloudflare Pages）の `VITE_API_BASE_URL` は変更不要（ホスト名が同じため）。
- ローカル機の専用トンネル（`voicelens-api`, ID `dc5c4f8f-...`）は使わなくなるが、削除はせず放置でよい。

## 5. 動作確認

- `https://voicelens.luy869.net` から実際に音声ファイルをアップロードし、文字起こし・話者分離・分析まで通ることを確認する。
