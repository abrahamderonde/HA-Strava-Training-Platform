import { useState, useEffect } from 'react'
import { format, parseISO } from 'date-fns'

const FLAG_LABELS = {
  very_high_tss: { label: 'TSS > 250', color: '#ef4444' },
  high_if: { label: 'IF > 1.15', color: '#f97316' },
  low_if_with_power: { label: 'IF < 0.3 w/ power', color: '#3b82f6' },
  np_below_avg: { label: 'NP < avg power', color: '#a855f7' },
  stored_tss_mismatch: { label: 'Stored ≠ recomputed', color: '#eab308' },
  no_source_tag: { label: 'No source tag (stale)', color: 'var(--muted)' },
  tss_without_power_or_hr: { label: 'TSS but no power/HR', color: '#ec4899' },
}

function FlagPill({ flag }) {
  const info = FLAG_LABELS[flag] || { label: flag, color: 'var(--muted)' }
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 10,
      background: `${info.color}22`, border: `1px solid ${info.color}55`,
      color: info.color, whiteSpace: 'nowrap',
    }}>
      {info.label}
    </span>
  )
}

export default function TssDebug() {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [sortBy, setSortBy] = useState('date')

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/trainiq/debug/tss-detail?days=${days}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json()
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [days])

  if (loading) return <div style={{ padding: 20, color: 'var(--muted)' }}>Loading…</div>
  if (error) return (
    <div style={{ padding: 20 }}>
      <div className="page-header">
        <h1 className="page-title">TSS Debug</h1>
      </div>
      <div style={{ color: '#ef4444', fontSize: 14 }}>
        Error loading data: {error}
      </div>
    </div>
  )
  if (!data) return <div style={{ padding: 20, color: 'var(--muted)' }}>No data.</div>

  const rows = showAll ? (data.all || []) : (data.flagged || [])
  const sorted = [...rows].sort((a, b) => {
    try {
      if (sortBy === 'tss') return (b?.stored_tss || 0) - (a?.stored_tss || 0)
      if (sortBy === 'if') return (b?.if || 0) - (a?.if || 0)
      return new Date(b?.date || 0) - new Date(a?.date || 0)
    } catch {
      return 0
    }
  })

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">TSS Debug</h1>
        <p className="page-subtitle">
          Full calculation breakdown per activity — {data.flagged_count} of {data.total_activities} flagged
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {[7, 30, 60, 90, 180].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-ghost'}`}>
            {d}d
          </button>
        ))}
        <button onClick={() => setShowAll(v => !v)}
          className={`btn btn-sm ${showAll ? 'btn-primary' : 'btn-ghost'}`}
          style={{ marginLeft: 12 }}>
          {showAll ? 'Showing all' : 'Showing flagged only'}
        </button>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 6,
                   border: '1px solid var(--border)', background: 'var(--surface2)',
                   color: 'var(--text)', fontSize: 13 }}>
          <option value="date">Sort: Date</option>
          <option value="tss">Sort: TSS (high→low)</option>
          <option value="if">Sort: IF (high→low)</option>
        </select>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              {['Date', 'Name', 'Min', 'TSS', 'Expected', 'FTP', 'Avg W', 'NP', 'IF', 'HR', 'Source', 'Flags'].map(h => (
                <th key={h} style={{ padding: '6px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id} style={{
                borderBottom: '1px solid var(--border)',
                background: r.flags.includes('very_high_tss') ? 'rgba(239,68,68,0.05)' : 'transparent',
              }}>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{format(parseISO(r.date), 'd MMM')}</td>
                <td style={{ padding: '6px 8px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}{r.trainer && ' 🏠'}
                </td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{r.elapsed_min}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontWeight: 700,
                  color: r.flags.includes('very_high_tss') ? '#ef4444' : 'var(--text)' }}>
                  {r.stored_tss ?? '—'}
                </td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)',
                  color: r.flags.includes('stored_tss_mismatch') ? '#eab308' : 'var(--muted)' }}>
                  {r.expected_tss ?? '—'}
                </td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{r.ftp_used}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{r.average_watts ?? '—'}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)',
                  color: r.flags.includes('np_below_avg') ? '#a855f7' : 'var(--text)' }}>
                  {r.np ?? '—'}
                </td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)',
                  color: r.flags.includes('high_if') ? '#f97316' : 'var(--text)' }}>
                  {r.if ?? '—'}
                </td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{r.average_heartrate ? Math.round(r.average_heartrate) : '—'}</td>
                <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{r.tss_source ?? '—'}</td>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {r.flags.map(f => <FlagPill key={f} flag={f} />)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div style={{ padding: 20, color: 'var(--muted)', textAlign: 'center' }}>
            No {showAll ? '' : 'flagged '}activities in this range.
          </div>
        )}
      </div>
    </div>
  )
}
