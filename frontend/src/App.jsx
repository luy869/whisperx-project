import { useState, useEffect } from 'react'
import './App.css'
import Auth from './Auth'
import { supabase } from './supabase'

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function getSpeakerClass(speaker) {
  if (!speaker) return 'speaker-0'
  return speaker === 'SPEAKER_00' || speaker === 'SPEAKER_0' ? 'speaker-0' : 'speaker-1'
}

// モードによって話者ラベルを変える
const SPEAKER_LABELS = {
  '面接': ['面接官', '応募者'],
  '営業トーク': ['営業', '顧客'],
  '会議': ['司会', '参加者'],
}

function getSpeakerLabel(speaker, mode) {
  if (!speaker) return '不明'
  const labels = SPEAKER_LABELS[mode] ?? ['話者1', '話者2']
  const isFirst = speaker === 'SPEAKER_00' || speaker === 'SPEAKER_0'
  return isFirst ? labels[0] : labels[1]
}

function App() {
  // ← フックは全部ここにまとめる（条件分岐より前）
  const [mode, setMode] = useState('面接')       // 選択中のモード                                                                              
  const [customPrompt, setCustomPrompt] = useState('')  // カスタムの入力テキスト             
  const [session, setSession] = useState(undefined)
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState([])
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [numSpeakers, setNumSpeakers] = useState(2)   // null=自動, 数値=指定
  const [customSpeakers, setCustomSpeakers] = useState('')  // 4以上の入力欄
  const [transcriptionId, setTranscriptionId] = useState(null)
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // フックの後なら条件分岐してOK
  if (session === undefined) return null
  if (!session) return <Auth />

  async function upload(withAnalysis = false) {
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    // numSpeakers が null（自動）の場合は送らない → バックエンドがデフォルト（自動検出）で動く
    if (numSpeakers !== null) formData.append('num_speakers', numSpeakers)

    setLoading(true)
    setResult([])
    setAnalysis(null)
    setError(null)

    try {
      // Step1: アップロード → すぐ job_id が返ってくる（WhisperXはまだ動いてない）
      const res = await fetch('http://localhost:8001/transcribe/', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(`サーバーエラー: ${res.status}`)

      const { job_id } = await res.json()

      // Step2: 2秒ごとにジョブの状態を確認する（ポーリング）
      await new Promise((resolve, reject) => {
        const intervalId = setInterval(async () => {
          try {
            const statusRes = await fetch(`http://localhost:8001/jobs/${job_id}`)
            const status = await statusRes.json()

            if (status.status === 'done') {
              clearInterval(intervalId)  // ポーリング停止

              // Step3: 完了したらSupabaseに保存して画面に表示
              setFileName(status.file_name)
              setResult(status.segments ?? [])

              const { data: saved, error: dbError } = await supabase
                .from('transcriptions')
                .insert({
                  user_id: session.user.id,
                  file_name: status.file_name,
                  segments: status.segments,
                })
                .select()
                .single()

              if (dbError) throw new Error(`DB保存エラー: ${dbError.message}`)
              setTranscriptionId(saved.id)

              if (withAnalysis) await runAnalysis(status.segments, saved.id)
              resolve()  // Promiseを完了させてfinallyに進む

            } else if (status.status === 'error') {
              clearInterval(intervalId)
              reject(new Error(`文字起こし処理に失敗しました: ${status.detail}`))
            }
            // "processing" の間は何もせず次のインターバルを待つ
          } catch (e) {
            clearInterval(intervalId)
            reject(e)
          }
        }, 2000)
      })

    } catch (e) {
      setError(e.message)
    } finally {
      // 成功・失敗どちらでも必ず実行される
      setLoading(false)
    }
  }

  async function runAnalysis(segments, tid = transcriptionId) {
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:8001/analyze/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments, mode, custom_prompt: customPrompt }),
      })
      if (!res.ok) throw new Error(`分析エラー: ${res.status}`)

      const data = await res.json()
      setAnalysis(data)

      // 分析結果をSupabaseに保存
      if (tid) {
        await supabase.from('analyses').insert({
          transcription_id: tid,
          good_points: data.good_points,
          improvements: data.improvements,
          overall: data.overall,
        })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  async function download() {
    const text = result.map(seg =>
      `[${formatTime(seg.start)}] ${getSpeakerLabel(seg.speaker, mode)}: ${seg.text}`
    ).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)  // BlobにURLをつける
    const a = document.createElement('a') // <a>タグを作る
    a.href = url
    a.download = 'result.txt'             // ファイル名
    a.click()                             // 自動クリック → ダウンロード開始
    URL.revokeObjectURL(url)              // 使い終わったURLを解放
  }

  async function loadHistory() {
    // transcriptionsとanalysesを結合して取得
    const { data } = await supabase
      .from('transcriptions')
      .select('*, analyses(*)')  // *=全カラム、analyses(*)=関連する分析も一緒に取得
      .order('created_at', { ascending: false })  // 新しい順

    setHistory(data ?? [])
    setShowHistory(true)
  }

  function handleFileChange(e) {
    const selected = e.target.files[0]
    if (selected) setFile(selected)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  function clearFile(e) {
    e.stopPropagation()
    setFile(null)
  }

  function reset() {
    setFile(null)
    setFileName('')
    setResult([])
    setAnalysis(null)
    setShowHistory(false)
  }

  const showResults = result.length > 0

  // 履歴画面
  if (showHistory) return (
    <>
      <nav className="nav">
        <div className="nav-logo">
          <div className="nav-icon">🎙</div>
          <span className="nav-title">VoiceLens<span>.jp</span></span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="back-btn" onClick={reset}>← 戻る</button>
        </div>
      </nav>
      <div className="transcript" style={{ maxWidth: '800px', margin: '32px auto', padding: '0 32px' }}>
        <h2 style={{ color: '#f1f5f9', marginBottom: '24px' }}>過去の面接</h2>
        {history.length === 0 && <p style={{ color: '#475569' }}>履歴がありません</p>}
        {history.map((item) => (
          <div
            key={item.id}
            className="history-item"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              // クリックしたアイテムの内容を結果画面に読み込む
              setFileName(item.file_name)
              setResult(item.segments)
              setAnalysis(item.analyses?.[0] ?? null)
              setTranscriptionId(item.id)
              setShowHistory(false)
            }}
          >
            <div className="history-header">
              <span className="history-filename">🎵 {item.file_name}</span>
              <span className="history-date">{new Date(item.created_at).toLocaleDateString('ja-JP')}</span>
            </div>
            {item.analyses?.[0] ? (
              <p className="history-overall">{item.analyses[0].overall}</p>
            ) : (
              <p className="history-overall" style={{ color: '#475569' }}>分析なし</p>
            )}
          </div>
        ))}
      </div>
    </>
  )

  return (
    <>
      <nav className="nav">
        <div className="nav-logo">
          <div className="nav-icon">🎙</div>
          <span className="nav-title">VoiceLens<span>.jp</span></span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: '#475569' }}>{session.user.email}</span>
          <button className="back-btn" onClick={loadHistory}>履歴</button>
          <button className="back-btn" onClick={() => supabase.auth.signOut()}>ログアウト</button>
        </div>
      </nav>

      {!showResults ? (
        <div className="upload-view">
          <div className="upload-card">
            <h1>音声ファイルをアップロード</h1>
            <p>M4A, MP3, WAV フォーマット対応</p>

            <div className="speakers-select">
              <label>話者数</label>
              <div className="speakers-btns">
                <button
                  className={`speaker-num-btn ${numSpeakers === null ? 'active' : ''}`}
                  onClick={() => { setNumSpeakers(null); setCustomSpeakers('') }}
                >自動</button>
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    className={`speaker-num-btn ${numSpeakers === n ? 'active' : ''}`}
                    onClick={() => { setNumSpeakers(n); setCustomSpeakers('') }}
                  >
                    {n}人
                  </button>
                ))}
                <input
                  type="number"
                  min="4"
                  max="20"
                  placeholder="4以上"
                  value={customSpeakers}
                  onChange={(e) => {
                    setCustomSpeakers(e.target.value)
                    setNumSpeakers(e.target.value ? Number(e.target.value) : null)
                  }}
                  className={`speaker-num-input ${customSpeakers ? 'active' : ''}`}
                />
              </div>
            </div>

            {/* モード選択 */}
            <div className="speakers-select" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
              <label>分析モード</label>
              <div className="speakers-btns" style={{ flexWrap: 'wrap' }}>
                {['面接', 'プレゼン', '会議', 'カスタム'].map(m => (
                  <button
                    key={m}
                    className={`speaker-num-btn ${mode === m ? 'active' : ''}`}
                    onClick={() => setMode(m)}
                  >{m}</button>
                ))}
              </div>
              {/* カスタムモード時だけテキストエリアを表示 */}
              {mode === 'カスタム' && (
                <textarea
                  className="custom-prompt-input"
                  placeholder={"例：この音声は音楽です。歌詞のテーマと感情表現を分析してください。"}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={3}
                />
              )}
            </div>

            <div
              className={`dropzone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="dropzone-selected">
                  <span className="file-icon">🎵</span>
                  <span className="file-name">{file.name}</span>
                  <button className="clear-btn" onClick={clearFile}>✕</button>
                </div>
              ) : (
                <>
                  <div className="dropzone-icon">☁</div>
                  <span className="dropzone-label">クリックしてファイルを選択</span>
                  <span className="dropzone-sub">またはドラッグ＆ドロップ</span>
                  <input
                    type="file"
                    accept="audio/*"
                    className="file-input"
                    onChange={handleFileChange}
                  />
                </>
              )}
            </div>

            {error && <p className="error-msg">{error}</p>}
            <div className="btn-group">
              <button
                className={`submit-btn ${loading ? 'loading' : file ? 'active' : ''}`}
                onClick={() => upload(false)}
                disabled={!file || loading}
              >
                {loading ? (
                  <><div className="spinner" />解析中...</>
                ) : (
                  '文字起こしのみ'
                )}
              </button>
              <button
                className={`submit-btn analyze ${loading ? 'loading' : file ? 'active-analyze' : ''}`}
                onClick={() => upload(true)}
                disabled={!file || loading}
              >
                {loading ? (
                  <><div className="spinner" />解析中...</>
                ) : (
                  '文字起こし + 分析'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="results-view">
          <div className="results-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="back-btn" onClick={reset}>← 戻る</button>
              <button className="back-btn" onClick={download}>↓ テキスト保存</button>
            </div>
            <h2><span className="file-icon">🎵</span>{fileName}</h2>
          </div>

          <div className="results-body">
            {/* 分析結果 */}
            <div className="analysis-panel">
              {analysis ? (
                <div className="analysis-result">
                  {/* 会議モード：決定事項・宿題・次回議題 */}
                  {analysis.decisions && <>
                    <div className="analysis-section good">
                      <h3>決定事項</h3>
                      <ul>{analysis.decisions.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                    <div className="analysis-section improve">
                      <h3>宿題・アクション</h3>
                      <ul>{analysis.action_items.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                    <div className="analysis-section overall">
                      <h3>次回議題</h3>
                      <ul>{analysis.next_agenda.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                  </>}

                  {/* 面接・プレゼン・スピーチ・営業モード */}
                  {analysis.good_points && <>
                    <div className="analysis-section good">
                      <h3>良かった点</h3>
                      <ul>{analysis.good_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                    <div className="analysis-section improve">
                      <h3>改善点</h3>
                      <ul>{analysis.improvements.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                    <div className="analysis-section overall">
                      <h3>総合コメント</h3>
                      <p>{analysis.overall}</p>
                    </div>
                  </>}

                  {/* カスタムモード：overallのみ自由テキスト */}
                  {!analysis.decisions && !analysis.good_points && (
                    <div className="analysis-section overall">
                      <h3>分析結果</h3>
                      <p>{analysis.overall}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="analysis-empty">
                  {analyzing ? (
                    <><div className="spinner" /><span>Geminiが分析中...</span></>
                  ) : (
                    <button
                      className="submit-btn active-analyze"
                      onClick={() => runAnalysis(result)}
                    >
                      {mode}を分析する
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 文字起こし */}
            <div className="transcript">
              {result.map((seg, i) => (
                <div className="segment-row" key={i}>
                  <span className="timestamp">{formatTime(seg.start)}</span>
                  <span className={`speaker-chip ${getSpeakerClass(seg.speaker)}`}>
                    {getSpeakerLabel(seg.speaker, mode)}
                  </span>
                  <span className="segment-text">{seg.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
