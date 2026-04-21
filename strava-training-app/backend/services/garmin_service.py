"""
Garmin Connect integration using python-garminconnect >= 0.3.2
Tokens stored in /config/strava_training/garmin_tokens (HA config volume).
"""
import logging
from pathlib import Path
from typing import Optional, Dict

logger = logging.getLogger(__name__)

TOKEN_PATH = Path("/config/strava_training/garmin_tokens")


class GarminService:
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self._client = None

    async def connect(self) -> bool:
        try:
            from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectConnectionError

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

            logger.info("Attempting fresh Garmin login")
            client = Garmin(email=self.email, password=self.password, prompt_mfa=None)
            client.login(token_str)
            self._client = client
            logger.info("Fresh Garmin login OK, tokens saved")
            return True

        except Exception as e:
            if "429" in str(e):
                logger.error("Garmin rate-limited. Generate tokens on your PC and copy to %s", TOKEN_PATH)
            else:
                logger.error("Garmin login failed: %s", e)
            return False

    async def export_workout(self, workout) -> Optional[str]:
        """Upload a workout to Garmin Connect."""
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
            step_order = 1
            intervals = workout.intervals or []

            if not intervals:
                dur = float((workout.target_duration_minutes or 60) * 60)
                steps.append(create_interval_step(step_order, dur))
            else:
                for iv in intervals:
                    itype   = iv.get("type", "work")
                    dur_s   = float(iv.get("duration_seconds", 300))
                    repeats = int(iv.get("repeats", 1))
                    rest_s  = float(iv.get("rest_seconds", 0))
                    p_low   = iv.get("power_low")
                    p_high  = iv.get("power_high")

                    for _ in range(repeats):
                        if itype == "warmup":
                            step = create_warmup_step(step_order, dur_s)
                        elif itype == "cooldown":
                            step = create_cooldown_step(step_order, dur_s)
                        elif itype == "recovery":
                            step = create_recovery_step(step_order, dur_s)
                        else:
                            step = create_interval_step(step_order, dur_s)
                            if p_low and p_high:
                                step["targetType"] = {"workoutTargetTypeKey": "power.zone"}
                                step["targetValueOne"] = int(p_low)
                                step["targetValueTwo"] = int(p_high)
                        steps.append(step)
                        step_order += 1

                        if rest_s > 0:
                            steps.append(create_recovery_step(step_order, rest_s))
                            step_order += 1

            sport_type = {"sportTypeId": 2, "sportTypeKey": "cycling"}
            garmin_workout = CyclingWorkout(
                workoutName=workout.title,
                estimatedDurationInSecs=int((workout.target_duration_minutes or 60) * 60),
                workoutSegments=[WorkoutSegment(
                    segmentOrder=1,
                    sportType=sport_type,
                    workoutSteps=steps,
                )],
            )

            result = self._client.upload_cycling_workout(garmin_workout)
            workout_id = (result or {}).get("workoutId") or \
                         (result or {}).get("detailedWorkout", {}).get("workoutId")
            logger.info("Uploaded '%s' to Garmin (ID: %s)", workout.title, workout_id)
            return str(workout_id) if workout_id else None

        except ImportError as e:
            logger.warning("Typed workout module unavailable (%s), using raw API", e)
            return await self._export_raw(workout)
        except Exception as e:
            logger.error("Garmin export failed: %s", e)
            self._client = None
            return None

    async def _export_raw(self, workout) -> Optional[str]:
        """Fallback: raw connectapi call."""
        try:
            payload = self._build_raw_workout(workout)
            response = self._client.connectapi(
                "/workout-service/workout", method="POST", json=payload
            )
            workout_id = (response or {}).get("workoutId")
            logger.info("Raw export '%s' (ID: %s)", workout.title, workout_id)
            return str(workout_id) if workout_id else None
        except Exception as e:
            logger.error("Raw export failed: %s", e)
            return None

    async def schedule_workout(self, garmin_workout_id: str, workout_date) -> bool:
        if not self._client:
            return False
        try:
            date_str = workout_date.strftime("%Y-%m-%d") if hasattr(workout_date, 'strftime') else str(workout_date)[:10]
            self._client.schedule_workout(garmin_workout_id, date_str)
            return True
        except Exception as e:
            logger.error("Schedule failed: %s", e)
            return False

    def _build_raw_workout(self, workout) -> Dict:
        steps = []
        order = 1
        for iv in (workout.intervals or []):
            itype  = iv.get("type", "work")
            dur_s  = iv.get("duration_seconds", 300)
            reps   = int(iv.get("repeats", 1))
            rest_s = int(iv.get("rest_seconds", 0))
            p_low  = iv.get("power_low")
            p_high = iv.get("power_high")
            for _ in range(reps):
                step = {
                    "type": "ExecutableStepDTO", "stepOrder": order,
                    "stepType": {"stepTypeKey": "interval" if itype == "work" else "recovery"},
                    "endCondition": {"conditionTypeKey": "time"},
                    "endConditionValue": dur_s,
                    "targetType": {"workoutTargetTypeKey": "power.zone" if p_low else "no.target"},
                }
                if p_low: step["targetValueOne"] = int(p_low)
                if p_high: step["targetValueTwo"] = int(p_high)
                steps.append(step); order += 1
                if rest_s > 0:
                    steps.append({
                        "type": "ExecutableStepDTO", "stepOrder": order,
                        "stepType": {"stepTypeKey": "recovery"},
                        "endCondition": {"conditionTypeKey": "time"},
                        "endConditionValue": rest_s,
                        "targetType": {"workoutTargetTypeKey": "no.target"},
                    }); order += 1
        return {
            "workoutName": workout.title, "description": workout.description or "",
            "sportType": {"sportTypeKey": "cycling"},
            "workoutSegments": [{"segmentOrder": 1,
                                  "sportType": {"sportTypeKey": "cycling"},
                                  "workoutSteps": steps}],
        }
