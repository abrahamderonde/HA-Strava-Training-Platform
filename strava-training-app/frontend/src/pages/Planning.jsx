import { useState, useEffect } from 'react'
import { addDays, startOfWeek, format, parseISO, addWeeks } from 'date-fns'
import { ChevronLeft, ChevronRight, RefreshCw, Zap, Download } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIME_OPTIONS = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180]
const COMMUTE_OPTIONS = [0, 10, 20, 30, 40, 50, 60]

function timeLabel(min) {
  if (!min) return '—'
  if (min < 60) return `${min}m`
  return `${Math.floor(min/60)}h${min%60 ? (min%60)+'m' : ''}`
}

export default function Planning() {
  const [goals, setGoals] = useState([])
  const [activeGoal, setActiveGoal] = useState(null)
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [daySettings, setDaySettings] = useState(null)
  const [workouts, setWorkouts] = useState([])
  const [generating, setGenerating] = useState(false)
  const [generatingGlobal, setGeneratingGlobal] = useState(false)
  const [status, setStatus] = useState(null)
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [weeklyHours, setWeeklyHours] = useState(8)
  const [newGoal, setNewGoal] = useState({
    event_name: '', event_date: '', event_distance_km: '',
    event_elevation_m: '', goal_description: '', weekly_hours: 8
  })

  useEffect(() => {
    loadGoals()
    loadWorkouts()
  }, [weekStart])

  const loadGoals = async () => {
    const res = await fetch('/trainiq/goals').then(r => r.json()).catch(() => [])
    setGoals(res)
    const active = res.find(g => g.active) || res[0]
    if (active) {
      setActiveGoal(active)
      setWeeklyHours(active.weekly_hours || 8)
      // Initialize day settings from last week or defaults
      if (!daySettings) {
        initDaySettings(active.last_week_settings)
      }
    }
  }

  const initDaySettings = (lastSettings) => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = format(addDays(weekStart, i), 'yyyy-MM-dd')
      const last = lastSettings?.find(s => {
        // match by day-of-week, not exact date
        const lastDate = new Date(s.date)
        return lastDate.getDay() === addDays(weekStart, i).getDay()
      })
      return {
        date,
        workout_minutes: last?.workout_minutes ?? 0,
        indoor: last?.indoor ?? false,
        commute_minutes: last?.commute_minutes ?? 0,
      }
    })
    setDaySettings(days)
  }

  const loadWorkouts = async () => {
    const from = format(weekStart, 'yyyy-MM-dd')
    const to = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    const res = await fetch(`/trainiq/planning/workouts?from_date=${from}&to_date=${to}`)
      .then(r => r.json()).catch(() => [])
    setWorkouts(res)
  }

  // Update day settings when week changes, preserving day-of-week pattern
  useEffect(() => {
    if (daySettings) {
      setDaySettings(days => days.map((d, i) => ({
        ...d,
        date: format(addDays(weekStart, i), 'yyyy-MM-dd')
      })))
    }
    loadWorkouts()
  }, [weekStart])

  const updateDay = (i, field, value) => {
    setDaySettings(days => days.map((d, idx) =>
      idx === i ? { ...d, [field]: value } : d
    ))
  }

  const generateGlobalPlan = async () => {
    if (!activeGoal) return
    setGeneratingGlobal(true)
    setStatus('Generating training plan...')
    try {
      const res = await fetch('/trainiq/planning/generate-global-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: activeGoal.id, weekly_hours: weeklyHours })
      })
      if (!res.ok) throw new Error(await res.text())
      setStatus('Global plan generated!')
      await loadGoals()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setGeneratingGlobal(false)
    }
  }

  const generateWeek = async () => {
    if (!activeGoal || !daySettings) return
    const trainingDays = daySettings.filter(d => d.workout_minutes > 0)
    if (trainingDays.length === 0) {
      setStatus('Select at least one workout day')
      return
    }
    setGenerating(true)
    setStatus('Generating workouts...')
    try {
      const res = await fetch('/trainiq/planning/generate-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_id: activeGoal.id,
          week_start: format(weekStart, 'yyyy-MM-dd'),
          day_settings: daySettings,
        })
      })
      if (!res.ok) throw new Error(await res.text())
      setStatus('Workouts generated!')
      await loadWorkouts()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const createGoal = async () => {
    const res = await fetch('/trainiq/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newGoal, weekly_hours: parseFloat(newGoal.weekly_hours) })
    })
    if (res.ok) {
      setShowGoalForm(false)
      setNewGoal({ event_name: '', event_date: '', event_distance_km: '', event_elevation_m: '', goal_description: '', weekly_hours: 8 })
      await loadGoals()
    }
  }

  const exportToGarmin = async (workoutId) => {
    setStatus('Exporting to Garmin...')
    const res = await fetch(`/trainiq/planning/export-to-garmin/${workoutId}`, { method: 'POST' })
    setStatus(res.ok ? 'Exported to Garmin!' : 'Garmin export failed — check log')
  }

  // Build global plan chart data
  const globalChartData = activeGoal?.global_plan?.phases?.flatMap(phase =>
    phase.weeks.map(w => ({
      week: `W${w.week_number}`,
      phase: w.phase,
      hours: w.target_hours,
      tss: w.target_tss,
      description: w.description,
    }))
  ) || []

  // Color per phase
  const phaseColor = { Base: '#3b82f6', Build: '#f97316', Peak: '#ef4444', Taper: '#22c55e' }

  const totalCommuteTSS = daySettings?.reduce((sum, d) => {
    return sum + ((d.commute_minutes / 60) * (0.65 ** 2) * 100)
  }, 0) || 0

  const totalWorkoutMinutes = daySettings?.reduce((sum, d) => sum + (d.workout_minutes || 0), 0) || 0

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Training Plan</h1>
          <p className="page-subtitle">AI-powered weekly planning</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowGoalForm(!showGoalForm)}>
          + New Goal
        </button>
      </div>

      {/* New goal form */}
      {showGoalForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-title">Create Training Goal</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['Event name', 'event_name', 'text', 'e.g. Amstel Gold Race'],
              ['Event date', 'event_date', 'date', ''],
              ['Distance (km)', 'event_distance_km', 'number', ''],
              ['Elevation (m)', 'event_elevation_m', 'number', ''],
              ['Target hours/week', 'weekly_hours', 'number', '8'],
            ].map(([label, key, type, placeholder]) => (
              <div key={key}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                <input type={type} value={newGoal[key]} placeholder={placeholder}
                  onChange={e => setNewGoal(g => ({ ...g, [key]: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div style={{ gridColumn: '1/-1' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Goal description</div>
              <input type="text" value={newGoal.goal_description} placeholder="e.g. Finish in the front group, target 4.5 W/kg"
                onChange={e => setNewGoal(g => ({ ...g, goal_description: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={createGoal}>Create Goal</button>
            <button className="btn btn-ghost" onClick={() => setShowGoalForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Active goal */}
      {activeGoal && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div className="card-title">{activeGoal.event_name}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {new Date(activeGoal.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {activeGoal.event_distance_km && ` · ${activeGoal.event_distance_km}km`}
                  {activeGoal.event_elevation_m && ` · ${activeGoal.event_elevation_m}m`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Target h/week</div>
                <input type="number" value={weeklyHours} min="2" max="30" step="0.5"
                  onChange={e => setWeeklyHours(parseFloat(e.target.value))}
                  style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, textAlign: 'center' }}
                />
                <button className="btn btn-ghost btn-sm" onClick={generateGlobalPlan} disabled={generatingGlobal}>
                  <RefreshCw size={13} />
                  {generatingGlobal ? 'Generating...' : 'Generate Plan'}
                </button>
              </div>
            </div>
            {activeGoal.ai_plan_summary && (
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 14, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8 }}>
                {activeGoal.ai_plan_summary}
              </div>
            )}

            {/* Global plan chart */}
            {globalChartData.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Weekly training load plan</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={globalChartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                      formatter={(val, name) => [name === 'hours' ? `${val}h` : val, name === 'hours' ? 'Hours' : 'TSS']}
                      labelFormatter={(label, payload) => {
                        const item = payload?.[0]?.payload
                        return item ? `${label} · ${item.phase} — ${item.description}` : label
                      }}
                    />
                    <Bar dataKey="hours" fill="#3b82f6" radius={[3, 3, 0, 0]} opacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
                {/* Phase legend */}
                <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                  {Object.entries(phaseColor).map(([phase, color]) => (
                    globalChartData.some(d => d.phase === phase) && (
                      <span key={phase} style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
                        {phase}
                      </span>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Week navigator + day settings */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(d => addDays(d, -7))}>
                <ChevronLeft size={16} />
              </button>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                Week of {format(weekStart, 'd MMM')} — {format(addDays(weekStart, 6), 'd MMM yyyy')}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(d => addDays(d, 7))}>
                <ChevronRight size={16} />
              </button>
            </div>

            {daySettings && (
              <>
                {/* Day settings table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 500 }}>Day</th>
                        <th style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--muted)', fontWeight: 500 }}>Workout</th>
                        <th style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--muted)', fontWeight: 500 }}>Indoor</th>
                        <th style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--muted)', fontWeight: 500 }}>Commute</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daySettings.map((d, i) => {
                        const date = addDays(weekStart, i)
                        const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                        const commuteTSS = d.commute_minutes ? ((d.commute_minutes / 60) * (0.65 ** 2) * 100).toFixed(0) : 0
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isToday ? 'rgba(249,115,22,0.04)' : 'transparent' }}>
                            <td style={{ padding: '8px 8px' }}>
                              <div style={{ fontWeight: isToday ? 700 : 400 }}>{DAY_NAMES[i]}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{format(date, 'd MMM')}</div>
                            </td>
                            <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                              <select value={d.workout_minutes}
                                onChange={e => updateDay(i, 'workout_minutes', parseInt(e.target.value))}
                                style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }}>
                                {TIME_OPTIONS.map(t => <option key={t} value={t}>{timeLabel(t)}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                              {d.workout_minutes > 0 ? (
                                <button
                                  onClick={() => updateDay(i, 'indoor', !d.indoor)}
                                  style={{
                                    padding: '3px 10px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                                    background: d.indoor ? 'rgba(59,130,246,0.2)' : 'rgba(34,197,94,0.15)',
                                    color: d.indoor ? '#3b82f6' : '#22c55e',
                                  }}>
                                  {d.indoor ? 'Indoor' : 'Outdoor'}
                                </button>
                              ) : <span style={{ color: 'var(--border)' }}>—</span>}
                            </td>
                            <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                              <select value={d.commute_minutes}
                                onChange={e => updateDay(i, 'commute_minutes', parseInt(e.target.value))}
                                style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }}>
                                {COMMUTE_OPTIONS.map(t => <option key={t} value={t}>{t ? `${t}m (~${Math.round((t/60)*(0.65**2)*100)} TSS)` : '—'}</option>)}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary + generate button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {totalWorkoutMinutes ? `${timeLabel(totalWorkoutMinutes)} training` : 'No workouts selected'}
                    {totalCommuteTSS > 0 && ` · ${totalCommuteTSS.toFixed(0)} TSS commutes`}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {status && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{status}</span>}
                    <button className="btn btn-primary" onClick={generateWeek} disabled={generating || totalWorkoutMinutes === 0}>
                      <Zap size={13} />
                      {generating ? 'Generating...' : 'Generate Workouts'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Generated workouts */}
          {workouts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {workouts.map(w => {
                const dateObj = new Date(w.date)
                const dayName = DAY_NAMES[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1]
                const typeColor = {
                  endurance: '#3b82f6', threshold: '#f97316',
                  vo2max: '#ef4444', recovery: '#22c55e', race: '#a855f7'
                }[w.workout_type] || 'var(--muted)'
                return (
                  <div key={w.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                            {dayName} {dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </span>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${typeColor}22`, color: typeColor, fontWeight: 600 }}>
                            {w.workout_type}
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{w.title}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>{w.target_tss}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>TSS</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>{w.target_duration_minutes}m</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>duration</div>
                        </div>
                        <a href={`/trainiq/planning/download-fit/${w.id}`} download
                          style={{ textDecoration: 'none' }}>
                          <button className="btn btn-ghost btn-sm" title="Download FIT file for manual Garmin import">
                            <Download size={13} />
                            .fit
                          </button>
                        </a>
                        <button className="btn btn-ghost btn-sm" onClick={() => exportToGarmin(w.id)}
                          title="Export to Garmin Connect" disabled={w.exported_to_garmin}>
                          <Download size={13} />
                          {w.exported_to_garmin ? 'Exported' : 'Garmin'}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>{w.description}</div>
                  </div>
                )
              })}
            </div>
          )}

          {workouts.length === 0 && !generating && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 20px', fontSize: 14 }}>
              No workouts for this week yet — set your schedule above and click Generate Workouts.
            </div>
          )}
        </>
      )}

      {!activeGoal && !showGoalForm && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No training goal set</div>
          <div style={{ fontSize: 14, marginBottom: 20 }}>Create a goal to start generating workouts</div>
          <button className="btn btn-primary" onClick={() => setShowGoalForm(true)}>+ Create Goal</button>
        </div>
      )}
    </div>
  )
}
