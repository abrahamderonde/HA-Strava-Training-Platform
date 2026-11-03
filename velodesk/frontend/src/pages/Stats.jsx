import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from 'recharts'

// Distinct colors for up to 8 years
const YEAR_COLORS = [
  '#3b82f6', '#f97316', '#22c55e', '#a855f7',
  '#ef4444', '#eab308', '#06b6d4', '#f43f5e'
]

// Month labels for x-axis (week 1-52)
const WEEK_TO_MONTH = {
  1: 'Jan', 5: 'Feb', 9: 'Mar', 14: 'Apr', 18: 'May', 23: 'Jun',
  27: 'Jul', 31: 'Aug', 36: 'Sep', 40: 'Oct', 44: 'Nov', 49: 'Dec'
}

function weekLabel(week) {
  return WEEK_TO_MONTH[week] || ''
}

// Day-of-year labels
const DOY_TO_MONTH = { 1: 'Jan', 32: 'Feb', 60: 'Mar', 91: 'Apr', 121: 'May', 152: 'Jun', 182: 'Jul', 213: 'Aug', 244: 'Sep', 274: 'Oct', 305: 'Nov', 335: 'Dec' }
function doyLabel(doy) {
  const entries = Object.entries(DOY_TO_MONTH)
  for (let i = entries.length - 1; i >= 0; i--) {
    if (doy >= parseInt(entries[i][0])) return entries[i][1]
  }
  return ''
}

