"""
Intervals.icu API integration.
Uploads planned workouts to intervals.icu calendar.
intervals.icu then syncs these to Garmin Connect automatically.

Auth: Basic auth with username="API_KEY" and password=<your api key>
Athlete ID: starts with 'i' e.g. 'i12345'

API docs: https://intervals.icu/api-docs.html
"""
import httpx
import base64
import logging
from datetime import datetime
from typing import Optional, Dict

logger = logging.getLogger(__name__)

BASE_URL = "https://intervals.icu/api/v1"


class IntervalsService:
    def __init__(self, api_key: str, athlete_id: str):
        self.api_key = api_key
        self.athlete_id = athlete_id  # e.g. "i12345"
        # Basic auth: username is literal "API_KEY", password is the key
        self.auth = ("API_KEY", api_key)

    def _workout_to_description(self, workout) -> str:
        """
        Convert a PlannedWorkout to intervals.icu description language.
        Expands all repeats explicitly to avoid Nx grouping ambiguity.
        """
        lines = []
        intervals = workout.intervals or []

        if not intervals:
            duration_min = workout.target_duration_minutes or 60
            pct = round((workout.target_if or 0.65) * 100)
            lines.append(f"- {duration_min}m {pct}%")
        else:
            for interval in intervals:
                itype    = interval.get("type", "work")
                dur_s    = interval.get("duration_seconds", 300)
                repeats  = int(interval.get("repeats", 1))
                rest_s   = int(interval.get("rest_seconds", 0))
                p_low    = interval.get("power_low")
                p_high   = interval.get("power_high")

                dur_min = dur_s / 60
                if dur_min >= 1:
                    dur_str = f"{int(dur_min)}m" if dur_min == int(dur_min) else f"{dur_min:.1f}m"
                else:
                    dur_str = f"{dur_s}s"

                if p_low and p_high and p_low != p_high:
                    power_str = f"{int(p_low)}-{int(p_high)}W"
                elif p_low:
                    power_str = f"{int(p_low)}W"
                else:
                    pct_map = {"warmup": 55, "cooldown": 55, "recovery": 50,
                               "work": 85, "threshold": 95, "vo2max": 115}
                    power_str = f"{pct_map.get(itype, 70)}%"

                if rest_s > 0:
                    rest_min = rest_s / 60
                    rest_str = f"{int(rest_min)}m" if rest_min >= 1 else f"{rest_s}s"

                # Expand repeats explicitly — no Nx syntax
                for rep in range(repeats):
                    lines.append(f"- {dur_str} {power_str}")
                    if rest_s > 0:
                        lines.append(f"- {rest_str} 50%")

        return "\n".join(lines)

    async def push_workout(self, workout, ftp: float = None) -> Optional[str]:
        """
        Push a workout to intervals.icu using description language.
        This avoids FIT binary format issues entirely.
        intervals.icu syncs scheduled workouts to Garmin automatically.
        """
        workout_date = workout.date if isinstance(workout.date, datetime) else datetime.combine(workout.date, datetime.min.time())
        start_local = workout_date.strftime("%Y-%m-%dT00:00:00")

        # Use AI-generated icu_description if available, otherwise build from intervals
        icu_desc = getattr(workout, 'icu_description', None) or self._workout_to_description(workout)

        event = {
            "category": "WORKOUT",
            "start_date_local": start_local,
            "type": "Ride",
            "name": workout.title,
            "description": icu_desc,
            "moving_time": (workout.target_duration_minutes or 60) * 60,
            "target": "POWER",
            "external_id": f"trainiq_{workout.id}",
        }

        if workout.target_tss:
            event["icu_training_load"] = workout.target_tss

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{BASE_URL}/athlete/{self.athlete_id}/events/bulk?upsert=true",
                    auth=self.auth,
                    json=[event],
                    timeout=30,
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    event_id = str(data[0].get("id", ""))
                    logger.info("Pushed workout '%s' to intervals.icu (event %s)", workout.title, event_id)
                    return event_id
                else:
                    logger.error("intervals.icu push failed: %s %s", resp.status_code, resp.text)
                    return None
        except Exception as e:
            logger.error("intervals.icu request failed: %s", e)
            return None

    async def delete_workout(self, external_id: str) -> bool:
        """Delete a workout from intervals.icu by external_id."""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.put(
                    f"{BASE_URL}/athlete/{self.athlete_id}/events/bulk-delete",
                    auth=self.auth,
                    json=[{"external_id": external_id}],
                    timeout=15,
                )
                return resp.status_code == 200
        except Exception as e:
            logger.error("intervals.icu delete failed: %s", e)
            return False

    async def verify_connection(self) -> Dict:
        """Verify API key and athlete ID are valid."""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{BASE_URL}/athlete/{self.athlete_id}",
                    auth=self.auth,
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return {"ok": True, "name": data.get("name", ""), "id": data.get("id", "")}
                return {"ok": False, "error": f"HTTP {resp.status_code}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}
