import 'leaflet'

declare module 'leaflet' {
  namespace VectorGrid {
    function slicer(data: GeoJSON.FeatureCollection, options: {
      rendererFactory?: RendererFactory
      vectorTileLayerStyles?: Record<string, () => PathOptions>
      getFeatureId?: (feature: GeoJSON.Feature) => string
      interactive?: boolean
      maxZoom?: number
      tolerance?: number
      indexMaxZoom?: number
    }): Layer & Evented & { setFeatureStyle: (id: string, style: PathOptions) => void }
  }

  const VectorGrid: typeof VectorGrid

  namespace canvas {
    const tile: RendererFactory
  }
}
