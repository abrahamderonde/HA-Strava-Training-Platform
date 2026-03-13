"""
Main FastAPI application for Strava Training Platform.
"""
import os
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from typing import Dict, Set
from fastapi import UploadFile, File
from .models.database import (
    init_db, get_db, Activity, TrainingMetrics, PowerCurve,
    FTPEstimate, PlannedWorkout, TrainingGoal, StravaToken,
    VisitedGemeente,
)
from .services.strava_service import StravaService
from .services.garmin_service import GarminService
from .services.ai_coach import AICoachService
from .services.training_science import (
    calculate_pmc, fit_critical_power, build_power_curve,
    merge_power_curves, POWER_CURVE_DURATIONS, get_power_zones
)
from .services.gemeente_service import GemeenteService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load config from HA options file
def load_config():
    options_file = "/data/options.json"
    if os.path.exists(options_file):
        with open(options_file) as f:
            return json.load(f)
    # Dev fallback from env
    return {
        "strava_client_id": os.getenv("STRAVA_CLIENT_ID", ""),
        "strava_client_secret": os.getenv("STRAVA_CLIENT_SECRET", ""),
        "garmin_email": os.getenv("GARMIN_EMAIL", ""),
        "garmin_password": os.getenv("GARMIN_PASSWORD", ""),
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY", ""),
        "athlete_weight_kg": int(os.getenv("ATHLETE_WEIGHT_KG", "70")),
        "ftp_initial": int(os.getenv("FTP_INITIAL", "200")),
    }

CONFIG = load_config()
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    
    # Schedule nightly PMC recalculation
    scheduler.add_job(
        nightly_recalculate,
        "cron", hour=2, minute=0,
        id="nightly_recalc"
    )
    scheduler.start()
    logger.info("Strava Training Platform started")
    yield
    scheduler.shutdown()


