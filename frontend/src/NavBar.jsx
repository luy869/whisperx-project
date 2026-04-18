// ナビゲーションバー
// onBack が渡された場合は「← 戻る」のみ表示（履歴画面用）
// onBack がない場合はフルメニューを表示（メイン画面用）
export function NavBar({ email, onBack, onHistory, onPasswordChange, onSignOut }) {
  return (
    <nav className="nav">
      <div className="nav-logo">
        <div className="nav-icon">🎙</div>
        <span className="nav-title">VoiceLens<span>.jp</span></span>
      </div>
      <div className="nav-actions">
        {onBack
          ? <button className="back-btn" onClick={onBack}>← 戻る</button>
          : <>
              <span className="nav-email" style={{ fontSize: '12px', color: '#475569' }}>{email}</span>
              <button className="back-btn" onClick={onHistory}>履歴</button>
              <button className="back-btn" onClick={onPasswordChange}>パスワード変更</button>
              <button className="back-btn" onClick={onSignOut}>ログアウト</button>
            </>
        }
      </div>
    </nav>
  )
}
