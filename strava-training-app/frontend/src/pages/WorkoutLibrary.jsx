import { useState, useEffect } from 'react'
import { RefreshCw, Trash2, Star } from 'lucide-react'

function StarRating({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n === value ? null : n)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <Star size={14} fill={value >= n ? '#f97316' : 'none'} color={value >= n ? '#f97316' : 'var(--muted)'} />
        </button>
      ))}
    </div>
  )
}

export default function WorkoutLibrary() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [source, setSource] = useState('')
  const [workoutType, setWorkoutType] = useState('')
  const [q, setQ] = useState('')

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (source) params.set('source', source)
    if (workoutType) params.set('workout_type', workoutType)
    if (q) params.set('q', q)
    fetch(`/trainiq/workout-library?${params.toString()}`)
      .then(r => r.json()).then(d => { setItems(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [source, workoutType])

  const runSync = async () => {
    setSyncing(true)
    setSyncMsg('Synchroniseren gestart…')
    try {
      await fetch('/trainiq/garmin/import-workout-library', { method: 'POST' })
      setSyncMsg('Sync gestart — dit kan even duren, ververs de pagina straks')
    } catch { setSyncMsg('Sync mislukt') }
    setSyncing(false)
  }

  const patch = async (id, body) => {
    await fetch(`/trainiq/workout-library/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    load()
  }

  const remove = async (id, name) => {
    if (!confirm(`"${name}" verwijderen uit de bibliotheek?`)) return
    await fetch(`/trainiq/workout-library/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Workout Bibliotheek</h1>
          <p className="page-subtitle">Garmin cycling-workouts, gelabeld voor hergebruik in Planning</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={runSync} disabled={syncing}>
          <RefreshCw size={13} className={syncing ? 'spin' : ''} />
          {syncing ? 'Bezig…' : 'Sync met Garmin'}
        </button>
      </div>

      {syncMsg && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{syncMsg}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select value={source} onChange={e => setSource(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 }}>
            <option value="">Alle bronnen</option>
            <option value="join">Join</option>
            <option value="trainiq">TrainIQ</option>
            <option value="overig">Overig</option>
          </select>
          <select value={workoutType} onChange={e => setWorkoutType(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 }}>
            <option value="">Alle types</option>
            <option value="endurance">Endurance</option>
            <option value="threshold">Threshold</option>
            <option value="vo2max">VO2max</option>
            <option value="recovery">Recovery</option>
            <option value="race">Race</option>
            <option value="unclassified">Ongeclassificeerd</option>
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Zoek op naam…"
            style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 }} />
          <button className="btn btn-ghost btn-sm" onClick={load}>Zoeken</button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', padding: 20 }}>Laden…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">Geen workouts gevonden. Klik op "Sync met Garmin" om te importeren.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(w => (
            <div key={w.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{w.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {w.estimated_duration_s ? `${Math.round(w.estimated_duration_s / 60)}min` : '—'}
                  {' · '}gebruikt {w.times_used}x
                </div>
              </div>
              <select value={w.source} onChange={e => patch(w.id, { source: e.target.value })}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }}>
                <option value="join">Join</option>
                <option value="trainiq">TrainIQ</option>
                <option value="overig">Overig</option>
              </select>
              <select value={w.workout_type || 'unclassified'} onChange={e => patch(w.id, { workout_type: e.target.value })}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }}>
                <option value="endurance">Endurance</option>
                <option value="threshold">Threshold</option>
                <option value="vo2max">VO2max</option>
                <option value="recovery">Recovery</option>
                <option value="race">Race</option>
                <option value="unclassified">Ongeclassificeerd</option>
              </select>
              <StarRating value={w.rating} onChange={val => patch(w.id, { rating: val })} />
              <button onClick={() => remove(w.id, w.name)}
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                         borderRadius: 4, padding: '5px 10px', cursor: 'pointer', color: '#ef4444' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}