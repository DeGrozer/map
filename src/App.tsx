import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { loadBoundaries, boundarySources } from './lib/geography/boundaries'
import { listChildren } from './lib/geography/psgc'
import type { BoundaryFeature, GeoLevel, Geography } from './lib/geography/types'

type ViewState = { level: GeoLevel; parent: Geography | null; features: BoundaryFeature[] }
const levelLabels: Record<GeoLevel, string> = { region: 'Regions', province: 'Provinces', municipality: 'Cities / Municipalities', barangay: 'Barangays' }
const property = (feature: BoundaryFeature, key: string) => String(feature.properties[key] ?? '')
const featureCode = (feature: BoundaryFeature) => property(feature, 'psgc_code')
const featureName = (feature: BoundaryFeature) => property(feature, 'psgc_name') || property(feature, 'ADM1ALT1EN') || property(feature, 'ADM2_EN') || property(feature, 'ADM3_EN') || property(feature, 'ADM4_EN')
const toLeafletFeature = (feature: BoundaryFeature): GeoJSON.Feature => ({ type: 'Feature', properties: feature.properties, geometry: feature.geometry as GeoJSON.Geometry })
const regionLabels: Record<string, string> = { '01': 'Region I', '02': 'Region II', '03': 'Region III', '04': 'Region IV-A', '05': 'Region V', '06': 'Region VI', '07': 'Region VII', '08': 'Region VIII', '09': 'Region IX', '10': 'Region X', '11': 'Region XI', '12': 'Region XII', '13': 'NCR', '14': 'CAR', '15': 'BARMM', '16': 'Region XIII', '17': 'MIMAROPA' }

