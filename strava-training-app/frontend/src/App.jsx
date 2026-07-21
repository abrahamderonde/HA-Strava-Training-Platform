import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import PowerCurve from './pages/PowerCurve'
import Planning from './pages/Planning'
import Gemeenten from './pages/Gemeenten'
import Eddington from './pages/Eddington'
import Settings from './pages/Settings'
import CommuteGenerator from './pages/CommuteGenerator'
import Stats from './pages/Stats'
import {
  LayoutDashboard, Calendar as CalIcon, TrendingUp,
  Zap, Target, Settings as SettingsIcon, Activity,
  Map, Award, Bike, BarChart2, Menu, X
} from 'lucide-react'
import './index.css'

// Primary items shown in the mobile bottom nav (max 4, plus a "More" button)
const PRIMARY_NAV = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/calendar',     icon: CalIcon,          label: 'Calendar'   },
  { to: '/power-curve',  icon: Zap,              label: 'Power'      },
  { to: '/planning',     icon: Target,           label: 'Planning'   },
]

const NAV = [
  ...PRIMARY_NAV,
  { to: '/gemeenten',    icon: Map,              label: 'NL Challenge'  },
  { to: '/eddington',    icon: Award,            label: 'Eddington'  },
  { to: '/stats',        icon: BarChart2,        label: 'Stats'      },
  { to: '/commutes',     icon: Bike,             label: 'Commutes'   },
  { to: '/settings',     icon: SettingsIcon,     label: 'Settings'   },
]

// Items shown in the mobile "More" slide-over (everything not in PRIMARY_NAV)
const MORE_NAV = NAV.filter(item => !PRIMARY_NAV.some(p => p.to === item.to))

export default function App() {
  const [stravaConnected, setStravaConnected] = useState(false)
  const [cpNotif, setCpNotif] = useState(null) // {new_cp, user_ftp, difference}
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  useEffect(() => {
    fetch('/trainiq/strava/status')
      .then(r => r.json())
      .then(d => setStravaConnected(d.authenticated))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/trainiq/analytics/cp-changed')
      .then(r => r.json())
      .then(d => {
        if (!d.changed) return
        // Only show if user hasn't already seen this exact CP value
        const seenCp = localStorage.getItem('cp_notif_seen')
        if (seenCp && Math.abs(parseFloat(seenCp) - d.new_cp) <= 2) return
        setCpNotif(d)
      })
      .catch(() => {})
  }, [])

  const acceptCp = async () => {
    await fetch('/trainiq/analytics/accept-cp-as-ftp', { method: 'POST' })
    localStorage.setItem('cp_notif_seen', String(cpNotif?.new_cp))
    setCpNotif(null)
  }
  const dismissCp = async () => {
    await fetch('/trainiq/analytics/dismiss-cp-notification', { method: 'POST' })
    localStorage.setItem('cp_notif_seen', String(cpNotif?.new_cp))
    setCpNotif(null)
  }

  return (
    <BrowserRouter>
      <div className="app-shell">

        {cpNotif && (
          <div className="cp-notification-toast">
            <div className="cp-toast-header">🔋 CP Updated</div>
            <div className="cp-toast-body">
              Your Critical Power estimate changed to <strong style={{ color: 'var(--text)' }}>{cpNotif.new_cp}W</strong>
              {' '}({cpNotif.difference > 0 ? '+' : ''}{cpNotif.difference}W vs your FTP of {cpNotif.user_ftp}W).
              <br /><br />
              CP is auto-calculated from your rides. FTP is your manual input used for TSS and zones.
              Do you want to copy this CP to your FTP?
            </div>
            <div className="cp-toast-actions">
              <button onClick={acceptCp} className="cp-btn-primary">Yes, update FTP</button>
              <button onClick={dismissCp} className="cp-btn-secondary">Keep current FTP</button>
            </div>
          </div>
        )}

        <nav className="sidebar">
          <div className="sidebar-logo">
            <Activity size={24} />
            <span>TrainIQ</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted)', padding: '0 16px', marginTop: -8, marginBottom: 8, opacity: 0.5 }}>
            build 2026-07-08-01
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

        {/* Mobile bottom navigation — 4 primary items + More */}
        <nav className="mobile-bottom-nav">
          {PRIMARY_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMoreMenuOpen(false)}
              className={({ isActive }) => isActive ? 'mobile-nav-item active' : 'mobile-nav-item'}
            >
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            className={`mobile-nav-item mobile-nav-more ${moreMenuOpen ? 'active' : ''}`}
            onClick={() => setMoreMenuOpen(v => !v)}
          >
            <Menu size={20} />
            <span>More</span>
          </button>
        </nav>

        {/* Mobile slide-over menu for secondary pages */}
        {moreMenuOpen && (
          <div className="mobile-more-overlay" onClick={() => setMoreMenuOpen(false)}>
            <div className="mobile-more-sheet" onClick={e => e.stopPropagation()}>
              <div className="mobile-more-header">
                <span>Menu</span>
                <button className="mobile-more-close" onClick={() => setMoreMenuOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <ul className="mobile-more-links">
                {MORE_NAV.map(({ to, icon: Icon, label }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      onClick={() => setMoreMenuOpen(false)}
                      className={({ isActive }) => isActive ? 'mobile-more-link active' : 'mobile-more-link'}
                    >
                      <Icon size={20} />
                      <span>{label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <main className="main-content">
          <Routes>
            <Route path="/"             element={<Dashboard />} />
            <Route path="/calendar"     element={<Calendar />} />
            <Route path="/power-curve"  element={<PowerCurve />} />
            <Route path="/planning"     element={<Planning />} />
            <Route path="/gemeenten"    element={<Gemeenten />} />
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
