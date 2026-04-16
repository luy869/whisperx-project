import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// flowType: 'implicit' を明示する理由
// v2.45以降のSupabase JSはPKCEがデフォルト。PKCEだとハッシュの #access_token=... を拾えず
// 招待リンク（ハッシュ形式のトークンが入る）でセッションが確立できない
// implicit にすればハッシュを同期的に処理してセッションを作る
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
