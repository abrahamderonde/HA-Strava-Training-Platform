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
import {
  LayoutDashboard, Calendar as CalIcon, TrendingUp,
  Zap, Target, Settings as SettingsIcon, Activity,
  Map, FileSearch, Award, Bike
} from 'lucide-react'
import './index.css'

const NAV = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/calendar',     icon: CalIcon,          label: 'Calendar'   },
  { to: '/pmc',          icon: TrendingUp,       label: 'PMC'        },
  { to: '/power-curve',  icon: Zap,              label: 'Power'      },
  { to: '/planning',     icon: Target,           label: 'Planning'   },
  { to: '/gemeenten',    icon: Map,              label: 'Gemeenten'  },
  { to: '/gpx-checker',  icon: FileSearch,       label: 'GPX Check'  },
  { to: '/eddington',    icon: Award,            label: 'Eddington'  },
  { to: '/commutes',     icon: Bike,             label: 'Commutes'   },
  { to: '/settings',     icon: SettingsIcon,     label: 'Settings'   },
]

export default function App() {
  const [stravaConnected, setStravaConnected] = useState(false)

  useEffect(() => {
    fetch('/trainiq/strava/status')
      .then(r => r.json())
      .then(d => setStravaConnected(d.authenticated))
      .catch(() => {})
  }, [])

  return (
    <BrowserRouter>
      <div className="app-shell">
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
            <Route path="/commutes"     element={<CommuteGenerator />} />
            <Route path="/settings"     element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
