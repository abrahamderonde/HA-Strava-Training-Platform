import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import PMC from './pages/PMC'
import PowerCurve from './pages/PowerCurve'
import Planning from './pages/Planning'
import Gemeenten from './pages/Gemeenten'
import GpxChecker from './pages/GpxChecker'
import Eddington from './pages/Eddington'
import Settings from './pages/Settings'
import CommuteGenerator from './pages/CommuteGenerator'
import Stats from './pages/Stats'
import {
  LayoutDashboard, Calendar as CalIcon, TrendingUp,
  Zap, Target, Settings as SettingsIcon, Activity,
  Map, FileSearch, Award, Bike, BarChart2
} from 'lucide-react'
import './index.css'

const NAV = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/calendar',     icon: CalIcon,          label: 'Calendar'   },
  { to: '/pmc',          icon: TrendingUp,       label: 'PMC'        },
  { to: '/power-curve',  icon: Zap,              label: 'Power'      },
  { to: '/planning',     icon: Target,           label: 'Planning'   },
  { to: '/gemeenten',    icon: Map,              label: 'NL Challenge'  },
  { to: '/gpx-checker',  icon: FileSearch,       label: 'GPX Check'  },
  { to: '/eddington',    icon: Award,            label: 'Eddington'  },
  { to: '/stats',        icon: BarChart2,        label: 'Stats'      },
  { to: '/commutes',     icon: Bike,             label: 'Commutes'   },
  { to: '/settings',     icon: SettingsIcon,     label: 'Settings'   },
]

export default function App() {
  const [stravaConnected, setStravaConnected] = useState(false)
  const [cpNotif, setCpNotif] = useState(null) // {new_cp, user_ftp, difference}

  useEffect(() => {
    fetch('/trainiq/strava/status')
      .then(r => r.json())
      .then(d => setStravaConnected(d.authenticated))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/trainiq/analytics/cp-changed')
      .then(r => r.json())
      .then(d => { if (d.changed) setCpNotif(d) })
      .catch(() => {})
  }, [])

  const acceptCp = async () => {
    await fetch('/trainiq/analytics/accept-cp-as-ftp', { method: 'POST' })
    setCpNotif(null)
  }
  const dismissCp = async () => {
    await fetch('/trainiq/analytics/dismiss-cp-notification', { method: 'POST' })
    setCpNotif(null)
  }

  return (
    <BrowserRouter>
      <div className="app-shell">

        {cpNotif && (
          <div style={{
            position: 'fixed', top: 20, right: 20, zIndex: 1000,
            background: 'var(--card)', border: '1px solid var(--border)',
            borderLeft: '4px solid #f97316', borderRadius: 8,
            padding: '16px 20px', maxWidth: 340, boxShadow: '0 4px 24px rgba(0,0,0,0.4)'
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>
              🔋 CP Updated
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Your Critical Power estimate changed to <strong style={{color:'var(--text)'}}>{cpNotif.new_cp}W</strong>
              {' '}({cpNotif.difference > 0 ? '+' : ''}{cpNotif.difference}W vs your FTP of {cpNotif.user_ftp}W).
              <br/><br/>
              CP is auto-calculated from your rides. FTP is your manual input used for TSS and zones.
              Do you want to copy this CP to your FTP?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={acceptCp}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 6, border: 'none',
                  background: '#f97316', color: '#fff', fontWeight: 600,
                  cursor: 'pointer', fontSize: 13
                }}>
                Yes, update FTP
              </button>
              <button
                onClick={dismissCp}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--muted)', cursor: 'pointer', fontSize: 13
                }}>
                Keep current FTP
              </button>
            </div>
          </div>
        )}

        <nav className="sidebar">
          <div className="sidebar-logo">
            <Activity size={24} />
            <span>TrainIQ</span>
          </div>

          <ul className="nav-links">
            {NAV.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          {stravaConnected && (
            <div className="sidebar-status">
              <span className="status-dot" />
              Strava connected
            </div>
          )}
        </nav>

        <main className="main-content">
          <Routes>
            <Route path="/"             element={<Dashboard />} />
            <Route path="/calendar"     element={<Calendar />} />
            <Route path="/pmc"          element={<PMC />} />
            <Route path="/power-curve"  element={<PowerCurve />} />
            <Route path="/planning"     element={<Planning />} />
            <Route path="/gemeenten"    element={<Gemeenten />} />
            <Route path="/gpx-checker"  element={<GpxChecker />} />
            <Route path="/eddington"    element={<Eddington />} />
            <Route path="/stats"       element={<Stats />} />
            <Route path="/commutes"     element={<CommuteGenerator />} />
            <Route path="/settings"     element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
