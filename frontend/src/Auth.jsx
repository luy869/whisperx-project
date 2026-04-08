import { useState } from 'react'
import { supabase } from './supabase'

function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (isSignUp) {
      // 新規登録
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
      } else {
        setMessage('確認メールを送信しました。メールを確認してください。')
      }
    } else {
      // ログイン
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    }

    setLoading(false)
  }

  return (
    <div className="upload-view">
      <div className="upload-card">
        <h1>{isSignUp ? '新規登録' : 'ログイン'}</h1>
        <p>VoiceLens.jp</p>

        {error && <p className="error-msg">{error}</p>}
        {message && <p className="success-msg">{message}</p>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            className="auth-input"
            type="email"
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="auth-input"
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            className={`submit-btn ${loading ? 'loading' : 'active'}`}
            type="submit"
            disabled={loading}
          >
            {loading ? <><div className="spinner" />処理中...</> : (isSignUp ? '新規登録' : 'ログイン')}
          </button>
        </form>

        <button
          className="toggle-auth-btn"
          onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null) }}
        >
          {isSignUp ? 'すでにアカウントをお持ちの方はこちら' : 'アカウントをお持ちでない方はこちら'}
        </button>
      </div>
    </div>
  )
}

export default Auth
