import { useState, useEffect, useRef } from 'react'
import { MapPin, RefreshCw } from 'lucide-react'

export default function Gemeenten() {
  const mapRef = useRef(null)
  const leafletMap = useRef(null)
  const geoLayer = useRef(null)

  const [stats, setStats] = useState(null)
  const [visited, setVisited] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [highlightYear, setHighlightYear] = useState('all')

  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
  }, [])

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/trainiq/gemeenten/visited')
      const data = await res.json()
      setVisited(data.visited || [])
      setStats(data.stats || null)
    } catch (e) {}
    setLoading(false)
  }

  useEffect(() => {
    if (!mapReady || !mapRef.current || leafletMap.current) return
    const L = window.L
    leafletMap.current = L.map(mapRef.current, { center: [52.3, 5.3], zoom: 7 })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { attribution: '© OpenStreetMap © CartoDB', maxZoom: 19 }
    ).addTo(leafletMap.current)
  }, [mapReady])

  useEffect(() => {
    if (!mapReady || !leafletMap.current) return
    loadGemeenteLayer()
  }, [mapReady, visited, highlightYear])

  const loadGemeenteLayer = async () => {
    const L = window.L
    if (!L) return
    try {
      const res = await fetch('/trainiq/gemeenten/boundaries')
      const geojson = await res.json()

      const visitedMap = {}
      for (const v of visited) visitedMap[v.code] = v

      const highlighted = new Set()
      for (const v of visited) {
        if (highlightYear === 'all') {
          highlighted.add(v.code)
        } else {
          const year = v.first_visit ? new Date(v.first_visit).getFullYear() : null
          if (year === parseInt(highlightYear)) highlighted.add(v.code)
        }
      }
      const visitedAll = new Set(visited.map(v => v.code))

      if (geoLayer.current) leafletMap.current.removeLayer(geoLayer.current)

      geoLayer.current = L.geoJSON(geojson, {
        style: (feature) => {
          const props = feature.properties || {}
          const code = props.statcode || props.gemeentecode || props.code || ''
          if (highlighted.has(code)) {
            return { fillColor: '#f97316', fillOpacity: 0.8, color: '#fb923c', weight: 1.5 }
          }
          if (visitedAll.has(code) && highlightYear !== 'all') {
            return { fillColor: '#f97316', fillOpacity: 0.25, color: '#f97316', weight: 0.5 }
          }
          return { fillColor: '#1e2533', fillOpacity: 0.55, color: '#2d3748', weight: 0.5 }
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {}
          const code = props.statcode || props.gemeentecode || props.code || ''
          const name = props.statnaam || props.gemeentenaam || props.naam || code
          const v = visitedMap[code]
          const year = v && v.first_visit ? new Date(v.first_visit).getFullYear() : null
          const visitedColor = '#f97316'
          const mutedColor = '#6b7280'
          const visitedText = v
            ? '<span style="color:' + visitedColor + '">Visited ' + (year || '') + '</span>'
            : '<span style="color:' + mutedColor + '">Not yet visited</span>'
          layer.bindTooltip(
            '<div style="font-family:sans-serif;font-size:13px"><strong>' + name + '</strong><br/>' + visitedText + '</div>',
            { sticky: true }
          )
          layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.95, weight: 2 }))
          layer.on('mouseout', () => {
            if (highlighted.has(code)) layer.setStyle({ fillOpacity: 0.8, weight: 1.5 })
            else if (visitedAll.has(code)) layer.setStyle({ fillOpacity: 0.25, weight: 0.5 })
            else layer.setStyle({ fillOpacity: 0.55, weight: 0.5 })
          })
        }
      }).addTo(leafletMap.current)
    } catch (e) {
      console.error('Failed to load gemeente boundaries:', e)
    }
  }

  const triggerScan = async () => {
    setScanning(true)
    await fetch('/trainiq/gemeenten/scan-all', { method: 'POST' })
    setTimeout(async () => { await fetchData(); setScanning(false) }, 3000)
  }

  const years = [...new Set(
    visited.map(v => v.first_visit ? new Date(v.first_visit).getFullYear() : null).filter(Boolean)
  )].sort()

  const recentVisited = [...visited]
    .filter(v => {
      if (highlightYear === 'all') return true
      return v.first_visit && new Date(v.first_visit).getFullYear() === parseInt(highlightYear)
    })
    .sort((a, b) => (b.first_visit || '').localeCompare(a.first_visit || ''))

  const highlightCount = highlightYear === 'all' ? (stats ? stats.visited_count : 0) : recentVisited.length

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Long Term NL Challenge</h1>
          <p className="page-subtitle">Dutch municipalities visited by cycling</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={triggerScan} disabled={scanning}>
          <RefreshCw size={14} className={scanning ? 'spin' : ''} />
          {scanning ? 'Scanning…' : 'Re-scan'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {stats && (
          <div className="stat-grid" style={{ flex: '1 1 300px', marginBottom: 0 }}>
            <div className="stat-tile">
              <div className="stat-label">Total visited</div>
              <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.visited_count}</div>
              <div className="stat-delta" style={{ color: 'var(--muted)' }}>of {stats.total_count}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Coverage</div>
              <div className="stat-value">{stats.percentage}<span className="stat-unit">%</span></div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">{highlightYear === 'all' ? 'Remaining' : 'In ' + highlightYear}</div>
              <div className="stat-value" style={{ color: highlightYear !== 'all' ? 'var(--accent2)' : 'var(--text)' }}>
                {highlightYear === 'all' ? stats.total_count - stats.visited_count : highlightCount}
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ flex: '1 1 200px', padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Highlight year</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setHighlightYear('all')}
              style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid', fontSize: 12, cursor: 'pointer',
                borderColor: highlightYear === 'all' ? 'var(--accent)' : 'var(--border)',
                background: highlightYear === 'all' ? 'rgba(249,115,22,0.15)' : 'transparent',
                color: highlightYear === 'all' ? 'var(--accent)' : 'var(--muted)' }}>
              All
            </button>
            {years.map(y => (
              <button key={y} onClick={() => setHighlightYear(String(y))}
                style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: highlightYear === String(y) ? 'var(--accent2)' : 'var(--border)',
                  background: highlightYear === String(y) ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: highlightYear === String(y) ? 'var(--accent2)' : 'var(--muted)' }}>
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, minHeight: 520 }}>
        <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', minHeight: 520, position: 'relative' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 520 }} />
          {!mapReady && (
            <div style={{ position: 'absolute', inset: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
              Loading map…
            </div>
          )}
        </div>

        <div className="card" style={{ overflowY: 'auto', maxHeight: 520, padding: '14px 16px' }}>
          <div className="card-title" style={{ marginBottom: 10 }}>
            {highlightYear === 'all' ? 'Recently visited' : 'Visited in ' + highlightYear}
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>({recentVisited.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentVisited.slice(0, 80).map(g => (
              <div key={g.code} style={{ display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 8px', background: 'var(--surface2)', borderRadius: 6, fontSize: 13 }}>
                <MapPin size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 500 }}>{g.name}</span>
                {g.first_visit && (
                  <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                    {new Date(g.first_visit).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
  )
}
