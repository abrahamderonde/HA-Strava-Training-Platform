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
from .training_science import calculate_mmp, calculate_pmc, estimate_tss_from_hr

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

            # Duration — Garmin gives seconds as float
            elapsed = int(raw.get("duration") or raw.get("elapsedDuration") or 0)
            moving = int(raw.get("movingDuration") or elapsed)
            distance = float(raw.get("distance") or 0)  # meters

            avg_power = raw.get("avgPower") or raw.get("averagePower")
            avg_hr = raw.get("averageHR") or raw.get("avgHr")
            max_hr = raw.get("maxHR") or raw.get("maxHr")
            is_trainer = bool(raw.get("trainer") or type_key == "indoor_cycling" or type_key == "virtual_ride")
            is_commute = bool(raw.get("commute", False))
            calories = raw.get("calories")
            elevation = raw.get("elevationGain")

            return {
                "garmin_id": int(garmin_id),
                "db_id": garmin_id_to_db(garmin_id),
                "name": raw.get("activityName") or "Untitled",
                "sport_type": sport_type,
                "start_date": start_date,
                "elapsed_time": elapsed,
                "moving_time": moving,
                "distance": distance,
                "average_watts": float(avg_power) if avg_power else None,
                "average_heartrate": float(avg_hr) if avg_hr else None,
                "max_heartrate": float(max_hr) if max_hr else None,
                "trainer": is_trainer,
                "commute": is_commute,
                "calories": float(calories) if calories else None,
                "total_elevation_gain": float(elevation) if elevation else None,
            }
        except Exception as e:
            logger.warning("Failed to parse activity %s: %s", raw.get("activityId"), e)
            return None

    async def _fetch_power_stream(self, client, garmin_id: int) -> Optional[List[float]]:
        """Fetch per-second power data from activity details."""
        try:
            details = client.get_activity_details(str(garmin_id), maxchart=3600)
            metrics = details.get("gritOffset") or details.get("metricDescriptors") or []
            # Find power metric key
            power_key = None
            for m in (details.get("metricDescriptors") or []):
                if "power" in (m.get("key") or "").lower():
                    power_key = m.get("metricsIndex")
                    break
            if power_key is None:
                return None
            stream = []
            for point in (details.get("activityDetailMetrics") or []):
                vals = point.get("metrics") or []
                if power_key < len(vals):
                    stream.append(vals[power_key])
            return stream if len(stream) > 10 else None
        except Exception as e:
            logger.debug("Could not fetch power stream for %s: %s", garmin_id, e)
            return None

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

        power_stream = None
        if fetch_streams and parsed.get("average_watts"):
            client = await self._get_client()
            if client:
                power_stream = await self._fetch_power_stream(client, parsed["garmin_id"])

        # Calculate TSS
        tss = None
        np = None
        intensity_factor = None

        if power_stream and len(power_stream) > 30:
            from .training_science import calculate_normalized_power
            np = calculate_normalized_power(power_stream)
            if np and self.ftp > 0:
                intensity_factor = np / self.ftp
                duration_hours = parsed["elapsed_time"] / 3600
                tss = (parsed["elapsed_time"] * np * intensity_factor) / (self.ftp * 3600) * 100
        elif parsed.get("average_watts") and parsed["elapsed_time"] > 0:
            # Fallback: estimate from avg power
            avg_p = parsed["average_watts"]
            if_est = avg_p / self.ftp
            tss = (parsed["elapsed_time"] * avg_p * if_est) / (self.ftp * 3600) * 100
        elif parsed.get("average_heartrate"):
            tss = estimate_tss_from_hr(
                parsed["elapsed_time"],
                parsed["average_heartrate"],
                parsed.get("max_heartrate") or 185,
                parsed["sport_type"]
            )

        activity = Activity(
            strava_id=db_id,  # Store Garmin ID as negative in strava_id field
            name=parsed["name"],
            sport_type=parsed["sport_type"],
            start_date=parsed["start_date"],
            elapsed_time=parsed["elapsed_time"],
            moving_time=parsed["moving_time"],
            distance=parsed["distance"],
            average_watts=parsed.get("average_watts"),
            average_heartrate=parsed.get("average_heartrate"),
            max_heartrate=parsed.get("max_heartrate"),
            normalized_power=np,
            intensity_factor=intensity_factor,
            tss=tss,
            trainer=parsed["trainer"],
            commute=parsed["commute"],
            power_stream=power_stream,
            synthetic=False,
        )

        self.db.add(activity)
        await self.db.commit()
        await self.db.refresh(activity)
        logger.info("Imported Garmin activity: %s (%s) TSS=%.0f",
                    parsed["name"], parsed["sport_type"], tss or 0)
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
