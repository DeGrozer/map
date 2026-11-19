import type { GeoLevel, Geography } from './types'

async function get<T>(path: string): Promise<T> {
  const endpoint = path.startsWith('/regions') ? '/data/regions.json'
    : path.startsWith('/provinces') ? '/data/provinces.json'
    : path.startsWith('/barangays') ? '/data/barangays.json'
    : '/data/municipalities.json'
  const response = await fetch(endpoint)
  if (!response.ok) throw new Error(`PSGC request failed: ${response.status}`)
  return await response.json() as T
}

function canonicalParentCode(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return digits.slice(0, 2) + digits.slice(3)
  return digits
}

export async function listChildren(parent: Geography | null): Promise<Geography[]> {
  if (!parent) {
    const regions = await get<Array<{ psgc10DigitCode: string; name: string }>>('/regions')
    return regions.map((item) => ({ code: item.psgc10DigitCode, name: item.name, level: 'region' }))
  }
  if (parent.level === 'region') {
    const provinces = await get<Array<{ psgc10DigitCode: string; name: string; regionCode: string }>>('/provinces')
    return provinces
      .filter((item) => canonicalParentCode(item.regionCode) === canonicalParentCode(parent.code))
      .map((item) => ({ code: item.psgc10DigitCode, name: item.name, level: 'province', parentCode: parent.code }))
  }
  if (parent.level === 'province') {
    const municipalities = await get<Array<{ psgc10DigitCode: string; name: string; provinceCode: string; isCity: boolean; isMunicipality: boolean }>>('/municipalities')
    return municipalities
      .filter((item) => canonicalParentCode(item.provinceCode) === canonicalParentCode(parent.code))
      .map((item) => ({ code: item.psgc10DigitCode, name: item.name, level: 'municipality', type: item.isCity ? 'City' : item.isMunicipality ? 'Mun' : '', parentCode: parent.code }))
  }
  if (parent.level === 'municipality') {
    const barangays = await get<Array<{ psgc10DigitCode: string; name: string; municipalityCode: false | string; cityCode: false | string }>>('/barangays')
    return barangays
      .filter((item) => canonicalParentCode(String(item.municipalityCode || item.cityCode || '')) === canonicalParentCode(parent.code))
      .map((item) => ({ code: item.psgc10DigitCode, name: item.name, level: 'barangay', parentCode: parent.code }))
  }
  return []
}

export async function getGeography(code: string, level: GeoLevel): Promise<Geography> {
  const endpoint = level === 'region'
    ? '/regions'
    : level === 'province'
      ? '/provinces'
      : level === 'municipality'
        ? '/municipalities'
        : '/barangays'
  const items = await get<Array<{ psgc10DigitCode: string; name: string; isCity?: boolean; isMunicipality?: boolean }>>(endpoint)
  const item = items.find((entry) => entry.psgc10DigitCode === code.replace(/^PH/, ''))
  if (!item) throw new Error(`PSGC geography not found: ${code}`)
  return {
    code: item.psgc10DigitCode,
    name: item.name,
    level,
    type: item.isCity ? 'City' : item.isMunicipality ? 'Mun' : undefined,
  }
}
