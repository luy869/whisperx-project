#!/usr/bin/env python3
"""
WhisperX vs Moonshine Voice 比較スクリプト
話者分離（pyannote）は1回だけ実行して両モデルに共通適用するため公平な比較になる。

使い方:
    uv run python compare.py <音声ファイル> [話者数]

例:
    uv run python compare.py interview.m4a 2
    uv run python compare.py recording.wav        # 話者数自動検出

事前準備:
    uv add moonshine-voice
    python -m moonshine_voice.download --language ja
"""
import time
import sys
import os
import subprocess
import gc

# ============================================================
# 引数チェック
# ============================================================
if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(1)

AUDIO_FILE = sys.argv[1]
NUM_SPEAKERS = int(sys.argv[2]) if len(sys.argv) > 2 else None

if not os.path.exists(AUDIO_FILE):
    print(f"エラー: ファイルが見つかりません: {AUDIO_FILE}")
    sys.exit(1)

# ============================================================
# 共通設定
# ============================================================
from dotenv import load_dotenv
load_dotenv()

DEVICE       = "cuda"
COMPUTE_TYPE = "float16"
BATCH_SIZE   = 16
HF_TOKEN     = os.getenv("HF_TOKEN")


# ============================================================
# 共通ユーティリティ
# ============================================================

