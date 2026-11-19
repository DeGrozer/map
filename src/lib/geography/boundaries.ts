import type { BoundaryCollection, BoundaryFeature, GeoLevel } from './types'

const ROOT = '/data'
const urls: Record<Exclude<GeoLevel, 'municipality'>, string> = {
  region: `${ROOT}/regions.geojson`,
  province: `${ROOT}/provinces.geojson`,
  barangay: `${ROOT}/barangays.geojson`,
}
const cache = new Map<string, Promise<BoundaryFeature[]>>()

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
    const psgcCode = adm3Code.length >= 9 ? adm3Code : `${adm3Code}000`
    return { ...feature, properties: { ...properties, psgc_code: psgcCode, psgc_name: properties.ADM3_EN ?? '' } }
  })
}

function uniqueByCode(features: BoundaryFeature[]): BoundaryFeature[] {
  return [...new Map(features.filter((feature) => feature.properties.psgc_code).map((feature) => [String(feature.properties.psgc_code), feature])).values()]
}

function canonicalPsgcCode(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  return digits.padStart(10, '0')
}

export async function loadBoundaries(level: GeoLevel, parentCode?: string): Promise<BoundaryFeature[]> {
  const cacheKey = level === 'barangay' && parentCode ? `${level}:${parentCode}` : level
  if (!cache.has(cacheKey)) {
    const timeoutMs = level === 'barangay' ? 120000 : 15000
    const normalizedParent = parentCode?.replace(/^PH/, '')
    const request = level === 'barangay' && normalizedParent
      ? loadCollection(`${ROOT}/barangays/by-region/${normalizedParent.slice(0, 2)}.json`, timeoutMs)
        .then(normalizeBarangays)
        .then(uniqueByCode)
      : level === 'municipality'
      ? loadCollection(`${ROOT}/municipalities.geojson`, timeoutMs)
        .then(normalizeMunicipalities)
        .then(uniqueByCode)
      : loadCollection(urls[level], timeoutMs)
        .then(level === 'barangay' ? normalizeBarangays : (features) => features)
        .then(uniqueByCode)
    cache.set(cacheKey, request)
  }
  const request = cache.get(cacheKey)!
  let features: BoundaryFeature[]
  try {
    features = await request
  } catch (cause) {
    if (cache.get(cacheKey) === request) cache.delete(cacheKey)
    throw cause
  }
  if (!parentCode) return features
  const normalizedParent = parentCode.replace(/^PH/, '')
  if (level === 'barangay') {
    const placeCode = canonicalPsgcCode(normalizedParent)
    return features.filter((feature) => {
      const adm3Code = feature.properties.adm3_psgc
      if (adm3Code !== undefined && adm3Code !== null) {
        return canonicalPsgcCode(String(adm3Code)) === placeCode
      }
      return canonicalPsgcCode(String(feature.properties.PSGC_MUNICIPALITY_CODE ?? '')) === placeCode
    })
  }
  const prefixLength = level === 'province' ? 2 : level === 'municipality' ? 2 : 0
  if (!prefixLength) return features
  const prefix = normalizedParent.slice(0, prefixLength)
  const filtered = features.filter((feature) => String(feature.properties.psgc_code ?? '').replace(/^PH/, '').startsWith(prefix))
  return filtered
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
