"""
Main FastAPI application for Strava Training Platform.
"""
import os
import json
import asyncio
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
from .services.intervals_service import IntervalsService
from .services.intervals_service import IntervalsService
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
        "intervals_api_key": os.getenv("INTERVALS_API_KEY", ""),
        "intervals_athlete_id": os.getenv("INTERVALS_ATHLETE_ID", ""),
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
        "intervals_configured": bool(CONFIG.get("intervals_api_key") and CONFIG.get("intervals_athlete_id")),
        "intervals_configured": bool(CONFIG.get("intervals_icu_api_key")),
    }


# ─── Auth / Strava OAuth ──────────────────────────────────────────────────────

@app.get("/trainiq/strava/auth-url")
async def get_strava_auth_url(request: Request, ha_url: str = None):
    """Return the Strava OAuth URL."""
    if ha_url:
        base = ha_url.rstrip("/")
        if not base.startswith("http"):
            base = f"http://{base}"
        redirect_uri = f"{base}/trainiq/strava/callback"
    else:
        # Use host from request but with our actual port
        host = request.headers.get("host", "homeassistant.local").split(":")[0]
        redirect_uri = f"http://{host}:8088/trainiq/strava/callback"
    service = StravaService(
        CONFIG["strava_client_id"],
        CONFIG["strava_client_secret"],
        None,
    )
    return {"url": service.get_auth_url(redirect_uri)}


@app.get("/trainiq/strava/callback")
@app.get("/trainiq/strava/callback")
async def strava_callback(code: str, request: Request, db: AsyncSession = Depends(get_db)):
    service = StravaService(
        CONFIG["strava_client_id"],
        CONFIG["strava_client_secret"],
        db,
    )
    # Reconstruct the redirect_uri that was used during authorization
    host = request.headers.get("host", "homeassistant.local:8088").split(":")[0]
    redirect_uri = f"http://{host}:8088/trainiq/strava/callback"
    logger.info("Strava callback received, exchanging code with redirect_uri: %s", redirect_uri)
    token_data = await service.exchange_code(code, redirect_uri=redirect_uri)
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

@app.post("/trainiq/strava/recalculate-tss")
async def recalculate_all_tss(background_tasks: BackgroundTasks):
    """Recalculate TSS for all activities using the current FTP estimate."""
    async def _recalc_tss():
        from .models.database import AsyncSessionLocal
        from .services.training_science import calculate_tss_from_power
        async with AsyncSessionLocal() as db:
            ftp = await get_current_ftp(db)
            logger.info("Recalculating TSS for all activities using FTP=%.1f", ftp)
            result = await db.execute(select(Activity).where(Activity.has_power == True))
            acts = result.scalars().all()
            updated = 0
            for act in acts:
                if not act.power_stream:
                    continue
                tss, np_val, if_ = calculate_tss_from_power(
                    act.power_stream, ftp, act.moving_time or 0
                )
                act.tss = tss
                act.np = np_val
                act.if_ = if_
                updated += 1
            await db.commit()
            logger.info("TSS recalculated for %d activities", updated)
            # Rebuild PMC with corrected TSS
            await recalculate_pmc(db)
            logger.info("PMC rebuilt after TSS recalculation")
    background_tasks.add_task(_recalc_tss)
    return {"status": "TSS recalculation started", "note": "PMC will rebuild automatically when done"}



async def tss_stats(db: AsyncSession = Depends(get_db)):
    """Debug: show TSS distribution to diagnose CTL discrepancy."""
    from sqlalchemy import func
    result = await db.execute(
        select(Activity)
        .where(Activity.start_date >= datetime.now() - timedelta(days=90))
        .order_by(Activity.start_date.desc())
    )
    acts = result.scalars().all()
    rows = []
    for a in acts:
        rows.append({
            "date": a.start_date.date().isoformat(),
            "name": a.name,
            "sport": a.sport_type,
            "duration_min": round((a.moving_time or 0) / 60),
            "tss": round(a.tss or 0, 1),
            "has_power": a.has_power,
            "commute": a.commute,
        })
    total_tss_90d = sum(r["tss"] for r in rows)
    avg_daily_tss = round(total_tss_90d / 90, 1)
    return {"avg_daily_tss_90d": avg_daily_tss, "activities": rows}



