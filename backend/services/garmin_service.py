"""
Garmin Connect integration using garth (unofficial API).
Exports structured workouts to Garmin Connect.
"""
import garth
import logging
import json
from datetime import datetime
from typing import Dict, List, Optional, Any
from ..models.database import PlannedWorkout

logger = logging.getLogger(__name__)


class GarminService:
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self._client = None

    async def connect(self) -> bool:
        """Authenticate with Garmin Connect."""
        try:
            garth.login(self.email, self.password)
            self._client = garth
            logger.info("Connected to Garmin Connect")
            return True
        except Exception as e:
            logger.error("Garmin Connect login failed: %s", e)
            return False

    def _build_garmin_workout(self, workout: PlannedWorkout) -> Dict:
        """
        Convert a PlannedWorkout to Garmin Connect workout format.
        Supports structured interval workouts.
        """
        steps = []
        step_order = 1

        intervals = workout.intervals or []

        if not intervals:
            # Simple duration-based workout
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
                    # Repeat block
                    repeat_steps = []
                    # Work step
                    work_step = self._make_step(
                        step_order=1,
                        step_type="interval",
                        duration_type="time",
                        duration_value=duration_s,
                        target_type="power.zone" if power_low else "no.target",
                        target_low=power_low,
                        target_high=power_high,
                    )
                    repeat_steps.append(work_step)

                    # Rest step if provided
                    rest_s = interval.get("rest_seconds", 0)
                    if rest_s > 0:
                        rest_step = self._make_step(
                            step_order=2,
                            step_type="recovery",
                            duration_type="time",
                            duration_value=rest_s,
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
                        duration_type="time",
                        duration_value=duration_s,
                        target_type="power.zone" if power_low else "no.target",
                        target_low=power_low,
                        target_high=power_high,
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

    def _make_step(
        self,
        step_order: int,
        step_type: str,
        duration_type: str,
        duration_value: int,
        target_type: str,
        target_low: Optional[float] = None,
        target_high: Optional[float] = None,
    ) -> Dict:
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

    async def export_workout(self, workout: PlannedWorkout) -> Optional[str]:
        """
        Export a workout to Garmin Connect.
        Returns the Garmin workout ID on success.
        """
        if not self._client:
            if not await self.connect():
                return None

        garmin_workout = self._build_garmin_workout(workout)

        try:
            response = garth.connectapi(
                "/workout-service/workout",
                method="POST",
                json=garmin_workout,
            )
            workout_id = response.get("workoutId")
            logger.info("Exported workout '%s' to Garmin (ID: %s)", workout.title, workout_id)
            return str(workout_id)
        except Exception as e:
            logger.error("Failed to export workout to Garmin: %s", e)
            return None

    async def schedule_workout(self, garmin_workout_id: str, date: datetime) -> bool:
        """Schedule an exported workout on a specific date in Garmin Connect."""
        if not self._client:
            if not await self.connect():
                return False
        try:
            garth.connectapi(
                f"/workout-service/schedule/{garmin_workout_id}",
                method="POST",
                json={"date": date.strftime("%Y-%m-%d")},
            )
            return True
        except Exception as e:
            logger.error("Failed to schedule workout: %s", e)
            return False
