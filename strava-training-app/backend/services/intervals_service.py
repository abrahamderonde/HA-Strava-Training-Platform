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
        Format: "- Xm Y% Description"
        Power percentages are relative to FTP.
        """
        lines = []
        intervals = workout.intervals or []

        if not intervals:
            # Simple duration workout
            duration_min = workout.target_duration_minutes or 60
            if_ = workout.target_if or 0.65
            pct = round(if_ * 100)
            lines.append(f"- {duration_min}m {pct}%")
        else:
            for interval in intervals:
                itype = interval.get("type", "work")
                duration_s = interval.get("duration_seconds", 300)
                duration_min = duration_s / 60
                dur_str = f"{int(duration_min)}m" if duration_min >= 1 else f"{duration_s}s"
                repeats = interval.get("repeats", 1)
                rest_s = interval.get("rest_seconds", 0)
                power_low = interval.get("power_low")
                power_high = interval.get("power_high")
                ftp = workout.target_if and workout.target_if * 100 or 100

                # Use midpoint power as percentage of FTP
                # We store actual watts, need to convert back to %
                # target_if on workout gives us reference FTP
                if power_low and power_high:
                    mid_watts = (power_low + power_high) / 2
                    # Approximate FTP from the workout's target_if
                    # We'll store the pct directly from interval data if available
                    pct = interval.get("power_pct") or round(mid_watts)
                elif power_low:
                    pct = interval.get("power_pct") or round(power_low)
                else:
                    # Map intensity type to typical percentages
                    pct_map = {"warmup": 55, "cooldown": 55, "recovery": 50,
                               "work": 85, "threshold": 95, "vo2max": 115}
                    pct = pct_map.get(itype, 70)

                if repeats > 1:
                    lines.append(f"{repeats}x")
                    lines.append(f"- {dur_str} {pct}%")
                    if rest_s > 0:
                        rest_min = rest_s / 60
                        rest_str = f"{int(rest_min)}m" if rest_min >= 1 else f"{rest_s}s"
                        lines.append(f"- {rest_str} 50%")
                else:
                    lines.append(f"- {dur_str} {pct}%")

        return "\n".join(lines)

    async def push_workout(self, workout, ftp: float = None) -> Optional[str]:
        """
        Push a single workout to intervals.icu calendar.
        Returns the intervals.icu event ID on success.
        Uses base64-encoded FIT file for best structured workout support.
        """
        from .fit_export import generate_workout_fit
        import base64

        try:
            fit_bytes = generate_workout_fit(workout)
            fit_b64 = base64.b64encode(fit_bytes).decode('utf-8')
        except Exception as e:
            logger.warning("FIT generation failed, falling back to description: %s", e)
            fit_b64 = None

        workout_date = workout.date if isinstance(workout.date, datetime) else datetime.combine(workout.date, datetime.min.time())
        start_local = workout_date.strftime("%Y-%m-%dT00:00:00")

        event = {
            "category": "WORKOUT",
            "start_date_local": start_local,
            "type": "Ride",
            "name": workout.title,
            "description": workout.description or "",
            "moving_time": (workout.target_duration_minutes or 60) * 60,
            "target": "POWER",
            "external_id": f"trainiq_{workout.id}",
        }

        if workout.target_tss:
            event["icu_training_load"] = workout.target_tss

        if fit_b64:
            event["filename"] = f"{workout.title.replace(' ', '_')[:30]}.fit"
            event["file_contents_base64"] = fit_b64
        else:
            event["description"] = self._workout_to_description(workout)

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
