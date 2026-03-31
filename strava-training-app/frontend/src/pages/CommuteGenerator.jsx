import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, Trash2, RefreshCw } from 'lucide-react'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function CommuteGenerator() {
  const [startDate, setStartDate] = useState('2020-01-01')
  const [endDate, setEndDate] = useState('2025-03-03')
  const [selectedDays, setSelectedDays] = useState([0, 1, 2, 3]) // Mon-Thu
  const [ridesPerDay, setRidesPerDay] = useState(2)
  const [durationMinutes, setDurationMinutes] = useState(20)
  const [intensityFactor, setIntensityFactor] = useState(0.65)
  const [preview, setPreview] = useState(null)
  const [existingCount, setExistingCount] = useState(0)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    fetchExistingCount()
  }, [])

  const fetchExistingCount = async () => {
    const res = await fetch('/trainiq/commutes/synthetic/count').then(r => r.json()).catch(() => ({ count: 0 }))
    setExistingCount(res.count)
  }

  const getPreview = async () => {
    setLoading(true)
    setConfirmed(false)
    setStatus(null)
    try {
      const res = await fetch('/trainiq/commutes/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          days_of_week: selectedDays,
          rides_per_day: ridesPerDay,
          duration_minutes: durationMinutes,
          intensity_factor: intensityFactor,
        })
      })
      const data = await res.json()
      setPreview(data)
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  const generate = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const res = await fetch('/trainiq/commutes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          days_of_week: selectedDays,
          rides_per_day: ridesPerDay,
          duration_minutes: durationMinutes,
          intensity_factor: intensityFactor,
        })
      })
      const data = await res.json()
      setStatus({ type: 'success', message: `Created ${data.created} activities (${data.total_tss} total TSS). PMC rebuilt.` })
      setPreview(null)
      setConfirmed(false)
      fetchExistingCount()
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  const deleteAll = async () => {
    if (!window.confirm(`Delete all ${existingCount} synthetic commute activities? PMC will be rebuilt.`)) return
    setLoading(true)
    try {
      const res = await fetch('/trainiq/commutes/synthetic', { method: 'DELETE' }).then(r => r.json())
      setStatus({ type: 'success', message: `Deleted ${res.deleted} synthetic activities. PMC rebuilt.` })
      setExistingCount(0)
      setPreview(null)
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  const toggleDay = (day) => {
    setSelectedDays(days => days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort())
    setPreview(null)
    setConfirmed(false)
  }

  const tssPerRide = ((durationMinutes / 60) * (intensityFactor ** 2) * 100).toFixed(1)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Historical Commute Generator</h1>
        <p className="page-subtitle">Backfill synthetic commute activities to improve CTL accuracy</p>
      </div>

      {existingCount > 0 && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{existingCount} synthetic commutes in database</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              These are counted in your PMC but excluded from distance graphs, power curve, Eddington, and gemeente detection.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={deleteAll} disabled={loading}
            style={{ color: '#ef4444', borderColor: '#ef4444' }}>
            <Trash2 size={13} /> Delete All
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Commute Pattern</div>

        {/* Date range */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>Start date</div>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPreview(null) }}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>End date (last day before tracking)</div>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPreview(null) }}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Days of week */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Commute days</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {DAY_NAMES.map((name, i) => (
              <button key={i} onClick={() => toggleDay(i)}
                style={{
                  padding: '5px 10px', borderRadius: 8, border: '1px solid',
                  borderColor: selectedDays.includes(i) ? 'var(--accent)' : 'var(--border)',
                  background: selectedDays.includes(i) ? 'rgba(249,115,22,0.15)' : 'var(--surface2)',
                  color: selectedDays.includes(i) ? 'var(--accent)' : 'var(--muted)',
                  cursor: 'pointer', fontSize: 12, fontWeight: selectedDays.includes(i) ? 700 : 400,
                }}>
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Settings row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>Rides per day</div>
            <select value={ridesPerDay} onChange={e => { setRidesPerDay(parseInt(e.target.value)); setPreview(null) }}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 }}>
              <option value={1}>1 (one way)</option>
              <option value={2}>2 (round trip)</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>Duration per ride</div>
            <select value={durationMinutes} onChange={e => { setDurationMinutes(parseInt(e.target.value)); setPreview(null) }}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 }}>
              {[10, 15, 20, 25, 30, 35, 40, 45, 60].map(t => <option key={t} value={t}>{t} min</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>Intensity factor</div>
            <select value={intensityFactor} onChange={e => { setIntensityFactor(parseFloat(e.target.value)); setPreview(null) }}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 }}>
              {[0.55, 0.60, 0.65, 0.70, 0.75].map(v => <option key={v} value={v}>{v} (~{((durationMinutes/60)*v*v*100).toFixed(0)} TSS/ride)</option>)}
            </select>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
          Each ride: <strong>{durationMinutes} min</strong> at IF <strong>{intensityFactor}</strong> = <strong>{tssPerRide} TSS</strong>
          {ridesPerDay === 2 && ` · ${(parseFloat(tssPerRide) * 2).toFixed(1)} TSS per commute day`}
        </div>

        <button className="btn btn-ghost btn-sm" onClick={getPreview} disabled={loading || selectedDays.length === 0}>
          <RefreshCw size={13} /> Preview
        </button>
      </div>

      {/* Preview */}
      {preview && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Preview</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              ['Commute days', preview.total_days],
              ['Total rides', preview.total_rides],
              ['TSS per day', preview.tss_per_day],
              ['Total TSS', preview.total_tss],
            ].map(([label, value]) => (
              <div key={label} className="stat-tile" style={{ padding: '12px 16px' }}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            FTP used for TSS calculation: <strong>{preview.ftp_used}W</strong>
            <br />
            Sample days: {preview.sample_days.join(', ')}{preview.total_days > 5 ? '...' : ''}
          </div>

          <div style={{ padding: '10px 14px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            <strong>Important:</strong> Synthetic activities count toward PMC (CTL/ATL) but are excluded from distance graphs, power curve, Eddington number, and gemeente detection.
            They can be deleted at any time.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
              I confirm — generate {preview.total_rides} synthetic commute activities
            </label>
          </div>

          {confirmed && (
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={generate} disabled={loading}>
              {loading ? 'Generating...' : `Generate ${preview.total_rides} activities`}
            </button>
          )}
        </div>
      )}

      {status && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
          borderRadius: 10, marginBottom: 16, fontSize: 13,
          background: status.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${status.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: status.type === 'success' ? '#22c55e' : '#ef4444',
        }}>
          {status.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {status.message}
        </div>
      )}
    </div>
  )
}