app = FastAPI(
    title="Strava Training Platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve React frontend
frontend_path = "/app/frontend/dist"
if os.path.exists(frontend_path):
    app.mount("/assets", StaticFiles(directory=f"{frontend_path}/assets"), name="assets")


async def nightly_recalculate():
    """Nightly job: recalculate PMC and update power curve/FTP."""
    from .models.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await recalculate_pmc(db)
        await recalculate_power_curve_and_ftp(db)


async def recalculate_pmc(db: AsyncSession):
    """Recalculate PMC (CTL/ATL/TSB) from all activities."""
    result = await db.execute(
        select(Activity.start_date, Activity.tss)
        .where(Activity.tss != None)
        .order_by(Activity.start_date)
    )
    rows = result.all()

    if not rows:
        return

    from collections import defaultdict
    daily_tss = defaultdict(float)
    for row in rows:
        day = row.start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        daily_tss[day] += row.tss or 0

    pmc_data = calculate_pmc(dict(daily_tss))

    # Upsert into training_metrics
    for entry in pmc_data:
        date = datetime.fromisoformat(entry["date"])
        result = await db.execute(
            select(TrainingMetrics).where(TrainingMetrics.date == date)
        )
        metric = result.scalar_one_or_none()
        if metric:
            metric.ctl = entry["ctl"]
            metric.atl = entry["atl"]
            metric.tsb = entry["tsb"]
            metric.daily_tss = entry["tss"]
        else:
            metric = TrainingMetrics(
                date=date,
                ctl=entry["ctl"],
                atl=entry["atl"],
                tsb=entry["tsb"],
                daily_tss=entry["tss"],
            )
            db.add(metric)

    await db.commit()
    logger.info("PMC recalculated for %d days", len(pmc_data))


async def recalculate_power_curve_and_ftp(db: AsyncSession):
    """Recalculate power curve from last 60 days and fit CP model."""
    cutoff = datetime.now() - timedelta(days=60)
    result = await db.execute(
        select(Activity)
        .where(Activity.has_power == True)
        .where(Activity.start_date >= cutoff)
        .where(Activity.power_stream != None)
    )
    activities_with_power = result.scalars().all()

    if not activities_with_power:
        return

    # Build merged power curve
    curves = []
    for act in activities_with_power:
        if act.power_stream:
            curve = build_power_curve(act.power_stream)
            if curve:
                curves.append(curve)

    if not curves:
        return

    merged = merge_power_curves(curves)

    # Upsert power curve entries
    for dur, power in merged.items():
        result = await db.execute(
            select(PowerCurve).where(PowerCurve.duration_seconds == dur)
        )
        pc = result.scalar_one_or_none()
        if pc:
            pc.best_power = power
            pc.updated_at = datetime.now()
        else:
            pc = PowerCurve(
                duration_seconds=dur,
                best_power=power,
                updated_at=datetime.now(),
            )
            db.add(pc)

    await db.commit()

    # Fit CP model
    cp_result = fit_critical_power(merged)
    if cp_result:
        estimate = FTPEstimate(
            estimated_at=datetime.now(),
            cp=cp_result["cp"],
            w_prime=cp_result["w_prime"],
            p_max=cp_result["p_max"],
            r_squared=cp_result["r_squared"],
            data_window_days=60,
        )
        db.add(estimate)
        await db.commit()
        logger.info(
            "FTP estimated: CP=%.1fW, W'=%.0fJ, R²=%.3f",
            cp_result["cp"], cp_result["w_prime"], cp_result["r_squared"]
        )


# ─── Settings ────────────────────────────────────────────────────────────────

@app.get("/trainiq/settings")
async def get_settings():
    """Return non-sensitive config values to the frontend."""
    return {
        "athlete_weight_kg": CONFIG.get("athlete_weight_kg", 70),
        "ftp_initial": CONFIG.get("ftp_initial", 200),
        "strava_configured": bool(CONFIG.get("strava_client_id")),
        "garmin_configured": bool(CONFIG.get("garmin_email")),
        "anthropic_configured": bool(CONFIG.get("anthropic_api_key")),
    }


# ─── Auth / Strava OAuth ──────────────────────────────────────────────────────

@app.get("/trainiq/strava/auth-url")
async def get_strava_auth_url(request: Request, ha_url: str = None):
    """Return the Strava OAuth URL."""
    if ha_url:
        # Strip trailing slash, ensure it has a scheme
        base = ha_url.rstrip("/")
        if not base.startswith("http"):
            base = f"https://{base}"
        redirect_uri = f"{base}/trainiq/strava/callback"
    else:
        # Fallback: use request base URL (works for direct access, not ingress)
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/trainiq/strava/callback"
    service = StravaService(
        CONFIG["strava_client_id"],
        CONFIG["strava_client_secret"],
        None,
    )
    return {"url": service.get_auth_url(redirect_uri)}


@app.get("/trainiq/strava/callback")
async def strava_callback(code: str, db: AsyncSession = Depends(get_db)):
    service = StravaService(
        CONFIG["strava_client_id"],
        CONFIG["strava_client_secret"],
        db,
    )
    token_data = await service.exchange_code(code)
    if not token_data:
        raise HTTPException(status_code=400, detail="Failed to exchange Strava code")
    await service.save_token(token_data)
    return RedirectResponse(url="/?strava_connected=1")


@app.get("/trainiq/strava/status")
async def strava_status(db: AsyncSession = Depends(get_db)):
    service = StravaService(
        CONFIG["strava_client_id"],
        CONFIG["strava_client_secret"],
        db,
    )
    return await service.get_auth_status()


# ─── Strava Webhook ──────────────────────────────────────────────────────────

@app.get("/trainiq/strava/webhook")
async def webhook_verify(
    hub_mode: str = None,
    hub_challenge: str = None,
    hub_verify_token: str = None,
):
    """Strava webhook subscription verification."""
    if hub_mode == "subscribe" and hub_challenge:
        return {"hub.challenge": hub_challenge}
    raise HTTPException(status_code=403)


@app.post("/trainiq/strava/webhook")
async def webhook_event(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Handle incoming Strava webhook events (new/updated activities)."""
    data = await request.json()
    logger.info("Webhook event: %s", data)

    if data.get("object_type") == "activity" and data.get("aspect_type") == "create":
        activity_id = data.get("object_id")
        background_tasks.add_task(import_single_activity, activity_id, db)

    return {"status": "ok"}


async def import_single_activity(activity_id: int, db: AsyncSession):
    """Background task: fetch and import a single new activity."""
    service = StravaService(
        CONFIG["strava_client_id"],
        CONFIG["strava_client_secret"],
        db,
        ftp=await get_current_ftp(db),
    )
    token = await service._get_valid_token()
    if not token:
        return

    async with __import__("httpx").AsyncClient() as client:
        resp = await client.get(
            f"https://www.strava.com/api/v3/activities/{activity_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 200:
            await service.import_activity(resp.json(), fetch_streams=True)
            await recalculate_pmc(db)
            await recalculate_power_curve_and_ftp(db)


# ─── Import ──────────────────────────────────────────────────────────────────

@app.post("/trainiq/strava/import")
async def trigger_import(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a full history import in the background."""
    background_tasks.add_task(run_full_import, db)
    return {"status": "Import started"}


async def run_full_import(db: AsyncSession):
    ftp = await get_current_ftp(db)
    service = StravaService(
        CONFIG["strava_client_id"],
        CONFIG["strava_client_secret"],
        db,
        ftp=ftp,
    )
    result = await service.import_history()
    logger.info("Import complete: %s", result)
    await recalculate_pmc(db)
    await recalculate_power_curve_and_ftp(db)


# ─── Analytics APIs ──────────────────────────────────────────────────────────

@app.get("/trainiq/analytics/pmc")
async def get_pmc(days: int = 120, db: AsyncSession = Depends(get_db)):
    cutoff = datetime.now() - timedelta(days=days)
    result = await db.execute(
        select(TrainingMetrics)
        .where(TrainingMetrics.date >= cutoff)
        .order_by(TrainingMetrics.date)
    )
    metrics = result.scalars().all()
    return [
        {
            "date": m.date.isoformat(),
            "ctl": m.ctl,
            "atl": m.atl,
            "tsb": m.tsb,
            "tss": m.daily_tss,
        }
        for m in metrics
    ]


@app.get("/trainiq/analytics/power-curve")
async def get_power_curve(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PowerCurve).order_by(PowerCurve.duration_seconds)
    )
    rows = result.scalars().all()
    return [{"duration": r.duration_seconds, "power": r.best_power} for r in rows]


@app.get("/trainiq/analytics/ftp")
async def get_ftp_estimate(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FTPEstimate).order_by(FTPEstimate.estimated_at.desc()).limit(1)
    )
    estimate = result.scalar_one_or_none()
    if not estimate:
        return {"ftp": CONFIG["ftp_initial"], "source": "initial_config", "r_squared": None}
    return {
        "ftp": estimate.cp,
        "cp": estimate.cp,
        "w_prime": estimate.w_prime,
        "p_max": estimate.p_max,
        "r_squared": estimate.r_squared,
        "estimated_at": estimate.estimated_at.isoformat(),
        "source": "cp3_model",
    }