export default function Stats() {
  const [distanceData, setDistanceData] = useState({})
  const [pmcData, setPmcData] = useState([])
  const [excludeCommutes, setExcludeCommutes] = useState(false)
  const [excludeIndoor, setExcludeIndoor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeYears, setActiveYears] = useState(new Set())
  const [currentYear] = useState(new Date().getFullYear())

  useEffect(() => {
    loadAll()
  }, [excludeCommutes, excludeIndoor])

  const loadAll = async () => {
    setLoading(true)
    const [dist, pmc] = await Promise.all([
      fetch(`/trainiq/analytics/distance-by-year?exclude_commutes=${excludeCommutes}&exclude_indoor=${excludeIndoor}`)
        .then(r => r.json()).catch(() => ({})),
      fetch('/trainiq/analytics/pmc-all').then(r => r.json()).catch(() => []),
    ])
    setDistanceData(dist)
    setPmcData(pmc)

    // Default: show current year + previous year
    const years = Object.keys(dist).map(Number).sort()
    const defaultActive = new Set(years.slice(-2).map(String))
    setActiveYears(defaultActive)
    setLoading(false)
  }

  const toggleYear = (year) => {
    setActiveYears(prev => {
      const next = new Set(prev)
      if (next.has(year)) { if (next.size > 1) next.delete(year) }
      else next.add(year)
      return next
    })
  }

  // ── Distance chart data ──────────────────────────────────────────────────
  const allYears = Object.keys(distanceData).sort()
  const visibleYears = allYears.filter(y => activeYears.has(y))

  // Build unified week array 1-52
  const distChartData = Array.from({ length: 52 }, (_, i) => {
    const week = i + 1
    const point = { week, label: weekLabel(week) }
    for (const year of visibleYears) {
      const entry = distanceData[year]?.find(d => d.week === week)
      point[year] = entry?.km ?? null
    }
    return point
  })

  // Cumulative distance per year
  const cumulativeData = Array.from({ length: 52 }, (_, i) => {
    const week = i + 1
    const point = { week, label: weekLabel(week) }
    for (const year of visibleYears) {
      const weeks = distanceData[year] || []
      const cum = weeks.filter(d => d.week <= week).reduce((s, d) => s + d.km, 0)
      point[year] = cum > 0 ? Math.round(cum) : null
    }
    return point
  })

  // ── PMC year-over-year ───────────────────────────────────────────────────
  // Group PMC by year, reshape to day-of-year
  const pmcByYear = {}
  for (const entry of pmcData) {
    const dt = new Date(entry.date)
    const year = dt.getFullYear()
    const doy = Math.floor((dt - new Date(year, 0, 0)) / 86400000)
    if (!pmcByYear[year]) pmcByYear[year] = {}
    pmcByYear[year][doy] = entry.ctl
  }

  const pmcYears = Object.keys(pmcByYear).sort()
  const visiblePmcYears = pmcYears.filter(y => activeYears.has(y))

  // Build day-of-year array 1-365
  const pmcChartData = Array.from({ length: 365 }, (_, i) => {
    const doy = i + 1
    const point = { doy, label: doyLabel(doy) }
    for (const year of visiblePmcYears) {
      point[year] = pmcByYear[year]?.[doy] ?? null
    }
    // Reference band: is current year above/below last year?
    const cyear = String(currentYear)
    const pyear = String(currentYear - 1)
    if (visiblePmcYears.includes(cyear) && visiblePmcYears.includes(pyear)) {
      const cur = point[cyear]
      const prev = point[pyear]
      if (cur != null && prev != null) {
        point._diff = cur - prev
      }
    }
    return point
  })

  // Today's day of year for reference line
  const todayDoy = Math.floor((new Date() - new Date(currentYear, 0, 0)) / 86400000)

  const yearColor = (year, idx) => YEAR_COLORS[allYears.indexOf(year) % YEAR_COLORS.length]

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Training Stats</h1>
        <p className="page-subtitle">Multi-year distance progress and fitness comparison</p>
      </div>

      {/* Year selector */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {allYears.map(year => (
              <button key={year} onClick={() => toggleYear(year)}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: '2px solid',
                  borderColor: activeYears.has(year) ? yearColor(year) : 'var(--border)',
                  background: activeYears.has(year) ? `${yearColor(year)}22` : 'transparent',
                  color: activeYears.has(year) ? yearColor(year) : 'var(--muted)',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}>
                {year}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--muted)' }}>
              <input type="checkbox" checked={excludeCommutes} onChange={e => setExcludeCommutes(e.target.checked)} />
              Exclude commutes
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--muted)' }}>
              <input type="checkbox" checked={excludeIndoor} onChange={e => setExcludeIndoor(e.target.checked)} />
              Exclude indoor
            </label>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading...</div>
      ) : (
        <>
          {/* ── Cumulative distance ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">Cumulative Distance by Year</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>km ridden from Jan 1 — shows if you're ahead or behind previous years</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={cumulativeData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }}
                  ticks={Object.keys(WEEK_TO_MONTH).map(Number)}
                  tickFormatter={(_, i) => cumulativeData[i]?.label || ''}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="km" />
                <Tooltip
                  contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, name) => [v ? `${v} km` : '—', name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {visibleYears.map(year => (
                  <Line key={year} type="monotone" dataKey={year}
                    stroke={yearColor(year)}
                    strokeWidth={year === String(currentYear) ? 2.5 : 1.5}
                    dot={false} connectNulls
                    strokeDasharray={year === String(currentYear) ? undefined : undefined}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── Weekly distance ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">Weekly Distance by Year</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={distChartData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }}
                  ticks={Object.keys(WEEK_TO_MONTH).map(Number)}
                  tickFormatter={(_, i) => distChartData[i]?.label || ''}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="km" />
                <Tooltip
                  contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, name) => [v ? `${v} km` : '—', name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {visibleYears.map(year => (
                  <Bar key={year} dataKey={year} fill={yearColor(year)} opacity={0.8} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Year-over-year CTL ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">Fitness (CTL) by Year</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              42-day chronic training load — compare fitness trajectory across years
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={pmcChartData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label"
                  ticks={Object.keys(DOY_TO_MONTH).map(Number)}
                  tickFormatter={(_, i) => pmcChartData[i]?.label || ''}
                  tick={{ fontSize: 11, fill: 'var(--muted)' }}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, name) => [v ? v.toFixed(1) : '—', `CTL ${name}`]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine x={todayDoy} stroke="var(--muted)" strokeDasharray="4 4"
                  label={{ value: 'Today', position: 'top', fontSize: 10, fill: 'var(--muted)' }} />
                {visiblePmcYears.map(year => (
                  <Line key={year} type="monotone" dataKey={year}
                    stroke={yearColor(year)}
                    strokeWidth={year === String(currentYear) ? 2.5 : 1.5}
                    dot={false} connectNulls
                    opacity={year === String(currentYear) ? 1 : 0.65}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>

            {/* Ahead/behind indicator */}
            {activeYears.has(String(currentYear)) && activeYears.has(String(currentYear - 1)) && (() => {
              const today = pmcChartData[todayDoy - 1]
              const cur = today?.[String(currentYear)]
              const prev = today?.[String(currentYear - 1)]
              if (!cur || !prev) return null
              const diff = cur - prev
              const ahead = diff >= 0
              return (
                <div style={{ marginTop: 12, padding: '8px 14px', borderRadius: 8, display: 'inline-block',
                  background: ahead ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${ahead ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  color: ahead ? '#22c55e' : '#ef4444', fontSize: 13 }}>
                  {ahead ? '▲' : '▼'} {Math.abs(diff).toFixed(1)} CTL {ahead ? 'ahead of' : 'behind'} {currentYear - 1} at this point
                </div>
              )
            })()}
          </div>
        </>
      )}
    </div>
  )
}
