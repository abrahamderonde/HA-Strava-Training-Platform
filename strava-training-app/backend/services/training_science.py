"""
Training science calculations:
- TSS (Training Stress Score) - power-based and HR-estimated
- PMC (Performance Management Chart): CTL, ATL, TSB
- Power Curve (Mean Maximal Power)
- 3-Parameter Critical Power model (Morton 1996)
  P(t) = W'/t + CP + Pmax * e^(-t/tau)
  FTP = CP
"""
import numpy as np
from scipy.optimize import curve_fit, minimize
from scipy.signal import savgol_filter
from datetime import datetime, timedelta
from typing import List, Optional, Tuple, Dict
import logging

logger = logging.getLogger(__name__)

# PMC time constants (days)
CTL_TAU = 42   # chronic training load decay constant
ATL_TAU = 7    # acute training load decay constant

# TSS estimation constants
MAX_HR_DEFAULT = 190
REST_HR_DEFAULT = 50


# ---------------------------------------------------------------------------
# TSS Calculation
# ---------------------------------------------------------------------------

def calculate_tss_from_power(
    power_stream: List[float],
    ftp: float,
    duration_seconds: int
) -> Tuple[float, float, float]:
    """
    Calculate TSS, NP, and IF from a power stream.
    Returns (tss, normalized_power, intensity_factor)
    """
    if not power_stream or ftp <= 0:
        return 0.0, 0.0, 0.0

    arr = np.array(power_stream, dtype=float)
    arr = np.nan_to_num(arr, nan=0.0)

    # Normalized Power: 30s rolling average -> ^4 -> mean -> ^0.25
    window = 30
    if len(arr) >= window:
        rolling = np.convolve(arr, np.ones(window) / window, mode='valid')
        np_val = float(np.mean(rolling ** 4) ** 0.25)
    else:
        np_val = float(np.mean(arr))

    if_ = np_val / ftp
    duration_hours = duration_seconds / 3600.0
    tss = (duration_hours * np_val * if_) / ftp * 100.0

    return round(tss, 1), round(np_val, 1), round(if_, 3)


def estimate_tss_from_hr(
    avg_hr: float,
    duration_seconds: int,
    max_hr: float = MAX_HR_DEFAULT,
    rest_hr: float = REST_HR_DEFAULT,
    ftp_hr_fraction: float = 0.89  # approx HR at threshold
) -> float:
    """
    Estimate TSS from heart rate using hrTSS method.
    Based on the relationship between HR reserve and training stress.
    """
    if avg_hr <= 0 or duration_seconds <= 0:
        return 0.0

    hr_reserve = max_hr - rest_hr
    lthr = rest_hr + ftp_hr_fraction * hr_reserve

    # HR-based intensity factor
    hr_if = (avg_hr - rest_hr) / (lthr - rest_hr)
    hr_if = max(0.0, min(hr_if, 1.5))

    duration_hours = duration_seconds / 3600.0
    tss = duration_hours * (hr_if ** 2) * 100.0

    return round(tss, 1)


def estimate_tss_no_data(duration_seconds: int, sport_type: str) -> float:
    """
    Rough TSS estimate when no power or HR data is available.
    Uses typical intensity assumptions per sport.
    """
    duration_hours = duration_seconds / 3600.0
    sport_if = {
        "Ride": 0.65,
        "VirtualRide": 0.70,
        "Run": 0.75,
        "TrailRun": 0.80,
        "Walk": 0.45,
        "Hike": 0.50,
        "RopeJumping": 0.85,
        "CoreStability": 0.40,
        "WeightTraining": 0.50,
    }
    if_ = sport_if.get(sport_type, 0.60)
    return round(duration_hours * (if_ ** 2) * 100.0, 1)


# ---------------------------------------------------------------------------
# Performance Management Chart (PMC)
# ---------------------------------------------------------------------------

