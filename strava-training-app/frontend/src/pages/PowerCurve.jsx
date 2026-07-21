import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

const DURATION_LABELS = {
  1: '1s', 5: '5s', 10: '10s', 15: '15s', 30: '30s', 60: '1m',
  120: '2m', 180: '3m', 300: '5m', 360: '6m', 600: '10m',
  900: '15m', 1200: '20m', 1800: '30m', 2700: '45m', 3600: '1h',
  5400: '1.5h', 7200: '2h',
}

const ZONE_COLORS = [
  'var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)',
  'var(--z5)', 'var(--z6)', 'var(--z7)'
]

function formatDuration(seconds) {
  return DURATION_LABELS[seconds] || (seconds >= 3600
    ? `${(seconds / 3600).toFixed(1)}h`
    : seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`)
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 13,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 6 }}>
        {formatDuration(d.duration)}
      </div>
      {d.power != null && (
        <div style={{ color: 'var(--accent2)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
          {d.power.toFixed(0)}W <span style={{ color: 'var(--muted)', fontWeight: 400 }}>actual</span>
        </div>
      )}
      {d.idealPower != null && (
        <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 500, marginTop: 2 }}>
          {d.idealPower.toFixed(0)}W <span style={{ color: 'var(--muted)', fontWeight: 400 }}>ideal</span>
        </div>
      )}
      {d.wpkg && (
        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
          {d.wpkg} W/kg
        </div>
      )}
    </div>
  )
}

export default function PowerCurve() {
  const [curve, setCurve] = useState([])
  const [ftp, setFtp]     = useState(null)
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [weight, setWeight] = useState(70)
  const [showIdeal, setShowIdeal] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const curveRes = await fetch('/trainiq/analytics/power-curve')
        const curveData = curveRes.ok ? await curveRes.json() : {}
        // Backward-compatible: older API shape was a bare array
        const actualRaw = Array.isArray(curveData) ? curveData : (curveData.actual || [])
        const idealRaw = Array.isArray(curveData) ? [] : (curveData.ideal || [])

        // Merge actual + ideal onto a single duration-keyed dataset so Recharts
        // can plot both lines on the same X axis, even where one series has a
        // data point and the other doesn't.
        const byDuration = {}
        actualRaw.forEach(d => {
          byDuration[d.duration] = { duration: d.duration, power: d.power }
        })
        idealRaw.forEach(d => {
          if (!byDuration[d.duration]) byDuration[d.duration] = { duration: d.duration }
          byDuration[d.duration].idealPower = d.power
        })

        const merged = Object.values(byDuration)
          .sort((a, b) => a.duration - b.duration)
          .map(d => ({
            ...d,
            wpkg: weight > 0 && d.power ? (d.power / weight).toFixed(2) : null,
            label: formatDuration(d.duration),
          }))
        setCurve(merged)
      } catch (e) { console.error('power-curve fetch:', e) }

      try {
        const ftpRes = await fetch('/trainiq/analytics/ftp')
        if (ftpRes.ok) setFtp(await ftpRes.json())
      } catch (e) { console.error('ftp fetch:', e) }

      try {
        const zonesRes = await fetch('/trainiq/analytics/zones')
        if (zonesRes.ok) {
          const z = await zonesRes.json()
          setZones(z.zones || [])
        }
      } catch (e) { console.error('zones fetch:', e) }

      setLoading(false)
    }
    load()
  }, [weight])

  const currentCp  = ftp?.cp  || ftp?.ftp || 0
  const currentFtp = ftp?.ftp || 0

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Power Curve</h1>
        <p className="page-subtitle">
          Mean maximal power from last 60 days · 3-parameter Critical Power model (Morton 1996)
        </p>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">CP (auto)</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>
            {currentCp.toFixed(0)}
            <span className="stat-unit">W</span>
          </div>
          <div className="stat-delta" style={{ color: 'var(--muted)' }}>
            Critical Power · Morton (1996)
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">FTP (manual)</div>
          <div className="stat-value">
            {currentFtp ? currentFtp.toFixed(0) : '—'}
            <span className="stat-unit">W</span>
          </div>
          <div className="stat-delta" style={{ color: currentFtp && currentCp && Math.abs(currentFtp - currentCp) > 5 ? '#f97316' : 'var(--muted)' }}>
            {currentFtp && currentCp ? `${Math.round(currentFtp - currentCp) > 0 ? '+' : ''}${Math.round(currentFtp - currentCp)}W vs CP` : 'Set in Settings'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">W/kg (CP)</div>
          <div className="stat-value">
            {weight > 0 ? (currentCp / weight).toFixed(2) : '—'}
            <span className="stat-unit">W/kg</span>
          </div>
        </div>
        {ftp?.w_prime && (
          <div className="stat-tile">
            <div className="stat-label">W' (Anaerobic)</div>
            <div className="stat-value">
              {(ftp.w_prime / 1000).toFixed(1)}
              <span className="stat-unit">kJ</span>
            </div>
          </div>
        )}
        {ftp?.p_max && (
          <div className="stat-tile">
            <div className="stat-label">P<sub>max</sub> (Sprint)</div>
            <div className="stat-value">
              {ftp.p_max.toFixed(0)}
              <span className="stat-unit">W</span>
            </div>
          </div>
        )}
        {ftp?.r_squared != null && (
          <div className="stat-tile">
            <div className="stat-label">Model Fit R²</div>
            <div className="stat-value" style={{
              color: ftp.r_squared > 0.99 ? 'var(--green)' : ftp.r_squared > 0.97 ? 'var(--yellow)' : 'var(--red)'
            }}>
              {(ftp.r_squared * 100).toFixed(1)}
              <span className="stat-unit">%</span>
            </div>
          </div>
        )}
        <div className="stat-tile">
          <div className="stat-label">Athlete Weight</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input
              type="number"
              value={weight}
              onChange={e => setWeight(+e.target.value)}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                fontSize: 22,
                width: 70,
                padding: '2px 6px',
              }}
            />
            <span style={{ color: 'var(--muted)' }}>kg</span>
          </div>
        </div>
      </div>

      {/* Power zones */}
      {zones.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Power Zones (Coggan)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {zones.map((z, i) => (
              <div key={z.zone} style={{
                background: `${ZONE_COLORS[i]}22`,
                border: `1px solid ${ZONE_COLORS[i]}55`,
                borderRadius: 8,
                padding: '10px 12px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: ZONE_COLORS[i], marginBottom: 4 }}>
                  Z{z.zone}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{z.name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)' }}>
                  {z.min}–{z.max === 9999 ? '∞' : z.max}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>W</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Power curve chart */}
      {loading ? (
        <div className="loading">Building power curve…</div>
      ) : curve.length === 0 ? (
        <div className="empty-state">
          <p>No power data available yet.</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>
            Power data exists in the database — try clicking Recalculate on the Dashboard,
            or check the browser console for errors.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 16 }}
            onClick={async () => {
              await fetch('/trainiq/analytics/recalculate', { method: 'POST' })
              setTimeout(() => window.location.reload(), 3000)
            }}>
            Recalculate Power Curve
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Mean Maximal Power (last 60 days)</span>
            <button
              onClick={() => setShowIdeal(v => !v)}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 12, cursor: 'pointer',
                background: showIdeal ? 'rgba(249,115,22,0.15)' : 'var(--surface2)',
                border: `1px solid ${showIdeal ? 'var(--accent)' : 'var(--border)'}`,
                color: showIdeal ? 'var(--accent)' : 'var(--muted)',
                fontWeight: 600,
              }}>
              {showIdeal ? '✓' : ''} Ideal curve
            </button>
          </div>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={curve} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                domain={['auto', 'auto']}
                unit="W"
              />
              <Tooltip content={<CustomTooltip />} />

              {/* FTP reference line */}
              {currentFtp > 0 && (
                <ReferenceLine
                  y={currentFtp}
                  stroke="var(--accent)"
                  strokeDasharray="6 3"
                  label={{
                    value: `CP ${currentCp.toFixed(0)}W`,
                    fill: 'var(--accent)',
                    fontSize: 11,
                    position: 'insideTopRight',
                  }}
                />
              )}

              <Line
                type="monotone"
                dataKey="power"
                stroke="var(--accent2)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--accent2)', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                name="Actual"
                connectNulls
              />
              {showIdeal && (
                <Line
                  type="monotone"
                  dataKey="idealPower"
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 4 }}
                  name="Ideal (CP model)"
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>

          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)' }}>
            {ftp?.estimated_at && (
              <span>Last estimated: {new Date(ftp.estimated_at).toLocaleDateString()}</span>
            )}
            {ftp?.r_squared && (
              <span style={{ marginLeft: 16 }}>Model R² = {(ftp.r_squared * 100).toFixed(2)}%</span>
            )}
            {showIdeal && (
              <span style={{ marginLeft: 16 }}>
                <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '1.5px dashed var(--accent)',
                  verticalAlign: 'middle', marginRight: 4 }} />
                Ideal curve shows theoretical power at each duration based on your CP/W'/Pmax model —
                a gap below it suggests untapped potential at that duration; matching it means you're
                riding at your physiological ceiling there.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