@app.get("/trainiq/analytics/zones")
async def get_zones(db: AsyncSession = Depends(get_db)):
    ftp = await get_current_ftp(db)
    return {"ftp": ftp, "zones": get_power_zones(ftp)}


# ─── Activities ──────────────────────────────────────────────────────────────

@app.get("/trainiq/activities")
async def get_activities(
    page: int = 1,
    per_page: int = 20,
    sport_type: str = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Activity).order_by(Activity.start_date.desc())
    if sport_type:
        query = query.where(Activity.sport_type == sport_type)
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    activities = result.scalars().all()
    return [_activity_to_dict(a) for a in activities]


@app.get("/trainiq/activities/calendar")
async def get_calendar_activities(
    year: int = None,
    month: int = None,
    db: AsyncSession = Depends(get_db),
):
    """Get activities for a specific month for calendar view."""
    now = datetime.now()
    year = year or now.year
    month = month or now.month

    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)

    result = await db.execute(
        select(Activity)
        .where(Activity.start_date >= start)
        .where(Activity.start_date < end)
        .order_by(Activity.start_date)
    )
    activities = result.scalars().all()

    # Also get planned workouts for this month
    pw_result = await db.execute(
        select(PlannedWorkout)
        .where(PlannedWorkout.date >= start)
        .where(PlannedWorkout.date < end)
    )
    planned = pw_result.scalars().all()

    return {
        "activities": [_activity_to_dict(a) for a in activities],
        "planned": [
            {
                "id": p.id,
                "date": p.date.isoformat(),
                "title": p.title,
                "workout_type": p.workout_type,
                "target_tss": p.target_tss,
                "target_duration_minutes": p.target_duration_minutes,
                "exported_to_garmin": p.exported_to_garmin,
            }
            for p in planned
        ],
    }


