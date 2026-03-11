import { useState, useEffect } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         startOfWeek, endOfWeek, isSameMonth, isToday, isSameDay } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SPORT_PILL = type => {
  if (['Ride','VirtualRide','EBikeRide','MountainBikeRide','GravelRide'].includes(type)) return 'pill-ride'
  if (['Run','TrailRun'].includes(type)) return 'pill-run'
  return 'pill-other'
}

function formatDistance(m) {
  return m >= 1000 ? `${(m/1000).toFixed(0)}km` : `${m?.toFixed(0)}m`
}

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [calData, setCalData] = useState({ activities: [], planned: [] })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    setLoading(true)
    const y = currentDate.getFullYear()
    const m = currentDate.getMonth() + 1
    fetch(`/api/activities/calendar?year=${y}&month=${m}`)
      .then(r => r.json())
      .then(d => { setCalData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [currentDate])

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

  const prev = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const next = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  const selectedKey = selected ? format(selected, 'yyyy-MM-dd') : null
  const selectedActivities = selectedKey ? (activitiesByDay[selectedKey] || []) : []
  const selectedPlanned    = selectedKey ? (plannedByDay[selectedKey] || []) : []

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

      {loading ? (
        <div className="loading">Loading calendar…</div>
      ) : (
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ flex: 1 }}>
            {/* Day headers */}
            <div className="calendar-grid" style={{ marginBottom: 4 }}>
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} className="calendar-day-header">{d}</div>
              ))}
            </div>

            {/* Day cells */}
            <div className="calendar-grid">
              {days.map(day => {
                const key = format(day, 'yyyy-MM-dd')
                const acts = activitiesByDay[key] || []
                const plans = plannedByDay[key] || []
                const inMonth = isSameMonth(day, currentDate)
                const isSelected = selected && isSameDay(day, selected)

                return (
                  <div
                    key={key}
                    className={[
                      'calendar-cell',
                      !inMonth && 'other-month',
                      isToday(day) && 'today',
                    ].filter(Boolean).join(' ')}
                    style={isSelected ? { borderColor: 'var(--accent)', background: 'var(--surface2)' } : {}}
                    onClick={() => setSelected(isSameDay(day, selected) ? null : day)}
                  >
                    <div className="calendar-day-num">{format(day, 'd')}</div>
                    {acts.slice(0, 2).map(a => (
                      <div key={a.id} className={`calendar-activity-pill ${SPORT_PILL(a.sport_type)}`}>
                        {a.name.length > 18 ? a.name.slice(0, 18) + '…' : a.name}
                      </div>
                    ))}
                    {acts.length > 2 && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        +{acts.length - 2} more
                      </div>
                    )}
                    {plans.slice(0, 2).map(p => (
                      <div key={p.id} className="calendar-activity-pill pill-planned">
                        📋 {p.title.length > 16 ? p.title.slice(0, 16) + '…' : p.title}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ width: 280, flexShrink: 0 }}>
              <div className="card">
                <div className="card-title">{format(selected, 'EEEE d MMMM')}</div>

                {selectedActivities.length === 0 && selectedPlanned.length === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>No activities</div>
                )}

                {selectedActivities.map(a => (
                  <div key={a.id} style={{
                    background: 'var(--surface2)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: 10,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{a.name}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {[
                        ['Distance', formatDistance(a.distance)],
                        ['Time', `${Math.round(a.moving_time / 60)}min`],
                        a.average_watts && ['Avg Power', `${a.average_watts?.toFixed(0)}W`],
                        a.tss && ['TSS', a.tss?.toFixed(0)],
                        a.np && ['NP', `${a.np?.toFixed(0)}W`],
                        a.average_heartrate && ['Avg HR', `${a.average_heartrate?.toFixed(0)}bpm`],
                        ['Elevation', `${a.total_elevation_gain?.toFixed(0)}m`],
                        a.if_ && ['IF', a.if_?.toFixed(2)],
                      ].filter(Boolean).map(([label, value]) => (
                        <div key={label}>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {selectedPlanned.map(p => (
                  <div key={p.id} style={{
                    background: 'rgba(249,115,22,0.08)',
                    border: '1px dashed rgba(249,115,22,0.3)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: 10,
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                      Planned
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{p.title}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {p.target_tss && ['TSS', p.target_tss]}
                      {p.target_duration_minutes && (
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Duration</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{p.target_duration_minutes}min</div>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                      {p.workout_type}
                      {p.exported_to_garmin && (
                        <span style={{ marginLeft: 8, color: 'var(--green)' }}>✓ Garmin</span>
                      )}
                    </div>
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
