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
   WhisperX (medium + align)     pyannote (話者分離)
              GTX 1660 Ti (GPU 0・CLIPと共有・6GB)
```

- **GPU互換の理由で GTX 1070 は使えない**（`run-voicelens.sh` 内コメント参照。torch cu128 が
  Pascal/sm_61 を非対応にしているため）。CLIP と同じ GTX 1660 Ti(GPU 0) に固定する。
- CLIP（常時 ~1.9GB）と同居するため VRAM に余裕がない。以下 3 点をサーバー限定で適用している
  （実機で全て検証済み・2026-07-06）:
  1. **`torch==2.7.0+cu128` に固定**（`uv sync` 直後に上書きインストール）。
     `torch==2.8.0`（whisperx が要求するデフォルト）は **GTX 1660 Ti(Turing/sm_75) 上で
     pyannote の diarization pipeline ロード時に確実にクラッシュする**
     （`Invalid handle. Cannot load symbol cublasLtCreate`、VRAM残量に関係なく発生。
     開発機の RTX 5080/3080 では同じコードで再現しない = Turing 固有のバグ）。
     CLIP が既に `torch==2.7.0` で安定稼働しているのと同じ対処。
  2. **`WHISPERX_MODEL=medium`**（.env）。`large-v3` だと ASR 推論自体が CLIP 分の VRAM を
     差し引いた残りで OOM する。medium なら CLIP 稼働中でも実音声(6.5分)で成功を確認済み。
  3. **align/diarize モデルはリクエストごとに読み込み・解放**（`fastapi_app.py` 側で対応済み、
     設定不要）。3モデル同時常駐だと余裕が無さすぎるため。
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

### torch を 2.7.0 に固定（GTX 1660 Ti 向け・必須）

`uv sync` は whisperx の要求で `torch==2.8.0` を入れるが、これは GTX 1660 Ti(Turing/sm_75)上で
pyannote diarization ロード時にクラッシュする（上記「構成」参照）。`clip_service` と同じ
`torch==2.7.0+cu128` に上書きする:

```bash
uv pip install "torch==2.7.0" "torchvision==0.22.0" "torchaudio==2.7.0" \
  --index-url https://download.pytorch.org/whl/cu128 --force-reinstall
```

- `pyproject.toml`/`uv.lock` はあえて変更しない（開発機は RTX 5080/3080 で torch 2.8.0 のままで
  問題ないため。Turing固有のバグなので開発機では発生しない）
- この上書きは `uv sync` を再実行するたびに消える（torch==2.8.0 に戻る）ので、
  **`uv sync` の後は必ずこの手順を再実行すること**

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
