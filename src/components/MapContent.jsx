import React, { memo, useId } from 'react';
import GridLayer from './GridLayer.jsx';

function MapContent({ map, polygons, isHost, previewVision, editorMode, selectedZoneId, viewBounds, draftBounds, draftPoints, zoom, currentStroke }) {
  const identifier = useId().replaceAll(':', '');
  const pointsString = (points) => points.map((point) => `${point.x},${point.y}`).join(' ');
  return (
    <>
      <img className="map-image" src={map.url} alt={map.name} width={map.width} height={map.height} draggable="false" />
      <GridLayer map={map} editorActive={isHost && editorMode === 'zone'} selectedZoneId={selectedZoneId} viewBounds={viewBounds} />
      <svg className="drawing-layer" width={map.width} height={map.height} viewBox={`0 0 ${map.width} ${map.height}`} aria-hidden="true">
        {(map.drawings || []).map((stroke) => <polyline key={stroke.id} points={pointsString(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeOpacity={stroke.opacity} strokeLinecap="round" strokeLinejoin="round" />)}
        {currentStroke && <polyline points={pointsString(currentStroke.points)} fill="none" stroke={currentStroke.color} strokeWidth={currentStroke.width} strokeOpacity={currentStroke.opacity} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {(!isHost || previewVision) && map.vision?.enabled && <svg className="vision-fog" width={map.width} height={map.height} viewBox={`0 0 ${map.width} ${map.height}`} aria-hidden="true">
        <defs><mask id={`${identifier}-vision`} maskUnits="userSpaceOnUse" x="0" y="0" width={map.width} height={map.height}>
          <rect width={map.width} height={map.height} fill="white" />
          {polygons.map((polygon) => <polygon key={polygon.entityId} points={pointsString(polygon.points)} fill="black" />)}
        </mask></defs>
        <rect width={map.width} height={map.height} fill="#050608" fillOpacity={map.vision.opacity} mask={`url(#${identifier}-vision)`} />
      </svg>}
      {isHost && editorMode === 'vision' && <svg className="wall-layer" width={map.width} height={map.height} viewBox={`0 0 ${map.width} ${map.height}`} aria-hidden="true">
        {(map.walls || []).map((wall) => <polygon key={wall.id} points={pointsString(wall.points)} fill="rgba(214,108,77,.12)" stroke="#e08b67" strokeWidth={2 / zoom} strokeDasharray={`${8 / zoom} ${5 / zoom}`} />)}
      </svg>}
      {draftBounds && <div className="bounds-draft" style={{ left: draftBounds.x, top: draftBounds.y, width: draftBounds.width, height: draftBounds.height }} />}
      {draftPoints.length > 0 && <svg className="zone-draft" width={map.width} height={map.height} viewBox={`0 0 ${map.width} ${map.height}`}><polyline points={pointsString(draftPoints)} fill="rgba(214,174,100,.12)" stroke="#f0c779" strokeWidth={2 / zoom} strokeDasharray={`${8 / zoom} ${5 / zoom}`} />{draftPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={5 / zoom} fill="#f0c779" />)}</svg>}
    </>
  );
}

export default memo(MapContent);
