import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { supabase } from './supabaseClient'
import LogView from './LogView'

const STORAGE_KEY = 'work-timer-sessions'
const ACTIVE_KEY = 'work-timer-active'

const PROJECTS = ['講義準備', '大学', '学会', 'その他']

// milestone: 今日の合計時間に応じた背景・メッセージ
function getMilestone(totalSec) {
  if (totalSec >= 100 * 60) return { label: '立派なブラックです✨', bg: '#1e1e1e', dark: true }
  if (totalSec >= 50 * 60)  return { label: '染まってきたね❤️',   bg: '#707070', dark: true }
  if (totalSec >= 25 * 60)  return { label: 'よくやったね😊',     bg: '#d0d0d0', dark: false }
  return null
}

function loadLocalSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function toDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildChartData(sessions) {
  const map = {}
  sessions.forEach(s => {
    const d = s.date
    map[d] = (map[d] || 0) + s.duration
  })
  const sorted = Object.keys(map).sort()
  const last7 = sorted.slice(-7)
  return last7.map(d => ({ date: formatDate(d), minutes: Math.round(map[d] / 60) }))
}

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '8px 12px' }}>
        <p style={{ fontSize: 13, color: '#555' }}>{label}</p>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#444' }}>{payload[0].value} 分</p>
      </div>
    )
  }
  return null
}

let _audioCtx = null

function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return _audioCtx
}

function ensureAudioUnlocked() {
  const ctx = getAudioCtx()
  if (ctx.state === 'suspended') ctx.resume()
}

