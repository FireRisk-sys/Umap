import React, { memo, useId, useMemo } from 'react';
import { effectiveGrid, hexCorners } from '../../shared/geometry.js';

const MAX_CELLS = 6000;

function boundsOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const maxX = Math.min(a.x + a.width, b.x + b.width);
  const maxY = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, maxX - x), height: Math.max(0, maxY - y) };
}

function quantize(bounds, step = 100) {
  if (!bounds) return null;
  const x = Math.floor(bounds.x / step) * step - step;
  const y = Math.floor(bounds.y / step) * step - step;
  return {
    x,
    y,
    width: Math.ceil((bounds.x + bounds.width - x) / step) * step + step,
    height: Math.ceil((bounds.y + bounds.height - y) / step) * step + step,
  };
}

function polygonPath(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ') + ' Z';
}

function gridPath(grid, bounds) {
  if (!grid || grid.type === 'none' || !bounds || bounds.width <= 0 || bounds.height <= 0) return '';
  const size = Math.max(4, Number(grid.size) || 80);
  const offsetX = Number(grid.offsetX) || 0;
  const offsetY = Number(grid.offsetY) || 0;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  const estimatedCells = Math.ceil(bounds.width / size) * Math.ceil(bounds.height / size);
  if (estimatedCells > MAX_CELLS) return '';
  const parts = [];

  if (grid.type === 'square') {
    for (let i = Math.ceil((bounds.x - offsetX) / size); i <= Math.floor((maxX - offsetX) / size); i += 1) {
      const x = offsetX + i * size;
      parts.push(`M${x},${bounds.y}V${maxY}`);
    }
    for (let i = Math.ceil((bounds.y - offsetY) / size); i <= Math.floor((maxY - offsetY) / size); i += 1) {
      const y = offsetY + i * size;
      parts.push(`M${bounds.x},${y}H${maxX}`);
    }
  } else {
    const rowHeight = size * 1.5;
    const columnWidth = Math.sqrt(3) * size;
    const startR = Math.floor((bounds.y - offsetY) / rowHeight) - 2;
    const endR = Math.ceil((maxY - offsetY) / rowHeight) + 2;
    const startQ = Math.floor((bounds.x - offsetX) / columnWidth) - 2;
    const endQ = Math.ceil((maxX - offsetX) / columnWidth) + 2;
    for (let r = startR; r <= endR; r += 1) {
      for (let q = startQ; q <= endQ; q += 1) {
        const cx = offsetX + columnWidth * (q + 0.5 * (((r % 2) + 2) % 2));
        const cy = offsetY + rowHeight * r;
        parts.push(polygonPath(hexCorners(cx, cy, size)));
      }
    }
  }
  return parts.join(' ');
}

const ZoneGrid = memo(function ZoneGrid({ map, zone, index, identifier, viewBounds, editorActive, selectedZoneId }) {
  const config = effectiveGrid({ ...map.grid, ...zone }, map.grid);
  const configKey = JSON.stringify(config);
  const zoneBounds = boundsOf(zone.points);
  const clipped = intersect(zoneBounds, viewBounds || zoneBounds);
  const path = useMemo(() => gridPath(config, clipped), [configKey, clipped.x, clipped.y, clipped.width, clipped.height]);
  const points = zone.points.map((point) => `${point.x},${point.y}`).join(' ');
  return (
    <g mask={`url(#${identifier}-zone-${zone.id})`}>
      {zone.type !== 'none' && <path d={path} fill="none" stroke={config.color} strokeOpacity={config.opacity} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
      {editorActive && <polygon points={points} fill={selectedZoneId === zone.id ? 'rgba(214,174,100,.08)' : 'transparent'} stroke={selectedZoneId === zone.id ? '#f0c779' : config.color} strokeOpacity="0.75" strokeWidth={selectedZoneId === zone.id ? 3 : 1.5} vectorEffect="non-scaling-stroke" strokeDasharray="8 6" />}
    </g>
  );
}, (previous, next) => previous.zone === next.zone && previous.map.grid === next.map.grid && previous.viewBounds === next.viewBounds && previous.editorActive === next.editorActive && previous.selectedZoneId === next.selectedZoneId);

function GridLayer({ map, editorActive = false, selectedZoneId = null, viewBounds }) {
  const identifier = useId().replaceAll(':', '');
  const zones = map.zones || [];
  const baseBounds = map.grid.bounds;
  const culledView = quantize(viewBounds) || { x: 0, y: 0, width: map.width, height: map.height };
  const visibleBase = intersect(baseBounds, culledView);
  const gridKey = JSON.stringify(map.grid);
  const basePath = useMemo(() => gridPath(map.grid, visibleBase), [gridKey, visibleBase.x, visibleBase.y, visibleBase.width, visibleBase.height]);
  if (!map.grid.visible) return null;

  return (
    <svg className="grid-layer" width={map.width} height={map.height} viewBox={`0 0 ${map.width} ${map.height}`} aria-hidden="true">
      <defs>
        <mask id={`${identifier}-base`} maskUnits="userSpaceOnUse" x="0" y="0" width={map.width} height={map.height}>
          <rect {...baseBounds} fill="white" />
          {zones.map((zone) => <polygon key={zone.id} points={zone.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="black" />)}
        </mask>
        {zones.map((zone, index) => (
          <mask id={`${identifier}-zone-${zone.id}`} key={zone.id} maskUnits="userSpaceOnUse" x="0" y="0" width={map.width} height={map.height}>
            <polygon points={zone.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="white" />
            {zones.slice(index + 1).map((higher) => <polygon key={higher.id} points={higher.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="black" />)}
          </mask>
        ))}
      </defs>
      {map.grid.type !== 'none' && <path d={basePath} fill="none" stroke={map.grid.color} strokeOpacity={map.grid.opacity} strokeWidth="1.2" vectorEffect="non-scaling-stroke" mask={`url(#${identifier}-base)`} />}
      {zones.map((zone, index) => <ZoneGrid key={zone.id} map={map} zone={zone} index={index} identifier={identifier} viewBounds={culledView} editorActive={editorActive} selectedZoneId={selectedZoneId} />)}
    </svg>
  );
}

export default memo(GridLayer, (previous, next) => (
  JSON.stringify(previous.map.grid) === JSON.stringify(next.map.grid)
  && JSON.stringify(previous.map.zones) === JSON.stringify(next.map.zones)
  && previous.editorActive === next.editorActive
  && previous.selectedZoneId === next.selectedZoneId
  && previous.viewBounds === next.viewBounds
));
