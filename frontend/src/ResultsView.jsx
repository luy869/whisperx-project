import { formatTime, getSpeakerClass, getSpeakerLabel, highlightText } from './utils'

// 結果画面（分析パネル + 文字起こし）
export function ResultsView({
  fileName, result, analysis, analyzing,
  mode, setMode, customPrompt, setCustomPrompt,
  searchQuery, setSearchQuery,
  error,
  onBack, onDownload, onExportMarkdown,
  onRunAnalysis, onResetAnalysis,
}) {
  return (
    <div className="results-view">
      <div className="results-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="back-btn" onClick={onBack}>← 戻る</button>
          <button className="back-btn" onClick={onDownload}>↓ テキスト保存</button>
          <button className="back-btn" onClick={onExportMarkdown}>↓ レポート保存</button>
        </div>
        <h2><span className="file-icon">🎵</span>{fileName}</h2>
      </div>

      <div className="results-body">
        {/* 分析パネル */}
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

              {/* 面接・プレゼンモード */}
              {analysis.good_points && <>
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

              {/* カスタムモード */}
              {!analysis.decisions && !analysis.good_points && !analysis.theme && (
                <div className="analysis-section overall">
                  <h3>分析結果</h3>
                  <p>{analysis.overall}</p>
                </div>
              )}

              <button
                className="back-btn"
                style={{ marginTop: '8px', width: '100%', textAlign: 'center' }}
                onClick={onResetAnalysis}
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
                    onClick={onRunAnalysis}
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
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input
              className="search-input"
              type="text"
              placeholder="文字起こしを検索..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>

          {result.map((seg, i) => {
            const isMatch = !searchQuery.trim() || seg.text.toLowerCase().includes(searchQuery.toLowerCase())
            return (
              <div className={`segment-row ${!isMatch ? 'segment-dimmed' : ''}`} key={i}>
                <span className="timestamp">{formatTime(seg.start)}</span>
                <span className={`speaker-chip ${getSpeakerClass(seg.speaker)}`}>
                  {getSpeakerLabel(seg.speaker, mode)}
                </span>
                <span className="segment-text">{highlightText(seg.text, searchQuery)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
