from sqlalchemy import Column, Integer, Float, String, DateTime, Boolean, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = f"sqlite+aiosqlite:////{os.getenv('DATA_PATH', '/data/strava_training')}/training.db"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True)
    strava_id = Column(Integer, unique=True, index=True)
    name = Column(String)
    sport_type = Column(String)  # Ride, VirtualRide, Run, etc.
    start_date = Column(DateTime, index=True)
    elapsed_time = Column(Integer)       # seconds
    moving_time = Column(Integer)        # seconds
    distance = Column(Float)             # meters
    total_elevation_gain = Column(Float) # meters
    average_speed = Column(Float)        # m/s
    max_speed = Column(Float)
    average_watts = Column(Float, nullable=True)
    max_watts = Column(Float, nullable=True)
    weighted_avg_watts = Column(Float, nullable=True)  # normalized power
    average_heartrate = Column(Float, nullable=True)
    max_heartrate = Column(Float, nullable=True)
    kilojoules = Column(Float, nullable=True)
    has_power = Column(Boolean, default=False)
    tss = Column(Float, nullable=True)   # training stress score
    np = Column(Float, nullable=True)    # normalized power
    if_ = Column(Float, nullable=True)   # intensity factor
    description = Column(Text, nullable=True)
    gear_id = Column(String, nullable=True)
    # Raw power stream stored as JSON array for power curve calculation
    commute = Column(Boolean, default=False)
    trainer = Column(Boolean, default=False)       # indoor / virtual ride flag
    power_stream = Column(JSON, nullable=True)
    hr_stream = Column(JSON, nullable=True)
    latlng_stream = Column(JSON, nullable=True)   # [[lat,lon], ...]
    # GPS track as list of [lat, lon] pairs for municipality detection
    latlng_stream = Column(JSON, nullable=True)
    municipalities_processed = Column(Boolean, default=False)
    # GPS stream: list of [lat, lon] pairs
    latlng_stream = Column(JSON, nullable=True)
    # CBS gemeente codes this activity passed through
    gemeente_codes = Column(JSON, nullable=True)


class PowerCurve(Base):
    """Cached best mean maximal power values per duration (seconds)"""
    __tablename__ = "power_curve"

    id = Column(Integer, primary_key=True)
    duration_seconds = Column(Integer, index=True)
    best_power = Column(Float)           # watts
    activity_id = Column(Integer)
    activity_date = Column(DateTime)
    updated_at = Column(DateTime)


class FTPEstimate(Base):
    __tablename__ = "ftp_estimates"

    id = Column(Integer, primary_key=True)
    estimated_at = Column(DateTime)
    cp = Column(Float)     # critical power (watts) = FTP
    w_prime = Column(Float)  # anaerobic work capacity (joules)
    p_max = Column(Float)   # maximal sprint power (watts)
    r_squared = Column(Float)  # model fit quality
    data_window_days = Column(Integer, default=60)


class TrainingMetrics(Base):
    """Daily PMC values"""
    __tablename__ = "training_metrics"

    id = Column(Integer, primary_key=True)
    date = Column(DateTime, unique=True, index=True)
    ctl = Column(Float)   # chronic training load (fitness)
    atl = Column(Float)   # acute training load (fatigue)
    tsb = Column(Float)   # training stress balance (form)
    daily_tss = Column(Float)


class PlannedWorkout(Base):
    __tablename__ = "planned_workouts"

    id = Column(Integer, primary_key=True)
    date = Column(DateTime, index=True)
    title = Column(String)
    description = Column(Text)
    workout_type = Column(String)  # endurance, threshold, vo2max, recovery, etc.
    target_tss = Column(Float, nullable=True)
    target_duration_minutes = Column(Integer, nullable=True)
    target_if = Column(Float, nullable=True)  # intensity factor
    intervals = Column(JSON, nullable=True)   # structured interval data
    garmin_workout_id = Column(String, nullable=True)
    exported_to_garmin = Column(Boolean, default=False)
    goal_id = Column(Integer, nullable=True)


class TrainingGoal(Base):
    __tablename__ = "training_goals"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime)
    event_name = Column(String)
    event_date = Column(DateTime)
    event_distance_km = Column(Float, nullable=True)
    event_elevation_m = Column(Float, nullable=True)
    goal_description = Column(Text)
    current_ftp = Column(Float)
    current_ctl = Column(Float)
    active = Column(Boolean, default=True)
    ai_plan_summary = Column(Text, nullable=True)
    weekly_hours = Column(Float, nullable=True)       # target hours per week
    global_plan = Column(JSON, nullable=True)         # [{week, phase, hours, tss, description}]
    global_plan_generated_at = Column(DateTime, nullable=True)
    last_week_settings = Column(JSON, nullable=True)  # remembered day settings from last planning


class StravaToken(Base):
    __tablename__ = "strava_tokens"

    id = Column(Integer, primary_key=True)
    access_token = Column(String)
    refresh_token = Column(String)
    expires_at = Column(Integer)  # unix timestamp
    athlete_id = Column(Integer)
    athlete_name = Column(String)


class GemeenteBoundary(Base):
    """CBS gemeente boundary polygons (downloaded once from PDOK)."""
    __tablename__ = "gemeente_boundaries"

    id = Column(Integer, primary_key=True)
    gemeente_code = Column(String, unique=True, index=True)
    gemeente_name = Column(String, index=True)
    geojson = Column(Text)


class VisitedGemeente(Base):
    """One row per activity-gemeente combination."""
    __tablename__ = "visited_gemeenten"

    id = Column(Integer, primary_key=True)
    gemeente_code = Column(String, index=True)
    gemeente_name = Column(String)
    activity_id = Column(Integer, index=True)
    first_visit_date = Column(DateTime, index=True)


# Keep old names as aliases for any legacy references
MunicipalityBoundary = GemeenteBoundary
VisitedMunicipality = VisitedGemeente
