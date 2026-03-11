import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { format, parseISO } from 'date-fns'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '12px 16px',
      fontSize: '13px',
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
        {label ? format(parseISO(label), 'EEE d MMM yyyy') : ''}
      </div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: 3 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          </span>
          <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{p.name}</span>
        </div>
      ))}
    </div>
  )
}

export default function PMC() {
  const [data, setData] = useState([])
  const [days, setDays] = useState(120)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics/pmc?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  const latest = data[data.length - 1]
  const tsbClass = latest
    ? latest.tsb > 5 ? 'positive' : latest.tsb < -20 ? 'negative' : 'neutral'
    : 'neutral'

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Performance Management Chart</h1>
        <p className="page-subtitle">
          Fitness (CTL), Fatigue (ATL) and Form (TSB) — Banister impulse-response model
        </p>
      </div>

      {/* Current values */}
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Fitness (CTL)</div>
          <div className="stat-value" style={{ color: 'var(--ctl-color)' }}>
            {latest?.ctl?.toFixed(1) ?? '—'}
          </div>
          <div className="stat-delta">42-day exp. avg TSS</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Fatigue (ATL)</div>
          <div className="stat-value" style={{ color: 'var(--atl-color)' }}>
            {latest?.atl?.toFixed(1) ?? '—'}
          </div>
          <div className="stat-delta">7-day exp. avg TSS</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Form (TSB)</div>
          <div className={`stat-value tsb-${tsbClass}`}>
            {latest?.tsb != null ? (latest.tsb > 0 ? '+' : '') + latest.tsb.toFixed(1) : '—'}
          </div>
          <div className={`stat-delta ${tsbClass}`}>
            {latest?.tsb > 5 ? 'Fresh — ready to race'
              : latest?.tsb > -10 ? 'Optimal training zone'
              : latest?.tsb > -20 ? 'Accumulated fatigue'
              : 'Overreaching — rest needed'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Yesterday TSS</div>
          <div className="stat-value">{latest?.tss?.toFixed(0) ?? '—'}</div>
          <div className="stat-delta" style={{ color: 'var(--muted)' }}>Training load</div>
        </div>
      </div>

      {/* Range selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[60, 90, 120, 180, 365].map(d => (
          <button
            key={d}
            className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setDays(d)}
          >
            {d}d
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading PMC data…</div>
      ) : (
        <div className="card">
          <div className="card-title">CTL · ATL · TSB</div>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={d => format(parseISO(d), 'MMM d')}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={Math.floor(data.length / 8)}
              />
              <YAxis
                yAxisId="load"
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="tss"
                orientation="right"
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: 'var(--muted)', paddingTop: 12 }}
              />
              <ReferenceLine yAxisId="load" y={0} stroke="var(--border)" />

              {/* Daily TSS bars */}
              <Bar
                yAxisId="tss"
                dataKey="tss"
                name="TSS"
                fill="rgba(255,255,255,0.06)"
                radius={[2, 2, 0, 0]}
              />

              {/* CTL - fitness */}
              <Line
                yAxisId="load"
                type="monotone"
                dataKey="ctl"
                name="CTL (Fitness)"
                stroke="var(--ctl-color)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />

              {/* ATL - fatigue */}
              <Line
                yAxisId="load"
                type="monotone"
                dataKey="atl"
                name="ATL (Fatigue)"
                stroke="var(--atl-color)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />

              {/* TSB - form */}
              <Line
                yAxisId="load"
                type="monotone"
                dataKey="tsb"
                name="TSB (Form)"
                stroke="var(--tsb-color)"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* TSB interpretation legend */}
          <div style={{
            display: 'flex', gap: 16, marginTop: 16,
            padding: '10px 14px',
            background: 'var(--surface2)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--muted)',
          }}>
            <span><span style={{ color: 'var(--green)' }}>■</span> TSB &gt; +5: Fresh / Race ready</span>
            <span><span style={{ color: 'var(--yellow)' }}>■</span> -10 to +5: Optimal training</span>
            <span><span style={{ color: 'var(--accent)' }}>■</span> -20 to -10: Building fatigue</span>
            <span><span style={{ color: 'var(--red)' }}>■</span> &lt; -20: Overreaching</span>
          </div>
        </div>
      )}
    </div>
  )
}
