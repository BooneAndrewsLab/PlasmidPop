import { useEffect, useMemo, useRef, useState } from 'react';

import { type SeqDocument } from '@/core';
import { assignLanes, sansFontOf } from '@/view/linear';
import { NO_OVERLAY, overlayLanes } from '@/view/overlay';
import { renderRibbon } from '@/view/ribbon/renderRibbon';
import { groupFeatures } from '@/view/featureGroups';
import { drawableFeatures } from '@/view/visibleFeatures';

import { useEditorState } from '../state/useEditorStore';
import { readLinearTheme } from './linearTheme';

interface Props {
  readonly doc: SeqDocument;
  /** The ribbon's height in CSS pixels. */
  readonly height: number;
  /**
   * A document that is not the one in front (a simulated product, #303):
   * drawn with its features alone, no selection and no preview.
   */
  readonly fixed?: boolean;
}

/**
 * The foldable map strip (item 107, point 5): the document as one ribbon
 * across the top of the workspace where the map cannot be beside it. It
 * draws what the views draw — the features, the selection, the primers
 * preview — on a canvas at the strip's width, and follows them live.
 */
export function MapStrip({ doc, height, fixed = false }: Props) {
  const live = useEditorState();
  const selection = fixed ? null : live.selection;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const overlay = fixed ? NO_OVERLAY : (live.preview?.items ?? NO_OVERLAY);
  const lanes = useMemo(() => {
    // Grouped as the views group (item 115), so the strip has their lanes.
    const features = groupFeatures(
      drawableFeatures(doc.features.all(), live.hiddenFeatureTypes),
      doc.length,
      live.expandedFeatureGroups,
    ).features;
    return {
      shown: features,
      features: assignLanes(features, doc.length),
      overlay: overlayLanes(overlay, doc.length),
    };
  }, [doc, overlay, live.hiddenFeatureTypes, live.expandedFeatureGroups]);

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (el === null || el === undefined || typeof ResizeObserver === 'undefined') return;
    const update = (): void => {
      setWidth(Math.floor(el.clientWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (el === null || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = readLinearTheme(el);
    renderRibbon(ctx, {
      doc,
      width,
      height,
      theme,
      selection,
      overlay,
      featureLanes: lanes.features,
      overlayLanes: lanes.overlay,
      hiddenTypes: live.hiddenFeatureTypes,
      features: lanes.shown,
      font: sansFontOf(10),
    });
  }, [doc, width, height, selection, overlay, lanes, live.hiddenFeatureTypes]);

  return (
    <div className="map-strip" style={{ height }}>
      <canvas
        ref={canvas}
        className="map-strip__canvas"
        style={{ width, height }}
        role="img"
        aria-label={`Map strip of ${doc.name}`}
      />
    </div>
  );
}