@app.get("/trainiq/debug/latlng-stats")
async def latlng_stats(db: AsyncSession = Depends(get_db)):
    """Debug: check how many cycling activities have latlng data."""
    from sqlalchemy import func, case
    CYCLING = ["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide"]
    result = await db.execute(
        select(Activity).where(Activity.sport_type.in_(CYCLING))
    )
    acts = result.scalars().all()
    null_count = sum(1 for a in acts if a.latlng_stream is None)
    empty_count = sum(1 for a in acts if a.latlng_stream is not None and len(a.latlng_stream) == 0)
    has_data = sum(1 for a in acts if a.latlng_stream and len(a.latlng_stream) > 0)
    sample = next((a for a in acts if a.latlng_stream and len(a.latlng_stream) > 0), None)
    return {
        "total_cycling": len(acts),
        "latlng_null": null_count,
        "latlng_empty_list": empty_count,
        "latlng_has_data": has_data,
        "sample_first_point": sample.latlng_stream[0] if sample else None,
    }





@app.post("/trainiq/commutes/preview")
async def preview_synthetic_commutes(request: Request, db: AsyncSession = Depends(get_db)):
    """Preview how many synthetic commute activities would be created."""
    data = await request.json()
    start_date = datetime.fromisoformat(data["start_date"])
    end_date = datetime.fromisoformat(data["end_date"])
    days_of_week = data.get("days_of_week", [0, 1, 2, 3])
    rides_per_day = data.get("rides_per_day", 2)
    duration_minutes = data.get("duration_minutes", 20)
    intensity_factor = data.get("intensity_factor", 0.65)

    ftp = await get_current_ftp(db)
    tss_per_ride = round((duration_minutes / 60) * (intensity_factor ** 2) * 100, 1)
    tss_per_day = tss_per_ride * rides_per_day

    days = []
    current = start_date
    while current <= end_date:
        if current.weekday() in days_of_week:
            days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)

    return {
        "total_days": len(days),
        "total_rides": len(days) * rides_per_day,
        "tss_per_ride": tss_per_ride,
        "tss_per_day": tss_per_day,
        "total_tss": round(len(days) * tss_per_day, 1),
        "ftp_used": round(ftp, 1),
        "sample_days": days[:5],
    }


@app.post("/trainiq/commutes/generate")
async def generate_synthetic_commutes(request: Request, db: AsyncSession = Depends(get_db)):
    """Generate synthetic commute activities for historical backfill."""
    data = await request.json()
    start_date = datetime.fromisoformat(data["start_date"])
    end_date = datetime.fromisoformat(data["end_date"])
    days_of_week = data.get("days_of_week", [0, 1, 2, 3])
    rides_per_day = data.get("rides_per_day", 2)
    duration_minutes = data.get("duration_minutes", 20)
    intensity_factor = data.get("intensity_factor", 0.65)

    ftp = await get_current_ftp(db)
    duration_seconds = duration_minutes * 60
    tss = round((duration_minutes / 60) * (intensity_factor ** 2) * 100, 1)
    distance_m = (duration_minutes / 60) * 15000  # assume 15 km/h

    # Use a large negative synthetic ID base to avoid conflicts
    # Find current min synthetic ID
    result = await db.execute(
        select(Activity.strava_id)
        .where(Activity.synthetic == True)
        .where(Activity.strava_id != None)
        .order_by(Activity.strava_id)
        .limit(1)
    )
    min_existing = result.scalar_one_or_none()
    next_id = min(min_existing or -1, -1) - 1

    created = 0
    current = start_date
    while current <= end_date:
        if current.weekday() in days_of_week:
            for ride_num in range(rides_per_day):
                hour = 8 if ride_num == 0 else 17
                ride_time = current.replace(hour=hour, minute=0, second=0)
                name = "Morning commute (estimated)" if ride_num == 0 else "Afternoon commute (estimated)"
                activity = Activity(
                    strava_id=next_id,  # negative unique ID
                    name=name,
                    sport_type="Ride",
                    start_date=ride_time,
                    elapsed_time=duration_seconds,
                    moving_time=duration_seconds,
                    distance=distance_m,
                    total_elevation_gain=0,
                    average_speed=distance_m / duration_seconds,
                    max_speed=distance_m / duration_seconds,
                    has_power=False,
                    tss=tss,
                    np=None,
                    if_=intensity_factor,
                    commute=True,
                    synthetic=True,
                )
                db.add(activity)
                next_id -= 1
                created += 1
        current += timedelta(days=1)

    await db.commit()
    logger.info("Generated %d synthetic commute activities", created)
    await recalculate_pmc(db)
    logger.info("PMC rebuilt after commute generation")
    total_tss = round(created * tss, 1)
    return {"created": created, "total_tss": total_tss, "tss_per_ride": tss}


