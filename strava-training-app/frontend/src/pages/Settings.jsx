import { useState, useEffect } from 'react'

function GarminImportCard() {
  const [status, setStatus] = useState(null)
  const [msg, setMsg] = useState(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    fetch('/trainiq/garmin/status').then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  const doImport = async (endpoint, label) => {
    setImporting(true)
    setMsg(`${label} started…`)
    try {
      const res = await fetch(`/trainiq/garmin/${endpoint}`, { method: 'POST' })
      const d = await res.json()
      setMsg(d.status || 'Started — check logs for progress')
    } catch { setMsg('Request failed') }
    setImporting(false)
  }

  const authenticated = status?.authenticated

  return (
    <div>
      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: authenticated ? '#22c55e' : '#ef4444',
          display: 'inline-block', flexShrink: 0
        }} />
        <span style={{ fontSize: 14 }}>
          {authenticated
            ? <>Tokens found — <span style={{ color: 'var(--muted)' }}>{status.files?.join(', ')}</span></>
            : 'No tokens found'}
        </span>
      </div>

      {!authenticated && (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7,
                      background: 'var(--surface2)', borderRadius: 6, padding: '10px 12px' }}>
          Run <code>example.py</code> from python-garminconnect on your PC, then copy the token file to HA:<br/>
          <code style={{ color: 'var(--accent)' }}>
            scp ~/.garminconnect/garmin_tokens.json root@homeassistant.local:/config/strava_training/garmin_tokens/
          </code>
        </div>
      )}

      {/* Import buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => doImport('import-recent', 'Recent import')}
          disabled={!authenticated || importing}
        >
          Sync last 14 days
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => doImport('import-history?days=365', 'Full history')}
          disabled={!authenticated || importing}
        >
          Import full year
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => doImport('import-history?days=1825', '5-year history')}
          disabled={!authenticated || importing}
        >
          Import 5 years
        </button>
      </div>

      {msg && (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{msg}</div>
      )}

      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
        Activities sync nightly at 1:00 AM automatically. Manual import runs in the background — large imports may take a few minutes.
        Garmin activity IDs are stored separately from Strava — both sources can coexist.
      </div>
    </div>
  )
}


  const [status, setStatus] = useState(null)
  const [config, setConfig] = useState(null)
  const [haUrl, setHaUrl] = useState(() => localStorage.getItem('ha_url') || '')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [ftpData, setFtpData] = useState(null)
  const [goalData, setGoalData] = useState(null)
  const [ftpInput, setFtpInput] = useState('')
  const [ftpSaving, setFtpSaving] = useState(false)
  const [ftpMsg, setFtpMsg] = useState(null)

  useEffect(() => {
    fetch('/trainiq/strava/status').then(r => r.json()).then(setStatus).catch(() => {})
    fetch('/trainiq/settings').then(r => r.json()).then(setConfig).catch(() => {})
    fetch('/trainiq/analytics/ftp').then(r => r.json()).then(d => {
      setFtpData(d)
      if (d?.ftp) setFtpInput(String(Math.round(d.ftp)))
    }).catch(() => {})
    fetch('/trainiq/goals').then(r => r.json()).then(setGoalData).catch(() => {})
  }, [])

  const saveFtp = async () => {
    const val = parseFloat(ftpInput)
    if (!val || val < 50 || val > 600) { setFtpMsg('Enter a value between 50 and 600W'); return }
    setFtpSaving(true)
    try {
      const res = await fetch('/trainiq/goals/ftp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ftp: val }),
      })
      if (!res.ok) throw new Error('Save failed')
      // Refresh ftp data and reseed input
      const fresh = await fetch('/trainiq/analytics/ftp').then(r => r.json())
      setFtpData(fresh)
      setFtpInput(String(Math.round(fresh.ftp)))
      setFtpMsg('FTP saved ✓')
      setTimeout(() => setFtpMsg(null), 3000)
    } catch { setFtpMsg('Save failed') }
    setFtpSaving(false)
  }

  const copyCpToFtp = async () => {
    const res = await fetch('/trainiq/analytics/accept-cp-as-ftp', { method: 'POST' })
    const d = await res.json()
    setGoalData(g => ({ ...g, current_ftp: d.new_ftp }))
    setFtpInput(String(d.new_ftp))
    setFtpMsg(`FTP updated to ${d.new_ftp}W ✓`)
    setTimeout(() => setFtpMsg(null), 3000)
  }

  const connectStrava = async () => {
    setError(null)
    setLoading(true)
    try {
      const callbackUrl = haUrl.trim() || window.location.origin
      const res = await fetch(`/trainiq/strava/auth-url?ha_url=${encodeURIComponent(callbackUrl)}`)
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else setError('No URL returned. Check Strava Client ID and Secret.')
    } catch (e) {
      setError(`Error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Connections and configuration</p>
      </div>

      <div className="section-grid">
        {/* Garmin Activity Import */}
        <div className="card">
          <div className="card-title">Garmin Activity Import</div>
          <GarminImportCard />
        </div>

        {/* Strava Connection */}
        <div className="card">
          <div className="card-title" style={{ color: 'var(--muted)' }}>Strava Connection <span style={{ fontSize: 11, fontWeight: 400 }}>(deprecated — Strava API now requires paid access)</span></div>

          {status?.authenticated ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Previously connected as <strong>{status.athlete_name}</strong>. Historical data already imported is retained.
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Strava API access now requires a paid subscription. Use Garmin Import above instead.
            </div>
          )}
        </div>

        {/* Current Config Values */}
        <div className="card">
          <div className="card-title">Current Configuration</div>
          {config ? (
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              {[
                ['Athlete weight', `${config.athlete_weight_kg} kg`],
                ['Initial FTP', `${config.ftp_initial} W`],
                ['Strava', config.strava_configured ? '✓ Configured' : '✗ Not configured', config.strava_configured ? 'var(--accent2)' : 'var(--accent)'],
                ['Garmin', config.garmin_configured ? '✓ Configured' : '— Not configured', config.garmin_configured ? 'var(--accent2)' : 'var(--muted)'],
                ['AI Planning', config.anthropic_configured ? '✓ Configured' : '— Not configured', config.anthropic_configured ? 'var(--accent2)' : 'var(--muted)'],
              ['intervals.icu', config.intervals_configured ? '✓ Configured' : '— Not configured', config.intervals_configured ? 'var(--accent2)' : 'var(--muted)'],
              ['intervals.icu', config.intervals_configured ? '✓ Configured' : '— Not configured', config.intervals_configured ? 'var(--accent2)' : 'var(--muted)'],
              ].map(([label, value, color], i, arr) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: 6, marginBottom: 6 }}>
                  <span style={{ color: 'var(--muted)' }}>{label}</span>
                  <strong style={{ color: color || 'var(--text)' }}>{value}</strong>
                </div>
              ))}
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                Change via <strong>Settings → Apps → Strava Training Platform → Configuration</strong> in HA.
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading...</div>
          )}
        </div>

        {/* CP vs FTP */}
        <div className="card">
          <div className="card-title">Critical Power vs FTP</div>

          {/* Two columns: CP (auto) | FTP (manual) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>CP — Auto calculated</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>
                {ftpData?.cp ? `${Math.round(ftpData.cp)}W` : '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                3-param CP model · updated nightly
              </div>
              {ftpData?.r_squared && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  R² = {ftpData.r_squared.toFixed(3)}
                  {ftpData.estimated_at && ` · ${new Date(ftpData.estimated_at).toLocaleDateString()}`}
                </div>
              )}
              {ftpData?.w_prime && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  W' = {(ftpData.w_prime / 1000).toFixed(1)} kJ
                </div>
              )}
            </div>

            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>FTP — Manual input</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
                {ftpData?.ftp ? `${Math.round(ftpData.ftp)}W` : config?.ftp_initial ? `${config.ftp_initial}W` : '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Used for TSS, zones, workout targets
              </div>
              {ftpData?.ftp && ftpData?.cp && (
                <div style={{ fontSize: 12, marginTop: 6, color: Math.abs(ftpData.ftp - ftpData.cp) > 5 ? '#f97316' : 'var(--muted)' }}>
                  {Math.round(ftpData.ftp - ftpData.cp) > 0 ? '+' : ''}{Math.round(ftpData.ftp - ftpData.cp)}W vs CP
                </div>
              )}
            </div>
          </div>

          {/* Manual FTP input */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              type="number"
              value={ftpInput}
              onChange={e => setFtpInput(e.target.value)}
              placeholder="Enter FTP (W)"
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '7px 12px', color: 'var(--text)',
                fontSize: 14, width: 140,
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={saveFtp} disabled={ftpSaving}>
              {ftpSaving ? 'Saving…' : 'Set FTP'}
            </button>
            {ftpData?.cp && (
              <button className="btn btn-ghost btn-sm" onClick={copyCpToFtp}
                title="Copy current CP value to FTP">
                Copy CP → FTP
              </button>
            )}
            {ftpMsg && <span style={{ fontSize: 13, color: ftpMsg.includes('✓') ? '#22c55e' : '#f97316' }}>{ftpMsg}</span>}
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <strong>CP</strong> is automatically estimated from your power data using the 3-parameter critical power model (Morton, 1996). It updates nightly as you ride.<br/>
            <strong>FTP</strong> is your manual input and is used for all TSS calculations, power zones, and workout targets. You stay in control of when it changes — use "Copy CP → FTP" when you agree with the model's estimate.
          </div>
        </div>

        {/* TSS */}
        <div className="card">
          <div className="card-title">TSS Calculation</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <p><strong>Power meter:</strong> TSS = (t × NP × IF) / FTP × 100</p>
            <p style={{ marginTop: 8 }}><strong>HR only:</strong> HR-TSS using LTHR estimate</p>
            <p style={{ marginTop: 8 }}><strong>No data:</strong> Estimated from activity type and duration</p>
          </div>
        </div>
      </div>

      {/* Recalculate TSS */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-title">Recalculate Historical TSS</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 14 }}>
          <p>If your initial FTP was set too low, all historical power-based TSS values will be inflated, causing CTL to be too high.</p>
          <p style={{ marginTop: 8 }}>This recalculates TSS for all power activities using the current estimated FTP, then rebuilds the PMC. Run this once after your FTP has been correctly estimated.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={async () => {
          await fetch('/trainiq/strava/recalculate-tss', { method: 'POST' })
          alert('TSS recalculation started — this may take a minute. PMC will rebuild automatically when done.')
        }}>
          Recalculate TSS + Rebuild PMC
        </button>
      </div>

      {/* Backfill GPS */}
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 14 }}>
          <p>Re-fetches GPS tracks for older cycling activities that were imported without location data. Required for complete Gemeente detection.</p>
          <p style={{ marginTop: 8 }}>This may take a while for large histories — progress shows in the app log.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={async () => {
          await fetch('/trainiq/strava/backfill-latlng', { method: 'POST' })
          alert('Backfill started — check the app log for progress. Run Re-scan on the Gemeenten page when complete.')
        }}>
          Backfill GPS Tracks
        </button>
      </div>

      {/* Strava Setup */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-title">Strava API Setup Instructions</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
          <ol style={{ paddingLeft: 18 }}>
            <li>Go to <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener" style={{ color: 'var(--accent2)' }}>strava.com/settings/api</a></li>
            <li>Set <strong>Authorization Callback Domain</strong> to your HA hostname only, e.g. <code style={{ background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4 }}>homeassistant.local</code></li>
            <li>Copy <strong>Client ID</strong> and <strong>Client Secret</strong> into the HA app Configuration tab</li>
            <li>Restart the app</li>
            <li>Enter your full HA URL above (with https://) and click <strong>Connect Strava</strong></li>
          </ol>
        </div>
      </div>
    </div>
  )
}
