import { useState, useEffect, useRef } from 'react'
import { MapPin, RefreshCw, Upload, X, Star, CheckCircle, AlertCircle } from 'lucide-react'

export default function Gemeenten() {
  const mapRef = useRef(null)
  const leafletMap = useRef(null)
  const geoLayer = useRef(null)
  const trackLayerRef = useRef(null)

  const [stats, setStats] = useState(null)
  const [visited, setVisited] = useState([])
  const [boundaries, setBoundaries] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [highlightYear, setHighlightYear] = useState('all')

  // GPX route-preview state — null means "normal" year-filter view
  const [gpxResult, setGpxResult] = useState(null)
  const [gpxLoading, setGpxLoading] = useState(false)
  const [gpxError, setGpxError] = useState(null)
  const [dragging, setDragging] = useState(false)

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
      const [visitedRes, boundsRes] = await Promise.all([
        fetch('/trainiq/gemeenten/visited').then(r => r.json()),
        fetch('/trainiq/gemeenten/boundaries').then(r => r.json()),
      ])
      setVisited(visitedRes.visited || [])
      setStats(visitedRes.stats || null)
      setBoundaries(boundsRes)
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

  // Redraw gemeente coloring whenever the year filter, visited list, or a GPX
  // result changes. When gpxResult is set, it takes priority styling; clearing
  // it (via the "Clear route" button or the year-filter buttons) returns to
  // the normal visited/year view.
  useEffect(() => {
    if (!mapReady || !leafletMap.current || !boundaries) return
    const L = window.L

    const visitedMap = {}
    for (const v of visited) visitedMap[v.code] = v
    const visitedAll = new Set(visited.map(v => v.code))

    const highlighted = new Set()
    for (const v of visited) {
      if (highlightYear === 'all') highlighted.add(v.code)
      else {
        const year = v.first_visit ? new Date(v.first_visit).getFullYear() : null
        if (year === parseInt(highlightYear)) highlighted.add(v.code)
      }
    }

    const newCodes = new Set(gpxResult?.new_gemeenten?.map(g => g.code) || [])
    const alreadyCodes = new Set(gpxResult?.already_gemeenten?.map(g => g.code) || [])

    if (geoLayer.current) leafletMap.current.removeLayer(geoLayer.current)

    geoLayer.current = L.geoJSON(boundaries, {
      style: (feature) => {
        const props = feature.properties || {}
        const code = props.statcode || props.gemeentecode || props.code || ''

        if (gpxResult) {
          // Route-preview mode
          if (newCodes.has(code)) return { fillColor: '#22c55e', fillOpacity: 0.65, color: '#4ade80', weight: 2 }
          if (alreadyCodes.has(code)) return { fillColor: '#ef4444', fillOpacity: 0.55, color: '#f87171', weight: 2 }
          if (visitedAll.has(code)) return { fillColor: '#f97316', fillOpacity: 0.35, color: '#fb923c', weight: 1 }
          return { fillColor: '#1e2533', fillOpacity: 0.5, color: '#2d3748', weight: 0.5 }
        }

        // Normal year-filter mode
        if (highlighted.has(code)) return { fillColor: '#f97316', fillOpacity: 0.8, color: '#fb923c', weight: 1.5 }
        if (visitedAll.has(code) && highlightYear !== 'all') return { fillColor: '#f97316', fillOpacity: 0.25, color: '#f97316', weight: 0.5 }
        return { fillColor: '#1e2533', fillOpacity: 0.55, color: '#2d3748', weight: 0.5 }
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {}
        const code = props.statcode || props.gemeentecode || props.code || ''
        const name = props.statnaam || props.gemeentenaam || props.naam || code
        const v = visitedMap[code]

        let statusHtml
        if (gpxResult) {
          if (newCodes.has(code)) statusHtml = '<span style="color:#22c55e">🌟 New on this route!</span>'
          else if (alreadyCodes.has(code)) statusHtml = '<span style="color:#ef4444">✓ Already visited (on route)</span>'
          else if (visitedAll.has(code)) statusHtml = '<span style="color:#f97316">✓ Already visited</span>'
          else statusHtml = '<span style="color:#6b7280">○ Not on this route</span>'
        } else {
          const year = v && v.first_visit ? new Date(v.first_visit).getFullYear() : null
          statusHtml = v
            ? '<span style="color:#f97316">Visited ' + (year || '') + '</span>'
            : '<span style="color:#6b7280">Not yet visited</span>'
        }
        layer.bindTooltip(
          '<div style="font-family:sans-serif;font-size:13px"><strong>' + name + '</strong><br/>' + statusHtml + '</div>',
          { sticky: true }
        )
        layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.95, weight: 2 }))
        layer.on('mouseout', () => {
          const style = geoLayer.current.options.style(feature)
          layer.setStyle(style)
        })
      }
    }).addTo(leafletMap.current)
  }, [mapReady, boundaries, visited, highlightYear, gpxResult])

  // Draw the GPX track polyline on top, and fit bounds to it
  useEffect(() => {
    if (!mapReady || !leafletMap.current) return
    const L = window.L
    if (trackLayerRef.current) {
      leafletMap.current.removeLayer(trackLayerRef.current)
      trackLayerRef.current = null
    }
    if (gpxResult?.track_preview?.length > 1) {
      trackLayerRef.current = L.polyline(gpxResult.track_preview, {
        color: '#ffffff', weight: 2.5, opacity: 0.9
      }).addTo(leafletMap.current)
      leafletMap.current.fitBounds(trackLayerRef.current.getBounds(), { padding: [40, 40] })
    }
  }, [gpxResult, mapReady])

  const triggerScan = async () => {
    setScanning(true)
    await fetch('/trainiq/gemeenten/scan-all', { method: 'POST' })
    setTimeout(async () => { await fetchData(); setScanning(false) }, 3000)
  }

  const uploadGpx = async (file) => {
    if (!file || !file.name.endsWith('.gpx')) { setGpxError('Please upload a .gpx file'); return }
    setGpxLoading(true)
    setGpxError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/trainiq/gemeenten/check-gpx', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      const data = await res.json()
      if (data.error) { setGpxError(data.error); return }
      setGpxResult(data)
    } catch (e) {
      setGpxError(e.message)
    } finally {
      setGpxLoading(false)
    }
  }

  const clearRoute = () => {
    setGpxResult(null)
    setGpxError(null)
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
        {stats && !gpxResult && (
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

        {/* GPX route-preview stats replace the normal stats while active */}
        {gpxResult && (
          <div className="stat-grid" style={{ flex: '1 1 300px', marginBottom: 0 }}>
            <div className="stat-tile">
              <div className="stat-label">Total crossed</div>
              <div className="stat-value">{gpxResult.total_crossed}</div>
              <div className="stat-delta" style={{ color: 'var(--muted)' }}>gemeenten</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">🌟 New!</div>
              <div className="stat-value" style={{ color: '#22c55e' }}>{gpxResult.new_count}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Already visited</div>
              <div className="stat-value" style={{ color: 'var(--muted)' }}>{gpxResult.already_count}</div>
            </div>
          </div>
        )}

        <div className="card" style={{ flex: '1 1 200px', padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            Highlight year {gpxResult && <span style={{ color: 'var(--accent)' }}>(clears route preview)</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => { setHighlightYear('all'); clearRoute() }}
              style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid', fontSize: 12, cursor: 'pointer',
                borderColor: highlightYear === 'all' && !gpxResult ? 'var(--accent)' : 'var(--border)',
                background: highlightYear === 'all' && !gpxResult ? 'rgba(249,115,22,0.15)' : 'transparent',
                color: highlightYear === 'all' && !gpxResult ? 'var(--accent)' : 'var(--muted)' }}>
              All
            </button>
            {years.map(y => (
              <button key={y} onClick={() => { setHighlightYear(String(y)); clearRoute() }}
                style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: highlightYear === String(y) && !gpxResult ? 'var(--accent2)' : 'var(--border)',
                  background: highlightYear === String(y) && !gpxResult ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: highlightYear === String(y) && !gpxResult ? 'var(--accent2)' : 'var(--muted)' }}>
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Compact GPX drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); uploadGpx(e.dataTransfer.files[0]) }}
          onClick={() => document.getElementById('gpx-input-compact').click()}
          style={{
            flex: '1 1 220px', minWidth: 200,
            border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 10, padding: '12px 14px', textAlign: 'center', cursor: 'pointer',
            background: dragging ? 'rgba(249,115,22,0.06)' : 'var(--card)',
            transition: 'all 0.2s', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <input id="gpx-input-compact" type="file" accept=".gpx" style={{ display: 'none' }}
            onChange={(e) => uploadGpx(e.target.files[0])} />
          {gpxResult ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Route loaded</div>
              <button onClick={(e) => { e.stopPropagation(); clearRoute() }}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)',
                  background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                <X size={11} /> Clear route
              </button>
            </>
          ) : (
            <>
              <Upload size={18} style={{ color: 'var(--accent)', marginBottom: 6 }} />
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {gpxLoading ? 'Analysing…' : 'Drop planned route (.gpx)'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                See which gemeenten it'll add
              </div>
            </>
          )}
        </div>
      </div>

      {gpxError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: '#ef4444',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <AlertCircle size={15} /> {gpxError}
        </div>
      )}

      {gpxResult && (
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
        </div>
      )}

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
          {gpxResult ? (
            <>
              <div className="card-title" style={{ marginBottom: 10, color: '#22c55e' }}>
                🌟 New gemeenten ({gpxResult.new_count})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                {gpxResult.new_gemeenten?.map(g => (
                  <div key={g.code} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, fontSize: 13 }}>
                    <Star size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{g.name}</span>
                  </div>
                ))}
                {gpxResult.new_count === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>No new gemeenten on this route.</div>
                )}
              </div>
              {gpxResult.already_count > 0 && (
                <>
                  <div className="card-title" style={{ marginBottom: 10, fontSize: 13 }}>
                    Already visited ({gpxResult.already_count})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {gpxResult.already_gemeenten?.map(g => (
                      <div key={g.code} style={{ display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 8px', background: 'var(--surface2)', borderRadius: 6, fontSize: 12 }}>
                        <CheckCircle size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <span>{g.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