@app.delete("/trainiq/commutes/synthetic")
async def delete_synthetic_commutes(db: AsyncSession = Depends(get_db)):
    """Delete all synthetic commute activities and rebuild PMC."""
    result = await db.execute(
        select(Activity).where(Activity.synthetic == True)
    )
    acts = result.scalars().all()
    # Also catch any with NULL strava_id that were created before the fix
    result2 = await db.execute(
        select(Activity).where(Activity.strava_id == None)
    )
    null_acts = result2.scalars().all()
    all_acts = {a.id: a for a in acts + null_acts}
    count = len(all_acts)
    for act in all_acts.values():
        await db.delete(act)
    await db.commit()
    await recalculate_pmc(db)
    return {"deleted": count}


@app.get("/trainiq/commutes/synthetic/count")
async def count_synthetic_commutes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Activity).where(Activity.synthetic == True))
    return {"count": len(result.scalars().all())}


async def backfill_latlng(background_tasks: BackgroundTasks):
    """Re-fetch latlng streams for cycling activities that are missing GPS data."""
    async def _backfill():
        from .models.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            CYCLING = ["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide"]
            result = await db.execute(
                select(Activity)
                .where(Activity.latlng_stream == None)
                .where(Activity.sport_type.in_(CYCLING))
                .order_by(Activity.start_date.desc())
            )
            acts = result.scalars().all()
            logger.info("Backfilling latlng for %d cycling activities without GPS", len(acts))

            # Also log total cycling activities for comparison
            total_result = await db.execute(
                select(func.count(Activity.id))
                .where(Activity.sport_type.in_(CYCLING))
            )
            total = total_result.scalar()
            logger.info("Total cycling activities in DB: %d", total)
            config = load_config()
            service = StravaService(config["strava_client_id"], config["strava_client_secret"], db)
            token = await service._get_valid_token()
            if not token:
                logger.error("No valid Strava token for backfill")
                return
            updated = 0
            for i, act in enumerate(acts):
                try:
                    streams = await service._get_activity_streams(act.strava_id, token)
                    if "latlng" in streams:
                        raw = streams["latlng"].get("data", [])
                        act.latlng_stream = raw[::5] if len(raw) > 5 else raw
                        updated += 1
                    await asyncio.sleep(0.5)  # respect rate limits
                except Exception as e:
                    logger.warning("Failed to fetch latlng for %s: %s", act.strava_id, e)
                if (i + 1) % 50 == 0:
                    await db.commit()
                    logger.info("Backfill progress: %d/%d, %d updated", i + 1, len(acts), updated)
            await db.commit()
            logger.info("Backfill complete: %d activities updated with latlng", updated)
    background_tasks.add_task(_backfill)
    return {"status": "Backfill started"}



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

@app.post("/trainiq/analytics/recalculate")
async def trigger_recalculate(background_tasks: BackgroundTasks):
    """Manually trigger PMC + power curve + FTP recalculation."""
    async def _recalc():
        from .models.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await recalculate_pmc(session)
            await recalculate_power_curve_and_ftp(session)
            logger.info("Manual recalculation complete")
    background_tasks.add_task(_recalc)
    return {"status": "Recalculation started"}



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


@app.get("/trainiq/debug/power-stats")
async def power_stats(db: AsyncSession = Depends(get_db)):
    """Debug: diagnose power curve and synthetic commute data."""
    cutoff_60 = datetime.now() - timedelta(days=60)

    result = await db.execute(
        select(Activity)
        .where(Activity.sport_type.in_(["Ride", "VirtualRide", "EBikeRide", "GravelRide"]))
        .where(Activity.start_date >= cutoff_60)
        .where(Activity.synthetic == False)
        .order_by(Activity.start_date.desc())
    )
    recent = result.scalars().all()

    pc_result = await db.execute(select(PowerCurve).order_by(PowerCurve.duration_seconds))
    pc_entries = pc_result.scalars().all()

    # Check synthetic commutes
    syn_result = await db.execute(
        select(Activity).where(Activity.synthetic == True).order_by(Activity.start_date.desc())
    )
    syn_acts = syn_result.scalars().all()

    # Check for negative strava_id activities (old format)
    neg_result = await db.execute(
        select(Activity).where(Activity.strava_id < 0)
    )
    neg_acts = neg_result.scalars().all()

    # Check for null strava_id activities
    null_result = await db.execute(
        select(Activity).where(Activity.strava_id == None)
    )
    null_acts = null_result.scalars().all()

    return {
        "rides_last_60d": len(recent),
        "rides_with_has_power_true": sum(1 for a in recent if a.has_power),
        "rides_with_power_stream": sum(1 for a in recent if a.power_stream),
        "power_curve_entries": len(pc_entries),
        "power_curve_sample": [{"duration": p.duration_seconds, "power": p.best_power} for p in pc_entries[:5]],
        "synthetic_count": len(syn_acts),
        "negative_strava_id_count": len(neg_acts),
        "null_strava_id_count": len(null_acts),
        "synthetic_sample": [
            {"date": a.start_date.isoformat(), "name": a.name, "tss": a.tss, "strava_id": a.strava_id, "synthetic": a.synthetic}
            for a in syn_acts[:5]
        ],
        "negative_id_sample": [
            {"date": a.start_date.isoformat(), "name": a.name, "strava_id": a.strava_id, "synthetic": a.synthetic}
            for a in neg_acts[:5]
        ],
    }



