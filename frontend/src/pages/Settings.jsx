import { useState, useEffect } from 'react'

export default function Settings() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    fetch('/api/strava/status').then(r => r.json()).then(setStatus)
  }, [])

  const connectStrava = async () => {
    const res = await fetch('/api/strava/auth-url')
    const { url } = await res.json()
    window.location.href = url
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Connections and configuration</p>
      </div>

      <div className="section-grid">
        <div className="card">
          <div className="card-title">Strava Connection</div>
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
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6 }}>
                Connect your Strava account to import activities and enable real-time webhook sync.
              </p>
              <button className="btn btn-primary" onClick={connectStrava}>
                Connect Strava
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Configuration</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <p>All credentials are configured in the Home Assistant add-on settings panel:</p>
            <ul style={{ marginTop: 8, paddingLeft: 16 }}>
              <li>Strava Client ID &amp; Secret</li>
              <li>Garmin email &amp; password</li>
              <li>Anthropic API key (for AI planning)</li>
              <li>Athlete weight &amp; initial FTP</li>
            </ul>
            <p style={{ marginTop: 10 }}>
              To change these, go to <strong>Settings → Add-ons → Strava Training Platform → Configuration</strong>.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-title">FTP &amp; Power Model</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <p>FTP is automatically estimated from your last 60 days of power data using the
              <strong> 3-parameter Critical Power model</strong> (Morton, 1996):</p>
            <code style={{
              display: 'block', marginTop: 8, marginBottom: 8,
              background: 'var(--surface2)', padding: '8px 12px',
              borderRadius: 6, fontSize: 12,
              color: 'var(--accent2)',
            }}>
              P(t) = W'/t + CP + (Pmax−CP)·e^(−t/τ)
            </code>
            <p>FTP = CP (Critical Power). The model is re-fit nightly at 2:00 AM.</p>
          </div>
        </div>

        <div className="card">
          <div className="card-title">TSS Calculation</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <p><strong>With power meter:</strong> TSS = (t × NP × IF) / FTP × 100</p>
            <p style={{ marginTop: 8 }}><strong>With HR only:</strong> HR-TSS using LTHR estimate</p>
            <p style={{ marginTop: 8 }}><strong>No data (commutes):</strong> Estimated from activity type and duration</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Strava API Setup Instructions</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
          <ol style={{ paddingLeft: 18 }}>
            <li>Go to <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener" style={{ color: 'var(--accent2)' }}>strava.com/settings/api</a></li>
            <li>Create a new application — set the <strong>Authorization Callback Domain</strong> to your Home Assistant IP/hostname</li>
            <li>Copy your <strong>Client ID</strong> and <strong>Client Secret</strong></li>
            <li>Enter them in the add-on Configuration tab in Home Assistant</li>
            <li>Restart the add-on and click <strong>Connect Strava</strong> above</li>
            <li>For webhooks: Strava must be able to reach your HA instance.
              If you're using Nabu Casa, the webhook URL is:<br />
              <code style={{
                background: 'var(--surface2)', padding: '4px 8px',
                borderRadius: 4, fontSize: 11, color: 'var(--accent2)',
              }}>
                https://YOUR_HA_URL/api/strava/webhook
              </code>
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
