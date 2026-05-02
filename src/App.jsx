import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import AuthPage from './AuthPage'
import TimerApp from './TimerApp'

const PROFILE_CACHE_KEY = 'work-timer-profile-v1'

function loadCachedProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) ?? 'null') }
  catch { return null }
}

function saveCachedProfile(p) {
  try {
    if (p) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p))
    else localStorage.removeItem(PROFILE_CACHE_KEY)
  } catch {}
}

async function fetchProfile(userId) {
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 5000))
  const query = supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
    .then(({ data }) => data ?? null)
    .catch(() => null)
  return Promise.race([query, timeout])
}

async function createDefaultProfile(user) {
  const displayName = user.user_metadata?.display_name?.trim() || ''
  const row = {
    id: user.id,
    updated_at: new Date().toISOString(),
    ...(displayName && { display_name: displayName }),
  }
  const { data, error } = await supabase
    .from('profiles')
    .insert(row)
    .select()
    .single()
  if (error) return await fetchProfile(user.id)
  return data ?? null
}

export default function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(loadCachedProfile)
  const [loading, setLoading] = useState(true)

  const handleProfileChange = (p) => {
    setProfile(p)
    saveCachedProfile(p)
  }

  useEffect(() => {
    let mounted = true

    ;(async () => {
      let u = null
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return
        u = session?.user ?? null
        setUser(u)
        if (!u) { setProfile(null); saveCachedProfile(null) }
      } finally {
        if (mounted) setLoading(false)
      }

      if (!u || !mounted) return
      const p = await fetchProfile(u.id)
      if (!mounted) return
      if (p) {
        setProfile(p); saveCachedProfile(p)
      } else if (!loadCachedProfile()) {
        createDefaultProfile(u).then(np => {
          if (mounted && np) { setProfile(np); saveCachedProfile(np) }
        }).catch(() => {})
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_IN') {
        const u = session?.user ?? null
        setUser(u)
        setLoading(true)
        try {
          const p = await fetchProfile(u?.id)
          if (mounted) {
            if (p) { setProfile(p); saveCachedProfile(p) }
            else if (!loadCachedProfile()) {
              createDefaultProfile(u).then(np => {
                if (mounted && np) { setProfile(np); saveCachedProfile(np) }
              }).catch(() => {})
            }
          }
        } finally {
          if (mounted) setLoading(false)
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        saveCachedProfile(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 15 }}>
        読み込み中...
      </div>
    )
  }

  if (!user) return <AuthPage />

  return <TimerApp user={user} profile={profile} onProfileChange={handleProfileChange} />
}
