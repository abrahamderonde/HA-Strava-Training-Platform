"""
Garmin Connect integration using python-garminconnect >= 0.3.2
Uses client.connectapi() directly with plain dicts — no pydantic dependency.
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
            from garminconnect import Garmin

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
                logger.error("Garmin rate-limited. Copy tokens from PC to %s", TOKEN_PATH)
            else:
                logger.error("Garmin login failed: %s", e)
            return False

    async def export_workout(self, workout) -> Optional[str]:
        """Upload workout to Garmin Connect via connectapi with plain JSON."""
        if not self._client:
            if not await self.connect():
                return None
        try:
            payload = self._build_workout(workout)
            response = self._client.connectapi(
                "/workout-service/workout",
                method="POST",
                json=payload,
            )
            workout_id = (response or {}).get("workoutId")
            logger.info("Uploaded '%s' to Garmin (ID: %s)", workout.title, workout_id)
            return str(workout_id) if workout_id else None
        except Exception as e:
            logger.error("Garmin export failed: %s", e)
            self._client = None
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

    def _build_workout(self, workout) -> Dict:
        """Build Garmin workout JSON from TrainIQ PlannedWorkout."""
        steps = []
        order = 1

        for iv in (workout.intervals or []):
            itype   = iv.get("type", "work")
            dur_s   = int(iv.get("duration_seconds", 300))
            repeats = int(iv.get("repeats", 1))
            rest_s  = int(iv.get("rest_seconds", 0))
            p_low   = iv.get("power_low")
            p_high  = iv.get("power_high")

            step_type = {
                "warmup":   "warmup",
                "cooldown": "cooldown",
                "recovery": "recovery",
            }.get(itype, "interval")

            target = (
                {
                    "workoutTargetTypeId": 2,
                    "workoutTargetTypeKey": "power.zone",
                    "displayOrder": 1,
                    "targetValueOne": int(p_low),
                    "targetValueTwo": int(p_high),
                }
                if p_low and p_high
                else {
                    "workoutTargetTypeId": 1,
                    "workoutTargetTypeKey": "no.target",
                    "displayOrder": 1,
                }
            )

            if repeats > 1:
                # Use RepeatGroupDTO for proper repeat structure on the device
                inner_steps = [
                    {
                        "type": "ExecutableStepDTO",
                        "stepOrder": 1,
                        "stepType": {"stepTypeKey": "interval"},
                        "endCondition": {"conditionTypeKey": "time"},
                        "endConditionValue": dur_s,
                        "targetType": target,
                    }
                ]
                if rest_s > 0:
                    inner_steps.append({
                        "type": "ExecutableStepDTO",
                        "stepOrder": 2,
                        "stepType": {"stepTypeKey": "recovery"},
                        "endCondition": {"conditionTypeKey": "time"},
                        "endConditionValue": rest_s,
                        "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
                    })
                steps.append({
                    "type": "RepeatGroupDTO",
                    "stepOrder": order,
                    "numberOfIterations": repeats,
                    "workoutSteps": inner_steps,
                    "endCondition": {"conditionTypeKey": "iterations"},
                    "endConditionValue": repeats,
                })
                order += 1
            else:
                steps.append({
                    "type": "ExecutableStepDTO",
                    "stepOrder": order,
                    "stepType": {"stepTypeKey": step_type},
                    "endCondition": {"conditionTypeKey": "time"},
                    "endConditionValue": dur_s,
                    "targetType": target,
                })
                order += 1
                if rest_s > 0:
                    steps.append({
                        "type": "ExecutableStepDTO",
                        "stepOrder": order,
                        "stepType": {"stepTypeKey": "recovery"},
                        "endCondition": {"conditionTypeKey": "time"},
                        "endConditionValue": rest_s,
                        "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
                    })
                    order += 1

        return {
            "workoutName": workout.title,
            "description": workout.description or "",
            "sportType": {"sportTypeKey": "cycling"},
            "estimatedDurationInSecs": int((workout.target_duration_minutes or 60) * 60),
            "workoutSegments": [{
                "segmentOrder": 1,
                "sportType": {"sportTypeKey": "cycling"},
                "workoutSteps": steps,
            }],
        }
