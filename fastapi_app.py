import tempfile
import os
import re
import json
from dotenv import load_dotenv
import whisperx
from whisperx.diarize import DiarizationPipeline
from google import genai
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header
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
model = whisperx.load_model("large-v3-turbo", device, compute_type=compute_type)
model_a, metadata = whisperx.load_align_model(language_code="ja", device=device)
diarize_model = DiarizationPipeline(token=HF_TOKEN, device=device)
print("モデルの読み込み完了")

app = FastAPI()

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


@app.post("/transcribe/")
async def transcribe(file: UploadFile = File(...), num_speakers: int = 2, user=Depends(get_current_user)):
    # ファイルタイプのバリデーション（5番の修正も兼ねる）
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="サポートされていないファイル形式です")

    suffix = os.path.splitext(file.filename)[1] or ".m4a"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        audio = whisperx.load_audio(tmp_path)
        result = model.transcribe(audio, batch_size=batch_size, language="ja")
        result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)
        diarize_segments = diarize_model(audio, min_speakers=num_speakers, max_speakers=num_speakers)
        result = whisperx.assign_word_speakers(diarize_segments, result)
    except Exception as e:
        # WhisperXが失敗したときにエラー内容をクライアントに伝える
        raise HTTPException(status_code=500, detail=f"文字起こし処理に失敗しました: {str(e)}")
    finally:
        # 成功・失敗どちらでも一時ファイルを削除
        os.unlink(tmp_path)

    return {"file_name": file.filename, "segments": result["segments"]}


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
        response = gemini.models.generate_content(model="gemma-3-27b-it", contents=prompt)
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
