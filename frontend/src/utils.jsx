// ============================================================
// ヘルパー関数・定数
// App.jsx から切り出してどのコンポーネントからも import できるようにする
// ============================================================

// 秒数を MM:SS 形式に変換
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// 話者IDからCSSクラス名を返す（speaker-0 〜 speaker-4）
export function getSpeakerClass(speaker) {
  if (!speaker) return 'speaker-0'
  const match = speaker.match(/SPEAKER_(\d+)/)
  const num = match ? parseInt(match[1], 10) : 0
  return `speaker-${Math.min(num, 4)}`
}

// モードによって話者ラベルを変える
export const SPEAKER_LABELS = {
  '面接': ['面接官', '応募者'],
  '会議': ['司会', '参加者'],
  '音楽': ['声1', '声2'],
}

export function getSpeakerLabel(speaker, mode) {
  if (!speaker) return '不明'
  const match = speaker.match(/SPEAKER_(\d+)/)
  const num = match ? parseInt(match[1], 10) : 0
  if (num <= 1) {
    const labels = SPEAKER_LABELS[mode] ?? ['話者1', '話者2']
    return labels[num]
  }
  return `話者${num + 1}`
}

// テキストの検索ワード一致部分を <mark> で囲む（React要素の配列を返す）
export function highlightText(text, query) {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="search-highlight">{part}</mark>
      : part
  )
}