def calculate_pmc(
    daily_tss: Dict[datetime, float],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    initial_ctl: float = 0.0,
    initial_atl: float = 0.0,
) -> List[Dict]:
    """
    Calculate CTL (fitness), ATL (fatigue), TSB (form) using
    Banister impulse-response model with exponential decay.

    CTL(d) = CTL(d-1) * e^(-1/42) + TSS(d) * (1 - e^(-1/42))
    ATL(d) = ATL(d-1) * e^(-1/7)  + TSS(d) * (1 - e^(-1/7))
    TSB(d) = CTL(d-1) - ATL(d-1)   (yesterday's fitness minus fatigue)
    """
    if not daily_tss:
        return []

    if start_date is None:
        start_date = min(daily_tss.keys())
    if end_date is None:
        end_date = max(daily_tss.keys())

    ctl_decay = np.exp(-1 / CTL_TAU)
    atl_decay = np.exp(-1 / ATL_TAU)
    ctl_gain = 1 - ctl_decay
    atl_gain = 1 - atl_decay

    ctl = initial_ctl
    atl = initial_atl
    results = []

    current = start_date
    while current <= end_date:
        tss = daily_tss.get(current, 0.0)
        tsb = ctl - atl  # form = yesterday's fitness - fatigue
        ctl = ctl * ctl_decay + tss * ctl_gain
        atl = atl * atl_decay + tss * atl_gain

        results.append({
            "date": current.isoformat(),
            "tss": round(tss, 1),
            "ctl": round(ctl, 1),
            "atl": round(atl, 1),
            "tsb": round(tsb, 1),
        })
        current += timedelta(days=1)

    return results


# ---------------------------------------------------------------------------
# Power Curve (Mean Maximal Power)
# ---------------------------------------------------------------------------

POWER_CURVE_DURATIONS = [
    1, 2, 3, 5, 7, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300,
    360, 420, 480, 600, 720, 900, 1200, 1800, 2700, 3600, 5400, 7200
]


def calculate_mmp(power_stream: List[float], duration_seconds: int) -> Optional[float]:
    """Calculate mean maximal power for a given duration from a power stream."""
    arr = np.array(power_stream, dtype=float)
    arr = np.nan_to_num(arr, nan=0.0)

    if len(arr) < duration_seconds:
        return None

    # Sliding window mean
    kernel = np.ones(duration_seconds) / duration_seconds
    rolling = np.convolve(arr, kernel, mode='valid')
    return float(np.max(rolling))


def build_power_curve(power_stream: List[float]) -> Dict[int, float]:
    """Build full power curve from a single activity's power stream."""
    results = {}
    for dur in POWER_CURVE_DURATIONS:
        mmp = calculate_mmp(power_stream, dur)
        if mmp is not None:
            results[dur] = round(mmp, 1)
    return results


def merge_power_curves(curves: List[Dict[int, float]]) -> Dict[int, float]:
    """Merge multiple power curves, keeping the best (highest) value per duration."""
    merged = {}
    for curve in curves:
        for dur, power in curve.items():
            if dur not in merged or power > merged[dur]:
                merged[dur] = power
    return merged


# ---------------------------------------------------------------------------
# 3-Parameter Critical Power Model (Morton 1996)
# P(t) = W'/t + CP + Pmax * exp(-t / tau)
# where tau is derived, and FTP = CP
# ---------------------------------------------------------------------------

def _cp3_model(t: np.ndarray, cp: float, w_prime: float, p_max: float) -> np.ndarray:
    """
    3-parameter CP model: P(t) = W'/t + CP + (Pmax - CP) * exp(-t/tau)
    Morton (1996): Ergonomics 39(4)
    tau is implicit: as t->inf P->CP, short durations dominated by Pmax and W'
    We use the simplified form fitting CP, W', and an effective Pmax component.
    """
    # Avoid division by zero
    t = np.maximum(t, 0.1)
    # Morton's form: P = CP + W'/t  (2-param) extended with sprint component
    # Full 3-param: P(t) = Pmax * (1 - exp(-t * CP / W')) + CP * exp(-t * CP / W')
    # Simplified tractable form used in practice:
    tau = w_prime / (p_max - cp) if (p_max - cp) > 0 else 1.0
    return cp + w_prime / t + (p_max - cp) * np.exp(-t / tau)


