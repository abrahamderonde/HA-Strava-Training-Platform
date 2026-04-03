"""
Garmin Connect integration using python-garminconnect >= 0.2.8.
This version uses the new TLS-based auth that replaced the deprecated garth SSO.
Tokens are cached to /data/strava_training/garmin_tokens/ — valid ~1 year.
"""
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

GARMIN_TOKEN_PATH = Path("/data/strava_training/garmin_tokens")


class GarminService:
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self._client = None

    async def connect(self) -> bool:
        """Authenticate with Garmin Connect, using cached tokens if available."""
        try:
            from garminconnect import Garmin, GarminConnectAuthenticationError

            GARMIN_TOKEN_PATH.mkdir(parents=True, exist_ok=True)
            token_str = str(GARMIN_TOKEN_PATH)

            # Try loading cached tokens first — new format (0.3.0+) uses garmin_tokens.json
            token_file_new = GARMIN_TOKEN_PATH / "garmin_tokens.json"
            has_tokens = token_file_new.exists() or any(GARMIN_TOKEN_PATH.glob("*.json"))
            if has_tokens:
                try:
                    client = Garmin()
                    client.login(token_str)
                    self._client = client
                    logger.info("Resumed cached Garmin session from %s", token_str)
                    return True
                except Exception as e:
                    logger.info("Cached tokens invalid (%s), trying fresh login", e)
                    # Clean up stale tokens so fresh login proceeds
                    for f in GARMIN_TOKEN_PATH.glob("*.json"):
                        f.unlink(missing_ok=True)

            # Fresh login
            logger.info("Attempting fresh Garmin login")
            client = Garmin(email=self.email, password=self.password,
                           is_cn=False, return_on_mfa=True)
            result = client.login()

            # Handle MFA if required
            if isinstance(result, tuple) and result[0] == "needs_mfa":
                logger.error(
                    "Garmin requires MFA code. Cannot complete login automatically. "
                    "Please generate tokens manually — see DOCS.md for instructions."
                )
                return False

            client.garth.dump(token_str)
            self._client = client
            logger.info("Logged in to Garmin Connect, tokens saved to %s", token_str)
            return True

        except Exception as e:
            if "429" in str(e):
                logger.error(
                    "Garmin rate-limited (429). Wait 24-48h or generate tokens manually. "
                    "See DOCS.md for instructions."
                )
            else:
                logger.error("Garmin Connect login failed: %s", e)
            return False

    async def export_workout(self, workout) -> Optional[str]:
        """Export a workout to Garmin Connect. Returns the Garmin workout ID."""
        if not self._client:
            if not await self.connect():
                return None

        garmin_workout = self._build_garmin_workout(workout)

        try:
            response = self._client.garth.connectapi(
                "/workout-service/workout",
                method="POST",
                json=garmin_workout,
            )
            workout_id = response.get("workoutId")
            logger.info("Exported workout '%s' to Garmin (ID: %s)", workout.title, workout_id)
            return str(workout_id)
        except Exception as e:
            logger.error("Failed to export workout to Garmin: %s", e)
            # Clear cached tokens so next attempt tries fresh login
            import shutil
            shutil.rmtree(str(GARMIN_TOKEN_PATH), ignore_errors=True)
            return None

    async def schedule_workout(self, garmin_workout_id: str, date: datetime) -> bool:
        """Schedule a workout on a specific date in Garmin Connect."""
        if not self._client:
            if not await self.connect():
                return False
        try:
            self._client.garth.connectapi(
                f"/workout-service/schedule/{garmin_workout_id}",
                method="POST",
                json={"date": date.strftime("%Y-%m-%d")},
            )
            return True
        except Exception as e:
            logger.error("Failed to schedule workout: %s", e)
            return False

    def _build_garmin_workout(self, workout) -> Dict:
        steps = []
        step_order = 1
        intervals = workout.intervals or []

        if not intervals:
            steps.append(self._make_step(
                step_order=step_order,
                step_type="interval",
                duration_type="time",
                duration_value=(workout.target_duration_minutes or 60) * 60,
                target_type="no.target",
            ))
        else:
            for interval in intervals:
                itype = interval.get("type", "work")
                duration_s = interval.get("duration_seconds", 300)
                repeats = interval.get("repeats", 1)
                power_low = interval.get("power_low")
                power_high = interval.get("power_high")

                if repeats > 1:
                    repeat_steps = []
                    work_step = self._make_step(
                        step_order=1, step_type="interval",
                        duration_type="time", duration_value=duration_s,
                        target_type="power.zone" if power_low else "no.target",
                        target_low=power_low, target_high=power_high,
                    )
                    repeat_steps.append(work_step)
                    rest_s = interval.get("rest_seconds", 0)
                    if rest_s > 0:
                        rest_step = self._make_step(
                            step_order=2, step_type="recovery",
                            duration_type="time", duration_value=rest_s,
                            target_type="no.target",
                        )
                        repeat_steps.append(rest_step)
                    steps.append({
                        "type": "RepeatGroupDTO",
                        "stepOrder": step_order,
                        "numberOfIterations": repeats,
                        "workoutSteps": repeat_steps,
                    })
                else:
                    step = self._make_step(
                        step_order=step_order,
                        step_type="interval" if itype == "work" else "recovery",
                        duration_type="time", duration_value=duration_s,
                        target_type="power.zone" if power_low else "no.target",
                        target_low=power_low, target_high=power_high,
                    )
                    steps.append(step)
                step_order += 1

        return {
            "workoutName": workout.title,
            "description": workout.description or "",
            "sportType": {"sportTypeKey": "cycling"},
            "workoutSegments": [{
                "segmentOrder": 1,
                "sportType": {"sportTypeKey": "cycling"},
                "workoutSteps": steps,
            }],
        }

    def _make_step(self, step_order, step_type, duration_type, duration_value,
                   target_type, target_low=None, target_high=None) -> Dict:
        step = {
            "type": "ExecutableStepDTO",
            "stepOrder": step_order,
            "stepType": {"stepTypeKey": step_type},
            "endCondition": {"conditionTypeKey": duration_type},
            "endConditionValue": duration_value,
            "targetType": {"workoutTargetTypeKey": target_type},
        }
        if target_low is not None:
            step["targetValueOne"] = target_low
        if target_high is not None:
            step["targetValueTwo"] = target_high
        return step
