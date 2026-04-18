import { NavBar } from './NavBar'

// 履歴一覧画面
// onSelect(item): アイテムクリック時（App.jsxでsegments取得+state更新を行う）
// onDelete(id): 削除ボタンクリック時
// onBack: ← 戻るクリック時
export function HistoryView({ history, onSelect, onDelete, onBack }) {
  return (
    <>
      <NavBar onBack={onBack} />
      <div className="transcript" style={{ maxWidth: '800px', margin: '32px auto', padding: '0 32px' }}>
        <h2 style={{ color: '#f1f5f9', marginBottom: '24px' }}>履歴</h2>
        {history.length === 0 && <p style={{ color: '#475569' }}>履歴がありません</p>}
        {history.map((item) => (
          <div
            key={item.id}
            className="history-item"
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(item)}
          >
            <div className="history-header">
              <span className="history-filename">🎵 {item.file_name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="history-date">{new Date(item.created_at).toLocaleDateString('ja-JP')}</span>
                <button
                  className="clear-btn"
                  style={{ position: 'static' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm('この履歴を削除しますか？')) onDelete(item.id)
                  }}
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
}
