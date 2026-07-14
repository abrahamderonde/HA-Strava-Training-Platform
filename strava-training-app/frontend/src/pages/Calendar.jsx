import { useState, useEffect } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         startOfWeek, endOfWeek, isSameMonth, isToday } from 'date-fns'
import { ChevronLeft, ChevronRight, Check, X, RotateCcw, Plus } from 'lucide-react'

const SPORT_PILL = type => {
  if (['Ride','VirtualRide','EBikeRide','MountainBikeRide','GravelRide'].includes(type)) return 'pill-ride'
  if (['Run','TrailRun'].includes(type)) return 'pill-run'
  return 'pill-other'
}
function formatDistance(m) {
  return m >= 1000 ? `${(m/1000).toFixed(0)}km` : `${m?.toFixed(0)}m`
}

// ── Workout status badge ───────────────────────────────────────────────
function StatusBadge({ completed }) {
  if (completed === true)  return <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700 }}>✓ Done</span>
  if (completed === false) return <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>✗ Skipped</span>
  return <span style={{ color: 'var(--muted)', fontSize: 11 }}>Planned</span>
}

// ── Mark workout panel ─────────────────────────────────────────────────
// ── RPE input panel for activities without power/HR data ──────────────
function RpePanel({ activity, onDone }) {
  const [rpe, setRpe] = useState(activity.rpe || 5)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const save = async () => {
    setSaving(true)
    const res = await fetch(`/trainiq/activities/${activity.id}/set-rpe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpe: parseFloat(rpe) }),
    })
    setSaving(false)
    if (res.ok) { setOpen(false); onDone() }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ background: activity.rpe ? 'rgba(168,85,247,0.15)' : 'var(--bg)',
                 border: `1px solid ${activity.rpe ? '#a855f7' : 'var(--border)'}`,
                 borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                 fontSize: 11, color: activity.rpe ? '#a855f7' : 'var(--muted)' }}>
        💪 {activity.rpe ? `RPE ${activity.rpe}` : 'Set RPE'}
      </button>
    )
  }

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg)', borderRadius: 6,
                  border: '1px solid var(--border)', width: '100%' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        Rate of Perceived Exertion (1=very easy, 10=max effort)
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <input type="range" min="1" max="10" step="0.5" value={rpe}
          onChange={e => setRpe(e.target.value)}
          style={{ flex: 1, accentColor: '#a855f7' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700,
                       color: '#a855f7', minWidth: 24, textAlign: 'right' }}>{rpe}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10,
                    color: 'var(--muted)', marginBottom: 10 }}>
        <span>Easy</span><span>Moderate</span><span>Max</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={save} disabled={saving}
          style={{ flex: 1, padding: '5px 0', borderRadius: 4, background: '#a855f7',
                   color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save & estimate TSS'}
        </button>
        <button onClick={() => setOpen(false)}
          style={{ padding: '5px 10px', borderRadius: 4, background: 'transparent',
                   border: '1px solid var(--border)', color: 'var(--muted)',
                   fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function MarkPanel({ workout, onDone }) {
  const [tss, setTss] = useState(String(workout.actual_tss || workout.target_tss || ''))
  const [dur, setDur] = useState(String(workout.actual_duration_minutes || workout.target_duration_minutes || ''))
  const [saving, setSaving] = useState(false)

  const mark = async (completed) => {
    setSaving(true)
    await fetch(`/trainiq/planning/workouts/${workout.id}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completed,
        actual_tss: completed ? (parseFloat(tss) || null) : null,
        actual_duration_minutes: completed ? (parseInt(dur) || null) : null,
      }),
    })
    setSaving(false)
    onDone()
  }

  const unmark = async () => {
    setSaving(true)
    await fetch(`/trainiq/planning/workouts/${workout.id}/unmark`, { method: 'POST' })
    setSaving(false)
    onDone()
  }

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 6 }}>
      {workout.completed == null ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Mark as:</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input type="number" value={tss} onChange={e => setTss(e.target.value)}
              placeholder="TSS" style={{ width: 64, padding: '4px 8px', borderRadius: 4,
              border: '1px solid var(--border)', background: 'var(--surface2)',
              color: 'var(--text)', fontSize: 12 }} />
            <input type="number" value={dur} onChange={e => setDur(e.target.value)}
              placeholder="min" style={{ width: 56, padding: '4px 8px', borderRadius: 4,
              border: '1px solid var(--border)', background: 'var(--surface2)',
              color: 'var(--text)', fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" disabled={saving}
              onClick={() => mark(true)}
              style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4,
                       padding: '4px 10px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={12} /> Done
            </button>
            <button className="btn btn-sm" disabled={saving}
              onClick={() => mark(false)}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4,
                       padding: '4px 10px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <X size={12} /> Skipped
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {workout.completed ? `Done · ${workout.actual_tss || workout.target_tss || '?'} TSS · ${workout.actual_duration_minutes || workout.target_duration_minutes || '?'}min` : 'Skipped'}
          </span>
          <button onClick={unmark} disabled={saving}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4,
                     padding: '3px 8px', fontSize: 11, color: 'var(--muted)', cursor: 'pointer',
                     display: 'flex', alignItems: 'center', gap: 3 }}>
            <RotateCcw size={10} /> Reset
          </button>
        </div>
      )}
    </div>
  )
}

