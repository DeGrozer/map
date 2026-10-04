import type { GeoLevel, Geography } from './types'

const API = 'https://psgc.cloud/api/v2'

type ApiItem = { code: string; name: string; type?: string; status?: string; district?: string; zip_code?: string; region?: string; province?: string; city_municipality?: string; provinces_count?: number; cities_municipalities_count?: number; barangays_count?: number }

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`PSGC request failed: ${response.status}`)
  const payload = await response.json() as { data: T }
  return payload.data
}

function mapItem(item: ApiItem, level: GeoLevel, parentCode?: string): Geography {
  return { code: item.code, name: item.name, level, type: item.type, status: item.status, district: item.district, zipCode: item.zip_code, region: item.region, province: item.province, municipality: item.city_municipality, provincesCount: item.provinces_count, citiesMunicipalitiesCount: item.cities_municipalities_count, barangaysCount: item.barangays_count, parentCode }
}

export async function listChildren(parent: Geography | null): Promise<Geography[]> {
  if (!parent) return (await get<ApiItem[]>('/regions')).map((item) => mapItem(item, 'region'))
  if (parent.level === 'region') return (await get<ApiItem[]>(`/regions/${parent.code}/provinces`)).map((item) => mapItem(item, 'province', parent.code))
  if (parent.level === 'province') return (await get<ApiItem[]>(`/provinces/${parent.code}/cities-municipalities`)).map((item) => mapItem(item, 'municipality', parent.code))
  if (parent.level === 'municipality') return (await get<ApiItem[]>(`/cities-municipalities/${parent.code}/barangays`)).map((item) => mapItem(item, 'barangay', parent.code))
  return []
}

export async function getGeography(code: string, level: GeoLevel): Promise<Geography> {
  const endpoint = level === 'region' ? 'regions' : level === 'province' ? 'provinces' : level === 'municipality' ? 'cities-municipalities' : 'barangays'
  const item = await get<ApiItem>(`/${endpoint}/${code}`)
  return mapItem(item, level)
}
