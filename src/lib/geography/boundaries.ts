import type { BoundaryCollection, BoundaryFeature, GeoLevel } from './types'

const ROOT = 'https://raw.githubusercontent.com/bendlikeabamboo/barangay-boundaries-repository/main/2023-10-24/hierarchical_t0p005'
const urls: Record<GeoLevel, string> = {
  region: `${ROOT}/regions.geojson`,
  province: `${ROOT}/provinces.geojson`,
  municipality: 'https://raw.githubusercontent.com/bendlikeabamboo/barangay-boundaries-repository/main/2023-10-24/raw_t0p005/adm3.geojson',
  barangay: 'https://raw.githubusercontent.com/bendlikeabamboo/barangay-boundaries-repository/main/2023-10-24/raw_t0p005/adm4.geojson',
}
const cache = new Map<GeoLevel, Promise<BoundaryFeature[]>>()

async function loadCollection(url: string, timeoutMs = 15000): Promise<BoundaryFeature[]> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Boundary request failed: ${response.status}`)
    const collection = await response.json() as BoundaryCollection
    return collection.features
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw new Error('Boundary request timed out. Check your internet connection and try again.')
    throw cause
  } finally {
    window.clearTimeout(timeout)
  }
}

function normalizeBarangays(features: BoundaryFeature[]): BoundaryFeature[] {
  return features.map((feature) => {
    const properties = feature.properties
    if (properties.psgc_code) return feature
    const code = String(properties.ADM4_PCODE ?? '').replace(/^PH/, '')
    return { ...feature, properties: { ...properties, psgc_code: code, psgc_name: properties.ADM4_EN ?? '' } }
  })
}

function normalizeMunicipalities(features: BoundaryFeature[]): BoundaryFeature[] {
  return features.map((feature) => {
    const properties = feature.properties
    if (properties.psgc_code) return feature
    const adm3Code = String(properties.ADM3_PCODE ?? '').replace(/^PH/, '')
    return { ...feature, properties: { ...properties, psgc_code: `${adm3Code}000`, psgc_name: properties.ADM3_EN ?? '' } }
  })
}

function uniqueByCode(features: BoundaryFeature[]): BoundaryFeature[] {
  return [...new Map(features.filter((feature) => feature.properties.psgc_code).map((feature) => [String(feature.properties.psgc_code), feature])).values()]
}

export async function loadBoundaries(level: GeoLevel, parentCode?: string): Promise<BoundaryFeature[]> {
  if (!cache.has(level)) {
    const timeoutMs = level === 'barangay' ? 120000 : 15000
    cache.set(level, level === 'municipality' ? loadCollection(urls[level], timeoutMs).then(normalizeMunicipalities).then(uniqueByCode) : level === 'barangay' ? loadCollection(urls[level], timeoutMs).then(normalizeBarangays).then(uniqueByCode) : loadCollection(urls[level], timeoutMs).then(uniqueByCode))
  }
  const request = cache.get(level)!
  let features: BoundaryFeature[]
  try {
    features = await request
  } catch (cause) {
    if (cache.get(level) === request) cache.delete(level)
    throw cause
  }
  if (!parentCode) return features
  const normalizedParent = parentCode.replace(/^PH/, '')
  const prefixLength = level === 'province' ? 2 : level === 'municipality' ? 5 : level === 'barangay' ? 7 : 0
  if (!prefixLength) return features
  const prefix = normalizedParent.slice(0, prefixLength)
  return features.filter((feature) => String(feature.properties.psgc_code ?? '').replace(/^PH/, '').startsWith(prefix))
}

export async function preloadBoundaries(): Promise<Record<GeoLevel, BoundaryFeature[]>> {
  const [region, province, municipality, barangay] = await Promise.all([
    loadBoundaries('region'),
    loadBoundaries('province'),
    loadBoundaries('municipality'),
    loadBoundaries('barangay'),
  ])
  return { region, province, municipality, barangay }
}

export const boundarySources = {
  repository: 'https://github.com/bendlikeabamboo/barangay-boundaries-repository',
  version: '2023-10-24',
  provenance: 'NAMRIA administrative boundary shapefiles and PSA PSGC snapshots',
}
