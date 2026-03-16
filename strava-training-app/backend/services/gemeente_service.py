"""
Dutch gemeente (municipality) service.

Boundary data: CBS Wijken en buurten via PDOK WFS
  https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0

Point-in-polygon: shapely for precise GPS track -> gemeente detection
GPX parsing: xml.etree for track points
"""
import httpx
import json
import logging
import gzip
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Set, Tuple
from xml.etree import ElementTree as ET

from shapely.geometry import shape, Point
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.database import Activity, VisitedGemeente

logger = logging.getLogger(__name__)

# PDOK WFS endpoint for CBS gemeente boundaries (2025)
PDOK_WFS_BASE = (
    "https://service.pdok.nl/cbs/gebiedsindelingen/2025/wfs/v1_0"
    "?service=WFS&version=2.0.0&request=GetFeature"
    "&typeName=gemeente_gegeneraliseerd"
    "&outputFormat=application/json&count=500"
)

CACHE_PATH = Path("/data/strava_training/gemeente_boundaries.json.gz")
CYCLING_SPORTS = {"Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide"}


class GemeenteService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self._shapes: Optional[List[Dict]] = None

    # ------------------------------------------------------------------ #
    #  Boundary loading                                                    #
    # ------------------------------------------------------------------ #

    async def ensure_boundaries_loaded(self) -> bool:
        if self._shapes is not None:
            return True
        if CACHE_PATH.exists():
            try:
                with gzip.open(CACHE_PATH, "rt", encoding="utf-8") as f:
                    geojson = json.load(f)
                self._shapes = self._parse_geojson(geojson)
                logger.info("Loaded %d gemeente boundaries from cache", len(self._shapes))
                return True
            except Exception as e:
                logger.warning("Cache load failed: %s", e)
        return await self.download_boundaries()

    async def download_boundaries(self) -> bool:
        logger.info("Downloading gemeente boundaries from PDOK...")
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                features = []
                start = 0
                while True:
                    url = PDOK_WFS_BASE + f"&startIndex={start}"
                    resp = await client.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                    batch = data.get("features", [])
                    features.extend(batch)
                    if len(batch) < 500:
                        break
                    start += 500

            geojson = {"type": "FeatureCollection", "features": features}
            CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(CACHE_PATH, "wt", encoding="utf-8") as f:
                json.dump(geojson, f)
            self._shapes = self._parse_geojson(geojson)
            logger.info("Downloaded %d gemeente boundaries", len(self._shapes))
            return True
        except Exception as e:
            logger.error("Failed to download gemeente boundaries: %s", e)
            return False

    def _parse_geojson(self, geojson: Dict) -> List[Dict]:
        shapes = []
        for feat in geojson.get("features", []):
            props = feat.get("properties", {})
            geom = feat.get("geometry")
            if not geom:
                continue
            try:
                shp = shape(geom)
                code = (props.get("statcode") or props.get("gemeentecode")
                        or props.get("code") or "")
                name = (props.get("statnaam") or props.get("gemeentenaam")
                        or props.get("naam") or "")
                shapes.append({"code": code, "name": name, "shape": shp})
            except Exception as e:
                logger.debug("Skipping feature: %s", e)
        return shapes

    def get_boundaries_geojson(self) -> Dict:
        if CACHE_PATH.exists():
            with gzip.open(CACHE_PATH, "rt", encoding="utf-8") as f:
                return json.load(f)
        return {"type": "FeatureCollection", "features": []}

    # ------------------------------------------------------------------ #
    #  Point-in-polygon                                                    #
    # ------------------------------------------------------------------ #

    def find_gemeenten_for_track(self, coords: List[Tuple[float, float]]) -> List[Dict]:
        """
        coords: list of (lon, lat)
        Returns list of {code, name} for all crossed gemeenten.
        """
        if not self._shapes or not coords:
            return []
        step = max(1, len(coords) // 2000)
        sampled = coords[::step]
        hit_codes: Set[str] = set()
        for lon, lat in sampled:
            pt = Point(lon, lat)
            for gem in self._shapes:
                if gem["code"] not in hit_codes and gem["shape"].contains(pt):
                    hit_codes.add(gem["code"])
        return [{"code": g["code"], "name": g["name"]}
                for g in self._shapes if g["code"] in hit_codes]

    # ------------------------------------------------------------------ #
    #  GPX parsing                                                         #
    # ------------------------------------------------------------------ #

    def parse_gpx(self, gpx_content: bytes) -> List[Tuple[float, float]]:
        """Return (lon, lat) list from GPX bytes."""
        coords = []
        try:
            root = ET.fromstring(gpx_content)
            ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
            for trkpt in root.findall(".//gpx:trkpt", ns):
                lat = trkpt.get("lat")
                lon = trkpt.get("lon")
                if lat and lon:
                    coords.append((float(lon), float(lat)))
            if not coords:
                for rtept in root.findall(".//gpx:rtept", ns):
                    lat = rtept.get("lat")
                    lon = rtept.get("lon")
                    if lat and lon:
                        coords.append((float(lon), float(lat)))
        except ET.ParseError as e:
            logger.error("GPX parse error: %s", e)
        return coords

    async def check_gpx_new_gemeenten(self, gpx_content: bytes) -> Dict:
        await self.ensure_boundaries_loaded()
        coords = self.parse_gpx(gpx_content)
        if not coords:
            return {"error": "No GPS coordinates found in GPX file"}

        crossed = self.find_gemeenten_for_track(coords)

        result = await self.db.execute(select(VisitedGemeente.gemeente_code).distinct())
        visited_codes = {row[0] for row in result.all()}

        new_gems   = [g for g in crossed if g["code"] not in visited_codes]
        already    = [g for g in crossed if g["code"] in visited_codes]

        step = max(1, len(coords) // 1000)
        track_preview = [[lat, lon] for lon, lat in coords[::step]]

        return {
            "total_crossed": len(crossed),
            "new_count": len(new_gems),
            "already_count": len(already),
            "new_gemeenten": new_gems,
            "already_gemeenten": already,
            "track_preview": track_preview,
            "point_count": len(coords),
        }

    # ------------------------------------------------------------------ #
    #  Activity processing                                                 #
    # ------------------------------------------------------------------ #

    async def process_activity_gemeenten(self, activity: Activity) -> List[str]:
        if activity.sport_type not in CYCLING_SPORTS:
            return []
        coords = self._extract_coords(activity)
        if not coords:
            return []
        await self.ensure_boundaries_loaded()
        gemeenten = self.find_gemeenten_for_track(coords)
        for gem in gemeenten:
            result = await self.db.execute(
                select(VisitedGemeente).where(
                    VisitedGemeente.gemeente_code == gem["code"],
                    VisitedGemeente.activity_id == activity.id,
                )
            )
            if not result.scalar_one_or_none():
                self.db.add(VisitedGemeente(
                    gemeente_code=gem["code"],
                    gemeente_name=gem["name"],
                    activity_id=activity.id,
                    first_visit_date=activity.start_date,
                ))
        await self.db.commit()
        return [g["code"] for g in gemeenten]

    def _extract_coords(self, activity: Activity) -> List[Tuple[float, float]]:
        if not activity.latlng_stream:
            return []
        return [(pt[1], pt[0]) for pt in activity.latlng_stream if len(pt) == 2]

    # ------------------------------------------------------------------ #
    #  Statistics                                                          #
    # ------------------------------------------------------------------ #

    async def get_visited_gemeenten(self) -> List[Dict]:
        result = await self.db.execute(
            select(
                VisitedGemeente.gemeente_code,
                VisitedGemeente.gemeente_name,
                VisitedGemeente.first_visit_date,
            ).distinct(VisitedGemeente.gemeente_code)
            .order_by(VisitedGemeente.gemeente_code, VisitedGemeente.first_visit_date)
        )
        rows = result.all()
        seen = {}
        for code, name, date in rows:
            if code not in seen:
                seen[code] = {"code": code, "name": name,
                              "first_visit": date.isoformat() if date else None}
        return list(seen.values())

    async def get_stats(self) -> Dict:
        visited = await self.get_visited_gemeenten()
        total_nl = len(self._shapes) if self._shapes else 342
        return {
            "visited_count": len(visited),
            "total_count": total_nl,
            "percentage": round(len(visited) / total_nl * 100, 1) if total_nl else 0,
        }
