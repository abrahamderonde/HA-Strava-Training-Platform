import { useState, useEffect } from 'react'
import { format, startOfWeek, addDays } from 'date-fns'
import { Target, Plus, Send, ChevronDown, ChevronUp, Dumbbell } from 'lucide-react'

const WORKOUT_COLORS = {
  endurance:  'var(--z2)',
  tempo:      'var(--z3)',
  threshold:  'var(--z4)',
  vo2max:     'var(--z5)',
  sprint:     'var(--z7)',
  recovery:   'var(--z1)',
  rest:       'var(--muted)',
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

export default function Planning() {
  const [goals, setGoals] = useState([])
  const [workouts, setWorkouts] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showNewGoal, setShowNewGoal] = useState(false)
  const [expandedWorkout, setExpandedWorkout] = useState(null)
  const [exportingId, setExportingId] = useState(null)

  const [weekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )

  const [newGoal, setNewGoal] = useState({
    event_name: '',
    event_date: '',
    event_distance_km: '',
    event_elevation_m: '',
    goal_description: '',
  })

  const [availableDays, setAvailableDays] = useState([0, 1, 2, 3, 5]) // Mon-Fri + Sat

  useEffect(() => {
    fetch('/api/goals').then(r => r.json()).then(setGoals)
    fetchWorkoutsForWeek()
  }, [])

  const fetchWorkoutsForWeek = () => {
    const from = format(weekStart, 'yyyy-MM-dd')
    const to   = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    fetch(`/api/planning/workouts?from_date=${from}&to_date=${to}`)
      .then(r => r.json())
      .then(setWorkouts)
  }

  const createGoal = async () => {
    setLoading(true)
    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newGoal),
    })
    const updated = await fetch('/api/goals').then(r => r.json())
    setGoals(updated)
    setShowNewGoal(false)
    setLoading(false)
  }

  const generateWeek = async () => {
    setGenerating(true)
    const activeGoal = goals.find(g => g.active)
    const res = await fetch('/api/planning/generate-week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week_start: format(weekStart, 'yyyy-MM-dd'),
        goal_id: activeGoal?.id,
        available_days: availableDays,
      }),
    })
    if (res.ok) {
      fetchWorkoutsForWeek()
    }
    setGenerating(false)
  }

  const exportToGarmin = async (workoutId) => {
    setExportingId(workoutId)
    await fetch(`/api/planning/export-to-garmin/${workoutId}`, { method: 'POST' })
    fetchWorkoutsForWeek()
    setExportingId(null)
  }

  const workoutByDay = {}
  workouts.forEach(w => {
    const dayIdx = new Date(w.date).getDay()
    const monIdx = dayIdx === 0 ? 6 : dayIdx - 1
    workoutByDay[monIdx] = w
  })

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Training Planning</h1>
        <p className="page-subtitle">AI-generated workouts based on your goal and current fitness</p>
      </div>

      {/* Active goal */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div className="card-title" style={{ margin: 0 }}>Training Goals</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowNewGoal(!showNewGoal)}>
            <Plus size={14} /> New Goal
          </button>
        </div>

        {showNewGoal && (
          <div style={{
            background: 'var(--surface2)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              {[
                ['event_name', 'Event name (e.g. Liège-Bastogne-Liège)', 'text'],
                ['event_date', 'Event date', 'date'],
                ['event_distance_km', 'Distance (km)', 'number'],
                ['event_elevation_m', 'Elevation (m)', 'number'],
              ].map(([field, placeholder, type]) => (
                <input
                  key={field}
                  type={type}
                  placeholder={placeholder}
                  value={newGoal[field]}
                  onChange={e => setNewGoal(g => ({ ...g, [field]: e.target.value }))}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    padding: '8px 12px',
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    width: '100%',
                  }}
                />
              ))}
            </div>
            <textarea
              placeholder="Describe your goal (e.g. 'Complete the full 150km route, target finishing time 5h30')"
              value={newGoal.goal_description}
              onChange={e => setNewGoal(g => ({ ...g, goal_description: e.target.value }))}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
                padding: '8px 12px',
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                width: '100%',
                height: 80,
                resize: 'vertical',
                marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={createGoal} disabled={loading}>
                {loading ? 'Creating…' : 'Create Goal'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewGoal(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {goals.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            No goals yet. Create one to start AI-powered training planning.
          </div>
        ) : (
          goals.map(g => (
            <div key={g.id} style={{
              background: g.active ? 'rgba(249,115,22,0.08)' : 'var(--surface2)',
              border: `1px solid ${g.active ? 'rgba(249,115,22,0.3)' : 'var(--border)'}`,
              borderRadius: 10,
              padding: '14px 16px',
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                    <Target size={14} style={{ display: 'inline', marginRight: 6, color: 'var(--accent)' }} />
                    {g.event_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(g.event_date).toLocaleDateString()} ·
                    {g.event_distance_km && ` ${g.event_distance_km}km`}
                    {g.event_elevation_m && ` · ${g.event_elevation_m}m elevation`}
                  </div>
                </div>
                {g.active && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    color: 'var(--accent)', background: 'rgba(249,115,22,0.15)',
                    padding: '3px 8px', borderRadius: 20
                  }}>Active</span>
                )}
              </div>
              {g.ai_plan_summary && (
                <div style={{
                  marginTop: 12, padding: '10px 12px',
                  background: 'var(--surface)',
                  borderRadius: 8, fontSize: 13, color: 'var(--muted)',
                  lineHeight: 1.6,
                }}>
                  {g.ai_plan_summary}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Week generator */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}>Week of {format(weekStart, 'd MMM yyyy')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Select available training days
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={generateWeek}
            disabled={generating || goals.length === 0}
          >
            <Dumbbell size={15} />
            {generating ? 'Generating…' : 'Generate with AI'}
          </button>
        </div>

        {/* Day availability toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {DAYS.map((day, i) => (
            <button
              key={i}
              onClick={() => setAvailableDays(days =>
                days.includes(i) ? days.filter(d => d !== i) : [...days, i]
              )}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: `1px solid ${availableDays.includes(i) ? 'var(--accent)' : 'var(--border)'}`,
                background: availableDays.includes(i) ? 'rgba(249,115,22,0.15)' : 'transparent',
                color: availableDays.includes(i) ? 'var(--accent)' : 'var(--muted)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--font-display)',
              }}
            >
              {day}
            </button>
          ))}
        </div>

        {/* Weekly schedule */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
          {DAYS.map((day, i) => {
            const w = workoutByDay[i]
            const dayDate = addDays(weekStart, i)
            return (
              <div key={i} style={{
                minHeight: 120,
                background: 'var(--surface2)',
                borderRadius: 8,
                padding: 10,
                border: `1px solid ${w ? WORKOUT_COLORS[w.workout_type] + '44' : 'var(--border)'}`,
              }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>
                  {day} {format(dayDate, 'd')}
                </div>
                {w ? (
                  <div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      color: WORKOUT_COLORS[w.workout_type],
                      marginBottom: 4,
                    }}>
                      {w.workout_type}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, marginBottom: 6 }}>
                      {w.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {w.target_duration_minutes && `${w.target_duration_minutes}min`}
                      {w.target_tss && ` · TSS ${w.target_tss}`}
                    </div>
                    {!w.exported_to_garmin ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 6, fontSize: 10, padding: '3px 8px' }}
                        onClick={() => exportToGarmin(w.id)}
                        disabled={exportingId === w.id}
                      >
                        <Send size={10} />
                        {exportingId === w.id ? '…' : 'Garmin'}
                      </button>
                    ) : (
                      <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 6 }}>
                        ✓ On Garmin
                      </div>
                    )}
                  </div>
                ) : availableDays.includes(i) ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
                    Training day — generate plan
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--border)' }}>Rest</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Workout detail list */}
      {workouts.length > 0 && (
        <div className="card">
          <div className="card-title">Workout Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workouts.map(w => (
              <div key={w.id} style={{
                background: 'var(--surface2)',
                borderRadius: 10,
                overflow: 'hidden',
                border: `1px solid var(--border)`,
              }}>
                <div
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedWorkout(expandedWorkout === w.id ? null : w.id)}
                >
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: WORKOUT_COLORS[w.workout_type],
                    flexShrink: 0,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{w.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {new Date(w.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {w.target_duration_minutes && ` · ${w.target_duration_minutes}min`}
                      {w.target_tss && ` · TSS ${w.target_tss}`}
                      {w.target_if && ` · IF ${w.target_if}`}
                    </div>
                  </div>
                  {expandedWorkout === w.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>

                {expandedWorkout === w.id && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '12px 0' }}>
                      {w.description}
                    </p>

                    {w.intervals?.length > 0 && (
                      <div className="interval-list">
                        {w.intervals.map((iv, idx) => (
                          <div key={idx} className="interval-row">
                            <span className="interval-type" style={{
                              color: iv.type === 'work' ? 'var(--accent)'
                                   : iv.type === 'warmup' || iv.type === 'cooldown' ? 'var(--z2)'
                                   : 'var(--muted)'
                            }}>
                              {iv.type}
                            </span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                              {iv.repeats > 1 ? `${iv.repeats}×` : ''}
                              {Math.floor(iv.duration_seconds / 60)}min
                              {iv.duration_seconds % 60 > 0 ? `${iv.duration_seconds % 60}s` : ''}
                            </span>
                            {iv.power_low && (
                              <span style={{ fontSize: 12, color: 'var(--accent)' }}>
                                {iv.power_low}–{iv.power_high}W
                              </span>
                            )}
                            {iv.rest_seconds > 0 && (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                                rest {Math.floor(iv.rest_seconds / 60)}min
                              </span>
                            )}
                            <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
                              {iv.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
