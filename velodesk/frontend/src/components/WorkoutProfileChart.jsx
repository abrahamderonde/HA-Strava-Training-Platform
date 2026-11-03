import { Fragment, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'

const ZONE_BOUNDS = [
  { max: 0.55, color: 'var(--z1)', label: 'Z1' },
  { max: 0.75, color: 'var(--z2)', label: 'Z2' },
  { max: 0.90, color: 'var(--z3)', label: 'Z3' },
  { max: 1.05, color: 'var(--z4)', label: 'Z4' },
  { max: 1.20, color: 'var(--z5)', label: 'Z5' },
  { max: 1.50, color: 'var(--z6)', label: 'Z6' },
  { max: Infinity, color: 'var(--z7)', label: 'Z7' },
]

function zoneFor(power, ftp) {
  if (!power || !ftp) return ZONE_BOUNDS[0]
  const ratio = power / ftp
  return ZONE_BOUNDS.find(z => ratio <= z.max) || ZONE_BOUNDS[ZONE_BOUNDS.length - 1]
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m}m`
}

function expandIntervals(intervals) {
  const segments = []
  let t = 0
  for (const iv of (intervals || [])) {
    const repeats = Math.max(1, parseInt(iv.repeats || 1))
    for (let r = 0; r < repeats; r++) {
      if (Array.isArray(iv.steps) && iv.steps.length) {
        for (const s of iv.steps) {
          const dur = Number(s.duration_seconds || 0)
          if (dur <= 0) continue
          const power = ((s.power_low || 0) + (s.power_high || s.power_low || 0)) / 2
          segments.push({ start: t, end: t + dur, power })
          t += dur
        }
      } else {
        const dur = Number(iv.duration_seconds || 0)
        if (dur > 0) {
          const power = ((iv.power_low || 0) + (iv.power_high || iv.power_low || 0)) / 2
          segments.push({ start: t, end: t + dur, power })
          t += dur
        }
      }
      const rest = Number(iv.rest_seconds || 0)
      if (rest > 0) {
        segments.push({ start: t, end: t + rest, power: 0 })
        t += rest
      }
    }
  }
  return segments
}

export default function WorkoutProfileChart({ intervals, ftp, height = 160 }) {
  const segments = useMemo(() => expandIntervals(intervals), [intervals])
  const total = segments.length ? segments[segments.length - 1].end : 0

  const points = useMemo(() => {
    const pts = []
    for (const seg of segments) {
      pts.push({ t: seg.start, power: seg.power })
      pts.push({ t: seg.end, power: seg.power })
    }
    return pts
  }, [segments])

  const gradientId = useMemo(() => `wprofile-${Math.random().toString(36).slice(2)}`, [])

  if (!segments.length || total <= 0) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>Geen intervaldata beschikbaar.</div>
  }

  const maxPower = Math.max(...segments.map(s => s.power), ftp || 0) * 1.1

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              {segments.map((seg, i) => {
                const color = zoneFor(seg.power, ftp).color
                return (
                  <Fragment key={i}>
                    <stop offset={`${(seg.start / total) * 100}%`} stopColor={color} />
                    <stop offset={`${(seg.end / total) * 100}%`} stopColor={color} />
                  </Fragment>
                )
              })}
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="t" type="number" domain={[0, total]}
            tickFormatter={fmtTime} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
          <YAxis domain={[0, maxPower]} tick={{ fontSize: 10, fill: 'var(--muted)' }} unit="W" width={40} />
          <Tooltip
            contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
            labelFormatter={t => fmtTime(t)}
            formatter={v => [`${Math.round(v)}W`, 'vermogen']}
          />
          {ftp > 0 && (
            <ReferenceLine y={ftp} stroke="var(--accent)" strokeDasharray="4 2"
              label={{ value: 'FTP', fill: 'var(--accent)', fontSize: 10, position: 'insideTopRight' }} />
          )}
          <Area type="linear" dataKey="power" stroke="none" fill={`url(#${gradientId})`} fillOpacity={0.9} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
        {ZONE_BOUNDS.map(z => (
          <span key={z.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: z.color, display: 'inline-block' }} />
            {z.label}
          </span>
        ))}
      </div>
    </div>
  )
}