import { useState, useRef, useEffect } from 'react'
import { Upload, CheckCircle, AlertCircle, Star } from 'lucide-react'

export default function GpxChecker() {
  const mapRef = useRef(null)
  const leafletMap = useRef(null)
  const geoLayerRef = useRef(null)
  const trackLayerRef = useRef(null)
  const [result, setResult] = useState(null)
  const [allVisited, setAllVisited] = useState(new Set())
  const [boundaries, setBoundaries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  // Load Leaflet
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

  // Load visited gemeenten and boundaries on mount
  useEffect(() => {
    fetch('/trainiq/gemeenten/visited')
      .then(r => r.json())
      .then(d => setAllVisited(new Set((d.visited || []).map(v => v.code))))
      .catch(() => {})
    fetch('/trainiq/gemeenten/boundaries')
      .then(r => r.json())
      .then(setBoundaries)
      .catch(() => {})
  }, [])

  // Init map
  useEffect(() => {
    if (!mapReady || !mapRef.current || leafletMap.current) return
    const L = window.L
    leafletMap.current = L.map(mapRef.current, { center: [52.3, 5.3], zoom: 7 })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB', maxZoom: 19
    }).addTo(leafletMap.current)
  }, [mapReady])

  // Render gemeente layer whenever boundaries, visited, or result changes
  useEffect(() => {
    if (!mapReady || !leafletMap.current || !boundaries) return
    const L = window.L

    if (geoLayerRef.current) {
      leafletMap.current.removeLayer(geoLayerRef.current)
    }

    const newCodes = new Set(result?.new_gemeenten?.map(g => g.code) || [])
    const alreadyCodes = new Set(result?.already_gemeenten?.map(g => g.code) || [])

    geoLayerRef.current = L.geoJSON(boundaries, {
      style: (feature) => {
        const props = feature.properties || {}
        const code = props.statcode || props.gemeentecode || props.code || ''

        if (newCodes.has(code)) {
          // New gemeente on this route — bright green
          return { fillColor: '#22c55e', fillOpacity: 0.65, color: '#4ade80', weight: 2 }
        }
        if (alreadyCodes.has(code)) {
          // Already visited on this route — orange/red
          return { fillColor: '#ef4444', fillOpacity: 0.55, color: '#f87171', weight: 2 }
        }
        if (allVisited.has(code)) {
          // Previously visited (not on this route) — orange
          return { fillColor: '#f97316', fillOpacity: 0.45, color: '#fb923c', weight: 1 }
        }
        // Not yet visited — dark grey
        return { fillColor: '#1e2533', fillOpacity: 0.6, color: '#2d3748', weight: 0.5 }
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {}
        const code = props.statcode || props.gemeentecode || props.code || ''
        const name = props.statnaam || props.gemeentenaam || props.naam || code
        let status = '○ Not yet visited'
        if (newCodes.has(code)) status = '🌟 New on this route!'
        else if (alreadyCodes.has(code)) status = '✓ Already visited (on this route)'
        else if (allVisited.has(code)) status = '✓ Already visited'
        layer.bindTooltip(`<strong>${name}</strong><br/><span style="font-size:12px">${status}</span>`, { sticky: true })
      }
    }).addTo(leafletMap.current)
  }, [mapReady, boundaries, allVisited, result])

  // Draw GPS track
  useEffect(() => {
    if (!mapReady || !leafletMap.current) return
    const L = window.L
    if (trackLayerRef.current) {
      leafletMap.current.removeLayer(trackLayerRef.current)
      trackLayerRef.current = null
    }
    if (result?.track_preview?.length > 1) {
      trackLayerRef.current = L.polyline(result.track_preview, {
        color: '#ffffff', weight: 2.5, opacity: 0.9
      }).addTo(leafletMap.current)
      leafletMap.current.fitBounds(trackLayerRef.current.getBounds(), { padding: [40, 40] })
    }
  }, [result, mapReady])

  const uploadGpx = async (file) => {
    if (!file || !file.name.endsWith('.gpx')) { setError('Please upload a .gpx file'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/trainiq/gemeenten/check-gpx', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">GPX Checker</h1>
        <p className="page-subtitle">Upload a planned route to see which new gemeenten you'll visit</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); uploadGpx(e.dataTransfer.files[0]) }}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 14, padding: '32px 24px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? 'rgba(249,115,22,0.06)' : 'var(--surface)',
          transition: 'all 0.2s', marginBottom: 16,
        }}
        onClick={() => document.getElementById('gpx-input').click()}
      >
        <input id="gpx-input" type="file" accept=".gpx" style={{ display: 'none' }}
          onChange={(e) => uploadGpx(e.target.files[0])} />
        <Upload size={28} style={{ color: 'var(--accent)', margin: '0 auto 10px' }} />
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          {loading ? 'Analysing route…' : 'Drop GPX file here'}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          or click to browse · Strava, Komoot, Garmin exports all work
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: '#ef4444',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} />
          New on this route
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />
          Already visited (on route)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#f97316', display: 'inline-block' }} />
          Previously visited
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#1e2533', border: '1px solid #2d3748', display: 'inline-block' }} />
          Not yet visited
        </span>
      </div>

      {/* Map — always in DOM */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20, height: 480 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {result && (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-tile">
              <div className="stat-label">Total crossed</div>
              <div className="stat-value">{result.total_crossed}</div>
              <div className="stat-delta" style={{ color: 'var(--muted)' }}>gemeenten</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">🌟 New!</div>
              <div className="stat-value" style={{ color: '#22c55e' }}>{result.new_count}</div>
              <div className="stat-delta" style={{ color: '#22c55e' }}>new gemeenten</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Already visited</div>
              <div className="stat-value" style={{ color: 'var(--muted)' }}>{result.already_count}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Track points</div>
              <div className="stat-value">{result.point_count?.toLocaleString()}</div>
            </div>
          </div>

          <div className="section-grid">
            {result.new_count > 0 && (
              <div className="card">
                <div className="card-title" style={{ color: '#22c55e' }}>🌟 New gemeenten ({result.new_count})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.new_gemeenten.map(g => (
                    <div key={g.code} style={{ display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 12px', background: 'rgba(34,197,94,0.08)',
                      border: '1px solid rgba(34,197,94,0.2)', borderRadius: 7, fontSize: 13 }}>
                      <Star size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{g.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{g.code}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.already_count > 0 && (
              <div className="card">
                <div className="card-title">Already visited ({result.already_count})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                  {result.already_gemeenten.map(g => (
                    <div key={g.code} style={{ display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 12px', background: 'var(--surface2)', borderRadius: 7, fontSize: 13 }}>
                      <CheckCircle size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <span>{g.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