function App() {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GeoJSON | null>(null)
  const barangayLayerRef = useRef<L.GeoJSON | null>(null)
  const provinceLayerRef = useRef<L.GeoJSON | null>(null)
  const municipalityLayerRef = useRef<L.GeoJSON | null>(null)
  const spotlightLayerRef = useRef<L.GeoJSON | null>(null)
  const preloadedRef = useRef<Record<GeoLevel, BoundaryFeature[]> | null>(null)
  const municipalityTypesRef = useRef<Map<string, string>>(new Map())
  const hoveredLayerRef = useRef<L.Layer | null>(null)
  const navigationIdRef = useRef(0)
  const fittedViewRef = useRef<ViewState | null>(null)
  const [view, setView] = useState<ViewState>({ level: 'region', parent: null, features: [] })
  const [trail, setTrail] = useState<Geography[]>([])
  const [hovered, setHovered] = useState<BoundaryFeature | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingLevel, setLoadingLevel] = useState<GeoLevel>('region')
  const [enteredAtlas, setEnteredAtlas] = useState(false)
  const [loadingBarangays, setLoadingBarangays] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [error, setError] = useState('')
  const [selectedPlace, setSelectedPlace] = useState<BoundaryFeature | null>(null)
  const [selectedPlaceLevel, setSelectedPlaceLevel] = useState<GeoLevel | null>(null)
  const [detailSideOpen, setDetailSideOpen] = useState(false)
  const [activeMunicipality, setActiveMunicipality] = useState<BoundaryFeature | null>(null)
  const [selectedBarangays, setSelectedBarangays] = useState<BoundaryFeature[]>([])
  const [regionScope, setRegionScope] = useState<Geography | null>(null)
  const [showMunicipalityScope, setShowMunicipalityScope] = useState(false)
  const [showCities, setShowCities] = useState(true)
  const [showMunicipalities, setShowMunicipalities] = useState(true)
  const [showBarangays, setShowBarangays] = useState(false)
  const [typesReady, setTypesReady] = useState(false)
  const [typeVersion, setTypeVersion] = useState(0)

  const regionalMunicipalities = regionScope && preloadedRef.current
    ? preloadedRef.current.municipality.filter((feature) => featureCode(feature).replace(/^PH/, '').startsWith(regionScope.code.replace(/^PH/, '').slice(0, 2)))
    : []
  const displayedLevel: GeoLevel = showMunicipalityScope && regionScope ? 'municipality' : view.level
  const featuresBeforeTypeFilter = showMunicipalityScope && regionScope ? regionalMunicipalities : view.features
  const visibleFeatures = displayedLevel === 'municipality' ? featuresBeforeTypeFilter.filter((feature) => {
    const type = municipalityTypesRef.current.get(featureCode(feature))
    if (type === 'City') return showCities
    if (type === 'Mun') return showMunicipalities
    return showCities || showMunicipalities
  }) : featuresBeforeTypeFilter

  useEffect(() => {
    const map = L.map(mapElement.current!, { zoomControl: false, attributionControl: false, preferCanvas: false, worldCopyJump: false, minZoom: 2, maxZoom: 18 })
    map.createPane('spotlight-pane').style.zIndex = '650'
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    let disposed = false
    const initialize = async () => {
      try {
        const regions = await loadBoundaries('region')
        if (disposed) return
        const data = { region: regions, province: [], municipality: [], barangay: [] } as Record<GeoLevel, BoundaryFeature[]>
        preloadedRef.current = data
        await changeLevel('region', null, [])
        void Promise.all([loadBoundaries('province'), loadBoundaries('municipality')]).then(([provinces, municipalities]) => {
          if (disposed) return
          data.province = provinces
          data.municipality = municipalities
          setTypeVersion((version) => version + 1)
        }).catch(() => undefined)
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : 'Unable to load boundary data')
          setLoading(false)
        }
      }
    }
    void initialize()
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layerRef.current?.removeFrom(map)
    if (!visibleFeatures.length) return
    const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: visibleFeatures.map(toLeafletFeature) }
    let featureIndex = 0
    const layer = L.geoJSON(collection, {
      style: () => styleFor(),
      onEachFeature: (_feature, featureLayer) => {
        const boundary = visibleFeatures[featureIndex++]
        featureLayer.on({ mouseover: (event) => { hoveredLayerRef.current = featureLayer; setHovered(boundary); (event.target as L.Path).setStyle(hoverStyle(displayedLevel)) }, mouseout: (event) => { setHovered(null); hoveredLayerRef.current = null; (event.target as L.Path).setStyle(styleFor(displayedLevel)) }, click: (event) => { event.originalEvent.stopPropagation(); void openBoundary(boundary, displayedLevel) } })
      },
    }).addTo(map)
    layerRef.current = layer
    if (displayedLevel === 'region' && map.getZoom() >= 6) layer.removeFrom(map)
    const bounds = layer.getBounds()
    if (bounds.isValid() && fittedViewRef.current !== view) {
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: displayedLevel === 'barangay' ? 13 : displayedLevel === 'municipality' ? 10 : 7, animate: true })
      fittedViewRef.current = view
    }
    return () => { layer.removeFrom(map); if (layerRef.current === layer) layerRef.current = null }
  }, [view, showCities, showMunicipalities, showMunicipalityScope, regionScope?.code, typeVersion])

  useEffect(() => {
    const region = regionScope
    const data = preloadedRef.current
    if (!region || !data) return
    let disposed = false
    setTypesReady(false)
    const regionPrefix = region.code.replace(/^PH/, '').slice(0, 2)
    const provinces = data.province.filter((feature) => property(feature, 'ADM1_PCODE').replace(/^PH/, '').startsWith(regionPrefix))
    void Promise.all(provinces.map((feature) => listChildren({ code: featureCode(feature), name: featureName(feature), level: 'province' }))).then((groups) => {
      if (disposed) return
      for (const place of groups.flat()) municipalityTypesRef.current.set(place.code, place.type ?? '')
      setTypesReady(true)
      setTypeVersion((version) => version + 1)
    }).catch(() => {
      if (!disposed) { setTypesReady(true); setTypeVersion((version) => version + 1) }
    })
    return () => { disposed = true }
  }, [regionScope?.code])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !showBarangays || !selectedBarangays.length) {
      barangayLayerRef.current?.remove()
      barangayLayerRef.current = null
      return
    }
    barangayLayerRef.current?.remove()
    const boundaries = new Map(selectedBarangays.map((feature) => [featureCode(feature), feature]))
    const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: selectedBarangays.map(toLeafletFeature) }
    const layer = L.geoJSON(collection, {
      style: { color: '#496e80', weight: 1, fillColor: '#f4e7bd', fillOpacity: .88 },
      onEachFeature: (feature, featureLayer) => {
        const boundary = boundaries.get(String(feature.properties?.psgc_code ?? ''))
        if (!boundary) return
        featureLayer.on({
          mouseover: (event) => { hoveredLayerRef.current = featureLayer; setHovered(boundary); (event.target as L.Path).setStyle({ color: '#123f4b', weight: 2.4, fillColor: '#f5c451', fillOpacity: .96 }) },
          mouseout: (event) => { hoveredLayerRef.current = null; setHovered(null); (event.target as L.Path).setStyle({ color: '#496e80', weight: 1, fillColor: '#f4e7bd', fillOpacity: .88 }) },
          click: () => { setSelectedPlace(boundary); setSelectedPlaceLevel('barangay'); setDetailSideOpen(true) },
        })
      },
    }).addTo(map)
    barangayLayerRef.current = layer
    return () => { layer.remove(); if (barangayLayerRef.current === layer) barangayLayerRef.current = null }
  }, [showBarangays, selectedBarangays])

  useEffect(() => {
    const map = mapRef.current
    const data = preloadedRef.current
    if (!map || view.level !== 'region' || !data) return
    const provinceCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: data.province.map(toLeafletFeature) }
    let provinceIndex = 0
    const provinceLayer = L.geoJSON(provinceCollection, {
      style: { color: '#3c7380', weight: 1.15, fillColor: '#cbe5e7', fillOpacity: .48 },
      onEachFeature: (_feature, featureLayer) => {
        const boundary = data.province[provinceIndex++]
        featureLayer.on({
          mouseover: (event) => { hoveredLayerRef.current = featureLayer; setHovered(boundary); (event.target as L.Path).setStyle({ color: '#123f4b', weight: 2.5, fillColor: '#f5c451', fillOpacity: .9 }) },
          mouseout: (event) => { hoveredLayerRef.current = null; setHovered(null); (event.target as L.Path).setStyle({ color: '#3c7380', weight: 1.15, fillColor: '#cbe5e7', fillOpacity: .48 }) },
          click: (event) => { event.originalEvent.stopPropagation(); void openProvinceBoundary(boundary) },
        })
      },
    })
    const municipalityCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: data.municipality.map(toLeafletFeature) }
    let municipalityIndex = 0
    const municipalityLayer = L.geoJSON(municipalityCollection, {
      style: { color: '#477c83', weight: .8, fillColor: '#f2e4b6', fillOpacity: .5 },
      onEachFeature: (_feature, featureLayer) => {
        const boundary = data.municipality[municipalityIndex++]
        featureLayer.on({
          mouseover: (event) => { hoveredLayerRef.current = featureLayer; setHovered(boundary); (event.target as L.Path).setStyle({ color: '#123f4b', weight: 2.6, fillColor: '#f5c451', fillOpacity: .92 }) },
          mouseout: (event) => { hoveredLayerRef.current = null; setHovered(null); (event.target as L.Path).setStyle({ color: '#477c83', weight: .8, fillColor: '#f2e4b6', fillOpacity: .5 }) },
          click: (event) => { event.originalEvent.stopPropagation(); void openMunicipalityBoundary(boundary) },
        })
      },
    })
    provinceLayerRef.current = provinceLayer
    municipalityLayerRef.current = municipalityLayer
    const refresh = () => {
      if (showMunicipalityScope && regionScope) {
        layerRef.current?.addTo(map)
        provinceLayer.removeFrom(map)
        municipalityLayer.removeFrom(map)
        return
      }
      const zoom = map.getZoom()
      if (zoom < 6) layerRef.current?.addTo(map)
      else layerRef.current?.removeFrom(map)
      if (zoom >= 6 && zoom < 8) provinceLayer.addTo(map)
      else provinceLayer.removeFrom(map)
      if (zoom >= 8) municipalityLayer.addTo(map)
      else municipalityLayer.removeFrom(map)
    }
    map.on('zoomend', refresh)
    refresh()
    return () => {
      map.off('zoomend', refresh)
      provinceLayer.removeFrom(map)
      municipalityLayer.removeFrom(map)
      provinceLayerRef.current = null
      municipalityLayerRef.current = null
    }
  }, [view.level, showMunicipalityScope, regionScope?.code, typeVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !detailSideOpen) return
    const frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    return () => cancelAnimationFrame(frame)
  }, [detailSideOpen])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedPlace) { spotlightLayerRef.current?.remove(); spotlightLayerRef.current = null; return }
    spotlightLayerRef.current?.remove()
    const highlighted = [selectedPlace]
    if (showBarangays && activeMunicipality && featureCode(selectedPlace) !== featureCode(activeMunicipality)) highlighted.push(activeMunicipality)
    const highlight = L.geoJSON({ type: 'FeatureCollection', features: highlighted.map(toLeafletFeature) } as GeoJSON.FeatureCollection, {
      pane: 'spotlight-pane',
      style: (feature) => feature?.properties?.psgc_code === featureCode(activeMunicipality ?? selectedPlace) && showBarangays
        ? { color: '#f5c451', weight: 3, opacity: 1, fillColor: '#f5c451', fillOpacity: 0 }
        : { color: '#f5c451', weight: 3.5, opacity: 1, fillColor: '#f5c451', fillOpacity: 0.24 },
      interactive: false,
    }).addTo(map)
    highlight.bringToFront()
    spotlightLayerRef.current = highlight
    return () => { highlight.remove(); if (spotlightLayerRef.current === highlight) spotlightLayerRef.current = null }
  }, [selectedPlace, activeMunicipality, showBarangays])

  function styleFor(level: GeoLevel = view.level) { return { color: level === 'barangay' ? '#64909b' : '#658992', weight: level === 'barangay' ? 0.9 : 1.2, opacity: 0.95, fill: true, fillColor: level === 'barangay' ? '#eaf0df' : '#f5e8bd', fillOpacity: 0.88 } }
  function hoverStyle(level: GeoLevel) { return { color: '#123f4b', weight: level === 'barangay' ? 2 : 2.8, fillColor: '#f5c451', fillOpacity: .96 } }
  function regionName(feature: BoundaryFeature) {
    const sourceName = property(feature, 'ADM1_EN') || property(feature, 'ADM1ALT1EN') || 'Philippines'
    const code = (property(feature, 'ADM1_PCODE') || featureCode(feature)).replace(/^PH/, '').slice(0, 2)
    const label = regionLabels[code]
    return label && label.startsWith('Region ') ? `${label} (${sourceName.replace(/^Region [IVXLC-]+ \((.*)\)$/, '$1')})` : label || sourceName
  }
  function hoverContext(feature: BoundaryFeature) { const region = regionName(feature); const province = property(feature, 'ADM2_EN'); const municipality = property(feature, 'ADM3_EN'); return municipality ? `${region} · ${municipality}` : province ? `${region} · ${province}` : region }

  function ancestor(boundary: BoundaryFeature, level: 'region' | 'province'): Geography {
    const code = featureCode(boundary).replace(/^PH/, '')
    if (level === 'region') return { code: property(boundary, 'ADM1_PCODE').replace(/^PH/, '') || code.slice(0, 2), name: regionName(boundary), level }
    return { code: property(boundary, 'ADM2_PCODE').replace(/^PH/, '') || code.slice(0, 5), name: property(boundary, 'ADM2_EN') || 'Province', level }
  }

  async function openProvinceBoundary(boundary: BoundaryFeature) {
    const region = ancestor(boundary, 'region')
    const province: Geography = { code: featureCode(boundary), name: featureName(boundary), level: 'province' }
    setRegionScope(region)
    await changeLevel('municipality', province, [region, province])
  }

  async function openMunicipalityBoundary(boundary: BoundaryFeature) {
    const municipality: Geography = { code: featureCode(boundary), name: featureName(boundary), level: 'municipality' }
    const region = ancestor(boundary, 'region')
    const nextTrail = [region, ancestor(boundary, 'province'), municipality]
    setSelectedPlace(boundary)
    setSelectedPlaceLevel('municipality')
    setDetailSideOpen(true)
    setActiveMunicipality(boundary)
    setRegionScope(region)
    setShowMunicipalityScope(true)
    setTrail(nextTrail)
    if (showBarangays) setSelectedBarangays(await loadBoundaries('barangay', municipality.code))
    const bounds = L.geoJSON(toLeafletFeature(boundary)).getBounds()
    if (bounds.isValid() && mapRef.current) mapRef.current.fitBounds(bounds, { padding: [72, 72], maxZoom: 10, animate: true })
  }

  async function toggleBarangayFilter() {
    const next = !showBarangays
    setShowBarangays(next)
    if (!next || !activeMunicipality) {
      setSelectedBarangays([])
      if (selectedPlaceLevel === 'barangay') { setSelectedPlace(activeMunicipality); setSelectedPlaceLevel(activeMunicipality ? 'municipality' : null) }
      return
    }
    setLoadingBarangays(true)
    try {
      setSelectedBarangays(await loadBoundaries('barangay', featureCode(activeMunicipality)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load barangay boundaries')
    } finally {
      setLoadingBarangays(false)
    }
  }

  async function openBoundary(boundary: BoundaryFeature, level: GeoLevel = view.level) {
    const geography: Geography = { code: featureCode(boundary), name: featureName(boundary), level }
    if (level === 'barangay') {
      setSelectedPlace(boundary)
      setSelectedPlaceLevel('barangay')
      setDetailSideOpen(true)
      return
    }
    const nextTrail = [...trail, geography]
    if (level === 'municipality') {
      await openMunicipalityBoundary(boundary)
      return
    }
    if (level === 'region') setRegionScope(geography)
    await changeLevel(level === 'region' ? 'province' : 'municipality', geography, nextTrail)
  }

  async function changeLevel(level: GeoLevel, parent: Geography | null, nextTrail: Geography[]) { const navigationId = ++navigationIdRef.current; setLoadingLevel(level); setLoading(true); setError(''); try { const features = await loadBoundaries(level, parent?.code); if (navigationId !== navigationIdRef.current) return; setView({ level, parent, features }); setTrail(nextTrail) } catch (cause) { if (navigationId === navigationIdRef.current) setError(cause instanceof Error ? cause.message : 'Unable to load boundaries') } finally { if (navigationId === navigationIdRef.current) setLoading(false) } }
  function enterAtlas() {
    setEnteredAtlas(true)
    const map = mapRef.current
    if (map) map.setZoom(Math.min(map.getZoom() + 0.7, map.getMaxZoom()), { animate: true })
  }
  async function goToRegionView() {
    if (!regionScope) return
    setDetailSideOpen(false)
    setSelectedPlace(null)
    setSelectedPlaceLevel(null)
    setActiveMunicipality(null)
    setSelectedBarangays([])
    setShowBarangays(false)
    setShowMunicipalityScope(false)
    await changeLevel('province', regionScope, [regionScope])
  }
  async function goToFullMap() {
    setDetailSideOpen(false)
    setSelectedPlace(null)
    setSelectedPlaceLevel(null)
    setActiveMunicipality(null)
    setSelectedBarangays([])
    setShowBarangays(false)
    setShowMunicipalityScope(false)
    setRegionScope(null)
    await changeLevel('region', null, [])
  }
  async function goTo(index: number) { setDetailSideOpen(false); setSelectedPlace(null); setSelectedPlaceLevel(null); setActiveMunicipality(null); setSelectedBarangays([]); setShowBarangays(false); setShowMunicipalityScope(false); const target = index < 0 ? null : trail[index]; setRegionScope(target?.level === 'region' ? target : target ? trail[0] ?? null : null); const level: GeoLevel = target ? target.level : 'region'; const parent = target ? trail[index - 1] ?? null : null; await changeLevel(level, parent, index < 0 ? [] : trail.slice(0, index)) }

  return <main className={`map-experience${enteredAtlas ? '' : ' is-splashed'}`}>
    <header className="minimal-header"><a className="wordmark" href="#top"><span className="flag" aria-label="Philippine flag" /><span>PHILIPPINE<br /><b>GEOBASE</b></span></a></header>
    <section className="map-stage" id="top">
      <div className="stage-top"><p className="kicker">Explore the archipelago</p><h1>{view.parent ? view.parent.name.replace(/^Region [IVXLC]+ \(/, '').replace(/\)$/, '') : 'Philippines'}</h1><div className="breadcrumbs">{trail.length > 0 && <><button onClick={() => void goTo(-1)}>PHILIPPINES</button>{trail.map((item, index) => <span key={`${item.level}-${item.code}`}><b>/</b><button onClick={() => void goTo(index)}>{item.name.replace(/^Region [IVXLC]+ \(/, '').replace(/\)$/, '')}</button></span>)}</>}</div></div>
      <div className={`map-wrap${detailSideOpen ? ' has-side-panel' : ''}`}>
        <div className="brand-stamp"><strong>PHILIPPINE GEOBASE</strong><small>PSGC · ADMINISTRATIVE BOUNDARIES</small></div>
        {regionScope && <div className="map-filters" aria-label="Boundary filters">
          <button className={showCities ? 'is-active' : ''} aria-pressed={showCities} disabled={!typesReady} onClick={() => { setShowCities((value) => showMunicipalityScope ? !value : true); setShowMunicipalityScope(true) }}><i /> Cities</button>
          <button className={showMunicipalities ? 'is-active' : ''} aria-pressed={showMunicipalities} disabled={!typesReady} onClick={() => { setShowMunicipalities((value) => showMunicipalityScope ? !value : true); setShowMunicipalityScope(true) }}><i /> Municipalities</button>
          <button className={showBarangays ? 'is-active' : ''} aria-pressed={showBarangays} disabled={!activeMunicipality} onClick={() => void toggleBarangayFilter()}><i /> Barangays</button>
        </div>}
        <div className="map-info"><span>{levelLabels[displayedLevel].toUpperCase()}</span><strong>{visibleFeatures.length.toLocaleString()} boundaries</strong><small>CLICK A BOUNDARY TO EXPLORE</small></div>
        <div ref={mapElement} className="leaflet-map" aria-label={`Interactive map showing Philippine ${levelLabels[displayedLevel].toLowerCase()}`} />
        {trail.length > 0 && <nav className="map-filters map-view-actions" aria-label="Map view navigation">
          {regionScope && <button onClick={() => void goToRegionView()}>Region view</button>}
          <button onClick={() => void goToFullMap()}>Full map</button>
        </nav>}
        {showBarangays && activeMunicipality && <div className="map-exploration"><span>EXPLORING</span><strong>{featureName(activeMunicipality)}</strong><small>PSGC {featureCode(activeMunicipality)}</small></div>}
        {hovered && <div className="hover-label"><span>{hoverContext(hovered)}</span><strong>{displayedLevel === 'region' ? regionName(hovered) : featureName(hovered)}</strong><small>PSGC {featureCode(hovered)}</small></div>}
        {loadingBarangays && activeMunicipality && <div className="atlas-toast"><span>BOUNDARY INDEX</span><strong>Plotting barangays</strong><small>{featureName(activeMunicipality)} · PSGC {featureCode(activeMunicipality)}</small></div>}
        {loading && <div className={`map-state${preloadedRef.current ? '' : ' map-loading-intro'}`}><span>PHILIPPINE GEOBASE</span><strong>{preloadedRef.current ? `LOADING ${levelLabels[loadingLevel].toUpperCase()}` : 'LOADING PHILIPPINE COORDINATES'}</strong><small>PSGC · ADMINISTRATIVE BOUNDARY DATA</small></div>}
        {error && <div className="map-state error">{error}</div>}
        <div className="map-scale">DRAG TO PAN · SCROLL TO ZOOM</div>
        <button className="atlas-info-button" aria-label="About this atlas and navigation" title="Atlas information" onClick={() => setInfoOpen(true)}>i</button>
      </div>
    </section>
    {detailSideOpen && selectedPlace && (selectedPlaceLevel === 'barangay' || selectedPlaceLevel === 'municipality') && <aside className="place-sidecard" aria-label={`${selectedPlaceLevel} details`}>
      <div className="sidecard-top"><span><i /> PHILIPPINE GEOBASE · PSGC</span><button className="sidecard-close" aria-label="Close place details" onClick={() => setDetailSideOpen(false)}>×</button></div>
      <p className="sidecard-kind">{selectedPlaceLevel === 'barangay' ? 'BARANGAY' : 'CITY / MUNICIPALITY'}</p>
      <h2>{featureName(selectedPlace)}</h2>
      <p className="sidecard-context">{hoverContext(selectedPlace)}</p>
      <div className="sidecard-field"><span>PSGC CODE</span><strong>{featureCode(selectedPlace) || 'Not supplied'}</strong></div>
      <div className="sidecard-field"><span>PROVINCE</span><strong>{property(selectedPlace, 'ADM2_EN') || 'Not supplied'}</strong></div>
      <div className="sidecard-field"><span>MUNICIPALITY / CITY</span><strong>{property(selectedPlace, 'ADM3_EN') || 'Not supplied'}</strong></div>
      {selectedPlaceLevel === 'municipality' && <button className="sidecard-action" onClick={() => void toggleBarangayFilter()}>{showBarangays ? 'CLOSE BARANGAYS' : 'EXPLORE BARANGAYS'}<span>→</span></button>}
      {selectedPlaceLevel === 'barangay' && activeMunicipality && <button className="sidecard-action" onClick={() => { setSelectedPlace(activeMunicipality); setSelectedPlaceLevel('municipality') }}>BACK TO {featureName(activeMunicipality).toUpperCase()}<span>←</span></button>}
      <div className="sidecard-source"><span>DATA SOURCE</span><strong>{boundarySources.provenance}</strong><small>Boundary data · {boundarySources.version}</small></div>
    </aside>}
    <footer className="map-footer"><span>PHILIPPINE GEOBASE</span><span>Click a region, province, or city to explore.</span></footer>
    {infoOpen && <div className="atlas-info-backdrop" onClick={() => setInfoOpen(false)}>
      <section className="atlas-info-dialog" role="dialog" aria-modal="true" aria-labelledby="atlas-info-title" onClick={(event) => event.stopPropagation()}>
        <div className="atlas-info-heading"><div><span>FIELD GUIDE · PSGC</span><h2 id="atlas-info-title">Using the atlas</h2></div><button aria-label="Close information" onClick={() => setInfoOpen(false)}>×</button></div>
        <ol className="atlas-instructions">
          <li><b>Choose a region</b><span>Click a region to open its provinces.</span></li>
          <li><b>Find a city or municipality</b><span>Choose a province, or use Cities / Municipalities to browse the selected region.</span></li>
          <li><b>Explore barangays</b><span>Select a city, then choose Explore Barangays in its place record.</span></li>
          <li><b>Read a boundary</b><span>Hover for its name and PSGC code. Pan by dragging and zoom with the scroll wheel.</span></li>
        </ol>
        <div className="atlas-credits">
          <div><span>BOUNDARY GEOJSON</span><a href="https://github.com/bendlikeabamboo/barangay-boundaries-repository" target="_blank" rel="noreferrer">Manuel Balmeo · Barangay Boundaries Repository</a><small>PSGC snapshot {boundarySources.version}; polygons derived from NAMRIA shapefiles and enriched with PSA PSGC data. Repository code: MIT.</small></div>
          <div><span>LIVE PSGC LOOKUP API</span><a href="https://psgc.cloud/" target="_blank" rel="noreferrer">PSGC Cloud · John Joshua A. Lipio</a><small>Community-maintained JSON API used for geographic classifications. Verify critical data with official records.</small></div>
          <div><span>ORIGINAL PUBLIC RECORDS</span><p><a href="https://psa.gov.ph/classification/psgc/" target="_blank" rel="noreferrer">Philippine Statistics Authority (PSA)</a><span> · </span><a href="https://namria.gov.ph/" target="_blank" rel="noreferrer">NAMRIA</a></p></div>
        </div>
      </section>
    </div>}
    {!enteredAtlas && <section className="atlas-splash" aria-label="Philippine GeoBase intro">
      <div className="splash-grid"><span>PHILIPPINES</span><span>PSGC BOUNDARY INDEX · 2023</span></div>
      <div className="splash-copy"><p>A field guide to Philippine geography</p><h2>Philippine<br /><em>GeoBase</em></h2><p className="splash-description">Browse administrative boundaries from region to barangay.</p>
        <button className="splash-enter" disabled={loading} onClick={enterAtlas}>{loading ? 'Preparing the map…' : 'Explore the map'}<span>→</span></button>
        {error && <small className="splash-error">{error}</small>}
      </div>
      <div className="splash-footer"><span>ADMINISTRATIVE BOUNDARIES</span><span>PSA PSGC · NAMRIA</span></div>
    </section>}
  </main>
}
export default App
