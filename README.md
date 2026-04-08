# VoiceLens.jp — 面接音声分析ツール

面接の音声を文字起こしし、AIで振り返りを行うWebアプリ。

## 概要

面接後に「うまく話せたかわからない」という課題を解決するために開発。音声をアップロードするだけで、誰が何を話したかを自動で分析し、良かった点・改善点をフィードバックする。

## 機能

- **音声の文字起こし** — WhisperXによるローカル処理（無料・高精度）
- **話者分離** — 面接官と応募者を自動で識別
- **面接分析** — Gemini APIによる良かった点・改善点・総合コメントの生成
- **履歴管理** — 過去の面接結果をSupabaseに保存・閲覧

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| 音声処理 | WhisperX（large-v3-turbo）+ pyannote（話者分離） |
| バックエンド | FastAPI（Python） |
| AI分析 | Gemini API（gemma-3-27b-it） |
| フロントエンド | React + Vite |
| 認証・DB | Supabase（PostgreSQL + Auth） |

## 技術的な工夫

- **モデルの使い回し** — WhisperXの3モデル（文字起こし・アライメント・話者分離）をサーバー起動時に1回だけロードし、リクエストのたびに再ロードするコストを排除
- **VAD感度の調整** — `vad_onset/offset: 0.1` に設定し、発話の取りこぼしを最小化
- **RLS（行レベルセキュリティ）** — SupabaseのRLSにより、ユーザーは自分のデータのみアクセス可能
- **認証プレースホルダー** — FastAPIの `Depends` を使い、Supabase JWT検証を後付けで差し込める設計

## セットアップ

### 必要なもの

- CUDA対応GPU（GTX 1660 Ti以上推奨）
- Python 3.11以上
- Node.js 20以上

### 環境変数

プロジェクトルートと `frontend/` に `.env` を作成。

**ルート（`.env`）**
```
HF_TOKEN=your_huggingface_token
gemini_api_key=your_gemini_api_key
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=your_supabase_secret_key
```

**フロントエンド（`frontend/.env`）**
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

### 起動

```bash
# バックエンド
uv sync
uv run uvicorn fastapi_app:app --reload --port 8001

# フロントエンド
cd frontend
npm install
npm run dev
```

`http://localhost:5173` にアクセス。

## 今後の予定

- [ ] 非同期処理（WhisperXのバックグラウンド実行）
- [ ] 複数ファイルへの対応
- [ ] エクスポート機能（テキスト/JSON）
- [ ] 分析プロンプトの改善（項目別スコア化）
- [ ] Google認証の追加
