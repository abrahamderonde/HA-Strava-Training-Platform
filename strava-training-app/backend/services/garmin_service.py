"""
Garmin Connect integration using python-garminconnect >= 0.3.2
Uses the new DI OAuth Bearer token auth (no garth dependency).
Tokens stored in /config/strava_training/garmin_tokens (HA config volume).
"""
import logging
from datetime import datetime, date
from pathlib import Path
from typing import Optional, Dict

logger = logging.getLogger(__name__)

# /config is mounted as rw in config.yaml — accessible from the container
TOKEN_PATH = Path("/config/strava_training/garmin_tokens")


class GarminService:
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self._client = None

    async def connect(self) -> bool:
        try:
            from garminconnect import (
                Garmin,
                GarminConnectAuthenticationError,
                GarminConnectConnectionError,
            )

            TOKEN_PATH.mkdir(parents=True, exist_ok=True)
            token_str = str(TOKEN_PATH)
            files = [f.name for f in TOKEN_PATH.iterdir()]
            logger.info("Garmin token path: %s  files: %s", token_str, files)

            if files:
                try:
                    client = Garmin()
                    client.login(token_str)
                    self._client = client
                    logger.info("Resumed Garmin session from cached tokens")
                    return True
                except Exception as e:
                    logger.warning("Cached tokens failed: %s", e)

            # Fresh login (may fail from server IPs — generate tokens on PC first)
            logger.info("Attempting fresh Garmin login")
            client = Garmin(email=self.email, password=self.password, prompt_mfa=None)
            client.login(token_str)
            self._client = client
            logger.info("Fresh Garmin login OK, tokens saved to %s", token_str)
            return True

        except Exception as e:
            if "429" in str(e):
                logger.error("Garmin rate-limited (429). Generate tokens on your PC and copy to %s", TOKEN_PATH)
            else:
                logger.error("Garmin login failed: %s", e)
            return False

    async def export_workout(self, workout) -> Optional[str]:
        """Upload a workout to Garmin Connect using the new typed workout API."""
        if not self._client:
            if not await self.connect():
                return None
        try:
            from garminconnect.workout import (
                CyclingWorkout, WorkoutSegment,
                create_warmup_step, create_interval_step,
                create_recovery_step, create_cooldown_step,
            )

            steps = []
            intervals = workout.intervals or []

            if not intervals:
                dur = (workout.target_duration_minutes or 60) * 60.0
                steps.append(create_interval_step(dur))
            else:
                for iv in intervals:
                    itype    = iv.get("type", "work")
                    dur_s    = float(iv.get("duration_seconds", 300))
                    repeats  = int(iv.get("repeats", 1))
                    rest_s   = float(iv.get("rest_seconds", 0))
                    p_low    = iv.get("power_low")
                    p_high   = iv.get("power_high")

                    for _ in range(repeats):
                        if itype == "warmup":
                            steps.append(create_warmup_step(dur_s))
                        elif itype == "cooldown":
                            steps.append(create_cooldown_step(dur_s))
                        elif itype == "recovery":
                            steps.append(create_recovery_step(dur_s))
                        else:
                            # Interval step — add power targets if available
                            step = create_interval_step(dur_s)
                            if p_low and p_high:
                                # Set power target on the step dict
                                step["targetType"] = {"workoutTargetTypeKey": "power.zone"}
                                step["targetValueOne"] = int(p_low)
                                step["targetValueTwo"] = int(p_high)
                            steps.append(step)

                        if rest_s > 0:
                            steps.append(create_recovery_step(rest_s))

            sport_type = {"sportTypeId": 2, "sportTypeKey": "cycling"}
            garmin_workout = CyclingWorkout(
                workoutName=workout.title,
                estimatedDurationInSecs=int((workout.target_duration_minutes or 60) * 60),
                workoutSegments=[
                    WorkoutSegment(
                        segmentOrder=1,
                        sportType=sport_type,
                        workoutSteps=steps,
                    )
                ],
            )

            result = self._client.upload_cycling_workout(garmin_workout)
            workout_id = result.get("workoutId") or result.get("detailedWorkout", {}).get("workoutId")
            logger.info("Uploaded '%s' to Garmin (ID: %s)", workout.title, workout_id)
            return str(workout_id) if workout_id else None

        except ImportError:
            # Fallback: use raw API if typed workout module not available
            logger.info("Typed workout module not found, using raw API")
            return await self._export_raw(workout)
        except Exception as e:
            logger.error("Garmin export failed: %s", e)
            self._client = None
            return None

    async def _export_raw(self, workout) -> Optional[str]:
        """Fallback: upload workout using raw connectapi."""
        try:
            garmin_workout = self._build_raw_workout(workout)
            # 0.3.x uses client.connectapi() not client.garth.connectapi()
            response = self._client.connectapi(
                "/workout-service/workout",
                method="POST",
                json=garmin_workout,
            )
            workout_id = response.get("workoutId")
            logger.info("Exported '%s' via raw API (ID: %s)", workout.title, workout_id)
            return str(workout_id) if workout_id else None
        except Exception as e:
            logger.error("Raw Garmin export failed: %s", e)
            return None

    async def schedule_workout(self, garmin_workout_id: str, workout_date) -> bool:
        """Schedule a workout on a specific date."""
        if not self._client:
            return False
        try:
            date_str = workout_date.strftime("%Y-%m-%d") if hasattr(workout_date, 'strftime') else str(workout_date)[:10]
            self._client.schedule_workout(garmin_workout_id, date_str)
            return True
        except Exception as e:
            logger.error("Failed to schedule workout: %s", e)
            return False

    def _build_raw_workout(self, workout) -> Dict:
        """Build raw Garmin workout JSON as fallback."""
        steps = []
        step_order = 1
        for iv in (workout.intervals or []):
            itype = iv.get("type", "work")
            dur_s = iv.get("duration_seconds", 300)
            repeats = int(iv.get("repeats", 1))
            p_low = iv.get("power_low")
            p_high = iv.get("power_high")
            rest_s = int(iv.get("rest_seconds", 0))
            for _ in range(repeats):
                step = {
                    "type": "ExecutableStepDTO",
                    "stepOrder": step_order,
                    "stepType": {"stepTypeKey": "interval" if itype == "work" else "recovery"},
                    "endCondition": {"conditionTypeKey": "time"},
                    "endConditionValue": dur_s,
                    "targetType": {"workoutTargetTypeKey": "power.zone" if p_low else "no.target"},
                }
                if p_low: step["targetValueOne"] = int(p_low)
                if p_high: step["targetValueTwo"] = int(p_high)
                steps.append(step)
                step_order += 1
                if rest_s > 0:
                    steps.append({
                        "type": "ExecutableStepDTO",
                        "stepOrder": step_order,
                        "stepType": {"stepTypeKey": "recovery"},
                        "endCondition": {"conditionTypeKey": "time"},
                        "endConditionValue": rest_s,
                        "targetType": {"workoutTargetTypeKey": "no.target"},
                    })
                    step_order += 1
        return {
            "workoutName": workout.title,
            "description": workout.description or "",
            "sportType": {"sportTypeKey": "cycling"},
            "workoutSegments": [{"segmentOrder": 1,
                                  "sportType": {"sportTypeKey": "cycling"},
                                  "workoutSteps": steps}],
        }