def assign_speakers(segments, diarize_segments):
    """
    セグメントリストにpyannoteの話者ラベルを付ける。
    各セグメントと最も重複時間が長いdiarizeセグメントの話者を採用する。

    diarize_segments は pyannote が返す pandas DataFrame で
    'segment'列（start/end属性）と'speaker'列を持つ。
    """
    result = []
    for seg in segments:
        seg_start = seg["start"]
        seg_end   = seg["end"]
        best_speaker = "SPEAKER_00"
        best_overlap = 0.0

        for _, row in diarize_segments.iterrows():
            d_start  = row["segment"].start
            d_end    = row["segment"].end
            overlap  = max(0.0, min(seg_end, d_end) - max(seg_start, d_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = row["speaker"]

        result.append({**seg, "speaker": best_speaker})
    return result


def audio_to_wav(src_path):
    """音声ファイルを 16kHz モノラル WAV に変換して返す（一時ファイル）。"""
    wav_path = src_path.rsplit(".", 1)[0] + "_tmp_16k.wav"
    subprocess.run(
        ["ffmpeg", "-i", src_path, "-ar", "16000", "-ac", "1", wav_path, "-y"],
        capture_output=True, check=True,
    )
    return wav_path


# ============================================================
# Step 1: 話者分離（1回だけ実行・両モデルで共有）
# ============================================================
print("\n[共通] pyannote で話者分離を実行中...")
import whisperx
from whisperx.diarize import DiarizationPipeline

t0 = time.time()
diarize_model   = DiarizationPipeline(token=HF_TOKEN, device=DEVICE)
audio_np        = whisperx.load_audio(AUDIO_FILE)      # 16kHz numpy array
audio_duration  = len(audio_np) / 16000

diarize_kwargs  = {}
if NUM_SPEAKERS:
    diarize_kwargs = {"min_speakers": NUM_SPEAKERS, "max_speakers": NUM_SPEAKERS}
diarize_segments = diarize_model(audio_np, **diarize_kwargs)
t_diarize = time.time() - t0
print(f"  → 完了 ({t_diarize:.1f}s)")


# ============================================================
# Step 2: WhisperX
# ============================================================
def run_whisperx():
    print("\n[1/2] WhisperX (large-v3-turbo) を実行中...")

    t_load_start = time.time()
    model     = whisperx.load_model("large-v3-turbo", DEVICE, compute_type=COMPUTE_TYPE,
                                    vad_options={"vad_onset": 0.1, "vad_offset": 0.1})
    model_a, metadata = whisperx.load_align_model(language_code="ja", device=DEVICE)
    t_load_end = time.time()

    t_trans_start = time.time()
    result = model.transcribe(audio_np, batch_size=BATCH_SIZE, language="ja", chunk_size=30)
    result = whisperx.align(result["segments"], model_a, metadata, audio_np, DEVICE,
                            return_char_alignments=False)
    # 共有のdiarize_segmentsを適用
    result = whisperx.assign_word_speakers(diarize_segments, result)
    t_trans_end = time.time()

    segments = result["segments"]

    # ---- GPUメモリを明示的に解放（Moonshineとの公平な比較のため）----
    print("  → WhisperXモデルをメモリから解放中...")
    del model, model_a
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
        print("  → GPU キャッシュをクリアしました")
    except Exception:
        pass

    return {
        "segments":       segments,
        "model_load_sec": t_load_end  - t_load_start,
        "transcribe_sec": t_trans_end - t_trans_start,
    }


# ============================================================
# Step 3: Moonshine Voice
# ============================================================
def run_moonshine():
    print("\n[2/2] Moonshine Voice (ja) を実行中...")

    try:
        from moonshine_voice import (
            Transcriber,
            get_model_for_language, load_wav_file,
        )
    except ImportError:
        print("  ⚠  moonshine-voice が見つかりません。")
        print("     uv add moonshine-voice==0.0.56")
        print("     python -m moonshine_voice.download --language ja")
        return None

    # Moonshine は WAV を想定 → ffmpeg で変換
    wav_path = None
    try:
        wav_path = audio_to_wav(AUDIO_FILE)

        # --- モデル読み込み ---
        t_load_start = time.time()
        model_path, model_arch = get_model_for_language("ja")
        transcriber = Transcriber(
            model_path=model_path,
            model_arch=model_arch,
        )
        t_load_end = time.time()

        audio_data, sample_rate = load_wav_file(wav_path)

        # --- 文字起こし（ストリーミングなし・一括処理）---
        t_trans_start = time.time()
        transcript = transcriber.transcribe_without_streaming(
            audio_data, sample_rate=sample_rate
        )
        t_trans_end = time.time()

        # Transcript オブジェクトから {start, end, text} を取り出す
        raw_segments = []
        for line in transcript.lines:
            raw_segments.append({
                "start": line.start_time,
                "end":   line.start_time + line.duration,
                "text":  line.text,
            })

        # 共有のdiarize_segmentsを適用（WhisperXと同じpyannote結果）
        segments_with_speakers = assign_speakers(raw_segments, diarize_segments)

        return {
            "segments":       segments_with_speakers,
            "model_load_sec": t_load_end  - t_load_start,
            "transcribe_sec": t_trans_end - t_trans_start,
        }

    except subprocess.CalledProcessError as e:
        print(f"  ⚠  ffmpeg 変換失敗: {e.stderr.decode()}")
        return None
    finally:
        if wav_path and os.path.exists(wav_path):
            os.remove(wav_path)


# ============================================================
# 実行
# ============================================================
wx = run_whisperx()
mn = run_moonshine()

SEP = "=" * 64

# ---- 処理時間テーブル ----
print(f"\n{SEP}")
print("📊  処理時間比較（話者分離は共通・除外）")
print(SEP)
has_mn = mn is not None
header = f"{'':32s} {'WhisperX':>14s}"
if has_mn:
    header += f" {'Moonshine':>14s}"
print(header)
print(f"{'音声の長さ':32s} {audio_duration:>13.1f}s")
print(f"{'[共通] 話者分離':32s} {t_diarize:>13.1f}s")
print(f"{'モデル読み込み':32s} {wx['model_load_sec']:>13.1f}s"
      + (f" {mn['model_load_sec']:>13.1f}s" if has_mn else ""))
print(f"{'文字起こし処理':32s} {wx['transcribe_sec']:>13.1f}s"
      + (f" {mn['transcribe_sec']:>13.1f}s" if has_mn else ""))
wx_rt = wx["transcribe_sec"] / audio_duration
print(f"{'リアルタイム倍率':32s} {wx_rt:>13.2f}x"
      + (f" {mn['transcribe_sec']/audio_duration:>13.2f}x" if has_mn else ""))

# ---- 文字起こし結果 ----
def print_segments(segments):
    for seg in segments:
        speaker = seg.get("speaker", "不明")
        start   = seg.get("start", 0)
        text    = seg.get("text", "")
        print(f"[{start:6.1f}s] {speaker}: {text}")

print(f"\n{SEP}")
print("📝  WhisperX 結果")
print(SEP)
print_segments(wx["segments"])

if has_mn:
    print(f"\n{SEP}")
    print("📝  Moonshine Voice 結果")
    print(SEP)
    if mn["segments"]:
        print_segments(mn["segments"])
    else:
        print("（結果なし — モデルが正しく動作しなかった可能性があります）")

# ---- ファイル保存 ----
out_path = "compare_result.txt"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(f"音声ファイル: {AUDIO_FILE}\n")
    f.write(f"音声長さ: {audio_duration:.1f}s\n")
    f.write(f"話者分離: {t_diarize:.1f}s（共通）\n\n")

    f.write("=== WhisperX ===\n")
    f.write(f"モデル読み込み: {wx['model_load_sec']:.1f}s  文字起こし: {wx['transcribe_sec']:.1f}s\n")
    for seg in wx["segments"]:
        f.write(f"[{seg.get('start',0):6.1f}s] {seg.get('speaker','不明')}: {seg.get('text','')}\n")

    if has_mn:
        f.write(f"\n=== Moonshine Voice ===\n")
        f.write(f"モデル読み込み: {mn['model_load_sec']:.1f}s  文字起こし: {mn['transcribe_sec']:.1f}s\n")
        for seg in mn["segments"]:
            f.write(f"[{seg.get('start',0):6.1f}s] {seg.get('speaker','不明')}: {seg.get('text','')}\n")

print(f"\n結果を {out_path} に保存しました")
