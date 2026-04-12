import { useState } from 'react'
import { supabase } from './supabase'

function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="upload-view">
      <div className="upload-card">
        <h1>ログイン</h1>
        <p>VoiceLens.jp</p>

        {error && <p className="error-msg">{error}</p>}

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
            {loading ? <><div className="spinner" />処理中...</> : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Auth
