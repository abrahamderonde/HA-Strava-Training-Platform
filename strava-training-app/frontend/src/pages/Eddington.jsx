import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, Line, ComposedChart
} from 'recharts'
import { Award } from 'lucide-react'

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>≥ {d.km} km days</div>
      <div style={{ color: d.achieved ? 'var(--accent)' : 'var(--muted)' }}>
        {d.days} days {d.achieved ? '✓' : `(need ${d.km})`}
      </div>
      {!d.achieved && (
        <div style={{ fontSize: 11, color: 'var(--accent2)', marginTop: 4 }}>
          {d.km - d.days} more rides of ≥{d.km} km needed
        </div>
      )}
    </div>
  )
}

export default function Eddington() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showRange, setShowRange] = useState('next20') // 'next20' | 'all' | 'top50'

  useEffect(() => {
    fetch('/trainiq/eddington')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Calculating Eddington number…</div>
  if (!data) return <div className="empty-state">No cycling data available</div>

  const { e, next_e, rides_needed, total_riding_days, histogram, top_days } = data

  // Progress toward next_e from last milestone
  // How many rides of >=next_e do we already have?
  const ridesHave = next_e - rides_needed
  const progressPct = Math.round((ridesHave / next_e) * 100)

  // Add n=n reference data to histogram
  const histWithRef = histogram.map(d => ({
    ...d,
    target: d.km, // the n=n line — always equals km
    gap: Math.max(0, d.km - d.days), // gap between bar and target line
  }))

  // Filter histogram based on range selector
  const filteredHist = (() => {
    if (showRange === 'next20') return histWithRef.filter(d => d.km >= e - 5 && d.km <= e + 20)
    if (showRange === 'top50') return histWithRef.filter(d => d.km >= e - 10).slice(0, 60)
    return histWithRef
  })()

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Eddington Number</h1>
        <p className="page-subtitle">E = largest N where you've cycled ≥ N km on at least N days</p>
      </div>

      {/* Hero */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '28px 32px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 36, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center', minWidth: 100 }}>
          <Award size={36} style={{ color: 'var(--accent)', margin: '0 auto 6px' }} />
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
            {e}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Eddington Number</div>
        </div>

        <div style={{ flex: 1, minWidth: 260 }}>
          {/* Progress toward next E */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>Progress toward E{next_e}</span>
              <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>
                {ridesHave} / {next_e} rides
              </span>
            </div>
            <div style={{ height: 10, background: 'var(--surface2)', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`,
                background: 'linear-gradient(90deg, var(--accent2), var(--accent))',
                borderRadius: 5, transition: 'width 1s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                {rides_needed > 0
                  ? `${rides_needed} more ride${rides_needed > 1 ? 's' : ''} of ≥${next_e} km to reach E${next_e}`
                  : `E${next_e} achieved! 🎉`}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{progressPct}%</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {[
              ['Total riding days', total_riding_days],
              ['Longest day', top_days?.[0] ? `${top_days[0]} km` : '—'],
              ['Top 5 avg', top_days?.length >= 5 ? `${(top_days.slice(0,5).reduce((a,b)=>a+b,0)/5).toFixed(0)} km` : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>Distance Frequency</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Orange bars = achieved · Grey line = target (n=n) · Gap shows what's still needed
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['next20', `E${e} ± 20`], ['top50', 'Zoom out'], ['all', 'All']].map(([key, label]) => (
              <button key={key} onClick={() => setShowRange(key)}
                style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid', fontSize: 11, cursor: 'pointer',
                  borderColor: showRange === key ? 'var(--accent)' : 'var(--border)',
                  background: showRange === key ? 'rgba(249,115,22,0.15)' : 'transparent',
                  color: showRange === key ? 'var(--accent)' : 'var(--muted)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={filteredHist} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="km" tickFormatter={v => `${v}km`}
              tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false}
              interval={showRange === 'all' ? 9 : 1}
            />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />

            {/* Current E reference */}
            <ReferenceLine x={e} stroke="var(--accent)" strokeDasharray="4 2"
              label={{ value: `E${e}`, fill: 'var(--accent)', fontSize: 11, position: 'top' }} />
            {/* Next E reference */}
            <ReferenceLine x={next_e} stroke="var(--accent2)" strokeDasharray="4 2"
              label={{ value: `E${next_e}?`, fill: 'var(--accent2)', fontSize: 11, position: 'top' }} />

            {/* Bars */}
            <Bar dataKey="days" radius={[3, 3, 0, 0]} maxBarSize={28}>
              {filteredHist.map((entry, i) => (
                <Cell key={i}
                  fill={entry.achieved
                    ? entry.km <= e ? 'var(--accent)' : 'var(--accent2)'
                    : '#2d3748'}
                  opacity={entry.achieved ? 0.9 : 0.6}
                />
              ))}
            </Bar>

            {/* n=n reference line */}
            <Line type="linear" dataKey="target" stroke="#ef4444" strokeWidth={2}
              dot={false} strokeDasharray="3 3"
              name="Target (n=n)"
            />
          </ComposedChart>
        </ResponsiveContainer>

        <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
          <span><span style={{ color: 'var(--accent)' }}>■</span> Achieved (E{e})</span>
          <span><span style={{ color: 'var(--accent2)' }}>■</span> Counts toward E{next_e}</span>
          <span><span style={{ color: '#2d3748', background: '#2d3748', display: 'inline-block', width: 10, height: 10, border: '1px solid #4b5563' }} /></span>
          Not yet
          <span><span style={{ color: '#ef4444' }}>- - -</span> Target line (bars must reach this)</span>
        </div>
      </div>

      {/* Top days */}
      {top_days?.length > 0 && (
        <div className="card">
          <div className="card-title">Your Longest Days</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {top_days.slice(0, 30).map((km, i) => (
              <div key={i} style={{
                fontFamily: 'var(--font-mono)', fontSize: 13,
                padding: '5px 12px', borderRadius: 20,
                background: km >= next_e ? 'rgba(249,115,22,0.15)' : km >= e ? 'rgba(59,130,246,0.15)' : 'var(--surface2)',
                color: km >= next_e ? 'var(--accent)' : km >= e ? 'var(--accent2)' : 'var(--muted)',
                border: `1px solid ${km >= next_e ? 'rgba(249,115,22,0.3)' : 'var(--border)'}`,
              }}>
                {km} km
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