def fit_critical_power(
    power_curve: Dict[int, float],
    min_duration: int = 120,    # start at 2 min — short sprints distort CP
    max_duration: int = 1200,   # up to 20 min
) -> Optional[Dict]:
    """
    Fit the 3-parameter critical power model to a power curve.
    Uses durations between min_duration and max_duration seconds.

    Returns dict with cp, w_prime, p_max, r_squared, or None if fitting fails.
    FTP = CP (Morton's interpretation)
    """
    # Filter to relevant durations
    durations = []
    powers = []
    for dur, pwr in sorted(power_curve.items()):
        if min_duration <= dur <= max_duration and pwr > 0:
            durations.append(float(dur))
            powers.append(float(pwr))

    if len(durations) < 6:
        logger.warning("Insufficient data points for CP model fitting (%d points)", len(durations))
        return None

    t = np.array(durations)
    p = np.array(powers)

    # Initial parameter estimates
    # CP should be close to 20-min power — use 80th percentile of longer efforts
    long_mask = t >= 600  # 10+ min efforts
    if np.sum(long_mask) >= 2:
        cp_init = float(np.mean(p[long_mask]) * 0.95)
    else:
        cp_init = float(np.percentile(p, 30))
    p_max_init = float(np.max(p))
    w_prime_init = 20000.0  # typical W' ~15-25 kJ

    try:
        popt, pcov = curve_fit(
            _cp3_model,
            t, p,
            p0=[cp_init, w_prime_init, p_max_init],
            bounds=(
                [50,  1000,  p_max_init * 0.5],   # lower bounds
                [500, 100000, 2000]                 # upper bounds
            ),
            maxfev=10000,
        )
        cp, w_prime, p_max = popt

        # Sanity check: CP should be plausible relative to 20-min power
        if len(p[long_mask]) > 0:
            p20_approx = float(np.min(p[t >= 1200])) if np.sum(t >= 1200) > 0 else float(np.min(p[long_mask]))
            if cp > p20_approx * 1.10:
                logger.warning("CP %.1fW seems too high vs 20-min power %.1fW, capping", cp, p20_approx)
                cp = p20_approx * 1.05  # CP is typically ~95-105% of 20-min power

        # Calculate R²
        p_pred = _cp3_model(t, *popt)
        ss_res = np.sum((p - p_pred) ** 2)
        ss_tot = np.sum((p - np.mean(p)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

        return {
            "cp": round(float(cp), 1),
            "w_prime": round(float(w_prime), 0),
            "p_max": round(float(p_max), 1),
            "r_squared": round(float(r_squared), 4),
            "ftp": round(float(cp), 1),  # FTP = CP per Morton
        }

    except (RuntimeError, ValueError) as e:
        logger.error("CP model fitting failed: %s", e)
        return None


def get_power_zones(ftp: float) -> List[Dict]:
    """
    Calculate Coggan power zones based on FTP.
    """
    zones = [
        {"zone": 1, "name": "Active Recovery", "min": 0,    "max": round(ftp * 0.55)},
        {"zone": 2, "name": "Endurance",        "min": round(ftp * 0.56), "max": round(ftp * 0.75)},
        {"zone": 3, "name": "Tempo",            "min": round(ftp * 0.76), "max": round(ftp * 0.90)},
        {"zone": 4, "name": "Threshold",        "min": round(ftp * 0.91), "max": round(ftp * 1.05)},
        {"zone": 5, "name": "VO2 Max",          "min": round(ftp * 1.06), "max": round(ftp * 1.20)},
        {"zone": 6, "name": "Anaerobic",        "min": round(ftp * 1.21), "max": round(ftp * 1.50)},
        {"zone": 7, "name": "Neuromuscular",    "min": round(ftp * 1.51), "max": 9999},
    ]
    return zones
