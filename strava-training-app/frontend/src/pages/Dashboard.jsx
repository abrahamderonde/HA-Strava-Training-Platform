import { useState, useEffect } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'
import { Activity, TrendingUp, Zap, Target } from 'lucide-react'

function StatTile({ label, value, unit, color, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : {}}>
        {value ?? '—'}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-delta" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [pmc, setPmc] = useState([])
  const [ftp, setFtp] = useState(null)
  const [activities, setActivities] = useState([])
  const [importStatus, setImportStatus] = useState(null)
  const [importing, setImporting] = useState(false)

  const loadData = () => {
    Promise.all([
      fetch('/trainiq/analytics/pmc?days=30').then(r => r.json()).catch(() => []),
      fetch('/trainiq/analytics/ftp').then(r => r.json()).catch(() => ({})),
      fetch('/trainiq/activities?per_page=5').then(r => r.json()).catch(() => []),
    ]).then(([pmcData, ftpData, actData]) => {
      setPmc(Array.isArray(pmcData) ? pmcData : [])
      setFtp(ftpData)
      setActivities(Array.isArray(actData) ? actData : [])
    })
  }

  useEffect(() => { loadData() }, [])

  const latest = pmc[pmc.length - 1]
  const tsbClass = latest
    ? latest.tsb > 5 ? 'positive' : latest.tsb < -20 ? 'negative' : 'neutral'
    : 'neutral'

  const triggerImport = async () => {
    setImporting(true)
    setImportStatus('Importing…')
    await fetch('/trainiq/strava/import', { method: 'POST' })
    setImportStatus('Import running — auto-refreshing every 30s…')
    setImporting(false)
    // Poll every 30s for up to 10 minutes
    let count = 0
    const interval = setInterval(() => {
      loadData()
      count++
      if (count >= 20) {
        clearInterval(interval)
        setImportStatus('Done — data refreshed')
      }
    }, 30000)
  }

  const triggerRecalculate = async () => {
    setImportStatus('Recalculating…')
    await fetch('/trainiq/analytics/recalculate', { method: 'POST' })
    // Recalculation takes ~5 seconds, refresh after 8s
    setTimeout(() => {
      loadData()
      setImportStatus('Recalculation done — data refreshed')
    }, 8000)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Your training at a glance</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {importStatus && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{importStatus}</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={triggerRecalculate}>
            Recalculate
          </button>
          <button className="btn btn-ghost btn-sm" onClick={triggerImport} disabled={importing}>
            <Activity size={13} />
            {importing ? 'Starting…' : 'Sync Strava'}
          </button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="stat-grid">
        <StatTile
          label="Fitness (CTL)"
          value={latest?.ctl?.toFixed(1)}
          color="var(--ctl-color)"
          sub="42-day avg"
        />
        <StatTile
          label="Fatigue (ATL)"
          value={latest?.atl?.toFixed(1)}
          color="var(--atl-color)"
          sub="7-day avg"
        />
        <StatTile
          label="Form (TSB)"
          value={latest?.tsb != null ? (latest.tsb > 0 ? '+' : '') + latest.tsb.toFixed(1) : null}
          color={tsbClass === 'positive' ? 'var(--green)' : tsbClass === 'negative' ? 'var(--red)' : 'var(--yellow)'}
          sub={latest?.tsb > 5 ? 'Race ready' : latest?.tsb > -10 ? 'Training zone' : 'Fatigued'}
        />
        <StatTile
          label="FTP"
          value={ftp?.ftp?.toFixed(0)}
          unit="W"
          color="var(--accent)"
          sub={ftp?.source === 'cp3_model' ? '3-param CP model' : 'Manual'}
        />
        {ftp?.w_prime && (
          <StatTile
            label="W' (Anaerobic)"
            value={(ftp.w_prime / 1000).toFixed(1)}
            unit="kJ"
            sub="Work capacity"
          />
        )}
        <StatTile
          label="Yesterday TSS"
          value={latest?.tss?.toFixed(0)}
          sub="Training load"
        />
      </div>

      {/* Mini PMC chart */}
      {pmc.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-title">Last 30 Days — CTL · ATL · TSB</div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={pmc} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={d => format(parseISO(d), 'MMM d')}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                tickLine={false} axisLine={false}
                interval={6}
              />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12,
                }}
                labelFormatter={d => format(parseISO(d), 'EEE d MMM')}
              />
              <Bar dataKey="tss" name="TSS" fill="rgba(255,255,255,0.05)" radius={[2,2,0,0]} />
              <Line type="monotone" dataKey="ctl" stroke="var(--ctl-color)" strokeWidth={2} dot={false} name="CTL" />
              <Line type="monotone" dataKey="atl" stroke="var(--atl-color)" strokeWidth={2} dot={false} name="ATL" />
              <Line type="monotone" dataKey="tsb" stroke="var(--tsb-color)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="TSB" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent activities */}
      <div className="card">
        <div className="card-title">Recent Activities</div>
        {activities.length === 0 ? (
          <div className="empty-state">
            <p>No activities yet.</p>
            <p style={{ marginTop: 8 }}>Connect Strava and sync to see your training history.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {activities.map(a => (
              <div key={a.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto',
                alignItems: 'center',
                gap: 16,
                padding: '10px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {format(parseISO(a.start_date), 'EEE d MMM')} · {a.sport_type}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {a.distance ? `${(a.distance / 1000).toFixed(1)}km` : '—'}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {a.moving_time ? `${Math.round(a.moving_time / 60)}min` : '—'}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                  {a.average_watts ? `${a.average_watts.toFixed(0)}W` : '—'}
                </div>
                <div style={{
                  textAlign: 'right', fontFamily: 'var(--font-mono)',
                  color: a.tss > 100 ? 'var(--red)' : a.tss > 60 ? 'var(--yellow)' : 'var(--green)'
                }}>
                  {a.tss ? `TSS ${a.tss.toFixed(0)}` : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
