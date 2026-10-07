import { useState, useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import { X } from 'lucide-react'
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts'

const ZONE_COLORS = ['#64748b', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7']
const STATUS_ICON = { green: '🟢', yellow: '🟡', red: '🔴' }
const TOOLTIP_STYLE = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }

function formatDuration(seconds) {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
}

function formatClock(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function StatusValue({ value, status, suffix = '' }) {
  if (value == null) return <span style={{ color: 'var(--muted)' }}>N/A</span>
  return <span>{STATUS_ICON[status] || ''} {value.toFixed(1)}{suffix}</span>
}

export function QuickStats({ quick, compact = false }) {
  if (!quick) return null
  const items = [
    ['Time', formatDuration(quick.duration_s)],
    ['TSS', quick.tss != null ? Math.round(quick.tss) : '—'],
    ['kJ', quick.kj != null ? Math.round(quick.kj) : '—'],
    ['VI', quick.vi != null ? quick.vi.toFixed(2) : '—'],
    ['Decoupling', <StatusValue value={quick.decoupling_pct} status={quick.decoupling_status} suffix="%" />],
  ]
  return (
    <div style={compact
      ? { display: 'flex', gap: 16, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }
      : { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ textAlign: compact ? 'right' : 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 13 : 13 }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="card-title">{title}</div>
      {children}
    </div>
  )
}

function Tile({ label, children, sub }) {
  return (
    <div className="stat-tile" style={{ padding: '12px 16px' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 22 }}>{children}</div>
      {sub && <div className="stat-delta" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

function Empty({ children }) {
  return <div style={{ color: 'var(--muted)', fontSize: 13 }}>{children}</div>
}

export default function RideDetail({ activityId, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    setError(null)
    fetch(`/trainiq/activities/${activityId}/analysis`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
  }, [activityId])

  const analysis = data?.analysis
  const activity = data?.activity

  return (
    <div className="ride-modal-overlay" onClick={onClose}>
      <div className="ride-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{activity?.name || 'Ride analysis'}</h2>
            {activity && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                {format(parseISO(activity.start_date), 'EEEE d MMMM yyyy, HH:mm')} · FTP {data.ftp}W
              </div>
            )}
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm"><X size={14} /></button>
        </div>

        {error && <Empty>Failed to load analysis: {error}</Empty>}
        {!data && !error && <div className="loading">Analysing ride…</div>}

        {data && !analysis.available && (
          <Empty>
            No stream data stored for this ride. Run <strong>Backfill ride streams</strong> in Settings → Garmin Activity Import.
            Indoor and manual activities have no streams.
          </Empty>
        )}

        {data && analysis.available && (
          <>
            {analysis.legacy_streams && (
              <div style={{ fontSize: 12, color: '#f97316', marginBottom: 14 }}>
                Only the legacy power stream is stored for this ride. Run Backfill ride streams for HR, W' and climb analysis.
              </div>
            )}

            <Section title="Pacing & intensity">
              <div className="stat-grid" style={{ marginBottom: 14 }}>
                <Tile label="Variability Index">{analysis.pacing.vi ?? '—'}</Tile>
                <Tile label="Intensity Factor">{analysis.pacing.if}</Tile>
                <Tile label="NP" sub={`Avg ${analysis.pacing.avg_power}W`}>{analysis.pacing.np}<span className="stat-unit">W</span></Tile>
                <Tile label="Work">{Math.round(analysis.pacing.kj)}<span className="stat-unit">kJ</span></Tile>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={analysis.zones.map(z => ({ name: `Z${z.zone}`, kj: z.kj, zone: z.zone }))}
                  margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="kJ" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`${v} kJ`, 'Work']} />
                  <Bar dataKey="kj" radius={[3, 3, 0, 0]}>
                    {analysis.zones.map(z => <Cell key={z.zone} fill={ZONE_COLORS[z.zone - 1]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="ride-table" style={{ marginTop: 10 }}>
                <thead><tr><th>Zone</th><th>Range</th><th>Time</th><th>Work</th><th>Share</th></tr></thead>
                <tbody>
                  {analysis.zones.map(z => (
                    <tr key={z.zone}>
                      <td style={{ color: ZONE_COLORS[z.zone - 1], fontWeight: 700 }}>Z{z.zone} {z.name}</td>
                      <td>{z.min}–{z.max === 9999 ? '∞' : z.max}W</td>
                      <td>{formatDuration(z.seconds)}</td>
                      <td>{z.kj} kJ</td>
                      <td>{z.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="Aerobic condition & durability">
              <div className="stat-grid" style={{ marginBottom: 14 }}>
                <Tile label="Drift per hour" sub="Pwr:HR, moving time, after 10 min warmup">
                  <StatusValue value={analysis.durability.drift_per_hour} status={analysis.durability.drift_status} suffix="%/h" />
                </Tile>
                <Tile label="EF1 → EF2" sub="Hour 1 vs hour 2">
                  <StatusValue value={analysis.durability.decoupling_pct} status={analysis.durability.decoupling_status} suffix="%" />
                </Tile>
              </div>
              {analysis.durability.ef_hourly.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={analysis.durability.ef_hourly.map(h => ({ name: `Hour ${h.hour}`, ef: h.ef, np: h.np, hr: h.avg_hr }))}
                    margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={TOOLTIP_STYLE}
                      formatter={(v, n, p) => [`${v} (NP ${p.payload.np}W / ${p.payload.hr}bpm)`, 'EF']} />
                    <Bar dataKey="ef" fill="var(--accent2)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No HR data available for an hourly EF breakdown.</Empty>
              )}
              {analysis.durability.drift_per_hour == null && (
                <Empty>Drift needs at least 2 hours of moving time with HR.</Empty>
              )}
            </Section>

            <Section title="Anaerobic battery (W' balance)">
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                CP {analysis.w_prime.cp}W · W' {(analysis.w_prime.w_prime / 1000).toFixed(1)} kJ · lowest {analysis.w_prime.min_pct}%
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={analysis.w_prime.series} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--muted)' }}
                    tickFormatter={formatClock} interval={Math.max(1, Math.floor(analysis.w_prime.series.length / 6))} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} domain={['auto', 100]} unit="%" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={formatClock} formatter={v => [`${v}%`, "W' bal"]} />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="pct" stroke="var(--accent)" fill="rgba(249,115,22,0.25)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Section>

            <Section title={`Detected intervals (${analysis.intervals.length})`}>
              {analysis.intervals.length === 0 ? (
                <Empty>No efforts of 3+ min above 90% FTP.</Empty>
              ) : (
                <table className="ride-table">
                  <thead><tr><th>#</th><th>Start</th><th>Length</th><th>NP</th><th>%FTP</th><th>HR</th><th>Cadence</th><th>EF</th></tr></thead>
                  <tbody>
                    {analysis.intervals.map((iv, i) => (
                      <tr key={iv.start_s}>
                        <td>{i + 1}</td>
                        <td>{formatClock(iv.start_s)}</td>
                        <td>{formatDuration(iv.duration_s)}</td>
                        <td>{iv.np ?? iv.avg_power}W</td>
                        <td>{iv.pct_ftp}%</td>
                        <td>{iv.avg_hr ?? '—'}</td>
                        <td>{iv.avg_cadence ?? '—'}</td>
                        <td>{iv.ef ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section title={`Detected climbs (${analysis.climbs.length})`}>
              {analysis.climbs.length === 0 ? (
                <Empty>No climbs found (&gt;3% gradient and &gt;10 m gain).</Empty>
              ) : (
                <table className="ride-table">
                  <thead><tr><th>#</th><th>Start</th><th>Length</th><th>Gain</th><th>Grade</th><th>VAM</th><th>Power</th><th>W/kg</th></tr></thead>
                  <tbody>
                    {analysis.climbs.map((c, i) => (
                      <tr key={c.start_s}>
                        <td>{i + 1}</td>
                        <td>{formatClock(c.start_s)}</td>
                        <td>{c.length_km} km</td>
                        <td>{c.gain_m} m</td>
                        <td>{c.avg_grade}%</td>
                        <td>{c.vam} m/h</td>
                        <td>{c.avg_power}W</td>
                        <td>{c.wkg ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}