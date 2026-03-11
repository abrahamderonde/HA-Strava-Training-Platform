"""
Municipality (gemeente) service for the Netherlands.
- Downloads gemeente boundaries from PDOK (official Dutch geo service)
- Detects which municipalities a GPS track passes through using point-in-polygon
- Tracks visited municipalities per activity
- Supports GPX file checking for new municipalities
"""
import json
import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Tuple, Set
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from ..models.database import Activity, VisitedMunicipality, ActivityMunicipality

logger = logging.getLogger(__name__)

# PDOK WFS endpoint - CBS gemeente boundaries simplified, WGS84
PDOK_WFS_URL = (
    "https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0"
    "?service=WFS&version=2.0.0&request=GetFeature"
    "&typeName=gemeente_gegeneraliseerd"
    "&outputFormat=application/json"
    "&srsName=EPSG:4326"
)

GEMEENTE_CACHE_PATH = Path("/data/strava_training/gemeenten.geojson")


class MunicipalityService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self._gemeenten: Optional[List[Dict]] = None

    # ─── Boundary data ───────────────────────────────────────────────────────

    async def ensure_boundaries(self) -> bool:
        if self._gemeenten is not None:
            return True
        if GEMEENTE_CACHE_PATH.exists():
            with open(GEMEENTE_CACHE_PATH) as f:
                data = json.load(f)
            self._gemeenten = data["features"]
            logger.info("Loaded %d gemeente boundaries from cache", len(self._gemeenten))
            return True
        return await self._download_boundaries()

    async def _download_boundaries(self) -> bool:
        logger.info("Downloading gemeente boundaries from PDOK...")
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(PDOK_WFS_URL)
                resp.raise_for_status()
                data = resp.json()
            GEMEENTE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(GEMEENTE_CACHE_PATH, "w") as f:
                json.dump(data, f)
            self._gemeenten = data["features"]
            logger.info("Downloaded %d gemeente boundaries", len(self._gemeenten))
            return True
        except Exception as e:
            logger.error("Failed to download gemeente boundaries: %s", e)
            return False

    def get_all_boundaries_geojson(self) -> Dict:
        if not self._gemeenten:
            return {"type": "FeatureCollection", "features": []}
        return {"type": "FeatureCollection", "features": self._gemeenten}

    # ─── Point-in-polygon ────────────────────────────────────────────────────

    def _point_in_polygon(self, lon: float, lat: float, ring: List) -> bool:
        inside = False
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
        return inside

    def _point_in_feature(self, lon: float, lat: float, feature: Dict) -> bool:
        geom = feature.get("geometry", {})
        gtype = geom.get("type")
        coords = geom.get("coordinates", [])
        if gtype == "Polygon":
            return self._point_in_polygon(lon, lat, coords[0])
        elif gtype == "MultiPolygon":
            for polygon in coords:
                if self._point_in_polygon(lon, lat, polygon[0]):
                    return True
        return False

    def _get_code(self, feature: Dict) -> str:
        p = feature.get("properties", {})
        return p.get("statcode") or p.get("gemeentecode") or p.get("id", "")

    def _get_name(self, feature: Dict) -> str:
        p = feature.get("properties", {})
        return p.get("statnaam") or p.get("gemeentenaam") or p.get("name", "")

    def find_gemeente_for_point(self, lon: float, lat: float) -> Optional[Dict]:
        if not self._gemeenten:
            return None
        # Quick Netherlands bounding box pre-filter
        if not (3.0 <= lon <= 7.5 and 50.5 <= lat <= 53.8):
            return None
        for feature in self._gemeenten:
            bbox = feature.get("bbox")
            if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
                continue
            if self._point_in_feature(lon, lat, feature):
                return feature
        return None

    def find_gemeenten_for_track(
        self,
        track_points: List[Tuple[float, float]],
        sample_every: int = 5,
    ) -> Dict[str, str]:
        """
        Find all gemeente codes+names a GPS track passes through.
        Returns dict {code: name}.
        """
        if not self._gemeenten or not track_points:
            return {}

        found: Dict[str, str] = {}
        sampled = track_points[::sample_every]
        if track_points[-1] not in sampled:
            sampled.append(track_points[-1])

        for lon, lat in sampled:
            feature = self.find_gemeente_for_point(lon, lat)
            if feature:
                code = self._get_code(feature)
                name = self._get_name(feature)
                if code and code not in found:
                    found[code] = name

        return found

    # ─── GPX parsing ─────────────────────────────────────────────────────────

    def parse_gpx(self, gpx_content: bytes) -> List[Tuple[float, float]]:
        """Parse GPX file → list of (lon, lat) tuples."""
        try:
            root = ET.fromstring(gpx_content)
            ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
            points = []
            for trkpt in root.findall(".//gpx:trkpt", ns):
                lat = float(trkpt.get("lat", 0))
                lon = float(trkpt.get("lon", 0))
                points.append((lon, lat))
            if not points:
                for rtept in root.findall(".//gpx:rtept", ns):
                    lat = float(rtept.get("lat", 0))
                    lon = float(rtept.get("lon", 0))
                    points.append((lon, lat))
            return points
        except Exception as e:
            logger.error("GPX parse error: %s", e)
            return []

    def parse_strava_latlng(self, latlng_stream: List) -> List[Tuple[float, float]]:
        """Convert Strava [[lat,lon]] stream to (lon, lat) tuples."""
        return [(pt[1], pt[0]) for pt in latlng_stream if len(pt) >= 2]

    # ─── Database ────────────────────────────────────────────────────────────

    async def process_activity(
        self, activity_id: int, track_points: List[Tuple[float, float]]
    ) -> Dict[str, str]:
        """Process activity GPS track, store municipalities crossed."""
        if not track_points:
            return {}

        found = self.find_gemeenten_for_track(track_points)
        if not found:
            return {}

        # Clear old links for this activity
        await self.db.execute(
            delete(ActivityMunicipality).where(ActivityMunicipality.activity_id == activity_id)
        )

        for code, name in found.items():
            self.db.add(ActivityMunicipality(
                activity_id=activity_id,
                gemeente_code=code,
                gemeente_name=name,
            ))
            # Upsert visited
            result = await self.db.execute(
                select(VisitedMunicipality).where(VisitedMunicipality.gemeente_code == code)
            )
            existing = result.scalar_one_or_none()
            if not existing:
                # Get province from feature
                province = ""
                for f in (self._gemeenten or []):
                    if self._get_code(f) == code:
                        province = f.get("properties", {}).get("ProvincieNaam", "")
                        break
                self.db.add(VisitedMunicipality(
                    gemeente_code=code,
                    gemeente_name=name,
                    province=province,
                    first_visited_activity_id=activity_id,
                    first_visited_at=datetime.now(),
                    visit_count=1,
                ))
            else:
                existing.visit_count += 1

        await self.db.commit()
        return found

    async def get_visited_codes(self) -> Set[str]:
        result = await self.db.execute(select(VisitedMunicipality.gemeente_code))
        return {row[0] for row in result.all()}

    async def get_visited_municipalities(self) -> List[Dict]:
        result = await self.db.execute(
            select(VisitedMunicipality).order_by(VisitedMunicipality.gemeente_name)
        )
        return [
            {
                "code": r.gemeente_code,
                "name": r.gemeente_name,
                "province": r.province,
                "first_visited_at": r.first_visited_at.isoformat() if r.first_visited_at else None,
                "visit_count": r.visit_count,
            }
            for r in result.scalars().all()
        ]

    async def check_gpx_for_new(self, gpx_content: bytes) -> Dict:
        """Check a GPX file: which municipalities are new vs already visited?"""
        await self.ensure_boundaries()
        track_points = self.parse_gpx(gpx_content)
        if not track_points:
            return {"error": "Could not parse GPX file", "track_points": []}

        found = self.find_gemeenten_for_track(track_points, sample_every=3)
        visited_codes = await self.get_visited_codes()

        new = {c: n for c, n in found.items() if c not in visited_codes}
        known = {c: n for c, n in found.items() if c in visited_codes}

        return {
            "total_found": len(found),
            "new": [{"code": c, "name": n} for c, n in sorted(new.items(), key=lambda x: x[1])],
            "already_visited": [{"code": c, "name": n} for c, n in sorted(known.items(), key=lambda x: x[1])],
            "track_points": [[pt[1], pt[0]] for pt in track_points[::4]],  # [lat,lon] for Leaflet
            "new_count": len(new),
        }
