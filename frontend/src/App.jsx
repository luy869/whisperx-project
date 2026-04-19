import { useState, useEffect, useRef } from 'react'
import './App.css'
import Auth from './Auth'
import { supabase } from './supabase'
import { NavBar } from './NavBar'
import { HistoryView } from './HistoryView'
import { UploadView } from './UploadView'
import { ResultsView } from './ResultsView'
import { formatTime, getSpeakerLabel, DEFAULT_PROMPTS } from './utils'

const API_BASE = import.meta.env.VITE_API_BASE_URL

// モジュールロード時にハッシュを確認してトークンを抽出する
// Supabaseの自動URL検知は無効化している（supabase.js参照）ので、
// ハッシュから取ったトークンをuseEffectで setSession に渡して明示的にセッション化する
const INVITE_HASH = window.location.hash.includes('type=invite') ? window.location.hash : null
const IS_INVITE_FLOW = INVITE_HASH !== null

// 毎回最新のアクセストークンを取得してAuthorizationヘッダーを返す
// getSession()を使う理由：Supabaseはバックグラウンドでトークンを自動更新するため
// session.access_tokenをキャッシュすると古いトークンを送る可能性がある
async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('ログインしていません')
  return { 'Authorization': `Bearer ${session.access_token}` }
}

function App() {
  // ← フックは全部ここにまとめる（条件分岐より前）
  const [mode, setMode] = useState('面接')
  // モードごとに編集内容を保持するオブジェクト（モード切り替えで消えない）
  const [customPrompts, setCustomPrompts] = useState({})
  // 現在のモードのプロンプト（未編集ならデフォルト値）
  const customPrompt = customPrompts[mode] ?? DEFAULT_PROMPTS[mode] ?? ''
  function setCustomPrompt(val) {
    setCustomPrompts(prev => ({ ...prev, [mode]: val }))
  }
  const [session, setSession] = useState(undefined)
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState('')
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState([])
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [numSpeakers, setNumSpeakers] = useState(2)
  const [customSpeakers, setCustomSpeakers] = useState('')
  const [transcriptionId, setTranscriptionId] = useState(null)
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [fromHistory, setFromHistory] = useState(false)
  const [needsPasswordUpdate, setNeedsPasswordUpdate] = useState(IS_INVITE_FLOW)
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  // 分析中のtranscription IDを追跡する（非同期リーク防止）
  const analyzingForIdRef = useRef(null)



  useEffect(() => {
    async function init() {
      if (IS_INVITE_FLOW && INVITE_HASH) {
        // 招待フロー：既存セッションが残っているとupdateUserが既存アカウントに当たってしまう
        // 必ずsignOutしてから、ハッシュから取ったトークンで招待ユーザーのセッションを作る
        await supabase.auth.signOut({ scope: 'local' })

        const hashParams = new URLSearchParams(INVITE_HASH.substring(1))
        const access_token = hashParams.get('access_token')
        const refresh_token = hashParams.get('refresh_token')

        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (error) {
            console.error('招待トークンのセッション化失敗:', error)
            setSession(null)
          } else {
            setSession(data.session)
          }
        } else {
          setSession(null)
        }

        window.history.replaceState(null, '', window.location.pathname)
      } else {
        const { data } = await supabase.auth.getSession()
        setSession(data.session)
      }
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // フックの後なら条件分岐してOK
  if (session === undefined) return null

  // 招待リンクから来たユーザーにパスワード設定を求める
  if (needsPasswordUpdate) return (
    <div className="upload-view">
      <div className="upload-card">
        <h1>パスワードを設定</h1>
        {!session ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
            <div className="spinner" /><span>認証中...</span>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  )

  if (!session) return <Auth />

  // ============================================================
  // データ処理関数
  // ============================================================

  async function processOneFile(file, withAnalysis) {
    const formData = new FormData()
    formData.append('file', file)
    if (numSpeakers !== null) formData.append('num_speakers', numSpeakers)

    const res = await fetch(`${API_BASE}/transcribe/`, {
      method: 'POST',
      headers: await authHeaders(),
      body: formData,
    })
    if (!res.ok) throw new Error(`サーバーエラー: ${res.status}`)
    const { job_id } = await res.json()

    await new Promise((resolve, reject) => {
      const startTime = Date.now()
      const TIMEOUT = 10 * 60 * 1000  // 10分（ミリ秒）

      const intervalId = setInterval(async () => {
        if (Date.now() - startTime > TIMEOUT) {
          clearInterval(intervalId)
          reject(new Error('処理がタイムアウトしました（10分経過）'))
          return
        }
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

    const oversized = files.find(f => f.size > 500 * 1024 * 1024)
    if (oversized) {
      setError(`「${oversized.name}」のサイズが500MBを超えています`)
      return
    }

    setLoading(true)
    setResult([])
    setAnalysis(null)
    setError(null)
    setProgress(files.map(f => ({ name: f.name, status: 'waiting' })))

    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing' } : f))
        await processOneFile(files[i], withAnalysis)
        setProgress(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'done' } : f))
      }
      if (files.length > 1) await loadHistory()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setProgress([])
    }
  }

  async function runAnalysis(segments, tid = transcriptionId) {
    analyzingForIdRef.current = tid
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/analyze/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders()),
        },
        body: JSON.stringify({ segments, mode, custom_prompt: customPrompt }),
      })
      if (!res.ok) throw new Error(`分析エラー: ${res.status}`)

      const data = await res.json()
      // 分析中にユーザーが別の履歴に移動した場合はUIを更新しない
      if (analyzingForIdRef.current === tid) {
        setAnalysis(data)
      }

      if (tid) {
        // 既存の分析を削除してから挿入（再分析で重複レコードができるのを防ぐ）
        await supabase.from('analyses').delete().eq('transcription_id', tid)
        const { error: insertError } = await supabase.from('analyses').insert({
          transcription_id: tid,
          good_points: data.good_points ?? null,
          improvements: data.improvements ?? null,
          overall: data.overall ?? null,
          scores: data.scores ?? null,
          raw_data: data,
        })
        if (insertError) throw new Error(`分析の保存に失敗: ${insertError.message}`)
      } else {
        console.warn('transcriptionId が null のため分析を保存できませんでした')
      }
    } catch (e) {
      if (analyzingForIdRef.current === tid) setError(e.message)
    } finally {
      if (analyzingForIdRef.current === tid) setAnalyzing(false)
    }
  }

  function download() {
    const text = result.map(seg =>
      `[${formatTime(seg.start)}] ${getSpeakerLabel(seg.speaker, mode)}: ${seg.text}`
    ).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'result.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportMarkdown() {
    const date = new Date().toLocaleDateString('ja-JP')
    let md = `# 音声分析レポート\n**ファイル:** ${fileName}\n**日時:** ${date}\n\n---\n\n`

    if (analysis) {
      if (analysis.good_points) {
        if (analysis.scores) {
          md += `## スコア\n| 項目 | スコア |\n|------|--------|\n`
          Object.entries(analysis.scores).forEach(([key, value]) => {
            md += `| ${key} | ${value}/100 |\n`
          })
          md += '\n'
        }
        md += `## 良かった点\n${analysis.good_points.map(p => `- ${p}`).join('\n')}\n\n`
        md += `## 改善点\n${(analysis.improvements ?? []).map(p => `- ${p}`).join('\n')}\n\n`
        md += `## 総合コメント\n${analysis.overall}\n\n`
      } else if (analysis.decisions) {
        md += `## 決定事項\n${analysis.decisions.map(p => `- ${p}`).join('\n')}\n\n`
        md += `## 宿題・アクション\n${(analysis.action_items ?? []).map(p => `- ${p}`).join('\n')}\n\n`
        md += `## 次回議題\n${(analysis.next_agenda ?? []).map(p => `- ${p}`).join('\n')}\n\n`
      } else if (analysis.theme) {
        md += `## テーマ\n${analysis.theme}\n\n`
        md += `## 印象的なフレーズ\n${(analysis.highlights ?? []).map(p => `- ${p}`).join('\n')}\n\n`
        md += `## 雰囲気・感情\n${analysis.mood ?? ''}\n\n`
        md += `## 総評\n${analysis.overall}\n\n`
      } else {
        md += `## 分析結果\n${analysis.overall}\n\n`
      }
      md += '---\n\n'
    }

    md += `## 文字起こし\n`
    result.forEach(seg => {
      md += `**[${formatTime(seg.start)}] ${getSpeakerLabel(seg.speaker, mode)}:** ${seg.text}\n\n`
    })

    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName.replace(/\.[^.]+$/, '')}_report.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function deleteHistory(id) {
    await supabase.from('analyses').delete().eq('transcription_id', id)
    await supabase.from('transcriptions').delete().eq('id', id)
    setHistory(prev => prev.filter(item => item.id !== id))
  }

  async function loadHistory() {
    const { data } = await supabase
      .from('transcriptions')
      .select('id, file_name, created_at, analyses(id, overall, scores)')
      .order('created_at', { ascending: false })
    setHistory(data ?? [])
    setShowHistory(true)
  }

  // 履歴アイテムをクリックして詳細を開く
  async function handleHistorySelect(item) {
    // 別の分析が走っていてもUIには反映させない
    analyzingForIdRef.current = null
    setAnalyzing(false)
    setError(null)

    const { data: full } = await supabase
      .from('transcriptions')
      .select('segments, analyses(*)')
      .eq('id', item.id)
      .single()
    setFileName(item.file_name)
    setResult(full?.segments ?? [])
    const savedAnalysis = full?.analyses?.[0]
    setAnalysis(savedAnalysis?.raw_data ?? savedAnalysis ?? null)
    setTranscriptionId(item.id)
    setFromHistory(true)
    setShowHistory(false)
  }

  function reset() {
    setFiles([])
    setFileName('')
    setResult([])
    setAnalysis(null)
    setFromHistory(false)
    setShowHistory(false)
    setSearchQuery('')
  }

  // 結果画面から戻るボタン（履歴から来たか否かで遷移先が変わる）
  function handleBackFromResults() {
    analyzingForIdRef.current = null
    setAnalyzing(false)
    if (fromHistory) {
      setResult([])
      setAnalysis(null)
      setFromHistory(false)
      setShowHistory(true)
    } else {
      reset()
    }
  }

  // ============================================================
  // 画面レンダリング
  // ============================================================

  if (showHistory) return (
    <HistoryView
      history={history}
      onSelect={handleHistorySelect}
      onDelete={deleteHistory}
      onBack={reset}
    />
  )

  return (
    <>
      <NavBar
        email={session.user.email}
        onHistory={loadHistory}
        onPasswordChange={() => { setNeedsPasswordUpdate(true); setNewPassword(''); setPasswordError(null) }}
        onSignOut={() => supabase.auth.signOut()}
      />

      {result.length === 0 ? (
        <UploadView
          mode={mode} setMode={setMode}
          customPrompt={customPrompt} setCustomPrompt={setCustomPrompt}
          defaultPrompt={DEFAULT_PROMPTS[mode] ?? ''}
          numSpeakers={numSpeakers} setNumSpeakers={setNumSpeakers}
          customSpeakers={customSpeakers} setCustomSpeakers={setCustomSpeakers}
          files={files} setFiles={setFiles}
          onFileChange={e => setFiles(Array.from(e.target.files))}
          onDrop={e => { e.preventDefault(); setDragOver(false); setFiles(Array.from(e.dataTransfer.files)) }}
          onClearFiles={e => { e.stopPropagation(); setFiles([]) }}
          dragOver={dragOver} setDragOver={setDragOver}
          loading={loading} progress={progress} error={error}
          onUpload={upload}
        />
      ) : (
        <ResultsView
          fileName={fileName} result={result} analysis={analysis} analyzing={analyzing}
          mode={mode} setMode={setMode}
          customPrompt={customPrompt} setCustomPrompt={setCustomPrompt}
          defaultPrompt={DEFAULT_PROMPTS[mode] ?? ''}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          error={error}
          onBack={handleBackFromResults}
          onDownload={download}
          onExportMarkdown={exportMarkdown}
          onRunAnalysis={() => runAnalysis(result)}
          onResetAnalysis={() => setAnalysis(null)}
        />
      )}
    </>
  )
}

export default App