@app.get("/trainiq/analytics/pmc-all")
async def get_pmc_all(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingMetrics).order_by(TrainingMetrics.date)
    )
    metrics = result.scalars().all()
    return [
        {
            "date": m.date.isoformat(),
            "ctl": round(m.ctl, 1) if m.ctl else 0,
            "atl": round(m.atl, 1) if m.atl else 0,
            "tsb": round(m.tsb, 1) if m.tsb else 0,
            "tss": round(m.daily_tss, 1) if m.daily_tss else 0,
        }
        for m in metrics
    ]


@app.get("/trainiq/analytics/distance-by-year")
async def get_distance_by_year(
    exclude_commutes: bool = False,
    exclude_indoor: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Return weekly distance per year for multi-year comparison charts."""
    query = select(
        Activity.start_date,
        Activity.distance,
        Activity.sport_type,
        Activity.commute,
        Activity.trainer,
        Activity.synthetic,
    ).where(
        Activity.sport_type.in_(["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide"])
    ).where(Activity.distance > 0)

    if exclude_commutes:
        query = query.where(Activity.commute == False)
    if exclude_indoor:
        query = query.where(Activity.sport_type != "VirtualRide")
        query = query.where(Activity.trainer == False)

    # Always exclude synthetic
    query = query.where(Activity.synthetic == False)

    result = await db.execute(query.order_by(Activity.start_date))
    rows = result.all()

    # Group by year and ISO week number → {year: {week: km}}
    from collections import defaultdict
    year_week = defaultdict(lambda: defaultdict(float))
    for row in rows:
        dt = row.start_date
        year = dt.year
        # Day of year 1-365
        doy = dt.timetuple().tm_yday
        year_week[year][doy] += (row.distance or 0) / 1000

    # Return as {year: [{doy, km}]}
    years = {}
    for year, doys in sorted(year_week.items()):
        # Aggregate into weekly buckets (week 1-52)
        weekly = defaultdict(float)
        for doy, km in doys.items():
            week = min(52, (doy - 1) // 7 + 1)
            weekly[week] += km
        years[str(year)] = [{"week": w, "km": round(km, 1)} for w, km in sorted(weekly.items())]

    return years



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
            "weekly_hours": g.weekly_hours,
            "global_plan": g.global_plan,
            "global_plan_generated_at": g.global_plan_generated_at.isoformat() if g.global_plan_generated_at else None,
            "last_week_settings": g.last_week_settings,
        }
        for g in goals
    ]


@app.post("/trainiq/goals")
async def create_goal(request: Request, db: AsyncSession = Depends(get_db)):
    data = await request.json()
    ftp = await get_current_ftp(db)
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
        weekly_hours=data.get("weekly_hours"),
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)

    if CONFIG.get("anthropic_api_key"):
        ai = AICoachService(CONFIG["anthropic_api_key"])
        summary = await ai.generate_goal_summary(goal, ftp, current_ctl)
        if summary:
            goal.ai_plan_summary = summary
            await db.commit()

    return {"id": goal.id, "status": "created"}


@app.post("/trainiq/planning/generate-global-plan")
async def generate_global_plan(request: Request, db: AsyncSession = Depends(get_db)):
    """Generate or regenerate the phased global training plan for the active goal."""
    data = await request.json()
    goal_id = data.get("goal_id")

    if not CONFIG.get("anthropic_api_key"):
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    result = await db.execute(
        select(TrainingGoal).where(TrainingGoal.id == goal_id) if goal_id
        else select(TrainingGoal).where(TrainingGoal.active == True).limit(1)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="No active goal found")

    # Update weekly_hours if provided
    if "weekly_hours" in data:
        goal.weekly_hours = data["weekly_hours"]

    ftp = await get_current_ftp(db)
    result = await db.execute(
        select(TrainingMetrics).order_by(TrainingMetrics.date.desc()).limit(1)
    )
    latest = result.scalar_one_or_none()
    ctl = latest.ctl if latest else 0

    # Get recent actual weekly TSS for deviation detection
    cutoff = datetime.now() - timedelta(days=28)
    result = await db.execute(
        select(Activity)
        .where(Activity.start_date >= cutoff)
        .order_by(Activity.start_date)
    )
    recent_acts = result.scalars().all()
    # Group by week
    week_map = {}
    for a in recent_acts:
        week = a.start_date.strftime("%Y-%m-%d")[:8] + "01"  # rough week key
        week_key = (a.start_date - timedelta(days=a.start_date.weekday())).strftime("%Y-%m-%d")
        if week_key not in week_map:
            week_map[week_key] = {"week": week_key, "actual_tss": 0, "actual_hours": 0}
        week_map[week_key]["actual_tss"] += a.tss or 0
        week_map[week_key]["actual_hours"] += (a.moving_time or 0) / 3600

    ai = AICoachService(CONFIG["anthropic_api_key"])
    plan = await ai.generate_global_plan(
        goal=goal,
        weekly_hours=goal.weekly_hours or 8,
        current_ctl=ctl,
        ftp=ftp,
        actual_last_weeks=list(week_map.values()),
    )

    if not plan:
        raise HTTPException(status_code=500, detail="Failed to generate global plan")

    goal.global_plan = plan
    goal.global_plan_generated_at = datetime.now()
    await db.commit()
    return plan


@app.post("/trainiq/planning/generate-week")
async def generate_week(request: Request, db: AsyncSession = Depends(get_db)):
    """Generate AI workout plan for a specific week with per-day settings."""
    data = await request.json()
    week_start = datetime.fromisoformat(data["week_start"])
    goal_id = data.get("goal_id")
    # New format: list of day settings
    day_settings = data.get("day_settings", [])

    if not CONFIG.get("anthropic_api_key"):
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    result = await db.execute(
        select(TrainingGoal).where(TrainingGoal.id == goal_id) if goal_id
        else select(TrainingGoal).where(TrainingGoal.active == True).limit(1)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=400, detail="No active training goal found")

    # Save day settings for next week pre-fill
    goal.last_week_settings = day_settings
    await db.commit()

    result = await db.execute(
        select(TrainingMetrics).order_by(TrainingMetrics.date.desc()).limit(1)
    )
    latest = result.scalar_one_or_none()
    ctl = latest.ctl if latest else 0
    atl = latest.atl if latest else 0
    tsb = latest.tsb if latest else 0

    ftp = await get_current_ftp(db)

    cutoff = datetime.now() - timedelta(days=14)
    result = await db.execute(
        select(Activity).where(Activity.start_date >= cutoff).order_by(Activity.start_date.desc())
    )
    recent = result.scalars().all()
    recent_dicts = [_activity_to_dict(a) for a in recent]

    # Find matching week in global plan
    global_plan_week = None
    if goal.global_plan:
        for phase in goal.global_plan.get("phases", []):
            for week in phase.get("weeks", []):
                if week.get("week_start") == week_start.strftime("%Y-%m-%d"):
                    global_plan_week = week
                    break

    ai = AICoachService(CONFIG["anthropic_api_key"])
    plan = await ai.generate_weekly_plan(
        goal=goal,
        current_ctl=ctl,
        current_atl=atl,
        current_tsb=tsb,
        ftp=ftp,
        recent_activities=recent_dicts,
        week_start=week_start,
        day_settings=day_settings,
        global_plan_week=global_plan_week,
    )

    if not plan:
        raise HTTPException(status_code=500, detail="Failed to generate plan")

    # Delete existing planned workouts for this week before saving new ones
    week_end = week_start + timedelta(days=7)
    await db.execute(
        select(PlannedWorkout)
        .where(PlannedWorkout.date >= week_start)
        .where(PlannedWorkout.date < week_end)
    )
    existing = (await db.execute(
        select(PlannedWorkout)
        .where(PlannedWorkout.date >= week_start)
        .where(PlannedWorkout.date < week_end)
    )).scalars().all()
    for wo in existing:
        await db.delete(wo)

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




@app.post("/trainiq/planning/push-to-intervals/{workout_id}")
async def push_to_intervals(workout_id: int, db: AsyncSession = Depends(get_db)):
    """Push a planned workout to intervals.icu (which syncs to Garmin automatically)."""
    from .services.fit_export import generate_workout_fit
    api_key = CONFIG.get("intervals_icu_api_key", "")
    athlete_id = CONFIG.get("intervals_icu_athlete_id", "0")
    if not api_key:
        raise HTTPException(status_code=400, detail="intervals.icu API key not configured in app settings")
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    # Generate FIT file for accurate structured workout
    try:
        fit_bytes = generate_workout_fit(workout)
    except Exception as e:
        logger.warning("FIT generation failed, using description format: %s", e)
        fit_bytes = None
    svc = IntervalsService(api_key=api_key, athlete_id=athlete_id)
    event_id = await svc.push_workout(workout, fit_bytes=fit_bytes)
    if not event_id:
        raise HTTPException(status_code=500, detail="Failed to push to intervals.icu — check log")
    return {"status": "pushed", "intervals_event_id": event_id}


@app.get("/trainiq/planning/intervals-test")
async def test_intervals_connection():
    """Test intervals.icu API credentials."""
    api_key = CONFIG.get("intervals_icu_api_key", "")
    athlete_id = CONFIG.get("intervals_icu_athlete_id", "0")
    if not api_key:
        return {"ok": False, "error": "Not configured — add intervals_icu_api_key in app settings"}
    svc = IntervalsService(api_key=api_key, athlete_id=athlete_id)
    ok = await svc.verify_connection()
    return {"ok": ok, "athlete_id": athlete_id}


@app.post("/trainiq/planning/export-to-intervals/{workout_id}")
async def export_to_intervals(workout_id: int, db: AsyncSession = Depends(get_db)):
    """Export a planned workout to intervals.icu (which then syncs to Garmin Connect)."""
    from .services.intervals_service import IntervalsService
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    if not CONFIG.get("intervals_api_key") or not CONFIG.get("intervals_athlete_id"):
        raise HTTPException(status_code=400, detail="intervals.icu API key and athlete ID not configured")
    svc = IntervalsService(CONFIG["intervals_api_key"], CONFIG["intervals_athlete_id"])
    ftp = await get_current_ftp(db)
    event_id = await svc.push_workout(workout, ftp=ftp)
    if event_id:
        return {"status": "exported", "intervals_event_id": event_id}
    raise HTTPException(status_code=500, detail="Failed to push workout to intervals.icu — check log")


@app.get("/trainiq/intervals/verify")
async def verify_intervals():
    """Verify intervals.icu credentials."""
    from .services.intervals_service import IntervalsService
    if not CONFIG.get("intervals_api_key") or not CONFIG.get("intervals_athlete_id"):
        return {"ok": False, "error": "Not configured"}
    svc = IntervalsService(CONFIG["intervals_api_key"], CONFIG["intervals_athlete_id"])
    return await svc.verify_connection()


@app.get("/trainiq/planning/download-fit/{workout_id}")
async def download_fit(workout_id: int, db: AsyncSession = Depends(get_db)):
    """Download a workout as a Garmin FIT file for manual import."""
    from fastapi.responses import Response
    from .services.fit_export import generate_workout_fit
    result = await db.execute(select(PlannedWorkout).where(PlannedWorkout.id == workout_id))
    workout = result.scalar_one_or_none()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    try:
        fit_data = generate_workout_fit(workout)
        filename = f"{workout.date.strftime('%Y-%m-%d')}_{workout.title.replace(' ', '_')[:30]}.fit"
        return Response(
            content=fit_data,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        logger.error("FIT generation failed: %s", e)
        raise HTTPException(status_code=500, detail=f"FIT generation failed: {e}")



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
    import os
    from .models.database import AsyncSessionLocal
    # Delete cached boundaries so they re-download with correct URL
    cache_path = "/data/strava_training/gemeente_boundaries.json.gz"
    if os.path.exists(cache_path):
        os.remove(cache_path)
        logger.info("Cleared gemeente boundary cache")
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
        for i, act in enumerate(acts):
            await svc.process_activity_gemeenten(act)
            if (i + 1) % 50 == 0:
                logger.info("Gemeente scan progress: %d/%d activities", i + 1, len(acts))
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
