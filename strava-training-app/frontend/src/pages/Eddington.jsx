import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts'
import { Award } from 'lucide-react'

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 13,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>≥ {d.km} km days</div>
      <div style={{ color: d.achieved ? 'var(--green)' : 'var(--muted)' }}>
        {d.days} days (need {d.needed})
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        {d.achieved ? '✓ Achieved' : `${d.needed - d.days} more needed`}
      </div>
    </div>
  )
}

export default function Eddington() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/trainiq/eddington')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Calculating Eddington number…</div>
  if (!data) return <div className="empty-state">No cycling data available</div>

  const { e, next_e, rides_needed, total_riding_days, histogram, top_days } = data

  // Progress toward next E
  const progressPct = next_e > 0
    ? Math.round(((next_e - rides_needed) / next_e) * 100)
    : 100

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Eddington Number</h1>
        <p className="page-subtitle">
          E = largest N where you've cycled ≥ N km on at least N days
        </p>
      </div>

      {/* E number hero */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '32px 36px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 40,
      }}>
        <div style={{ textAlign: 'center' }}>
          <Award size={40} style={{ color: 'var(--accent)', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 80, fontWeight: 800, lineHeight: 1, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
            {e}
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            Eddington Number
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>Progress toward E = {next_e}</span>
              <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                {next_e - rides_needed}/{next_e} days
              </span>
            </div>
            <div style={{
              height: 10, background: 'var(--surface2)',
              borderRadius: 5, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, var(--accent2), var(--accent))',
                borderRadius: 5,
                transition: 'width 1s ease',
              }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 8, fontWeight: 600 }}>
              {rides_needed > 0
                ? `${rides_needed} more rides of ≥${next_e} km needed to reach E${next_e}`
                : `E${next_e} achieved! 🎉`}
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

      {/* Progress histogram */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Distance Frequency — Progress to E{next_e}</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={histogram} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="km"
              tickFormatter={v => `${v}km`}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickLine={false} axisLine={false}
              interval={4}
            />
            <YAxis
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickLine={false} axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine x={e} stroke="var(--accent)" strokeDasharray="4 2"
              label={{ value: `E${e}`, fill: 'var(--accent)', fontSize: 11, position: 'top' }}
            />
            <ReferenceLine x={next_e} stroke="var(--accent2)" strokeDasharray="4 2"
              label={{ value: `E${next_e}?`, fill: 'var(--accent2)', fontSize: 11, position: 'top' }}
            />
            <Bar dataKey="days" radius={[3, 3, 0, 0]}>
              {histogram.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.achieved
                    ? (entry.km <= e ? 'var(--accent)' : 'var(--accent2)')
                    : 'var(--surface2)'}
                  stroke={entry.achieved ? 'transparent' : 'var(--border)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
          <span><span style={{ color: 'var(--accent)' }}>■</span> Achieved (counts toward E{e})</span>
          <span><span style={{ color: 'var(--accent2)' }}>■</span> Need for E{next_e}</span>
          <span><span style={{ color: 'var(--border)', background: 'var(--border)', display: 'inline-block', width: 10, height: 10 }} /> Not yet achieved</span>
        </div>
      </div>

      {/* Top days */}
      {top_days?.length > 0 && (
        <div className="card">
          <div className="card-title">Your Longest Days</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {top_days.slice(0, 30).map((km, i) => (
              <div key={i} style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                padding: '5px 12px',
                borderRadius: 20,
                background: km >= (next_e || e + 1)
                  ? 'rgba(249,115,22,0.15)'
                  : km >= e
                    ? 'rgba(59,130,246,0.15)'
                    : 'var(--surface2)',
                color: km >= (next_e || e + 1)
                  ? 'var(--accent)'
                  : km >= e
                    ? 'var(--accent2)'
                    : 'var(--muted)',
                border: `1px solid ${km >= (next_e || e + 1) ? 'rgba(249,115,22,0.3)' : 'var(--border)'}`,
              }}>
                {km} km
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
