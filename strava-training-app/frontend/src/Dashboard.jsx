import { useState, useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'

function StatTile({ label, value, unit, color, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : {}}>
        {value ?? '—'}{unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-delta" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const entry = payload[0]?.payload
  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 16px', fontSize: 13, minWidth: 180 }}>
      <div style={{ color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>
        {label ? format(parseISO(label), 'EEE d MMM yyyy') : ''}
      </div>
      {entry?.activity_name && (
        <div style={{ color: 'var(--text)', marginBottom: 8, fontStyle: 'italic',
          fontSize: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
          📍 {entry.activity_name}
        </div>
      )}
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: 3 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          </span>
          <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{p.name}</span>
        </div>
      ))}
      {entry?.tss > 0 && (
        <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 12 }}>
          TSS: {entry.tss?.toFixed(0)}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [pmc, setPmc]         = useState([])
  const [ftp, setFtp]         = useState(null)
  const [activities, setActivities] = useState([])
  const [days, setDays]       = useState(120)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch(`/trainiq/analytics/pmc?days=${days}`).then(r => r.json()).catch(() => []),
      fetch('/trainiq/analytics/ftp').then(r => r.json()).catch(() => ({})),
      fetch('/trainiq/activities?per_page=7').then(r => r.json()).catch(() => []),
    ]).then(([pmcData, ftpData, actData]) => {
      setPmc(Array.isArray(pmcData) ? pmcData : [])
      setFtp(ftpData)
      setActivities(Array.isArray(actData) ? actData : [])
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [days])

  const latest  = pmc[pmc.length - 1]
  const tsbColor = latest
    ? latest.tsb > 5 ? '#22c55e' : latest.tsb < -20 ? '#ef4444' : '#f97316'
    : 'var(--muted)'
  const tsbLabel = latest
    ? latest.tsb > 5 ? 'Race ready' : latest.tsb < -20 ? 'Fatigued' : 'Training'
    : '—'

  const triggerImport = async () => {
    setImporting(true)
    setImportMsg('Syncing…')
    try {
      await fetch('/trainiq/garmin/import-recent', { method: 'POST' })
      setImportMsg('Sync started — check back in a moment')
      setTimeout(() => { setImportMsg(null); load() }, 3000)
    } catch { setImportMsg('Sync failed') }
    setImporting(false)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Performance Management Chart — Banister impulse-response model</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Day range selector */}
          {[30, 60, 120, 180, 365].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-ghost'}`}>
              {d}d
            </button>
          ))}
          <button onClick={triggerImport} disabled={importing}
            className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}>
            {importing ? '⏳' : '↻'} Sync
          </button>
        </div>
      </div>

      {importMsg && (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>{importMsg}</div>
      )}

      {/* Stat tiles */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <StatTile label="Fitness (CTL)" value={latest?.ctl?.toFixed(1)} unit=""
          color="var(--accent2)" sub="Chronic Training Load" />
        <StatTile label="Fatigue (ATL)" value={latest?.atl?.toFixed(1)} unit=""
          color="#ef4444" sub="Acute Training Load" />
        <StatTile label="Form (TSB)" value={latest?.tsb?.toFixed(1)} unit=""
          color={tsbColor} sub={tsbLabel} />
        <StatTile label="CP (auto)" value={ftp?.cp?.toFixed(0)} unit="W"
          color="var(--accent)" sub="Critical Power · nightly" />
        <StatTile label="FTP (manual)" value={ftp?.ftp?.toFixed(0)} unit="W"
          sub="Used for TSS & zones" />
        {ftp?.w_prime && (
          <StatTile label="W' (anaerobic)" value={(ftp.w_prime/1000).toFixed(1)} unit="kJ"
            sub="Work capacity" />
        )}
      </div>

      {/* PMC Chart */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Performance Management</div>
        {loading ? (
          <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={pmc} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }}
                tickFormatter={d => format(parseISO(d), 'd MMM')}
                interval={Math.max(1, Math.floor(pmc.length / 8))} />
              <YAxis yAxisId="load" tick={{ fontSize: 11, fill: 'var(--muted)' }} width={36} />
              <YAxis yAxisId="tss" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted)' }} width={36} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="load" y={0} stroke="var(--border)" />
              <Bar yAxisId="tss" dataKey="tss" name="TSS" fill="rgba(99,102,241,0.25)"
                radius={[2,2,0,0]} />
              <Line yAxisId="load" type="monotone" dataKey="ctl" name="CTL"
                stroke="var(--accent2)" strokeWidth={2} dot={false} />
              <Line yAxisId="load" type="monotone" dataKey="atl" name="ATL"
                stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line yAxisId="load" type="monotone" dataKey="tsb" name="TSB"
                stroke="#22c55e" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent activities */}
      <div className="card">
        <div className="card-title">Recent Activities</div>
        {activities.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No activities yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activities.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {format(parseISO(a.start_date), 'd MMM yyyy')} · {a.sport_type}
                    {a.commute && ' · 🚲 commute'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                  {[
                    a.tss && [`${a.tss.toFixed(0)}`, 'TSS'],
                    a.moving_time && [`${Math.round(a.moving_time/60)}min`, ''],
                    a.distance > 0 && [`${(a.distance/1000).toFixed(0)}km`, ''],
                    a.average_watts && [`${a.average_watts.toFixed(0)}W`, ''],
                  ].filter(Boolean).map(([val, lbl]) => (
                    <div key={lbl+val} style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{val}</div>
                      {lbl && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{lbl}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
