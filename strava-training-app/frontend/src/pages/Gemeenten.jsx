import { useState, useEffect, useRef } from 'react'
import { Map, MapPin, RefreshCw } from 'lucide-react'

/**
 * Dutch gemeente choropleth map using Leaflet + PDOK boundaries.
 * Visited = deep orange, unvisited = dark slate.
 */
export default function Gemeenten() {
  const mapRef = useRef(null)
  const leafletMap = useRef(null)
  const geoLayer = useRef(null)

  const [stats, setStats] = useState(null)
  const [visited, setVisited] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  // Load Leaflet dynamically
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

  useEffect(() => {
    fetchData()
  }, [])

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

    leafletMap.current = L.map(mapRef.current, {
      center: [52.3, 5.3],
      zoom: 7,
      zoomControl: true,
    })

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { attribution: '© OpenStreetMap © CartoDB', maxZoom: 19 }
    ).addTo(leafletMap.current)
  }, [mapReady])

  // Re-render gemeente layer when data changes
  useEffect(() => {
    if (!mapReady || !leafletMap.current) return
    loadGemeenteLayer()
  }, [mapReady, visited])

  const loadGemeenteLayer = async () => {
    const L = window.L
    if (!L) return

    try {
      const res = await fetch('/trainiq/gemeenten/boundaries')
      const geojson = await res.json()
      const visitedCodes = new Set(visited.map(v => v.code))

      if (geoLayer.current) {
        leafletMap.current.removeLayer(geoLayer.current)
      }

      geoLayer.current = L.geoJSON(geojson, {
        style: (feature) => {
          const props = feature.properties || {}
          const code = props.statcode || props.gemeentecode || props.code || ''
          const isVisited = visitedCodes.has(code)
          return {
            fillColor: isVisited ? '#f97316' : '#1e2533',
            fillOpacity: isVisited ? 0.75 : 0.5,
            color: isVisited ? '#fb923c' : '#2d3748',
            weight: isVisited ? 1.5 : 0.5,
          }
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {}
          const code = props.statcode || props.gemeentecode || props.code || ''
          const name = props.statnaam || props.gemeentenaam || props.naam || code
          const isVisited = new Set(visited.map(v => v.code)).has(code)
          const visitInfo = visited.find(v => v.code === code)

          layer.bindTooltip(
            `<div style="font-family:sans-serif;font-size:13px">
              <strong>${name}</strong><br/>
              ${isVisited
                ? `<span style="color:#f97316">✓ Visited</span>${visitInfo?.first_visit ? ` · ${new Date(visitInfo.first_visit).toLocaleDateString('nl-NL')}` : ''}`
                : '<span style="color:#6b7280">Not yet visited</span>'}
            </div>`,
            { sticky: true }
          )

          layer.on('mouseover', () => {
            layer.setStyle({ fillOpacity: isVisited ? 0.95 : 0.7, weight: 2 })
          })
          layer.on('mouseout', () => {
            layer.setStyle({
              fillOpacity: isVisited ? 0.75 : 0.5,
              weight: isVisited ? 1.5 : 0.5,
            })
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
    setTimeout(async () => {
      await fetchData()
      setScanning(false)
    }, 3000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 20 }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Gemeentekaart</h1>
          <p className="page-subtitle">Dutch municipalities visited by cycling</p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={triggerScan}
          disabled={scanning}
        >
          <RefreshCw size={14} className={scanning ? 'spin' : ''} />
          {scanning ? 'Scanning…' : 'Re-scan activities'}
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="stat-grid" style={{ marginBottom: 0 }}>
          <div className="stat-tile">
            <div className="stat-label">Visited</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.visited_count}</div>
            <div className="stat-delta" style={{ color: 'var(--muted)' }}>gemeenten</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Total NL</div>
            <div className="stat-value">{stats.total_count}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Coverage</div>
            <div className="stat-value" style={{ color: stats.percentage > 50 ? 'var(--green)' : 'var(--text)' }}>
              {stats.percentage}
              <span className="stat-unit">%</span>
            </div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Remaining</div>
            <div className="stat-value">{stats.total_count - stats.visited_count}</div>
          </div>
        </div>
      )}

      {/* Map */}
      <div style={{
        flex: 1,
        minHeight: 500,
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        position: 'relative',
      }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 500 }} />
        {!mapReady && (
          <div className="loading" style={{ position: 'absolute', inset: 0, background: 'var(--surface)' }}>
            Loading map…
          </div>
        )}
      </div>

      {/* Visited list */}
      {visited.length > 0 && (
        <div className="card">
          <div className="card-title">Recently Visited Gemeenten</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 6,
            maxHeight: 260,
            overflowY: 'auto',
          }}>
            {[...visited]
              .sort((a, b) => (b.first_visit || '').localeCompare(a.first_visit || ''))
              .slice(0, 60)
              .map(g => (
                <div key={g.code} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: 'var(--surface2)',
                  borderRadius: 6,
                  fontSize: 13,
                }}>
                  <MapPin size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 500 }}>{g.name}</span>
                  {g.first_visit && (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {new Date(g.first_visit).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