// ── FTP / Weight entry panel ────────────────────────────────────────────
function FtpWeightPanel({ date, onDone }) {
  const [mode, setMode] = useState('ftp') // 'ftp' | 'weight'
  const [ftp, setFtp] = useState('')
  const [weight, setWeight] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const dateStr = format(date, 'yyyy-MM-dd')
    setSaving(true)
    if (mode === 'ftp') {
      if (!ftp) { setSaving(false); return }
      await fetch('/trainiq/ftp-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr, ftp: parseFloat(ftp), notes: notes || null }),
      })
    } else {
      if (!weight) { setSaving(false); return }
      await fetch('/trainiq/weight-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr, weight_kg: parseFloat(weight) }),
      })
    }
    setSaving(false)
    onDone()
  }

  return (
    <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg)', borderRadius: 6,
                  border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button onClick={() => setMode('ftp')}
          style={{ flex: 1, padding: '5px 0', borderRadius: 4, cursor: 'pointer', fontSize: 12,
            background: mode === 'ftp' ? 'rgba(249,115,22,0.15)' : 'var(--surface2)',
            border: `1px solid ${mode === 'ftp' ? 'var(--accent)' : 'var(--border)'}`,
            color: mode === 'ftp' ? 'var(--accent)' : 'var(--muted)' }}>
          ⚡ FTP
        </button>
        <button onClick={() => setMode('weight')}
          style={{ flex: 1, padding: '5px 0', borderRadius: 4, cursor: 'pointer', fontSize: 12,
            background: mode === 'weight' ? 'rgba(59,130,246,0.15)' : 'var(--surface2)',
            border: `1px solid ${mode === 'weight' ? '#3b82f6' : 'var(--border)'}`,
            color: mode === 'weight' ? '#3b82f6' : 'var(--muted)' }}>
          ⚖️ Weight
        </button>
      </div>

      {mode === 'ftp' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input type="number" value={ftp} onChange={e => setFtp(e.target.value)}
            placeholder="FTP (W)" style={{ padding: '5px 8px', borderRadius: 4,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', fontSize: 12 }} />
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional, e.g. 'FTP test')" style={{ padding: '5px 8px', borderRadius: 4,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', fontSize: 12 }} />
        </div>
      ) : (
        <input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)}
          placeholder="Weight (kg)" style={{ width: '100%', padding: '5px 8px', borderRadius: 4,
          border: '1px solid var(--border)', background: 'var(--surface2)',
          color: 'var(--text)', fontSize: 12, boxSizing: 'border-box' }} />
      )}

      <button onClick={save} disabled={saving || (mode === 'ftp' ? !ftp : !weight)}
        style={{ marginTop: 8, width: '100%', padding: '5px 0', borderRadius: 4,
                 background: mode === 'ftp' ? 'var(--accent)' : '#3b82f6',
                 color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer',
                 opacity: (mode === 'ftp' ? !ftp : !weight) ? 0.4 : 1 }}>
        {saving ? 'Saving…' : `Save ${mode === 'ftp' ? 'FTP' : 'weight'} entry`}
      </button>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
        Effective from this date forward, until the next entry.
      </div>
    </div>
  )
}

