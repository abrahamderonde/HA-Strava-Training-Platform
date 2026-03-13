import { useState, useEffect } from 'react'

export default function Settings() {
  const [status, setStatus] = useState(null)
  const [config, setConfig] = useState(null)
  const [haUrl, setHaUrl] = useState(() => localStorage.getItem('ha_url') || '')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/trainiq/strava/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(e => console.error('Status fetch failed:', e))

    fetch('/trainiq/settings')
      .then(r => r.json())
      .then(setConfig)
      .catch(e => console.error('Settings fetch failed:', e))
  }, [])

  const connectStrava = async () => {
    setError(null)
    setLoading(true)
    try {
      const callbackUrl = haUrl.trim() || window.location.origin
      const fetchUrl = `/api/strava/auth-url?ha_url=${encodeURIComponent(callbackUrl)}`
      console.log('Fetching auth URL from:', fetchUrl)
      const res = await fetch(fetchUrl)
      console.log('Response status:', res.status)
      const data = await res.json()
      console.log('Auth URL data:', data)
      if (data.url) {
        window.location.href = data.url
      } else {
        setError('No URL returned. Check that Strava Client ID and Secret are configured.')
      }
    } catch (e) {
      console.error('Connect Strava error:', e)
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
        {/* Strava Connection */}
        <div className="card">
          <div className="card-title">Strava Connection</div>

          {config && !config.strava_configured && (
            <div style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--accent)' }}>
              ⚠️ Strava Client ID and Secret not configured in HA app settings.
            </div>
          )}

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#ef4444' }}>
              {error}
            </div>
          )}

          {status?.authenticated ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span className="status-dot" />
                <span style={{ fontSize: 14 }}>Connected as <strong>{status.athlete_name}</strong></span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                New activities sync automatically. Use "Sync Strava" on the dashboard to import history.
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
                Connect your Strava account to import activities.
              </p>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Home Assistant URL (for Strava redirect callback)
                </label>
                <input
                  type="text"
                  value={haUrl}
                  onChange={e => setHaUrl(e.target.value)}
                  placeholder="homeassistant.local:8088"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'var(--surface2)',
                    color: 'var(--text)', fontSize: 13, boxSizing: 'border-box'
                  }}
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Use port 8088 (direct app port, not 8123). In Strava API settings set Authorization Callback Domain to just the hostname without port.
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={connectStrava}
                disabled={loading}
                style={{ opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'Connecting...' : 'Connect Strava'}
              </button>
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

        {/* FTP Model */}
        <div className="card">
          <div className="card-title">FTP &amp; Power Model</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <p>Automatically estimated from last 60 days of power data using the <strong>3-parameter Critical Power model</strong> (Morton, 1996):</p>
            <code style={{ display: 'block', margin: '8px 0', background: 'var(--surface2)', padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--accent2)' }}>
              P(t) = W'/t + CP + (Pmax−CP)·e^(−t/τ)
            </code>
            <p>FTP = CP. Re-fit nightly at 2:00 AM. Initial FTP is used until enough power data is available.</p>
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