# ─── Planning ────────────────────────────────────────────────────────────────

@app.get("/trainiq/goals")
async def get_goals(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingGoal).order_by(TrainingGoal.created_at.desc())
    )
    goals = result.scalars().all()
    return [
        {
            "id": g.id,
            "event_name": g.event_name,
            "event_date": g.event_date.isoformat(),
            "event_distance_km": g.event_distance_km,
            "event_elevation_m": g.event_elevation_m,
            "goal_description": g.goal_description,
            "active": g.active,
            "ai_plan_summary": g.ai_plan_summary,
        }
        for g in goals
    ]


@app.post("/trainiq/goals")
async def create_goal(request: Request, db: AsyncSession = Depends(get_db)):
    data = await request.json()
    ftp = await get_current_ftp(db)

    # Get current CTL
    result = await db.execute(
        select(TrainingMetrics).order_by(TrainingMetrics.date.desc()).limit(1)
    )
    latest_metric = result.scalar_one_or_none()
    current_ctl = latest_metric.ctl if latest_metric else 0

    goal = TrainingGoal(
        created_at=datetime.now(),
        event_name=data["event_name"],
        event_date=datetime.fromisoformat(data["event_date"]),
        event_distance_km=data.get("event_distance_km"),
        event_elevation_m=data.get("event_elevation_m"),
        goal_description=data.get("goal_description", ""),
        current_ftp=ftp,
        current_ctl=current_ctl,
        active=True,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)

    # Generate AI plan summary in background
    if CONFIG.get("anthropic_api_key"):
        ai = AICoachService(CONFIG["anthropic_api_key"])
        summary = await ai.suggest_goal_plan(goal, current_ctl, ftp)
        if summary:
            goal.ai_plan_summary = summary
            await db.commit()

    return {"id": goal.id, "status": "created"}


@app.post("/trainiq/planning/generate-week")
async def generate_week(request: Request, db: AsyncSession = Depends(get_db)):
    """Generate AI workout plan for a week."""
    data = await request.json()
    week_start = datetime.fromisoformat(data["week_start"])
    goal_id = data.get("goal_id")
    available_days = data.get("available_days", [1, 2, 3, 4, 6])

    if not CONFIG.get("anthropic_api_key"):
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    # Get goal
    goal = None
    if goal_id:
        result = await db.execute(select(TrainingGoal).where(TrainingGoal.id == goal_id))
        goal = result.scalar_one_or_none()
    if not goal:
        result = await db.execute(
            select(TrainingGoal).where(TrainingGoal.active == True).limit(1)
        )
        goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=400, detail="No active training goal found")

    # Get current PMC
    result = await db.execute(
        select(TrainingMetrics).order_by(TrainingMetrics.date.desc()).limit(1)
    )
    latest = result.scalar_one_or_none()
    ctl = latest.ctl if latest else 0
    atl = latest.atl if latest else 0
    tsb = latest.tsb if latest else 0

    ftp = await get_current_ftp(db)

    # Get recent activities
    cutoff = datetime.now() - timedelta(days=14)
    result = await db.execute(
        select(Activity).where(Activity.start_date >= cutoff).order_by(Activity.start_date.desc())
    )
    recent = result.scalars().all()
    recent_dicts = [_activity_to_dict(a) for a in recent]

    ai = AICoachService(CONFIG["anthropic_api_key"])
    plan = await ai.generate_weekly_plan(
        goal=goal,
        current_ctl=ctl,
        current_atl=atl,
        current_tsb=tsb,
        ftp=ftp,
        recent_activities=recent_dicts,
        week_start=week_start,
        available_days=available_days,
    )

    if not plan:
        raise HTTPException(status_code=500, detail="Failed to generate plan")

    # Save workouts to database
    saved_ids = []
    for wo in plan.get("workouts", []):
        workout = PlannedWorkout(
            date=datetime.fromisoformat(wo["date"]),
            title=wo["title"],
            description=wo["description"],
            workout_type=wo["workout_type"],
            target_tss=wo.get("target_tss"),
            target_duration_minutes=wo.get("target_duration_minutes"),
            target_if=wo.get("target_if"),
            intervals=wo.get("intervals"),
            goal_id=goal.id,
        )
        db.add(workout)
        await db.flush()
        saved_ids.append(workout.id)

    await db.commit()
    plan["saved_workout_ids"] = saved_ids
    return plan


