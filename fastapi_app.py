import tempfile
import os
import re
import json
from dotenv import load_dotenv
import whisperx
from whisperx.diarize import DiarizationPipeline
from google import genai
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

device = "cuda"
compute_type = "float16"
batch_size = 16
HF_TOKEN = os.getenv("HF_TOKEN")

gemini = genai.Client(api_key=os.getenv("gemini_api_key"))

# サーバー起動時にモデルを一度だけロード
print("モデルを読み込んでいます...")
# vad_onset/offset を低くすることで発話の取りこぼしを防ぐ（デフォルトは約0.5で厳しすぎる）
vad_options = {"vad_onset": 0.1, "vad_offset": 0.1}
model = whisperx.load_model("large-v3-turbo", device, compute_type=compute_type, vad_options=vad_options)
model_a, metadata = whisperx.load_align_model(language_code="ja", device=device)
diarize_model = DiarizationPipeline(token=HF_TOKEN, device=device)
print("モデルの読み込み完了")

app = FastAPI()
jobs = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_TYPES = {"audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a", "audio/aac"}


# 認証プレースホルダー
# Supabase導入時はここでJWTを検証してユーザーIDを返す
async def get_current_user(authorization: str = Header(None)):
    return None


# バックグラウンドで動く関数（エンドポイントではない）
# def にする理由：別スレッドで動くためイベントループがなく、awaitが使えない
def run_transcription(job_id: str, tmp_path: str, filename: str, num_speakers: int):
    jobs[job_id] = {"status": "processing"}
    try:
        audio = whisperx.load_audio(tmp_path)
        # chunk_size=30: 30秒単位で処理することで長い音声の取りこぼしを防ぐ
        result = model.transcribe(audio, batch_size=batch_size, language="ja", chunk_size=30)
        result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)
        diarize_segments = diarize_model(audio, min_speakers=num_speakers, max_speakers=num_speakers)
        result = whisperx.assign_word_speakers(diarize_segments, result)
        # 成功したら結果をjobs辞書に置く（フロントがポーリングで取りに来る）
        jobs[job_id] = {"status": "done", "file_name": filename, "segments": result["segments"]}
    except Exception as e:
        # HTTPExceptionは使えない（HTTPレスポンスと紐づいていないため）
        jobs[job_id] = {"status": "error", "detail": str(e)}
    finally:
        os.unlink(tmp_path)


@app.post("/transcribe/")
async def transcribe(file: UploadFile = File(...), num_speakers: int = 2, background_tasks: BackgroundTasks = BackgroundTasks(), user=Depends(get_current_user)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="サポートされていないファイル形式です")

    # ファイルを先に保存する（background関数はawaitできないため、ここで読み込む）
    suffix = os.path.splitext(file.filename)[1] or ".m4a"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    # job_idを生成してすぐ返す
    import uuid
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "pending"}

    # WhisperX処理をバックグラウンドに投げる（ここでは待たない）
    background_tasks.add_task(run_transcription, job_id, tmp_path, file.filename, num_speakers)

    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    # フロントが定期的にここを叩いてステータスを確認する
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="ジョブが見つかりません")
    return jobs[job_id]


class AnalyzeRequest(BaseModel):
    segments: list


@app.post("/analyze/")
async def analyze(req: AnalyzeRequest, user=Depends(get_current_user)):
    transcript = "\n".join(
        f"[{seg.get('speaker', '不明')}]: {seg.get('text', '')}"
        for seg in req.segments
    )

    prompt = f"""以下は就職面接の文字起こしです。応募者のパフォーマンスを分析してください。

{transcript}

以下の形式でJSONのみを返してください（他のテキストは不要）：
{{
  "good_points": ["良かった点1", "良かった点2", "良かった点3"],
  "improvements": ["改善点1", "改善点2", "改善点3"],
  "overall": "総合コメント（2〜3文）"
}}"""

    try:
        response = gemini.models.generate_content(model="gemma-4-31b-it", contents=prompt)
        text = response.text.strip()

        # コードブロックをregexで確実に除去
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)

        analysis = json.loads(text.strip())
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Gemini APIの応答をパースできませんでした")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini API呼び出しに失敗しました: {str(e)}")

    return analysis