// ── Add manual activity panel ──────────────────────────────────────────
function AddActivityPanel({ date, onDone }) {
  const [title, setTitle] = useState('')
  const [tss, setTss] = useState('')
  const [dur, setDur] = useState('')
  const [type, setType] = useState('Ride')
  const [commute, setCommute] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    if (!tss || !dur) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/trainiq/planning/workouts/add-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: format(date, 'yyyy-MM-dd') + 'T12:00:00',
          title: title || (commute ? 'Commute' : 'Manual activity'),
          tss: parseFloat(tss),
          duration_minutes: parseInt(dur),
          sport_type: type,
          commute,
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Server returned ${res.status}: ${body.slice(0, 150)}`)
      }
      onDone()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg)', borderRadius: 6,
                  border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>
        Add manual activity
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Title (optional)"
          style={{ padding: '5px 8px', borderRadius: 4, border: '1px solid var(--border)',
                   background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="number" value={tss} onChange={e => setTss(e.target.value)}
            placeholder="TSS" style={{ flex: 1, padding: '5px 8px', borderRadius: 4,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', fontSize: 12 }} />
          <input type="number" value={dur} onChange={e => setDur(e.target.value)}
            placeholder="min" style={{ flex: 1, padding: '5px 8px', borderRadius: 4,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', fontSize: 12 }} />
        </div>
        <select value={type} onChange={e => setType(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 4, border: '1px solid var(--border)',
                   background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }}>
          <option value="Ride">Ride</option>
          <option value="VirtualRide">Indoor ride</option>
          <option value="Run">Run</option>
          <option value="Walk">Walk</option>
          <option value="Other">Other</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                        color: 'var(--text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={commute} onChange={e => setCommute(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: 'var(--accent)' }} />
          Mark as commute
        </label>
        <button onClick={save} disabled={saving || !tss || !dur}
          style={{ padding: '5px 0', borderRadius: 4, background: 'var(--accent)',
                   color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer',
                   opacity: (!tss || !dur) ? 0.4 : 1 }}>
          {saving ? 'Saving…' : 'Add activity'}
        </button>
        {error && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>{error}</div>
        )}
      </div>
    </div>
  )
}

// ── Main Calendar ──────────────────────────────────────────────────────
export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [calData, setCalData] = useState({ activities: [], planned: [] })
  const [ftpHistory, setFtpHistory] = useState([])
  const [weightHistory, setWeightHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [showAddPanel, setShowAddPanel] = useState(false)

  const load = () => {
    setLoading(true)
    const y = currentDate.getFullYear()
    const m = currentDate.getMonth() + 1
    Promise.all([
      fetch(`/trainiq/activities/calendar?year=${y}&month=${m}`).then(r => r.json()).catch(() => ({ activities: [], planned: [] })),
      fetch('/trainiq/ftp-history').then(r => r.json()).catch(() => []),
      fetch('/trainiq/weight-history').then(r => r.json()).catch(() => []),
    ]).then(([cal, ftpH, weightH]) => {
      setCalData(cal)
      setFtpHistory(Array.isArray(ftpH) ? ftpH : [])
      setWeightHistory(Array.isArray(weightH) ? weightH : [])
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [currentDate])

  const monthStart = startOfMonth(currentDate)
  const monthEnd   = endOfMonth(currentDate)
  const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd     = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days       = eachDayOfInterval({ start: calStart, end: calEnd })

  const activitiesByDay = {}
  calData.activities.forEach(a => {
    const key = a.start_date.slice(0, 10)
    if (!activitiesByDay[key]) activitiesByDay[key] = []
    activitiesByDay[key].push(a)
  })

  const plannedByDay = {}
  calData.planned.forEach(p => {
    const key = p.date.slice(0, 10)
    if (!plannedByDay[key]) plannedByDay[key] = []
    plannedByDay[key].push(p)
  })

  const ftpByDay = {}
  ftpHistory.forEach(f => { ftpByDay[f.date] = f })
  const weightByDay = {}
  weightHistory.forEach(w => { weightByDay[w.date] = w })

  const prev = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const next = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  const selectedKey      = selected ? format(selected, 'yyyy-MM-dd') : null
  const selectedActivities = selectedKey ? (activitiesByDay[selectedKey] || []) : []
  const selectedPlanned    = selectedKey ? (plannedByDay[selectedKey] || []) : []

  const refresh = () => { load(); setShowAddPanel(false) }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Training Calendar</h1>
          <p className="page-subtitle">Completed activities & planned workouts</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={prev}><ChevronLeft size={16} /></button>
          <span style={{ fontWeight: 700, fontSize: 16, minWidth: 140, textAlign: 'center' }}>
            {format(currentDate, 'MMMM yyyy')}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={next}><ChevronRight size={16} /></button>
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--muted)', padding: 20 }}>Loading…</div> : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* Calendar grid */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 11,
                  color: 'var(--muted)', padding: '4px 0', fontWeight: 600 }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
              {days.map(day => {
                const key   = format(day, 'yyyy-MM-dd')
                const acts  = activitiesByDay[key] || []
                const plans = plannedByDay[key] || []
                const isSelected = selected && format(selected, 'yyyy-MM-dd') === key
                const inMonth = isSameMonth(day, currentDate)

                return (
                  <div key={key}
                    onClick={() => { setSelected(day); setShowAddPanel(false) }}
                    style={{
                      minHeight: 72, borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                      background: isSelected ? 'var(--surface2)' : 'var(--card)',
                      border: isToday(day) ? '1px solid var(--accent)' : '1px solid var(--border)',
                      opacity: inMonth ? 1 : 0.35,
                      transition: 'background 0.1s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: isToday(day) ? 700 : 400,
                        color: isToday(day) ? 'var(--accent)' : 'var(--muted)' }}>
                        {format(day, 'd')}
                      </span>
                      <span style={{ display: 'flex', gap: 2 }}>
                        {ftpByDay[key] && (
                          <span title={`FTP: ${ftpByDay[key].ftp}W`} style={{ fontSize: 9, color: 'var(--accent)' }}>⚡</span>
                        )}
                        {weightByDay[key] && (
                          <span title={`Weight: ${weightByDay[key].weight_kg}kg`} style={{ fontSize: 9, color: '#3b82f6' }}>⚖️</span>
                        )}
                      </span>
                    </div>
                    {acts.map(a => (
                      <div key={a.id} className={`calendar-activity-pill ${SPORT_PILL(a.sport_type)}`}
                        style={{ fontSize: 10, padding: '1px 5px', marginBottom: 2,
                          borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden',
                          textOverflow: 'ellipsis' }}>
                        {a.name.length > 14 ? a.name.slice(0, 14) + '…' : a.name}
                      </div>
                    ))}
                    {plans.map(p => (
                      <div key={p.id} style={{
                        fontSize: 10, padding: '1px 5px', marginBottom: 2,
                        borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        background: p.completed === true  ? 'rgba(34,197,94,0.15)'
                                  : p.completed === false ? 'rgba(239,68,68,0.15)'
                                  : 'rgba(249,115,22,0.12)',
                        color: p.completed === true  ? '#22c55e'
                             : p.completed === false ? '#ef4444'
                             : 'var(--accent)',
                        border: `1px dashed ${
                          p.completed === true  ? '#22c55e44'
                        : p.completed === false ? '#ef444444'
                        : 'rgba(249,115,22,0.3)'}`,
                      }}>
                        {p.completed === true ? '✓ ' : p.completed === false ? '✗ ' : '📋 '}
                        {p.title.length > 12 ? p.title.slice(0, 12) + '…' : p.title}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ width: 290, flexShrink: 0 }}>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div className="card-title" style={{ margin: 0 }}>{format(selected, 'EEEE d MMM')}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => { setShowAddPanel(v => v === 'activity' ? false : 'activity') }}
                      title="Add activity"
                      style={{ background: showAddPanel === 'activity' ? 'rgba(249,115,22,0.15)' : 'var(--surface2)',
                               border: '1px solid var(--border)',
                               borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: 'var(--muted)',
                               display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <Plus size={12} /> Activity
                    </button>
                    <button onClick={() => { setShowAddPanel(v => v === 'ftp' ? false : 'ftp') }}
                      title="Add FTP or weight entry"
                      style={{ background: showAddPanel === 'ftp' ? 'rgba(249,115,22,0.15)' : 'var(--surface2)',
                               border: '1px solid var(--border)',
                               borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: 'var(--muted)',
                               display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <Plus size={12} /> FTP/Wt
                    </button>
                  </div>
                </div>

                {showAddPanel === 'activity' && (
                  <AddActivityPanel date={selected} onDone={refresh} />
                )}
                {showAddPanel === 'ftp' && (
                  <FtpWeightPanel date={selected} onDone={refresh} />
                )}

                {(ftpByDay[selectedKey] || weightByDay[selectedKey]) && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                    {ftpByDay[selectedKey] && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                        background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)',
                        borderRadius: 6, padding: '4px 10px', fontSize: 12, color: 'var(--accent)' }}>
                        ⚡ FTP {ftpByDay[selectedKey].ftp}W
                        <button onClick={async () => {
                          await fetch(`/trainiq/ftp-history/${ftpByDay[selectedKey].id}`, { method: 'DELETE' })
                          refresh()
                        }} style={{ background: 'none', border: 'none', color: 'var(--accent)',
                          cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                      </div>
                    )}
                    {weightByDay[selectedKey] && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                        background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
                        borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#3b82f6' }}>
                        ⚖️ {weightByDay[selectedKey].weight_kg}kg
                        <button onClick={async () => {
                          await fetch(`/trainiq/weight-history/${weightByDay[selectedKey].id}`, { method: 'DELETE' })
                          refresh()
                        }} style={{ background: 'none', border: 'none', color: '#3b82f6',
                          cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                      </div>
                    )}
                  </div>
                )}

                {selectedActivities.length === 0 && selectedPlanned.length === 0 && !showAddPanel && (
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>No activities planned or recorded.</div>
                )}

                {/* Actual activities */}
                {selectedActivities.map(a => (
                  <div key={a.id} style={{ background: 'var(--surface2)', borderRadius: 8,
                    padding: '12px 14px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{a.name}</div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        {a.synthetic && <span style={{ fontSize: 10, color: 'var(--muted)',
                          background: 'var(--bg)', padding: '2px 5px', borderRadius: 3 }}>synthetic</span>}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                      {[
                        ['Time', `${Math.round(a.moving_time / 60)}min`],
                        a.distance > 0 && ['Dist', formatDistance(a.distance)],
                        a.average_watts && ['Power', `${a.average_watts?.toFixed(0)}W`],
                        a.tss && ['TSS', `${a.tss?.toFixed(0)}${a.tss_source === 'rpe' ? ' (RPE)' : ''}`],
                        a.average_heartrate && ['HR', `${a.average_heartrate?.toFixed(0)}bpm`],
                      ].filter(Boolean).map(([label, value]) => (
                        <div key={label}>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {!a.average_watts && !a.average_heartrate && (
                        <RpePanel activity={a} onDone={refresh} />
                      )}
                      <button
                        onClick={async () => {
                          await fetch(`/trainiq/activities/${a.id}/toggle-commute`, { method: 'POST' })
                          refresh()
                        }}
                        style={{ background: a.commute ? 'rgba(249,115,22,0.15)' : 'var(--bg)',
                                 border: `1px solid ${a.commute ? 'var(--accent)' : 'var(--border)'}`,
                                 borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                                 fontSize: 11, color: a.commute ? 'var(--accent)' : 'var(--muted)' }}>
                        🚲 {a.commute ? 'Commute ✓' : 'Set commute'}
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete "${a.name}"? This cannot be undone.`)) return
                          await fetch(`/trainiq/activities/${a.id}`, { method: 'DELETE' })
                          refresh()
                        }}
                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                                 borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                                 fontSize: 11, color: '#ef4444' }}>
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                ))}

                {/* Planned workouts with mark controls */}
                {selectedPlanned.map(p => (
                  <div key={p.id} style={{
                    background: p.completed === true  ? 'rgba(34,197,94,0.06)'
                              : p.completed === false ? 'rgba(239,68,68,0.06)'
                              : 'rgba(249,115,22,0.06)',
                    border: `1px dashed ${
                      p.completed === true  ? '#22c55e55'
                    : p.completed === false ? '#ef444455'
                    : 'rgba(249,115,22,0.3)'}`,
                    borderRadius: 8, padding: '12px 14px', marginBottom: 10,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</div>
                      <StatusBadge completed={p.completed} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 4 }}>
                      {p.target_tss && (
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Target TSS</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{p.target_tss?.toFixed(0)}</div>
                        </div>
                      )}
                      {p.target_duration_minutes && (
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Duration</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{p.target_duration_minutes}min</div>
                        </div>
                      )}
                      {p.actual_tss && p.actual_tss !== p.target_tss && (
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Actual TSS</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#22c55e' }}>{p.actual_tss?.toFixed(0)}</div>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                      {p.workout_type}
                      {p.exported_to_garmin && <span style={{ marginLeft: 8, color: '#22c55e' }}>✓ Garmin</span>}
                    </div>
                    <MarkPanel workout={p} onDone={refresh} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
