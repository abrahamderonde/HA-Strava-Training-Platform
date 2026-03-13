import { useState, useEffect } from 'react'

export default function Settings() {
  const [status, setStatus] = useState(null)
  const [config, setConfig] = useState(null)
  const [haUrl, setHaUrl] = useState(() => localStorage.getItem('ha_url') || window.location.origin)

  useEffect(() => {
    fetch('/api/strava/status').then(r => r.json()).then(setStatus).catch(() => {})
    fetch('/api/settings').then(r => r.json()).then(setConfig).catch(() => {})
  }, [])

  const connectStrava = async () => {
    localStorage.setItem('ha_url', haUrl)
    const res = await fetch(`/api/strava/auth-url?ha_url=${encodeURIComponent(haUrl)}`)
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
    } else {
      alert('Failed to get Strava auth URL. Check that Strava Client ID and Secret are configured in the app settings.')
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
              ⚠️ Strava Client ID and Secret are not configured. Go to the app Configuration tab in Home Assistant first.
            </div>
          )}
          {status?.authenticated ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span className="status-dot" />
                <span style={{ fontSize: 14 }}>Connected as <strong>{status.athlete_name}</strong></span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                New activities will automatically sync via webhook.
                Use the "Sync Strava" button on the dashboard to import history.
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
                Connect your Strava account to import activities.
              </p>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Your Home Assistant URL (needed for Strava redirect)
                </label>
                <input
                  type="text"
                  value={haUrl}
                  onChange={e => setHaUrl(e.target.value)}
                  placeholder="http://homeassistant.local:8123"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'var(--surface2)',
                    color: 'var(--text)', fontSize: 13, boxSizing: 'border-box'
                  }}
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Also set this as the Authorization Callback Domain in your Strava API settings.
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={connectStrava}
                disabled={config && !config.strava_configured}
              >
                Connect Strava
              </button>
            </div>
          )}
        </div>

        {/* Current Config Values */}
        <div className="card">
          <div className="card-title">Current Configuration</div>
          {config ? (
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
                <span style={{ color: 'var(--muted)' }}>Athlete weight</span>
                <strong>{config.athlete_weight_kg} kg</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
                <span style={{ color: 'var(--muted)' }}>Initial FTP</span>
                <strong>{config.ftp_initial} W</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
                <span style={{ color: 'var(--muted)' }}>Strava</span>
                <strong style={{ color: config.strava_configured ? 'var(--accent2)' : 'var(--accent)' }}>
                  {config.strava_configured ? '✓ Configured' : '✗ Not configured'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
                <span style={{ color: 'var(--muted)' }}>Garmin</span>
                <strong style={{ color: config.garmin_configured ? 'var(--accent2)' : 'var(--muted)' }}>
                  {config.garmin_configured ? '✓ Configured' : '— Not configured'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>AI Planning</span>
                <strong style={{ color: config.anthropic_configured ? 'var(--accent2)' : 'var(--muted)' }}>
                  {config.anthropic_configured ? '✓ Configured' : '— Not configured'}
                </strong>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
                To change these values go to <strong>Settings → Apps → Strava Training Platform → Configuration</strong> in Home Assistant.
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
            <p>FTP is automatically estimated from your last 60 days of power data using the
              <strong> 3-parameter Critical Power model</strong> (Morton, 1996):</p>
            <code style={{
              display: 'block', marginTop: 8, marginBottom: 8,
              background: 'var(--surface2)', padding: '8px 12px',
              borderRadius: 6, fontSize: 12, color: 'var(--accent2)',
            }}>
              P(t) = W'/t + CP + (Pmax−CP)·e^(−t/τ)
            </code>
            <p>FTP = CP (Critical Power). Re-fit nightly at 2:00 AM.</p>
            <p style={{ marginTop: 8 }}>Until enough power data is available, the initial FTP from configuration is used.</p>
          </div>
        </div>

        {/* TSS */}
        <div className="card">
          <div className="card-title">TSS Calculation</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <p><strong>With power meter:</strong> TSS = (t × NP × IF) / FTP × 100</p>
            <p style={{ marginTop: 8 }}><strong>With HR only:</strong> HR-TSS using LTHR estimate</p>
            <p style={{ marginTop: 8 }}><strong>No data:</strong> Estimated from activity type and duration</p>
          </div>
        </div>
      </div>

      {/* Strava Setup Instructions */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-title">Strava API Setup Instructions</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
          <ol style={{ paddingLeft: 18 }}>
            <li>Go to <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener" style={{ color: 'var(--accent2)' }}>strava.com/settings/api</a></li>
            <li>Create a new application</li>
            <li>Set <strong>Authorization Callback Domain</strong> to your Home Assistant hostname or IP (e.g. <code style={{ background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4 }}>homeassistant.local</code>)</li>
            <li>Copy your <strong>Client ID</strong> and <strong>Client Secret</strong></li>
            <li>Enter them in the app Configuration tab in Home Assistant and restart the app</li>
            <li>Enter your full HA URL above and click <strong>Connect Strava</strong></li>
          </ol>
        </div>
      </div>
    </div>
  )
}
