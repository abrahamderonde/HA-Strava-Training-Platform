"""
Garmin Connect activity import service for TrainIQ.
Replaces Strava as the activity data source.

Garmin field mapping → Activity model:
  activityId          → strava_id (reused as unique ID, prefixed negative to distinguish)
  activityName        → name
  activityType.typeKey → sport_type (mapped to Strava-style names)
  startTimeLocal      → start_date
  duration            → elapsed_time (seconds)
  movingDuration      → moving_time
  distance            → distance (meters)
  averagePower        → average_watts
  avgHr               → average_heartrate
  maxHr               → max_heartrate
  trainer             → trainer (bool)
  lapDTO[].messageIndex → used for power/HR streams via get_activity_details
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any, Tuple
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.database import Activity, FTPHistory, TrainingMetrics
from .training_science import (
    calculate_tss_from_power,
    calculate_pmc,
    estimate_tss_from_hr,
    estimate_tss_no_data,
    calculate_normalized_power,
)

logger = logging.getLogger(__name__)

TOKEN_PATH = Path("/config/strava_training/garmin_tokens")

MIN_POWER_COVERAGE: float = 0.5
MAX_TSS: float = 500.0
DEFAULT_MAX_HR: float = 185.0

# Map Garmin activity type keys → Strava-style sport types used in the app
SPORT_TYPE_MAP = {
    "cycling":           "Ride",
    "road_biking":       "Ride",
    "gravel_cycling":    "GravelRide",
    "mountain_biking":   "MountainBikeRide",
    "indoor_cycling":    "VirtualRide",
    "virtual_ride":      "VirtualRide",
    "running":           "Run",
    "trail_running":     "TrailRun",
    "walking":           "Walk",
    "hiking":            "Hike",
    "swimming":          "Swim",
    "strength_training": "WeightTraining",
    "other":             "Other",
}

# Garmin activity IDs are stored as negative integers to distinguish from Strava IDs
def garmin_id_to_db(garmin_id: int) -> int:
    """Convert Garmin activity ID to a unique negative DB ID."""
    return -abs(int(garmin_id))


class GarminImportService:
    def __init__(self, email: str, password: str, db: AsyncSession, ftp: float = 200.0):
        self.email = email
        self.password = password
        self.db = db
        self.ftp = ftp
        self._client = None

    async def _fetch_latlng_stream(self, client, garmin_id: int) -> Optional[List]:
        """Fetch GPS track as [[lat, lon], ...] by downloading GPX and parsing it.
        Returns None for indoor/trainer activities with no GPS data."""
        try:
            from garminconnect import Garmin
            import xml.etree.ElementTree as ET

            gpx_bytes = client.download_activity(
                str(garmin_id),
                dl_fmt=Garmin.ActivityDownloadFormat.GPX,
            )
            if not gpx_bytes:
                return None

            root = ET.fromstring(gpx_bytes)
            # GPX namespace handling — find all trackpoints regardless of namespace
            ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
            trkpts = root.findall('.//gpx:trkpt', ns)
            if not trkpts:
                # Try without namespace as fallback
                trkpts = root.findall('.//trkpt')
            if not trkpts:
                return None

            latlng = []
            # Sample every Nth point to keep stream size reasonable (max ~2000 points)
            step = max(1, len(trkpts) // 2000)
            for pt in trkpts[::step]:
                lat = pt.get('lat')
                lon = pt.get('lon')
                if lat and lon:
                    latlng.append([float(lat), float(lon)])

            return latlng if len(latlng) > 5 else None

        except Exception as e:
            logger.debug("Could not fetch GPX for activity %s: %s", garmin_id, e)
            return None

    async def _get_client(self):
        """Get authenticated Garmin client, using cached tokens."""
        if self._client:
            return self._client
        try:
            from garminconnect import Garmin
            TOKEN_PATH.mkdir(parents=True, exist_ok=True)
            files = list(TOKEN_PATH.iterdir())
            if not files:
                logger.error("No Garmin tokens at %s", TOKEN_PATH)
                return None
            client = Garmin()
            client.login(str(TOKEN_PATH))
            self._client = client
            logger.info("Garmin import: authenticated from cached tokens")
            return client
        except Exception as e:
            logger.error("Garmin import auth failed: %s", e)
            return None

    def _parse_activity(self, raw: Dict) -> Optional[Dict]:
        """Parse a raw Garmin activity dict into our Activity field dict."""
        def safe_float(val, default=None):
            try:
                return float(val) if val is not None and val != '' else default
            except (TypeError, ValueError):
                return default

        def safe_int(val, default=0):
            try:
                return int(float(val)) if val is not None and val != '' else default
            except (TypeError, ValueError):
                return default

        try:
            garmin_id = raw.get("activityId")
            if not garmin_id:
                return None

            # Sport type
            type_key = (raw.get("activityType") or {}).get("typeKey", "other")
            sport_type = SPORT_TYPE_MAP.get(type_key, "Other")

            # Start date — Garmin gives local time string
            start_str = raw.get("startTimeLocal") or raw.get("startTimeGMT", "")
            try:
                start_date = datetime.strptime(start_str[:19], "%Y-%m-%d %H:%M:%S")
            except Exception:
                start_date = datetime.now()

            elapsed  = safe_int(raw.get("duration") or raw.get("elapsedDuration"))
            moving   = safe_int(raw.get("movingDuration") or elapsed) or elapsed
            distance = safe_float(raw.get("distance"), 0)

            avg_power = safe_float(raw.get("avgPower") or raw.get("averagePower"))
            avg_hr    = safe_float(raw.get("averageHR") or raw.get("avgHr"))
            max_hr    = safe_float(raw.get("maxHR") or raw.get("maxHr"))
            is_trainer = bool(raw.get("trainer") or type_key in ("indoor_cycling", "virtual_ride"))
            is_commute = bool(raw.get("commute", False))

            return {
                "garmin_id": int(garmin_id),
                "db_id": garmin_id_to_db(garmin_id),
                "name": raw.get("activityName") or "Untitled",
                "sport_type": sport_type,
                "start_date": start_date,
                "elapsed_time": elapsed,
                "moving_time": moving,
                "distance": distance,
                "average_watts": avg_power,
                "average_heartrate": avg_hr,
                "max_heartrate": max_hr,
                "trainer": is_trainer,
                "commute": is_commute,
            }
        except Exception as e:
            logger.warning("Failed to parse activity %s: %s", raw.get("activityId"), e)
            return None

    async def _fetch_power_stream(self, client, garmin_id: int, _retry: bool = True) -> Optional[List[float]]:
        try:
            from garminconnect import Garmin, GarminConnectTooManyRequestsError
            import xml.etree.ElementTree as ET

            try:
                tcx_bytes = client.download_activity(
                    str(garmin_id),
                    dl_fmt=Garmin.ActivityDownloadFormat.TCX,
                )
            except GarminConnectTooManyRequestsError:
                if _retry:
                    logger.warning("Rate-limited fetching TCX for %s, backing off 5s and retrying once", garmin_id)
                    await asyncio.sleep(5.0)
                    return await self._fetch_power_stream(client, garmin_id, _retry=False)
                logger.warning("Rate-limited fetching TCX for %s, giving up after retry", garmin_id)
                return None

            if not tcx_bytes:
                logger.warning("No TCX data returned by Garmin for activity %s", garmin_id)
                return None
                
            root = ET.fromstring(tcx_bytes)
            ns = {
                'tcx': 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
                'ext': 'http://www.garmin.com/xmlschemas/ActivityExtension/v2',
            }
            trackpoints = root.findall('.//tcx:Trackpoint', ns)
            if not trackpoints:
                logger.warning("TCX for activity %s parsed but contains no Trackpoint elements", garmin_id)
                return None

            watts = []
            for tp in trackpoints:
                # Power is nested under Extensions/TPX/Watts
                watts_el = tp.find('.//ext:Watts', ns)
                if watts_el is not None and watts_el.text:
                    try:
                        w = float(watts_el.text)
                        if 0 <= w <= 3000:  # sanity range for cycling power
                            watts.append(w)
                    except ValueError:
                        continue

            if len(watts) <= 30:
                logger.warning(
                    "TCX for activity %s has %d trackpoints but only %d valid <Watts> "
                    "readings — activity likely has no power meter data",
                    garmin_id, len(trackpoints), len(watts)
                )
                return None

            return watts

        except Exception as e:
            logger.warning("Could not fetch TCX power stream for activity %s: %s", garmin_id, e)
            return None

    async def _get_ftp_at_date(self, target_date: datetime) -> float:
        """Look up the FTP that was in effect on a given date from FTPHistory,
        falling back to self.ftp (current) if no history exists yet."""
        try:
            result = await self.db.execute(
                select(FTPHistory)
                .where(FTPHistory.date <= target_date)
                .order_by(FTPHistory.date.desc())
                .limit(1)
            )
            hist = result.scalar_one_or_none()
            if hist:
                return float(hist.ftp)
        except Exception as e:
            logger.debug("FTP history lookup failed, using current FTP: %s", e)
        return float(self.ftp) if self.ftp else 200.0

        def _compute_tss(
        self,
        power_stream: Optional[List[float]],
        avg_power: Optional[float],
        avg_hr: Optional[float],
        max_hr: Optional[float],
        elapsed: int,
        ftp: float,
        sport_type: str,
    ) -> Tuple[Optional[float], Optional[str]]:
        if elapsed <= 0:
            return None, None

        np_value: Optional[float] = None
        if power_stream:
            active: int = sum(1 for w in power_stream if w > 0)
            if active / len(power_stream) >= MIN_POWER_COVERAGE:
                np_value = calculate_normalized_power(power_stream)
        elif avg_power and avg_power > 0:
            np_value = avg_power

        if np_value and np_value > 0 and ftp > 0:
            tss: float = elapsed * np_value * (np_value / ftp) / (ftp * 3600) * 100
            return round(min(tss, MAX_TSS), 1), "power" if power_stream else "power_avg"

        if avg_hr and avg_hr > 0:
            hr_tss: float = estimate_tss_from_hr(elapsed, avg_hr, max_hr or DEFAULT_MAX_HR, sport_type)
            return round(min(hr_tss, MAX_TSS), 1), "hr"

        return round(min(estimate_tss_no_data(elapsed, sport_type), MAX_TSS), 1), "estimate"

    async def import_activity(self, raw: Dict, fetch_streams: bool = True) -> Optional[Activity]:
        """Import a single Garmin activity into the database."""
        parsed = self._parse_activity(raw)
        if not parsed:
            return None

        db_id = parsed["db_id"]

        # Check if already imported (use strava_id field for garmin ID)
        existing = await self.db.execute(
            select(Activity).where(Activity.strava_id == db_id)
        )
        if existing.scalar_one_or_none():
            return None  # Already imported

        # Fetch power stream (TCX-based, reliable) and compute real Normalized Power.
        # Attempted for ALL activities, including trainer/indoor rides — smart trainers
        # report power just like outdoor power meters, and excluding trainer=True here
        # was silently starving VirtualRides of TSS. Only GPS fetching should skip
        # trainer activities, since those genuinely have no location data.
        power_stream = None
        np_real = None
        if fetch_streams:
            client = await self._get_client()
            if client:
                power_stream = await self._fetch_power_stream(client, parsed["garmin_id"])
                if power_stream:
                    np_real = calculate_normalized_power(power_stream)
                    if not parsed.get("average_watts"):
                        recovered_avg = sum(power_stream) / len(power_stream)
                        logger.info(
                            "Recovered missing avg power for '%s' from TCX stream: %.0fW (%d samples)",
                            parsed.get("name"), recovered_avg, len(power_stream)
                        )
                        parsed["average_watts"] = recovered_avg
                elif not parsed.get("average_watts"):
                    logger.info(
                        "No power data found for '%s' (list endpoint and TCX both empty) — "
                        "activity likely genuinely has no power meter reading",
                        parsed.get("name")
                    )

        elapsed: int = int(parsed.get("elapsed_time") or 0)
        avg_p: Optional[float] = float(parsed.get("average_watts") or 0) or None
        avg_hr: Optional[float] = float(parsed.get("average_heartrate") or 0) or None
        max_hr: Optional[float] = float(parsed.get("max_heartrate") or 0) or None
        ftp: float = await self._get_ftp_at_date(parsed["start_date"])

        tss, source = self._compute_tss(
            power_stream, avg_p, avg_hr, max_hr, elapsed, ftp, parsed["sport_type"]
        )
        power_used: bool = source in ("power", "power_avg")
        if not power_used:
            power_stream = None
            avg_p = None
        np_approx: Optional[int] = (
            round(np_real) if power_used and np_real
            else round(avg_p * 1.05) if avg_p
            else None
        )

        # Fetch GPS track for outdoor activities (skip trainer/indoor — genuinely no location data)
        latlng_stream = None
        if fetch_streams and not parsed.get("trainer"):
            client = await self._get_client()
            if client:
                latlng_stream = await self._fetch_latlng_stream(client, parsed["garmin_id"])

        activity = Activity(
            strava_id=db_id,
            name=parsed["name"],
            sport_type=parsed["sport_type"],
            start_date=parsed["start_date"],
            elapsed_time=int(parsed.get("elapsed_time") or 0),
            moving_time=int(parsed.get("moving_time") or 0),
            distance=float(parsed.get("distance") or 0),
            average_watts=avg_p,
            weighted_avg_watts=np_approx,
            np=np_approx,
            tss_source=source,
            average_heartrate=parsed.get("average_heartrate"),
            max_heartrate=parsed.get("max_heartrate"),
            tss=tss,
            has_power=power_used,
            trainer=parsed["trainer"],
            commute=parsed["commute"],
            power_stream=power_stream,
            latlng_stream=latlng_stream,
            synthetic=False,
        )

        self.db.add(activity)
        await self.db.commit()
        await self.db.refresh(activity)
        logger.info("Imported Garmin activity: %s (%s) TSS=%.0f NP=%s avg=%s GPS=%s",
                    parsed["name"], parsed["sport_type"], tss or 0,
                    f"{np_approx}W" if np_approx else "n/a",
                    f"{avg_p:.0f}W" if avg_p else "n/a",
                    f"{len(latlng_stream)}pts" if latlng_stream else "none")
        return activity

    async def import_history(self, days: int = 365, progress_callback=None) -> Dict:
        """Import all activities from the last N days."""
        client = await self._get_client()
        if not client:
            return {"error": "Not authenticated", "imported": 0}

        end = datetime.now()
        start = end - timedelta(days=days)
        imported = 0
        skipped = 0
        errors = 0

        try:
            activities = client.get_activities_by_date(
                startdate=start.strftime("%Y-%m-%d"),
                enddate=end.strftime("%Y-%m-%d"),
            )
            logger.info("Garmin import: found %d activities", len(activities))

            for i, raw in enumerate(activities):
                try:
                    result = await self.import_activity(raw, fetch_streams=True)
                    if result:
                        imported += 1
                    else:
                        skipped += 1
                    if progress_callback and i % 10 == 0:
                        await progress_callback(i, len(activities))
                except Exception as e:
                    logger.warning("Error importing activity %s: %s",
                                   raw.get("activityId"), e)
                    errors += 1
                await asyncio.sleep(1.0)

        except Exception as e:
            logger.error("Garmin history import failed: %s", e)
            return {"error": str(e), "imported": imported}

        return {"imported": imported, "skipped": skipped, "errors": errors,
                "total": len(activities) if 'activities' in dir() else 0}

    async def import_recent(self, days: int = 7) -> Dict:
        """Import recent activities (for daily sync)."""
        return await self.import_history(days=days, progress_callback=None)

    async def get_auth_status(self) -> Dict:
        """Check if Garmin tokens are available and valid."""
        files = list(TOKEN_PATH.iterdir()) if TOKEN_PATH.exists() else []
        if not files:
            return {"authenticated": False, "reason": "No token files found"}
        client = await self._get_client()
        if client:
            return {"authenticated": True, "token_path": str(TOKEN_PATH),
                    "files": [f.name for f in files]}
        return {"authenticated": False, "reason": "Token load failed"}