@app.post("/trainiq/planning/export-to-garmin/{workout_id}")
async def export_to_garmin(workout_id: int, db: AsyncSession = Depends(get_db)):
    """Export a planned workout to Garmin Connect."""
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")

    if not CONFIG.get("garmin_email") or not CONFIG.get("garmin_password"):
        raise HTTPException(status_code=400, detail="Garmin credentials not configured")

    garmin = GarminService(CONFIG["garmin_email"], CONFIG["garmin_password"])
    garmin_id = await garmin.export_workout(workout)

    if garmin_id:
        workout.garmin_workout_id = garmin_id
        workout.exported_to_garmin = True
        # Also schedule it on the correct date
        await garmin.schedule_workout(garmin_id, workout.date)
        await db.commit()
        return {"status": "exported", "garmin_id": garmin_id}
    else:
        raise HTTPException(status_code=500, detail="Failed to export to Garmin")


@app.get("/trainiq/planning/workouts")
async def get_planned_workouts(
    from_date: str = None,
    to_date: str = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(PlannedWorkout).order_by(PlannedWorkout.date)
    if from_date:
        query = query.where(PlannedWorkout.date >= datetime.fromisoformat(from_date))
    if to_date:
        query = query.where(PlannedWorkout.date <= datetime.fromisoformat(to_date))
    result = await db.execute(query)
    workouts = result.scalars().all()
    return [
        {
            "id": w.id,
            "date": w.date.isoformat(),
            "title": w.title,
            "description": w.description,
            "workout_type": w.workout_type,
            "target_tss": w.target_tss,
            "target_duration_minutes": w.target_duration_minutes,
            "target_if": w.target_if,
            "intervals": w.intervals,
            "exported_to_garmin": w.exported_to_garmin,
            "garmin_workout_id": w.garmin_workout_id,
        }
        for w in workouts
    ]


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def get_current_ftp(db: AsyncSession) -> float:
    result = await db.execute(
        select(FTPEstimate).order_by(FTPEstimate.estimated_at.desc()).limit(1)
    )
    estimate = result.scalar_one_or_none()
    return estimate.cp if estimate else float(CONFIG.get("ftp_initial", 200))


def _activity_to_dict(a: Activity) -> Dict:
    return {
        "id": a.id,
        "strava_id": a.strava_id,
        "name": a.name,
        "sport_type": a.sport_type,
        "start_date": a.start_date.isoformat(),
        "elapsed_time": a.elapsed_time,
        "moving_time": a.moving_time,
        "distance": a.distance,
        "total_elevation_gain": a.total_elevation_gain,
        "average_speed": a.average_speed,
        "average_watts": a.average_watts,
        "weighted_avg_watts": a.weighted_avg_watts,
        "average_heartrate": a.average_heartrate,
        "has_power": a.has_power,
        "commute": a.commute,
        "trainer": a.trainer,
        "tss": a.tss,
        "np": a.np,
        "if_": a.if_,
        "kilojoules": a.kilojoules,
    }




# ─── Gemeenten / Municipalities ───────────────────────────────────────────────

@app.get("/trainiq/gemeenten/boundaries")
async def get_gemeente_boundaries(db: AsyncSession = Depends(get_db)):
    """Return all Dutch gemeente boundaries as GeoJSON (from PDOK cache)."""
    svc = GemeenteService(db)
    await svc.ensure_boundaries_loaded()
    return svc.get_boundaries_geojson()


@app.get("/trainiq/gemeenten/visited")
async def get_visited_gemeenten(db: AsyncSession = Depends(get_db)):
    """Return all uniquely visited gemeenten with first visit date."""
    svc = GemeenteService(db)
    visited = await svc.get_visited_gemeenten()
    stats = await svc.get_stats()
    return {"visited": visited, "stats": stats}


@app.post("/trainiq/gemeenten/scan-all")
async def scan_all_activities_for_gemeenten(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Re-scan all cycling activities with GPS to detect visited gemeenten."""
    background_tasks.add_task(_scan_all_gemeenten)
    return {"status": "Scanning started in background"}


async def _scan_all_gemeenten():
    from .models.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        svc = GemeenteService(db)
        await svc.ensure_boundaries_loaded()
        result = await db.execute(
            select(Activity)
            .where(Activity.latlng_stream != None)
            .where(Activity.sport_type.in_(
                ["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide"]
            ))
        )
        acts = result.scalars().all()
        logger.info("Scanning %d cycling activities for gemeenten", len(acts))
        for act in acts:
            await svc.process_activity_gemeenten(act)
        logger.info("Gemeente scan complete")


@app.post("/trainiq/gemeenten/check-gpx")
async def check_gpx(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload GPX → returns crossed gemeenten split into new vs already visited."""
    content = await file.read()
    svc = GemeenteService(db)
    result = await svc.check_gpx_new_gemeenten(content)
    return result


# ─── Eddington Number ─────────────────────────────────────────────────────────

@app.get("/trainiq/eddington")
async def get_eddington(db: AsyncSession = Depends(get_db)):
    """
    Calculate Eddington number for cycling.
    E = largest N such that you have ridden >= N km on at least N days.
    """
    CYCLING_TYPES = ["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide"]
    result = await db.execute(
        select(Activity.start_date, Activity.distance)
        .where(Activity.sport_type.in_(CYCLING_TYPES))
        .where(Activity.distance > 0)
    )
    rows = result.all()

    if not rows:
        return {"e": 0, "next_e": 1, "rides_needed": 1, "total_rides": 0, "histogram": []}

    from collections import defaultdict
    # Sum distance per calendar day (multiple rides same day = combined)
    daily_km: dict = defaultdict(float)
    for row in rows:
        day = row.start_date.strftime("%Y-%m-%d")
        daily_km[day] += (row.distance or 0) / 1000.0

    distances = sorted(daily_km.values(), reverse=True)

    # Compute E: count how many days have >= N km, find largest N where count >= N
    e = 0
    for n in range(1, int(max(distances)) + 2):
        count = sum(1 for d in distances if d >= n)
        if count >= n:
            e = n
        else:
            break

    next_e = e + 1
    rides_needed = next_e - sum(1 for d in distances if d >= next_e)

    # Progress histogram: for each distance bucket, how many days
    histogram = []
    for n in range(max(1, e - 20), e + 30):
        count = sum(1 for d in distances if d >= n)
        histogram.append({"km": n, "days": count, "needed": n, "achieved": count >= n})

    return {
        "e": e,
        "next_e": next_e,
        "rides_needed": max(0, rides_needed),
        "total_riding_days": len(distances),
        "total_rides": len(rows),
        "max_day_km": round(max(distances), 1),
        "histogram": histogram,
        "top_days": [round(d, 1) for d in distances[:50]],
    }


# ─── Frontend SPA catch-all ───────────────────────────────────────────────────

@app.get("/{full_path:path}", response_class=HTMLResponse)
async def serve_spa(full_path: str):
    index_path = f"{frontend_path}/index.html"
    if os.path.exists(index_path):
        with open(index_path) as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend not built yet</h1>")
