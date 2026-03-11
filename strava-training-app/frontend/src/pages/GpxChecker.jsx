import { useState, useRef, useEffect } from 'react'
import { Upload, CheckCircle, AlertCircle, MapPin, Star } from 'lucide-react'

export default function GpxChecker() {
  const mapRef = useRef(null)
  const leafletMap = useRef(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const trackLayerRef = useRef(null)
  const newLayerRef = useRef(null)
  const visitedLayerRef = useRef(null)

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

  useEffect(() => {
    if (!mapReady || !mapRef.current || leafletMap.current) return
    const L = window.L
    leafletMap.current = L.map(mapRef.current, { center: [52.3, 5.3], zoom: 7 })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB', maxZoom: 19
    }).addTo(leafletMap.current)
  }, [mapReady])

  // Draw result on map
  useEffect(() => {
    if (!mapReady || !result || !leafletMap.current) return
    const L = window.L

    // Remove old layers
    ;[trackLayerRef, newLayerRef, visitedLayerRef].forEach(ref => {
      if (ref.current) leafletMap.current.removeLayer(ref.current)
    })

    // Draw GPS track
    if (result.track_preview?.length > 1) {
      trackLayerRef.current = L.polyline(result.track_preview, {
        color: '#f97316', weight: 3, opacity: 0.8
      }).addTo(leafletMap.current)
      leafletMap.current.fitBounds(trackLayerRef.current.getBounds(), { padding: [30, 30] })
    }

    // Load boundaries to highlight crossed gemeenten
    loadHighlightedBoundaries(result)
  }, [result, mapReady])

  const loadHighlightedBoundaries = async (res) => {
    const L = window.L
    if (!L) return
    try {
      const geoRes = await fetch('/api/gemeenten/boundaries')
      const geojson = await geoRes.json()
      const newCodes = new Set(res.new_gemeenten?.map(g => g.code) || [])
      const alreadyCodes = new Set(res.already_gemeenten?.map(g => g.code) || [])
      const allCodes = new Set([...newCodes, ...alreadyCodes])

      const layer = L.geoJSON(geojson, {
        filter: (feature) => {
          const props = feature.properties || {}
          const code = props.statcode || props.gemeentecode || props.code || ''
          return allCodes.has(code)
        },
        style: (feature) => {
          const props = feature.properties || {}
          const code = props.statcode || props.gemeentecode || props.code || ''
          const isNew = newCodes.has(code)
          return {
            fillColor: isNew ? '#22c55e' : '#f97316',
            fillOpacity: 0.4,
            color: isNew ? '#4ade80' : '#fb923c',
            weight: 2,
          }
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {}
          const code = props.statcode || props.gemeentecode || props.code || ''
          const name = props.statnaam || props.gemeentenaam || props.naam || code
          const isNew = newCodes.has(code)
          layer.bindTooltip(
            `<strong>${name}</strong><br/>${isNew ? '🌟 New gemeente!' : '✓ Already visited'}`,
            { sticky: true }
          )
        }
      }).addTo(leafletMap.current)

      newLayerRef.current = layer
    } catch (e) {}
  }

  const uploadGpx = async (file) => {
    if (!file || !file.name.endsWith('.gpx')) {
      setError('Please upload a .gpx file')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/api/gemeenten/check-gpx', { method: 'POST', body: form })
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

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadGpx(file)
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
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 14,
          padding: '40px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'rgba(249,115,22,0.06)' : 'var(--surface)',
          transition: 'all 0.2s',
          marginBottom: 20,
        }}
        onClick={() => document.getElementById('gpx-input').click()}
      >
        <input
          id="gpx-input"
          type="file"
          accept=".gpx"
          style={{ display: 'none' }}
          onChange={(e) => uploadGpx(e.target.files[0])}
        />
        <Upload size={32} style={{ color: 'var(--accent)', margin: '0 auto 12px' }} />
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
          {loading ? 'Analysing route…' : 'Drop GPX file here'}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          or click to browse · Strava, Komoot, Garmin exports all work
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10, padding: '12px 16px', marginBottom: 16,
          color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {result && (
        <>
          {/* Summary */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-tile">
              <div className="stat-label">Total crossed</div>
              <div className="stat-value">{result.total_crossed}</div>
              <div className="stat-delta" style={{ color: 'var(--muted)' }}>gemeenten</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">🌟 New!</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>{result.new_count}</div>
              <div className="stat-delta positive">new gemeenten</div>
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

          {/* Map */}
          <div style={{
            borderRadius: 14, overflow: 'hidden',
            border: '1px solid var(--border)', marginBottom: 20,
            height: 420,
          }}>
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          </div>

          {/* Gemeente lists */}
          <div className="section-grid">
            {result.new_count > 0 && (
              <div className="card">
                <div className="card-title" style={{ color: 'var(--green)' }}>
                  🌟 New gemeenten ({result.new_count})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.new_gemeenten.map(g => (
                    <div key={g.code} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px',
                      background: 'rgba(34,197,94,0.08)',
                      border: '1px solid rgba(34,197,94,0.2)',
                      borderRadius: 7, fontSize: 13,
                    }}>
                      <Star size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
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
                    <div key={g.code} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 12px',
                      background: 'var(--surface2)',
                      borderRadius: 7, fontSize: 13,
                    }}>
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

      {!result && !loading && (
        <div style={{
          borderRadius: 14, overflow: 'hidden',
          border: '1px solid var(--border)', height: 380,
        }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>
      )}
    </div>
  )
}
