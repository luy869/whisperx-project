import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// detectSessionInUrl: false にする理由
// true にすると、既にログインしていても招待リンクのハッシュを自動処理してしまう。
// しかも既存セッションを置き換えるかどうかの挙動が不安定で、
// 結果として updateUser が「既にログインしてるユーザー」に対して動き、
// 既存アカウントのパスワードを書き換える事故が起きる。
// App.jsx側でsignOut→手動setSessionの順で制御する（招待ハッシュがある場合のみ）。
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
})
