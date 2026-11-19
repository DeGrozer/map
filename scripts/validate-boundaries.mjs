const PSGC_BARANGAYS_PATH = fileURLToPath(new URL('../public/data/barangays.json', import.meta.url))
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const LOCAL_GEOMETRY_PATH = fileURLToPath(new URL('../public/data/barangays.geojson', import.meta.url))

const [apiBarangays, collection] = await Promise.all([
  fs.readFile(PSGC_BARANGAYS_PATH, 'utf8').then(JSON.parse),
  fs.readFile(LOCAL_GEOMETRY_PATH, 'utf8').then(JSON.parse),
])

const apiByCode = new Map(apiBarangays.map((item) => [String(item.psgc10DigitCode), item]))
const geometryByCode = new Map()
let malformed = 0

for (const feature of collection.features) {
  const properties = feature.properties ?? {}
  const code = String(properties.psgc_code ?? properties.ADM4_PCODE ?? '').replace(/^PH/, '')
  if (!/^\d{10}$/.test(code) || !feature.geometry) {
    malformed++
    continue
  }
  if (!geometryByCode.has(code)) geometryByCode.set(code, feature)
}

const missingFromGeometry = apiBarangays.filter((item) => !geometryByCode.has(String(item.psgc10DigitCode)))
const missingFromPsgc = [...geometryByCode.keys()].filter((code) => !apiByCode.has(code))

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  apiBarangays: apiBarangays.length,
  geometryBarangays: geometryByCode.size,
  malformedGeometryFeatures: malformed,
  missingFromGeometry: missingFromGeometry.length,
  missingFromPsgc: missingFromPsgc.length,
  missingFromGeometrySample: missingFromGeometry.slice(0, 20).map(({ psgc10DigitCode, name, municipalityCode, cityCode }) => ({
    code: psgc10DigitCode,
    name,
    municipalityCode,
    cityCode,
  })),
  missingFromPsgcSample: missingFromPsgc.slice(0, 20),
}, null, 2))
