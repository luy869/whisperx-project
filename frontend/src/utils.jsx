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

// モードごとのデフォルト指示文（バックエンドのPROMPTS dictのinstruction部分と一致させる）
// フロントでtextareaに初期表示し、ユーザーが編集できる
export const DEFAULT_PROMPTS = {
  '面接':    '以下は就職面接の文字起こしです。応募者のパフォーマンスを分析してください。',
  'プレゼン': '以下はプレゼンテーションの文字起こしです。発表者の話し方・構成・説得力を分析してください。',
  '会議':    '以下は会議の文字起こしです。内容を整理してください。',
  '音楽':    '以下は楽曲の文字起こしです。歌詞のテーマ・感情・印象的なフレーズを分析してください。',
  'カスタム': '',
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
