// アップロード画面
export function UploadView({
  mode, setMode,
  customPrompt, setCustomPrompt, defaultPrompt,
  numSpeakers, setNumSpeakers,
  customSpeakers, setCustomSpeakers,
  files, onFileChange, onDrop, onClearFiles,
  dragOver, setDragOver,
  loading, progress, error,
  onUpload,
}) {
  return (
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
          <div style={{ position: 'relative', width: '100%' }}>
            <textarea
              className="custom-prompt-input"
              placeholder={mode === 'カスタム' ? '例：この音声は音楽です。歌詞のテーマと感情表現を分析してください。' : '分析の指示を編集できます'}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={3}
            />
            {mode !== 'カスタム' && customPrompt !== defaultPrompt && (
              <button
                className="back-btn"
                style={{ marginTop: '4px', fontSize: '11px' }}
                onClick={() => setCustomPrompt(defaultPrompt)}
              >
                デフォルトに戻す
              </button>
            )}
          </div>
        </div>

        <div
          className={`dropzone ${dragOver ? 'drag-over' : ''} ${files.length ? 'has-file' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {files.length ? (
            <div className="dropzone-selected">
              <span className="file-icon">🎵</span>
              <span className="file-name">
                {files.length === 1 ? files[0].name : `${files.length}件のファイル`}
              </span>
              <button className="clear-btn" onClick={onClearFiles}>✕</button>
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
                onChange={onFileChange}
              />
            </>
          )}
        </div>

        {/* 処理中の進捗リスト */}
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
            onClick={() => onUpload(false)}
            disabled={!files.length || loading}
          >
            {loading ? <><div className="spinner" />解析中...</> : '文字起こしのみ'}
          </button>
          <button
            className={`submit-btn analyze ${loading ? 'loading' : files.length ? 'active-analyze' : ''}`}
            onClick={() => onUpload(true)}
            disabled={!files.length || loading}
          >
            {loading ? <><div className="spinner" />解析中...</> : '文字起こし + 分析'}
          </button>
        </div>
      </div>
    </div>
  )
}
