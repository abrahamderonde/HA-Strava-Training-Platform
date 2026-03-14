"""
Strava API integration:
- OAuth2 authentication flow
- Activity history import (with power streams)
- Real-time webhook subscription
"""
import httpx
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from ..models.database import Activity, StravaToken
from .training_science import (
    calculate_tss_from_power,
    estimate_tss_from_hr,
    estimate_tss_no_data,
    build_power_curve,
)

logger = logging.getLogger(__name__)

STRAVA_BASE = "https://www.strava.com/api/v3"
STRAVA_AUTH = "https://www.strava.com/oauth"

CYCLING_SPORTS = {"Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide"}


class StravaService:
    def __init__(self, client_id: str, client_secret: str, db: AsyncSession, ftp: float = 200.0):
        self.client_id = client_id
        self.client_secret = client_secret
        self.db = db
        self.ftp = ftp

    def get_auth_url(self, redirect_uri: str) -> str:
        return (
            f"{STRAVA_AUTH}/authorize"
            f"?client_id={self.client_id}"
            f"&response_type=code"
            f"&redirect_uri={redirect_uri}"
            f"&approval_prompt=force"
            f"&scope=read,activity:read_all"
        )

    async def exchange_code(self, code: str, redirect_uri: str = None) -> Optional[Dict]:
        async with httpx.AsyncClient() as client:
            payload = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "grant_type": "authorization_code",
            }
            if redirect_uri:
                payload["redirect_uri"] = redirect_uri
            resp = await client.post(f"{STRAVA_AUTH}/token", data=payload)
            if resp.status_code == 200:
                return resp.json()
            logger.error("Strava token exchange failed: %s %s", resp.status_code, resp.text)
        return None

    async def _get_valid_token(self) -> Optional[str]:
        """Get a valid access token, refreshing if needed."""
        result = await self.db.execute(select(StravaToken).limit(1))
        token_row = result.scalar_one_or_none()
        if not token_row:
            return None

        now = int(datetime.now(timezone.utc).timestamp())
        if token_row.expires_at - now < 300:  # refresh 5 min before expiry
            async with httpx.AsyncClient() as client:
                resp = await client.post(f"{STRAVA_AUTH}/token", data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": token_row.refresh_token,
                    "grant_type": "refresh_token",
                })
                if resp.status_code == 200:
                    data = resp.json()
                    token_row.access_token = data["access_token"]
                    token_row.refresh_token = data.get("refresh_token", token_row.refresh_token)
                    token_row.expires_at = data["expires_at"]
                    await self.db.commit()
                else:
                    logger.error("Token refresh failed: %s", resp.text)
                    return None

        return token_row.access_token

    async def _get_activity_streams(self, activity_id: int, token: str) -> Dict:
        """Fetch power and HR streams for an activity."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{STRAVA_BASE}/activities/{activity_id}/streams",
                params={"keys": "watts,heartrate,latlng", "key_by_type": "true"},
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                return resp.json()
        return {}

    def _compute_tss(
        self,
        activity_data: Dict,
        power_stream: Optional[List[float]],
        hr_stream: Optional[List[float]],
        sport_type: str,
        moving_time: int,
    ) -> tuple:
        """Compute TSS, NP, IF for an activity."""
        if power_stream and len(power_stream) > 10 and self.ftp > 0:
            tss, np_val, if_ = calculate_tss_from_power(power_stream, self.ftp, moving_time)
            return tss, np_val, if_, True

        avg_hr = activity_data.get("average_heartrate")
        if avg_hr and avg_hr > 0:
            tss = estimate_tss_from_hr(avg_hr, moving_time)
            return tss, None, None, False

        tss = estimate_tss_no_data(moving_time, sport_type)
        return tss, None, None, False

    async def import_activity(self, activity_data: Dict, fetch_streams: bool = True) -> Optional[Activity]:
        """Import a single activity into the database."""
        strava_id = activity_data["id"]

        # Check if already exists
        result = await self.db.execute(
            select(Activity).where(Activity.strava_id == strava_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            return existing

        sport_type = activity_data.get("sport_type", activity_data.get("type", "Ride"))
        moving_time = activity_data.get("moving_time", 0)
        has_power = activity_data.get("device_watts", False)

        power_stream = None
        hr_stream = None
        latlng_stream = None

        CYCLING = {"Ride","VirtualRide","EBikeRide","MountainBikeRide","GravelRide"}
        if fetch_streams and (has_power or sport_type in CYCLING):
            token = await self._get_valid_token()
            if token:
                streams = await self._get_activity_streams(strava_id, token)
                if "watts" in streams:
                    power_stream = streams["watts"].get("data")
                if "heartrate" in streams:
                    hr_stream = streams["heartrate"].get("data")
                if "latlng" in streams:
                    # Sample every 10th point to save storage
                    raw = streams["latlng"].get("data", [])
                    latlng_stream = raw[::10] if len(raw) > 10 else raw

        tss, np_val, if_, used_power = self._compute_tss(
            activity_data, power_stream, hr_stream, sport_type, moving_time
        )

        start_date = datetime.fromisoformat(
            activity_data["start_date"].replace("Z", "+00:00")
        ).replace(tzinfo=None)

        activity = Activity(
            strava_id=strava_id,
            name=activity_data.get("name", ""),
            sport_type=sport_type,
            start_date=start_date,
            elapsed_time=activity_data.get("elapsed_time", 0),
            moving_time=moving_time,
            distance=activity_data.get("distance", 0),
            total_elevation_gain=activity_data.get("total_elevation_gain", 0),
            average_speed=activity_data.get("average_speed", 0),
            max_speed=activity_data.get("max_speed", 0),
            average_watts=activity_data.get("average_watts"),
            max_watts=activity_data.get("max_watts"),
            weighted_avg_watts=activity_data.get("weighted_average_watts"),
            average_heartrate=activity_data.get("average_heartrate"),
            max_heartrate=activity_data.get("max_heartrate"),
            kilojoules=activity_data.get("kilojoules"),
            has_power=used_power,
            tss=tss,
            np=np_val,
            if_=if_,
            description=activity_data.get("description"),
            gear_id=activity_data.get("gear_id"),
            commute=bool(activity_data.get("commute", False)),
            trainer=bool(activity_data.get("trainer", False)),
            power_stream=power_stream,
            hr_stream=hr_stream,
            latlng_stream=latlng_stream,
        )

        self.db.add(activity)
        await self.db.commit()
        await self.db.refresh(activity)
        logger.info("Imported activity %s: %s (TSS: %.1f)", strava_id, activity.name, tss or 0)
        return activity

    async def import_history(self, progress_callback=None) -> Dict:
        """Import all historical activities from Strava."""
        token = await self._get_valid_token()
        if not token:
            return {"error": "Not authenticated with Strava"}

        page = 1
        per_page = 100
        imported = 0
        skipped = 0

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                resp = await client.get(
                    f"{STRAVA_BASE}/athlete/activities",
                    params={"page": page, "per_page": per_page},
                    headers={"Authorization": f"Bearer {token}"},
                )

                if resp.status_code != 200:
                    logger.error("Strava API error: %s", resp.text)
                    break

                activities = resp.json()
                if not activities:
                    break

                for act_data in activities:
                    result = await self.db.execute(
                        select(Activity).where(Activity.strava_id == act_data["id"])
                    )
                    if result.scalar_one_or_none():
                        skipped += 1
                    else:
                        await self.import_activity(act_data, fetch_streams=True)
                        imported += 1

                if progress_callback:
                    progress_callback(imported, skipped)

                if len(activities) < per_page:
                    break
                page += 1

        return {"imported": imported, "skipped": skipped}

    async def save_token(self, token_data: Dict) -> StravaToken:
        """Save or update OAuth tokens."""
        result = await self.db.execute(select(StravaToken).limit(1))
        existing = result.scalar_one_or_none()

        athlete = token_data.get("athlete", {})
        athlete_name = f"{athlete.get('firstname', '')} {athlete.get('lastname', '')}".strip()

        if existing:
            existing.access_token = token_data["access_token"]
            existing.refresh_token = token_data["refresh_token"]
            existing.expires_at = token_data["expires_at"]
            existing.athlete_id = athlete.get("id", 0)
            existing.athlete_name = athlete_name
        else:
            existing = StravaToken(
                access_token=token_data["access_token"],
                refresh_token=token_data["refresh_token"],
                expires_at=token_data["expires_at"],
                athlete_id=athlete.get("id", 0),
                athlete_name=athlete_name,
            )
            self.db.add(existing)

        await self.db.commit()
        return existing

    async def get_auth_status(self) -> Dict:
        result = await self.db.execute(select(StravaToken).limit(1))
        token_row = result.scalar_one_or_none()
        if not token_row:
            return {"authenticated": False}
        return {
            "authenticated": True,
            "athlete_name": token_row.athlete_name,
            "athlete_id": token_row.athlete_id,
        }
