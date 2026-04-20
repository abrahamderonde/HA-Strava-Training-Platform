"""
Garmin Connect integration using python-garminconnect >= 0.3.2
New DI OAuth Bearer token auth — replaces deprecated garth SSO.
Tokens stored in garmin_tokens.json, auto-renew via refresh token.
"""
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict

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
            from garminconnect import (
                Garmin,
                GarminConnectAuthenticationError,
                GarminConnectConnectionError,
                GarminConnectTooManyRequestsError,
            )

            GARMIN_TOKEN_PATH.mkdir(parents=True, exist_ok=True)
            token_str = str(GARMIN_TOKEN_PATH)

            # Log what's in the token directory
            files = list(GARMIN_TOKEN_PATH.iterdir()) if GARMIN_TOKEN_PATH.exists() else []
            logger.info("Garmin token path: %s, files: %s", token_str, [f.name for f in files])

            # Try loading saved tokens first (0.3.x auto-renews via refresh token)
            if files:
                try:
                    client = Garmin()
                    client.login(token_str)
                    self._client = client
                    logger.info("Resumed Garmin session from %s", token_str)
                    return True
                except (GarminConnectAuthenticationError, GarminConnectConnectionError, FileNotFoundError) as e:
                    logger.warning("Cached tokens invalid (%s), will try fresh login", e)
            else:
                logger.warning("No token files found at %s — cannot login without tokens", token_str)
                return False

            # Fresh login
            client = Garmin(
                email=self.email,
                password=self.password,
                prompt_mfa=None,  # No interactive MFA in server context
            )
            client.login(token_str)
            self._client = client
            logger.info("Logged in to Garmin, tokens saved to %s", token_str)
            return True

        except Exception as e:
            if "429" in str(e):
                logger.error("Garmin rate-limited (429). Wait 24-48h before retrying.")
            else:
                logger.error("Garmin login failed: %s", e)
            return False

    async def export_workout(self, workout) -> Optional[str]:
        """Export a workout to Garmin Connect. Returns Garmin workout ID."""
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
            logger.info("Exported '%s' to Garmin (ID: %s)", workout.title, workout_id)
            return str(workout_id)
        except Exception as e:
            logger.error("Garmin export failed: %s", e)
            return None

    def _build_garmin_workout(self, workout) -> Dict:
        steps = []
        step_order = 1
        intervals = workout.intervals or []
        if not intervals:
            steps.append(self._make_step(step_order, "interval", "time",
                                          (workout.target_duration_minutes or 60)*60, "no.target"))
        else:
            for interval in intervals:
                itype = interval.get("type", "work")
                duration_s = interval.get("duration_seconds", 300)
                repeats = interval.get("repeats", 1)
                power_low = interval.get("power_low")
                power_high = interval.get("power_high")
                for rep in range(repeats):
                    steps.append(self._make_step(
                        step_order, "interval" if itype == "work" else "recovery",
                        "time", duration_s,
                        "power.zone" if power_low else "no.target",
                        power_low, power_high,
                    ))
                    step_order += 1
                    if interval.get("rest_seconds", 0) > 0:
                        steps.append(self._make_step(step_order, "recovery", "time",
                                                      interval["rest_seconds"], "no.target"))
                        step_order += 1
        return {
            "workoutName": workout.title,
            "description": workout.description or "",
            "sportType": {"sportTypeKey": "cycling"},
            "workoutSegments": [{"segmentOrder": 1,
                                  "sportType": {"sportTypeKey": "cycling"},
                                  "workoutSteps": steps}],
        }

    def _make_step(self, order, step_type, duration_type, duration_value,
                   target_type, target_low=None, target_high=None) -> Dict:
        step = {
            "type": "ExecutableStepDTO",
            "stepOrder": order,
            "stepType": {"stepTypeKey": step_type},
            "endCondition": {"conditionTypeKey": duration_type},
            "endConditionValue": duration_value,
            "targetType": {"workoutTargetTypeKey": target_type},
        }
        if target_low: step["targetValueOne"] = target_low
        if target_high: step["targetValueTwo"] = target_high
        return step
