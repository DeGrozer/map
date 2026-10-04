export type GeoLevel = 'region' | 'province' | 'municipality' | 'barangay'

export type Geography = {
  code: string
  name: string
  level: GeoLevel
  status?: string
  district?: string
  zipCode?: string
  provincesCount?: number
  citiesMunicipalitiesCount?: number
  barangaysCount?: number
  region?: string
  province?: string
  municipality?: string
  type?: string
  parentCode?: string
}

export type BoundaryFeature = {
  type: 'Feature'
  properties: Record<string, string | number | null>
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
}

export type BoundaryCollection = {
  type: 'FeatureCollection'
  features: BoundaryFeature[]
}
