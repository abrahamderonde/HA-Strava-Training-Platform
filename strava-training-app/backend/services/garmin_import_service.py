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
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.database import Activity, TrainingMetrics
from .training_science import (
    calculate_tss_from_power,
    calculate_pmc,
    estimate_tss_from_hr,
    calculate_normalized_power,
)

logger = logging.getLogger(__name__)

TOKEN_PATH = Path("/config/strava_training/garmin_tokens")

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

    async def _fetch_power_stream(self, client, garmin_id: int) -> Optional[List[float]]:
        """Fetch per-second power data by downloading the TCX file and parsing <Watts> tags.
        TCX is far more reliable than the JSON activity-details metrics API, which has
        been observed returning garbled/mis-scaled values."""
        try:
            from garminconnect import Garmin
            import xml.etree.ElementTree as ET

            tcx_bytes = client.download_activity(
                str(garmin_id),
                dl_fmt=Garmin.ActivityDownloadFormat.TCX,
            )
            if not tcx_bytes:
                return None

            root = ET.fromstring(tcx_bytes)
            ns = {
                'tcx': 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
                'ext': 'http://www.garmin.com/xmlschemas/ActivityExtension/v2',
            }
            trackpoints = root.findall('.//tcx:Trackpoint', ns)
            if not trackpoints:
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

            return watts if len(watts) > 30 else None

        except Exception as e:
            logger.debug("Could not fetch TCX power stream for %s: %s", garmin_id, e)
            return None

    async def _get_ftp_at_date(self, target_date: datetime) -> float:
        """Look up the FTP that was in effect on a given date from FTPHistory,
        falling back to self.ftp (current) if no history exists yet."""
        from .models.database import FTPHistory
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

        # Fetch power stream (TCX-based, reliable) and compute real Normalized Power
        power_stream = None
        np_real = None
        should_fetch_power = fetch_streams and bool(parsed.get("average_watts"))
        if should_fetch_power:
            client = await self._get_client()
            if client:
                power_stream = await self._fetch_power_stream(client, parsed["garmin_id"])
                if power_stream:
                    np_real = calculate_normalized_power(power_stream)

        # Calculate TSS using real NP when available, falling back to avg power, then HR
        tss = None
        try:
            avg_p = float(parsed.get("average_watts") or 0) or None
            elapsed = int(parsed.get("elapsed_time") or 0)
            avg_hr = float(parsed.get("average_heartrate") or 0) or None
            max_hr = float(parsed.get("max_heartrate") or 185)
            ftp = await self._get_ftp_at_date(parsed["start_date"])

            if not self.ftp or ftp == 200.0:
                logger.warning(
                    "Using fallback FTP=200W for '%s' — if your real FTP differs, "
                    "TSS will be wrong until recalculated. self.ftp=%s",
                    parsed.get("name"), self.ftp
                )

            # Prefer true NP from power stream — this matches intervals.icu's calculation
            np_for_tss = np_real if np_real and np_real > 0 else avg_p
            source = None

            if np_for_tss and np_for_tss > 0 and ftp > 0 and elapsed > 0:
                if_est = np_for_tss / ftp
                tss = (elapsed * np_for_tss * if_est) / (ftp * 3600) * 100
                source = "power" if np_real else "power_avg"

                # Flag suspicious NP/avg_power ratios for debugging
                if avg_p and np_for_tss > avg_p * 1.5:
                    logger.warning(
                        "Suspicious NP for '%s': NP=%.0fW vs avg=%.0fW (ratio %.2f) — "
                        "elapsed=%ds, power_stream_len=%s, IF=%.2f, TSS=%.0f",
                        parsed.get("name"), np_for_tss, avg_p, np_for_tss/avg_p,
                        elapsed, len(power_stream) if power_stream else 0, if_est, tss
                    )
                if if_est > 1.15:
                    logger.warning(
                        "High IF for '%s': IF=%.2f (NP=%.0fW, FTP=%.0fW) — "
                        "check if FTP is set correctly or if this was a genuinely hard/short effort",
                        parsed.get("name"), if_est, np_for_tss, ftp
                    )
            elif avg_hr and elapsed > 0:
                tss = estimate_tss_from_hr(
                    duration_seconds=elapsed,
                    avg_hr=avg_hr,
                    max_hr=max_hr or 185,
                    sport_type=parsed["sport_type"],
                )
                source = "hr"

            # Sanity cap
            if tss and tss > 500:
                logger.warning("TSS %.0f too high for %s, capping at 500", tss, parsed["name"])
                tss = 500.0

            # NP for storage: real NP if we have it, else the avg-power approximation
            np_approx = round(np_real) if np_real else (round(avg_p * 1.05) if avg_p else None)
        except Exception as e:
            logger.warning("TSS calculation failed for %s: %s", parsed.get("name"), e)
            tss = None
            np_approx = None
            avg_p = None
            source = None

        # Fetch GPS track for outdoor activities (skip trainer/indoor)
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
            has_power=bool(parsed.get("average_watts")),
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
