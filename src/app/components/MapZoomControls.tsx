/** One zoom step of the toolbar buttons and of a double-click, shared by the circular map and the diff map. */
export const MAP_ZOOM_STEP = 1.6;

interface Props {
  readonly zoom: number;
  readonly maxZoom: number;
  readonly onZoomBy: (factor: number) => void;
  readonly onFit: () => void;
  /** The editor's map has a selection to zoom to; the Bench's product has none. */
  readonly zoomToSelection?: { readonly disabled: boolean; readonly onClick: () => void };
}

/** The zoom toolbar over a map: in, out, optionally to the selection, fit, and the zoom readout. */
export function MapZoomControls({ zoom, maxZoom, onZoomBy, onFit, zoomToSelection }: Props) {
  const zoomed = zoom > 1;
  return (
    <div className="map-view__controls" role="toolbar" aria-label="Map zoom">
      <button
        type="button"
        className="button map-view__control"
        data-tip="Zoom in (mouse wheel or pinch also zooms; double-click a feature to fit it)"
        aria-label="Zoom in"
        disabled={zoom >= maxZoom}
        onClick={() => {
          onZoomBy(MAP_ZOOM_STEP);
        }}
      >
        +
      </button>
      <button
        type="button"
        className="button map-view__control"
        data-tip="Zoom out"
        aria-label="Zoom out"
        disabled={!zoomed}
        onClick={() => {
          onZoomBy(1 / MAP_ZOOM_STEP);
        }}
      >
        −
      </button>
      {zoomToSelection !== undefined && (
        <button
          type="button"
          className="button map-view__control"
          data-tip="Zoom to the selected bases"
          aria-label="Zoom to selection"
          disabled={zoomToSelection.disabled}
          onClick={zoomToSelection.onClick}
        >
          Sel
        </button>
      )}
      <button
        type="button"
        className="button map-view__control"
        data-tip="Show the whole map"
        aria-label="Show the whole map"
        disabled={!zoomed}
        onClick={onFit}
      >
        Fit
      </button>
      {zoomed && (
        <span className="map-view__zoom" aria-live="polite">
          {zoom < 10 ? zoom.toFixed(1) : Math.round(zoom).toString()}×
        </span>
      )}
    </div>
  );
}