export default function TimerApp({ user, profile, onProfileChange }) {
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [localData, setLocalData] = useState(loadLocalSessions)
  const [migrating, setMigrating] = useState(false)

  const [project, setProject] = useState('講義準備')
  const [status, setStatus] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [sessionStart, setSessionStart] = useState(null)
  const [bgMusic, setBgMusic] = useState('off')
  const [view, setView] = useState('timer')
  const [restored, setRestored] = useState(false)

  const intervalRef = useRef(null)
  const runStartRef = useRef(null)
  const baseElapsedRef = useRef(0)
  const sessionStartRef = useRef(null)
  const userIdRef = useRef(user.id)
  const projectRef = useRef(project)
  const statusRef = useRef('idle')
  const tickRef = useRef(null)
  const fetchSessionsRef = useRef(null)
  const musicRef = useRef(null)
  const musicKeyRef = useRef('off')
  const shouldPlayMusicRef = useRef(false)

  useEffect(() => { projectRef.current = project }, [project])
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { sessionStartRef.current = sessionStart }, [sessionStart])

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
    if (data) setSessions(data)
    setSessionsLoading(false)
  }, [user.id])

  useEffect(() => { fetchSessionsRef.current = fetchSessions }, [fetchSessions])
  useEffect(() => { fetchSessions() }, [fetchSessions])

  // Restore active timer from localStorage on mount
  useEffect(() => {
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(ACTIVE_KEY)) } catch { return null }
    })()
    if (!saved) return
    if (saved.savedAt && Date.now() - saved.savedAt > 8 * 3600 * 1000) {
      localStorage.removeItem(ACTIVE_KEY)
      return
    }
    const timePassed = saved.status === 'running' && saved.savedAt
      ? Math.floor((Date.now() - saved.savedAt) / 1000)
      : 0
    const restoredElapsed = (saved.elapsed || 0) + timePassed
    if (saved.project) setProject(saved.project)
    if (saved.sessionStart) setSessionStart(new Date(saved.sessionStart))
    baseElapsedRef.current = restoredElapsed
    setElapsed(restoredElapsed)

    if (saved.status === 'running') {
      runStartRef.current = Date.now()
      intervalRef.current = setInterval(() => tickRef.current(), 1000)
      setStatus('running')
    } else {
      setStatus('paused')
      setRestored(true)
    }
  }, [])

  // Persist active state each tick
  useEffect(() => {
    if (status === 'idle') {
      localStorage.removeItem(ACTIVE_KEY)
      return
    }
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({
      status,
      project,
      sessionStart: sessionStart?.toISOString() ?? null,
      elapsed,
      savedAt: Date.now(),
    }))
  }, [status, project, sessionStart, elapsed])

  // Warn before unload while timer is active
  useEffect(() => {
    const handler = (e) => {
      if (status === 'running' || status === 'paused') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [status])

  // Migrate localStorage data to Supabase
  const migrateLocalData = async () => {
    if (localData.length === 0) return
    setMigrating(true)
    const inserts = localData.map(s => ({
      user_id: user.id,
      date: s.date,
      started_at: s.startedAt || new Date().toISOString(),
      duration: s.duration,
      project: s.project || '講義準備',
    }))
    const { error } = await supabase.from('sessions').insert(inserts)
    if (!error) {
      localStorage.removeItem(STORAGE_KEY)
      setLocalData([])
      await fetchSessions()
    }
    setMigrating(false)
  }

  const today = toDateStr(new Date())
  const todayTotal = sessions.filter(s => s.date === today).reduce((sum, s) => sum + s.duration, 0)
  const chartData = buildChartData(sessions)
  const milestone = getMilestone(todayTotal)

  // Update body background and title
  useEffect(() => {
    document.body.style.background = milestone?.bg || '#f5f5f5'
    return () => { document.body.style.background = '' }
  }, [milestone?.bg])

  const clearInterval_ = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const tick = useCallback(() => {
    if (!runStartRef.current) return
    const secondsIntoRun = Math.floor((Date.now() - runStartRef.current) / 1000)
    setElapsed(baseElapsedRef.current + secondsIntoRun)
  }, [])

  useEffect(() => { tickRef.current = tick }, [tick])

  // Background music
  useEffect(() => {
    const shouldPlay = status === 'running' && bgMusic !== 'off'
    shouldPlayMusicRef.current = shouldPlay
    if (!shouldPlay) {
      musicRef.current?.pause()
      return
    }
    const MUSIC_SRC = { ice: '/ice3.m4a', fire: '/fire.mp3', piano: '/piano.mp3' }
    if (!musicRef.current || musicKeyRef.current !== bgMusic) {
      musicRef.current?.pause()
      const audio = new Audio(MUSIC_SRC[bgMusic])
      audio.loop = true
      audio.volume = 0.4
      musicRef.current = audio
      musicKeyRef.current = bgMusic
    }
    if (musicRef.current.paused) {
      musicRef.current.play().catch(() => {})
    }
  }, [status, bgMusic])

  useEffect(() => () => { musicRef.current?.pause() }, [])

  const start = useCallback(() => {
    if (status === 'running') return
    ensureAudioUnlocked()
    runStartRef.current = Date.now()
    if (status === 'idle') {
      setSessionStart(new Date())
      setElapsed(0)
      baseElapsedRef.current = 0
    } else {
      baseElapsedRef.current = elapsed
    }
    setStatus('running')
    intervalRef.current = setInterval(() => tickRef.current(), 1000)
  }, [status, elapsed])

  const pause = useCallback(() => {
    if (status !== 'running') return
    clearInterval_()
    if (runStartRef.current) {
      const s = Math.floor((Date.now() - runStartRef.current) / 1000)
      setElapsed(baseElapsedRef.current + s)
      runStartRef.current = null
    }
    setStatus('paused')
  }, [status, clearInterval_])

  const stop = useCallback(async () => {
    clearInterval_()
    const finalElapsed = runStartRef.current
      ? baseElapsedRef.current + Math.floor((Date.now() - runStartRef.current) / 1000)
      : elapsed
    runStartRef.current = null

    if (finalElapsed > 0) {
      const sessionDate = toDateStr(sessionStart || new Date())
      const sessionStartedAt = (sessionStart || new Date()).toISOString()
      const { error } = await supabase.from('sessions').insert({
        user_id: userIdRef.current,
        date: sessionDate,
        started_at: sessionStartedAt,
        duration: finalElapsed,
        project: projectRef.current,
      })
      if (error) {
        const fallback = { date: sessionDate, startedAt: sessionStartedAt, duration: finalElapsed, project: projectRef.current }
        const updated = [fallback, ...loadLocalSessions()]
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        setLocalData(updated)
      } else {
        fetchSessionsRef.current()
      }
    }

    setRestored(false)
    document.title = '仕事タイマー'
    setStatus('idle')
    setElapsed(0)
    setSessionStart(null)
  }, [clearInterval_, elapsed, sessionStart])

  const handleDeleteSession = useCallback(async (sessionId) => {
    const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
    if (!error) setSessions(prev => prev.filter(s => s.id !== sessionId))
    return !error
  }, [])

  const handleAddManualSession = useCallback(async (date, minutes) => {
    const { error } = await supabase.from('sessions').insert({
      user_id: userIdRef.current,
      date,
      started_at: new Date().toISOString(),
      duration: minutes * 60,
      project: '講義準備',
    })
    if (!error) fetchSessionsRef.current()
    return !error
  }, [])

  const handleLogout = async () => { await supabase.auth.signOut() }

  useEffect(() => () => clearInterval_(), [clearInterval_])

  // Recalculate on screen wake
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        ensureAudioUnlocked()
        tickRef.current()
        if (statusRef.current === 'running' && !intervalRef.current) {
          intervalRef.current = setInterval(() => tickRef.current(), 1000)
        }
        if (shouldPlayMusicRef.current && musicRef.current?.paused) {
          musicRef.current.play().catch(() => {})
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const isDark = milestone?.dark ?? false
  const textColor = isDark ? '#fff' : '#222'
  const subTextColor = isDark ? '#ccc' : '#666'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: textColor }}>仕事タイマー</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: subTextColor }}>{profile?.display_name || user.email}</span>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 14px',
              border: `1.5px solid ${isDark ? '#666' : '#e0e0e0'}`,
              borderRadius: 6,
              background: 'transparent',
              color: subTextColor,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ログアウト
          </button>
        </div>
      </div>

      {/* Migration Banner */}
      {view === 'timer' && localData.length > 0 && (
        <div style={{
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 10,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <p style={{ fontSize: 13, color: '#7d6300', margin: 0 }}>
            このデバイスに {localData.length} 件のローカル記録があります。クラウドに移行しますか？
          </p>
          <button
            onClick={migrateLocalData}
            disabled={migrating}
            style={{
              padding: '6px 16px',
              background: migrating ? '#aaa' : '#444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              cursor: migrating ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {migrating ? '移行中...' : 'クラウドに移行'}
          </button>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { key: 'timer', label: 'タイマー' },
          { key: 'log',   label: 'ログ' },
          { key: 'settings', label: '設定' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            style={{
              padding: '8px 16px',
              borderRadius: 20,
              border: 'none',
              cursor: 'pointer',
              background: view === key ? (isDark ? '#fff' : '#444') : (isDark ? 'rgba(255,255,255,0.15)' : '#e0e0e0'),
              color: view === key ? (isDark ? '#222' : '#fff') : subTextColor,
              fontWeight: 600,
              fontSize: 14,
              transition: 'background 0.2s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'log' && <LogView sessions={sessions} />}
      {view === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SettingsCard user={user} profile={profile} onProfileSaved={onProfileChange} />
          <EditCard sessions={sessions} onDelete={handleDeleteSession} onAdd={handleAddManualSession} />
        </div>
      )}

      {view === 'timer' && <>

        {/* Restore Banner */}
        {restored && (
          <div style={{
            background: '#fff',
            border: '1.5px solid #888',
            borderRadius: 10,
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <span style={{ fontSize: 13, color: '#555' }}>
              前回のセッションを復元しました。再開または終了してください。
            </span>
            <button
              onClick={() => setRestored(false)}
              style={{ padding: '4px 12px', background: 'transparent', border: '1px solid #888', borderRadius: 6, color: '#555', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              閉じる
            </button>
          </div>
        )}

        {/* Milestone label */}
        {milestone && (
          <div style={{
            textAlign: 'center',
            fontSize: 24,
            fontWeight: 700,
            color: isDark ? '#fff' : '#333',
            letterSpacing: '0.04em',
            padding: '4px 0',
          }}>
            {milestone.label}
          </div>
        )}

        {/* Timer Card */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
        }}>
          {/* Project selector */}
          <div style={{ display: 'flex', gap: 8 }}>
            {PROJECTS.map(p => (
              <button
                key={p}
                onClick={() => { if (status === 'idle') setProject(p) }}
                disabled={status !== 'idle'}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: 'none',
                  cursor: status === 'idle' ? 'pointer' : 'default',
                  background: project === p ? '#444' : '#e8e8e8',
                  color: project === p ? '#fff' : '#666',
                  fontWeight: 600,
                  fontSize: 13,
                  transition: 'background 0.2s',
                  opacity: status !== 'idle' && project !== p ? 0.4 : 1,
                }}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Time display */}
          <div style={{ fontSize: 68, fontWeight: 700, fontFamily: 'monospace', color: '#222', letterSpacing: 2 }}>
            {formatTime(elapsed)}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 12 }}>
            {status === 'idle' && (
              <Btn onClick={start} color="#444">開始</Btn>
            )}
            {status === 'running' && (
              <>
                <Btn onClick={pause} color="#888">一時停止</Btn>
                <Btn onClick={stop} color="#555" outline>終了</Btn>
              </>
            )}
            {status === 'paused' && (
              <>
                <Btn onClick={start} color="#444">再開</Btn>
                <Btn onClick={stop} color="#555" outline>終了</Btn>
              </>
            )}
          </div>

          {/* Music buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { key: 'off',   label: 'off'       },
              { key: 'ice',   label: '❄️ ice'   },
              { key: 'fire',  label: '🔥 fire'  },
              { key: 'piano', label: '🎹 piano' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setBgMusic(key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: 'none',
                  cursor: 'pointer',
                  background: bgMusic === key ? '#444' : '#e8e8e8',
                  color: bgMusic === key ? '#fff' : '#666',
                  fontWeight: 600,
                  fontSize: 13,
                  transition: 'background 0.2s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Today's Total */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          padding: '20px 28px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 15, color: '#666' }}>今日の合計時間</span>
          <span style={{ fontSize: 26, fontWeight: 700, fontFamily: 'monospace', color: '#333' }}>
            {formatTime(todayTotal)}
          </span>
        </div>

        {/* Chart */}
        {!sessionsLoading && chartData.length > 0 && (
          <div style={{
            background: '#fff',
            borderRadius: 16,
            padding: '24px 16px 16px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#444', marginBottom: 16, paddingLeft: 8 }}>
              日別時間（分）
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#888' }} />
                <YAxis tick={{ fontSize: 12, fill: '#888' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="minutes" fill="#666" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Session History */}
        {!sessionsLoading && sessions.length > 0 && (
          <div style={{
            background: '#fff',
            borderRadius: 16,
            padding: '24px 24px 16px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#444', marginBottom: 12 }}>
              セッション履歴
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {sessions.slice(0, 10).map(s => (
                <div key={s.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: '1px solid #f5f5f5',
                  fontSize: 14,
                }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ color: '#888' }}>{formatDate(s.date)}</span>
                    <span style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: '#f0f0f0',
                      color: '#555',
                    }}>
                      {s.project || '本業仕事'}
                    </span>
                  </div>
                  <span style={{ fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>
                    {formatTime(s.duration)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </>}
    </div>
  )
}

function Btn({ children, onClick, color, outline }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 28px',
        borderRadius: 8,
        border: outline ? `2px solid ${color}` : 'none',
        background: outline ? 'transparent' : color,
        color: outline ? color : '#fff',
        fontWeight: 700,
        fontSize: 15,
        cursor: 'pointer',
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      {children}
    </button>
  )
}

function SettingsCard({ user, profile, onProfileSaved }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (displayName.trim().length < 1) { setError('表示名を入力してください'); return }
    setLoading(true)
    const { data, error: dbError } = await supabase
      .from('profiles')
      .upsert({ id: user.id, display_name: displayName.trim(), updated_at: new Date().toISOString() })
      .select()
      .single()
    if (dbError) {
      setError('保存に失敗しました。再度お試しください。')
    } else {
      onProfileSaved(data)
      setSuccess(true)
    }
    setLoading(false)
  }

  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      padding: '20px 24px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#444', marginBottom: 16 }}>設定</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={settingsLabel}>表示名</label>
          <input
            type="text"
            value={displayName}
            onChange={e => { setDisplayName(e.target.value); setSuccess(false) }}
            required
            style={settingsInput}
            placeholder="例: タナカ"
            maxLength={30}
          />
        </div>
        {error && (
          <p style={{ fontSize: 13, color: '#ee5a24', background: '#fff5f2', borderRadius: 6, padding: '8px 12px', margin: 0 }}>
            {error}
          </p>
        )}
        {success && (
          <p style={{ fontSize: 13, color: '#555', background: '#f0f0f0', borderRadius: 6, padding: '8px 12px', margin: 0 }}>
            保存しました
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '11px 0',
            background: loading ? '#aaa' : '#444',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 15,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '保存中...' : '設定を変更する'}
        </button>
      </form>
    </div>
  )
}

const settingsLabel = {
  fontSize: 13,
  fontWeight: 600,
  color: '#555',
  display: 'block',
  marginBottom: 5,
}

const settingsInput = {
  width: '100%',
  padding: '10px 12px',
  border: '1.5px solid #e0e0e0',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

function EditCard({ sessions, onDelete, onAdd }) {
  const [confirmId, setConfirmId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [manualDate, setManualDate] = useState(() => toDateStr(new Date()))
  const [manualMin, setManualMin] = useState(10)
  const [adding, setAdding] = useState(false)
  const [addResult, setAddResult] = useState(null)

  const sorted = [...sessions].sort((a, b) =>
    b.date !== a.date ? b.date.localeCompare(a.date)
      : new Date(b.started_at) - new Date(a.started_at)
  )

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    const ok = await onDelete(confirmId)
    if (ok) setConfirmId(null)
    setDeleting(false)
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    setAdding(true)
    setAddResult(null)
    const ok = await onAdd(manualDate, manualMin)
    setAddResult(ok ? 'ok' : 'error')
    setAdding(false)
    if (ok) setManualMin(10)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#444', marginBottom: 4 }}>セッションを削除</h2>
        <p style={{ fontSize: 12, color: '#aaa', marginBottom: 14 }}>誤記録などを削除できます</p>
        {sorted.length === 0 ? (
          <p style={{ fontSize: 13, color: '#bbb', margin: 0 }}>記録がありません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sorted.map(s => (
              <div key={s.id} style={{ borderBottom: '1px solid #f5f5f5', padding: '10px 0' }}>
                {confirmId === s.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, color: '#ee5a24', fontWeight: 600 }}>
                      {formatDate(s.date)}　{formatTime(s.duration)}　を削除しますか？
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={handleDeleteConfirm} disabled={deleting}
                        style={{ padding: '5px 14px', background: '#ee5a24', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {deleting ? '...' : '削除'}
                      </button>
                      <button onClick={() => setConfirmId(null)}
                        style={{ padding: '5px 12px', background: '#f0f0f0', color: '#666', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                        戻る
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: '#888' }}>{formatDate(s.date)}</span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f0f0f0', color: '#666' }}>
                        {s.project || '本業仕事'}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace', color: '#333' }}>
                        {formatTime(s.duration)}
                      </span>
                    </div>
                    <button onClick={() => setConfirmId(s.id)}
                      style={{ padding: '4px 12px', background: 'transparent', color: '#ccc', border: '1px solid #e8e8e8', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                      削除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#444', marginBottom: 4 }}>時間を手動追加</h2>
        <p style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>記録し忘れた時間を最大20分まで追加できます</p>
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={settingsLabel}>日付</label>
            <input type="date" value={manualDate} max={toDateStr(new Date())}
              onChange={e => { setManualDate(e.target.value); setAddResult(null) }}
              required style={settingsInput} />
          </div>
          <div>
            <label style={settingsLabel}>追加時間：<strong style={{ color: '#444' }}>{manualMin} 分</strong></label>
            <input type="range" min={1} max={20} value={manualMin}
              onChange={e => { setManualMin(Number(e.target.value)); setAddResult(null) }}
              style={{ width: '100%', marginTop: 6 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#bbb', marginTop: 2 }}>
              <span>1分</span><span>20分</span>
            </div>
          </div>
          {addResult === 'ok' && (
            <p style={{ fontSize: 13, color: '#555', background: '#f0f0f0', borderRadius: 6, padding: '8px 12px', margin: 0 }}>追加しました</p>
          )}
          {addResult === 'error' && (
            <p style={{ fontSize: 13, color: '#ee5a24', background: '#fff5f2', borderRadius: 6, padding: '8px 12px', margin: 0 }}>追加に失敗しました。再度お試しください。</p>
          )}
          <button type="submit" disabled={adding}
            style={{ padding: '11px 0', background: adding ? '#aaa' : '#444', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: adding ? 'not-allowed' : 'pointer' }}>
            {adding ? '追加中...' : '追加する'}
          </button>
        </form>
      </div>
    </div>
  )
}
