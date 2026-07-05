#!/usr/bin/env bash
# VoiceLens FastAPI バックエンドをホストで起動する（GPU直接利用・systemd無し）。
# clip_service/run-clip.sh (palette-vein) と同じ運用パターン。
#
# GPU互換の注意（実機で確認済み）:
#   torch (cu128, PyPI標準ビルド) は Pascal (GTX 1070, sm_61) 非対応。
#   align/diarization (pyannote) が生torchを使うため、1070を選ぶと
#   "no kernel image is available" でクラッシュする。
#   → CLIPと同じ GTX 1660 Ti (sm_75, GPU 0) に固定する。
#
# 使うGPUを固定してCLIP/チャットボットと住み分ける（環境変数で上書き可）:
#   CUDA_VISIBLE_DEVICES=0 ./run-voicelens.sh
set -e
cd "$(dirname "$0")"

export CUDA_DEVICE_ORDER="${CUDA_DEVICE_ORDER:-PCI_BUS_ID}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
PORT="${PORT:-8001}"

echo "Starting VoiceLens backend on GPU index ${CUDA_VISIBLE_DEVICES}, port ${PORT} (Ctrl+C to stop)..."
# --no-sync: `uv run` は既定でロックファイルと環境を同期し直すため、これが無いと
# サーバー限定の torch==2.7.0 上書き（DEPLOY.md参照、GTX 1660 Ti のバグ回避）が
# 起動のたびに torch==2.8.0 へ静かに戻ってしまう
exec uv run --no-sync uvicorn fastapi_app:app --host 127.0.0.1 --port "${PORT}"
