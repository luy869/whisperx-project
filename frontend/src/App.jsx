import { useState, useEffect } from 'react'
import './App.css'
import Auth from './Auth'
import { supabase } from './supabase'

const API_BASE = import.meta.env.VITE_API_BASE_URL

// 毎回最新のアクセストークンを取得してAuthorizationヘッダーを返す
// getSession()を使う理由：Supabaseはバックグラウンドでトークンを自動更新するため
// session.access_tokenをキャッシュすると古いトークンを送る可能性がある
async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('ログインしていません')
  return { 'Authorization': `Bearer ${session.access_token}` }
}

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
  '会議': ['司会', '参加者'],
  '音楽': ['声1', '声2'],
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
  const [files, setFiles] = useState([])       // 複数ファイル対応
  const [progress, setProgress] = useState('')  // 「2/3完了」などの進捗テキスト
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
  const [fromHistory, setFromHistory] = useState(false)  // 結果画面が履歴から開かれたか
  const [needsPasswordUpdate, setNeedsPasswordUpdate] = useState(false)  // 招待リンクからのアクセス
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState(null)

  useEffect(() => {
    // 招待リンクからのアクセスか確認（ハッシュに type=invite が含まれるか）
    if (window.location.hash.includes('type=invite')) {
      setNeedsPasswordUpdate(true)
      window.history.replaceState(null, '', window.location.pathname)  // URLからハッシュを消す
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // フックの後なら条件分岐してOK
  if (session === undefined) return null
  if (!session) return <Auth />

  // 招待リンクから来たユーザーにパスワード設定を求める
  if (needsPasswordUpdate) return (
    <div className="upload-view">
      <div className="upload-card">
        <h1>パスワードを設定</h1>
        <p>VoiceLensへようこそ。ログイン用のパスワードを設定してください。</p>
        {passwordError && <p className="error-msg">{passwordError}</p>}
        <input
          className="auth-input"
          type="password"
          placeholder="新しいパスワード（6文字以上）"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          style={{ marginBottom: '12px' }}
        />
        <button
          className={`submit-btn ${newPassword.length >= 6 ? 'active' : ''}`}
          disabled={newPassword.length < 6}
          onClick={async () => {
            const { error } = await supabase.auth.updateUser({ password: newPassword })
            if (error) {
              setPasswordError(error.message)
            } else {
              setNeedsPasswordUpdate(false)
              setNewPassword('')
            }
          }}
        >
          パスワードを保存
        </button>
        <button
          className="back-btn"
          style={{ marginTop: '8px', width: '100%', textAlign: 'center' }}
          onClick={() => { setNeedsPasswordUpdate(false); setNewPassword(''); setPasswordError(null) }}
        >
          キャンセル
        </button>
      </div>
    </div>
  )

  // 1ファイルを処理してSupabaseに保存する（uploadのループから呼ばれる）
  async function processOneFile(file, withAnalysis) {
    const formData = new FormData()
    formData.append('file', file)
    if (numSpeakers !== null) formData.append('num_speakers', numSpeakers)

    const res = await fetch(`${API_BASE}/transcribe/`, {
      method: 'POST',
      headers: await authHeaders(),  // FormDataのContent-TypeはブラウザがBoundary付きで自動設定するのでここに書かない
      body: formData,
    })
    if (!res.ok) throw new Error(`サーバーエラー: ${res.status}`)
    const { job_id } = await res.json()

    await new Promise((resolve, reject) => {
      const intervalId = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/jobs/${job_id}`, {
            headers: await authHeaders(),
          })
          const status = await statusRes.json()
          if (status.status === 'done') {
            clearInterval(intervalId)
            const { data: saved, error: dbError } = await supabase
              .from('transcriptions')
              .insert({ user_id: session.user.id, file_name: status.file_name, segments: status.segments })
              .select().single()
            if (dbError) throw new Error(`DB保存エラー: ${dbError.message}`)
            // 結果画面で表示できるようにstateを設定（1ファイル時に使う）
            setFileName(status.file_name)
            setResult(status.segments)
            setTranscriptionId(saved.id)
            if (withAnalysis) await runAnalysis(status.segments, saved.id)
            resolve()
          } else if (status.status === 'error') {
            clearInterval(intervalId)
            reject(new Error(`文字起こし処理に失敗しました: ${status.detail}`))
          }
        } catch (e) { clearInterval(intervalId); reject(e) }
      }, 2000)
    })
  }

  async function upload(withAnalysis = false) {
    if (!files.length) return

    setLoading(true)
    setResult([])
    setAnalysis(null)
    setError(null)
    // 各ファイルの状態を初期化：waiting（待機中）
    setProgress(files.map(f => ({ name: f.name, status: 'waiting' })))

    try {
      for (let i = 0; i < files.length; i++) {
        // 現在処理中のファイルをprocessingに更新
        setProgress(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing' } : f))
        await processOneFile(files[i], withAnalysis)
        // 完了したらdoneに更新
        setProgress(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'done' } : f))
      }
      // 複数ファイルは履歴へ、1ファイルは結果をそのまま表示
      if (files.length > 1) await loadHistory()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setProgress([])
    }
  }

  async function runAnalysis(segments, tid = transcriptionId) {
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/analyze/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders()),  // スプレッドでAuthorizationを追加
        },
        body: JSON.stringify({ segments, mode, custom_prompt: customPrompt }),
      })
      if (!res.ok) throw new Error(`分析エラー: ${res.status}`)

      const data = await res.json()
      setAnalysis(data)

      // 分析結果をSupabaseに保存
      // raw_data に全データを保存することで、音楽・会議など全モードのデータを保持できる
      if (tid) {
        await supabase.from('analyses').insert({
          transcription_id: tid,
          good_points: data.good_points ?? null,
          improvements: data.improvements ?? null,
          overall: data.overall ?? null,
          scores: data.scores ?? null,
          raw_data: data,
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

  async function deleteHistory(id) {
    // analysesを先に削除（transcriptionsへの外部キーがあるため）
    await supabase.from('analyses').delete().eq('transcription_id', id)
    await supabase.from('transcriptions').delete().eq('id', id)
    // stateからも除去して即座に画面を更新（再fetchしなくていい）
    setHistory(prev => prev.filter(item => item.id !== id))
  }

  async function loadHistory() {
    // 一覧表示に必要な列だけ取得（segments=全文字起こしは除く。重くなるため）
    // analysesも表示に使うoverallとscoresだけ取得
    const { data } = await supabase
      .from('transcriptions')
      .select('id, file_name, created_at, analyses(id, overall, scores)')
      .order('created_at', { ascending: false })

    setHistory(data ?? [])
    setShowHistory(true)
  }

  function handleFileChange(e) {
    setFiles(Array.from(e.target.files))  // 複数ファイルを配列に変換
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    setFiles(Array.from(e.dataTransfer.files))
  }

  function clearFiles(e) {
    e.stopPropagation()
    setFiles([])
  }

  function reset() {
    setFiles([])
    setFileName('')
    setResult([])
    setAnalysis(null)
    setFromHistory(false)
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
        <h2 style={{ color: '#f1f5f9', marginBottom: '24px' }}>履歴</h2>
        {history.length === 0 && <p style={{ color: '#475569' }}>履歴がありません</p>}
        {history.map((item) => (
          <div
            key={item.id}
            className="history-item"
            style={{ cursor: 'pointer' }}
            onClick={async () => {
              // 一覧では取得していないsegmentsをクリック時に1件だけ取得
              const { data: full } = await supabase
                .from('transcriptions')
                .select('segments, analyses(*)')
                .eq('id', item.id)
                .single()
              setFileName(item.file_name)
              setResult(full?.segments ?? [])
              // raw_dataがあればそちらを優先（音楽・会議など全モードのデータが入っている）
              const savedAnalysis = full?.analyses?.[0]
              setAnalysis(savedAnalysis?.raw_data ?? savedAnalysis ?? null)
              setTranscriptionId(item.id)
              setFromHistory(true)   // 履歴から開いたことを記録
              setShowHistory(false)
            }}
          >
            <div className="history-header">
              <span className="history-filename">🎵 {item.file_name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="history-date">{new Date(item.created_at).toLocaleDateString('ja-JP')}</span>
                <button
                  className="clear-btn"
                  style={{ position: 'static' }}
                  onClick={(e) => { e.stopPropagation(); deleteHistory(item.id) }}
                >✕</button>
              </div>
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
          <button className="back-btn" onClick={() => { setNeedsPasswordUpdate(true); setNewPassword(''); setPasswordError(null) }}>パスワード変更</button>
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
                {['面接', 'プレゼン', '会議', '音楽', 'カスタム'].map(m => (
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
              className={`dropzone ${dragOver ? 'drag-over' : ''} ${files.length ? 'has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {files.length ? (
                <div className="dropzone-selected">
                  <span className="file-icon">🎵</span>
                  <span className="file-name">
                    {files.length === 1 ? files[0].name : `${files.length}件のファイル`}
                  </span>
                  <button className="clear-btn" onClick={clearFiles}>✕</button>
                </div>
              ) : (
                <>
                  <div className="dropzone-icon">☁</div>
                  <span className="dropzone-label">クリックしてファイルを選択</span>
                  <span className="dropzone-sub">複数選択可 / ドラッグ＆ドロップ</span>
                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    className="file-input"
                    onChange={handleFileChange}
                  />
                </>
              )}
            </div>

            {/* 処理中の進捗リスト（A案）*/}
            {Array.isArray(progress) && progress.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                {progress.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '13px', color: '#94a3b8' }}>
                    {f.status === 'done' && <span style={{ color: '#34d399' }}>✓</span>}
                    {f.status === 'processing' && <div className="spinner" />}
                    {f.status === 'waiting' && <span style={{ color: '#475569' }}>–</span>}
                    <span style={{ color: f.status === 'done' ? '#34d399' : f.status === 'processing' ? '#f1f5f9' : '#475569' }}>
                      {f.name}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="error-msg">{error}</p>}
            <div className="btn-group">
              <button
                className={`submit-btn ${loading ? 'loading' : files.length ? 'active' : ''}`}
                onClick={() => upload(false)}
                disabled={!files.length || loading}
              >
                {loading ? (
                  <><div className="spinner" />解析中...</>
                ) : (
                  '文字起こしのみ'
                )}
              </button>
              <button
                className={`submit-btn analyze ${loading ? 'loading' : files.length ? 'active-analyze' : ''}`}
                onClick={() => upload(true)}
                disabled={!files.length || loading}
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
              <button className="back-btn" onClick={() => {
                if (fromHistory) {
                  // 履歴から来た場合は履歴一覧に戻る
                  setResult([])
                  setAnalysis(null)
                  setFromHistory(false)
                  setShowHistory(true)
                } else {
                  reset()
                }
              }}>← 戻る</button>
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

                  {/* 音楽モード：テーマ・フレーズ・雰囲気・総評 */}
                  {analysis.theme && <>
                    <div className="analysis-section scores">
                      <h3>テーマ</h3>
                      <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.7 }}>{analysis.theme}</p>
                    </div>
                    <div className="analysis-section good">
                      <h3>印象的なフレーズ</h3>
                      <ul>{analysis.highlights.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                    <div className="analysis-section improve">
                      <h3>雰囲気・感情</h3>
                      <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.7 }}>{analysis.mood}</p>
                    </div>
                    <div className="analysis-section overall">
                      <h3>総評</h3>
                      <p>{analysis.overall}</p>
                    </div>
                  </>}

                  {/* 面接・プレゼン・スピーチ・営業モード */}
                  {analysis.good_points && <>
                    {/* 項目別スコア（面接・プレゼンのみ） */}
                    {analysis.scores && (
                      <div className="analysis-section scores">
                        <h3>スコア</h3>
                        {Object.entries(analysis.scores).map(([key, value]) => (
                          <div key={key} className="score-row">
                            <span className="score-label">{key}</span>
                            <div className="score-bar-bg">
                              <div className="score-bar-fill" style={{ width: `${value}%` }} />
                            </div>
                            <span className="score-value">{value}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
                  {!analysis.decisions && !analysis.good_points && !analysis.theme && (
                    <div className="analysis-section overall">
                      <h3>分析結果</h3>
                      <p>{analysis.overall}</p>
                    </div>
                  )}

                  {/* 再分析ボタン：analysis=nullにするだけで下のモード選択UIが出る */}
                  <button
                    className="back-btn"
                    style={{ marginTop: '8px', width: '100%', textAlign: 'center' }}
                    onClick={() => setAnalysis(null)}
                  >
                    別のモードで再分析
                  </button>
                </div>
              ) : (
                <div className="analysis-empty">
                  {analyzing ? (
                    <><div className="spinner" /><span>Geminiが分析中...</span></>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                      {/* 結果画面でもモードを選べるようにする */}
                      <div className="speakers-btns" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                        {['面接', 'プレゼン', '会議', '音楽', 'カスタム'].map(m => (
                          <button
                            key={m}
                            className={`speaker-num-btn ${mode === m ? 'active' : ''}`}
                            onClick={() => setMode(m)}
                          >{m}</button>
                        ))}
                      </div>
                      {mode === 'カスタム' && (
                        <textarea
                          className="custom-prompt-input"
                          placeholder="例：この音声の内容を要約してください。"
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          rows={3}
                        />
                      )}
                      <button
                        className="submit-btn active-analyze"
                        onClick={() => runAnalysis(result)}
                      >
                        {mode}を分析する
                      </button>
                    </div>
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
