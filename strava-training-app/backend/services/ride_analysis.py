from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .training_science import calculate_normalized_power, get_power_zones

WARMUP_SECONDS: int = 600
HOUR_SECONDS: int = 3600
MIN_CHUNK_SECONDS: int = 1800
MIN_DECOUPLING_MOVING_SECONDS: int = 7200
DEFAULT_W_PRIME: float = 20000.0
INTERVAL_MIN_SECONDS: int = 180
INTERVAL_FTP_FRACTION: float = 0.90
CLIMB_MIN_GRADE: float = 3.0
CLIMB_MIN_GAIN_M: float = 10.0
CLIMB_MIN_LENGTH_M: float = 200.0
CLIMB_STEP_M: float = 50.0
WBAL_SERIES_STEP: int = 10


def _to_array(stream: Optional[Sequence[Optional[float]]]) -> Optional[np.ndarray]:
    if not stream:
        return None
    arr = np.array([float(v) if v is not None else 0.0 for v in stream], dtype=float)
    return np.nan_to_num(arr, nan=0.0)


def _aligned(stream: Optional[Sequence[Optional[float]]], length: int) -> Optional[np.ndarray]:
    arr = _to_array(stream)
    if arr is None or len(arr) != length:
        return None
    return arr


def _smooth(arr: np.ndarray, window: int) -> np.ndarray:
    if len(arr) < window:
        return arr
    pad = window // 2
    padded = np.pad(arr, (pad, window - 1 - pad), mode="edge")
    return np.convolve(padded, np.ones(window) / window, mode="valid")


def _runs(mask: np.ndarray) -> List[Tuple[int, int]]:
    if not mask.any():
        return []
    padded = np.concatenate(([False], mask, [False])).astype(int)
    edges = np.diff(padded)
    starts = np.where(edges == 1)[0]
    ends = np.where(edges == -1)[0]
    return [(int(s), int(e)) for s, e in zip(starts, ends)]


def _merge_runs(runs: List[Tuple[int, int]], max_gap: int) -> List[Tuple[int, int]]:
    merged: List[Tuple[int, int]] = []
    for start, end in runs:
        if merged and start - merged[-1][1] <= max_gap:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def _normalized(power: np.ndarray) -> Optional[float]:
    if len(power) == 0:
        return None
    value = calculate_normalized_power(power.tolist())
    return float(value) if value else float(np.mean(power))


def decoupling_status(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    if value < 1.5:
        return "green"
    if value <= 3.0:
        return "yellow"
    return "red"


def _hourly_ef(power: np.ndarray, hr: np.ndarray, moving: np.ndarray) -> List[Dict[str, float]]:
    idx = np.arange(len(power))
    kept = idx[(moving > 0) & (idx >= WARMUP_SECONDS) & (hr > 0)]
    chunks: List[Dict[str, float]] = []
    for start in range(0, len(kept), HOUR_SECONDS):
        sel = kept[start:start + HOUR_SECONDS]
        if len(sel) < MIN_CHUNK_SECONDS:
            continue
        np_val = _normalized(power[sel])
        avg_hr = float(np.mean(hr[sel]))
        if not np_val or avg_hr <= 0:
            continue
        chunks.append({
            "hour": float(len(chunks) + 1),
            "np": round(np_val, 1),
            "avg_hr": round(avg_hr, 1),
            "ef": round(np_val / avg_hr, 3),
            "minutes": float(round(len(sel) / 60)),
            "center": start + len(sel) / 2.0,
        })
    return chunks


def aerobic_decoupling(power: np.ndarray, hr: np.ndarray, moving: np.ndarray, moving_seconds: int) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "decoupling_pct": None,
        "decoupling_status": None,
        "drift_per_hour": None,
        "drift_status": None,
        "ef_hourly": [],
    }
    chunks = _hourly_ef(power, hr, moving)
    result["ef_hourly"] = [{k: v for k, v in c.items() if k != "center"} for c in chunks]
    if moving_seconds < MIN_DECOUPLING_MOVING_SECONDS or len(chunks) < 2:
        return result

    first, second, last = chunks[0], chunks[1], chunks[-1]
    pct = (1 - second["ef"] / first["ef"]) * 100.0
    result["decoupling_pct"] = round(pct, 1)
    result["decoupling_status"] = decoupling_status(pct)

    hours = (last["center"] - first["center"]) / HOUR_SECONDS
    if hours > 0:
        drift = (1 - last["ef"] / first["ef"]) * 100.0 / hours
        result["drift_per_hour"] = round(drift, 1)
        result["drift_status"] = decoupling_status(drift)
    return result


def work_per_zone(power: np.ndarray, moving: np.ndarray, ftp: float) -> List[Dict[str, Any]]:
    zones = get_power_zones(ftp)
    uppers = np.array([z["max"] for z in zones], dtype=float)
    zone_idx = np.clip(np.searchsorted(uppers, power, side="left"), 0, len(zones) - 1)
    total_kj = float(power.sum()) / 1000.0
    rows: List[Dict[str, Any]] = []
    for i, zone in enumerate(zones):
        in_zone = zone_idx == i
        kj = float(power[in_zone].sum()) / 1000.0
        rows.append({
            "zone": zone["zone"],
            "name": zone["name"],
            "min": zone["min"],
            "max": zone["max"],
            "kj": round(kj, 1),
            "seconds": int(np.sum(in_zone & (moving > 0))),
            "pct": round(kj / total_kj * 100.0, 1) if total_kj > 0 else 0.0,
        })
    return rows


def w_prime_balance(power: np.ndarray, cp: float, w_prime: float) -> Dict[str, Any]:
    balance = np.empty(len(power), dtype=float)
    current = w_prime
    for i, p in enumerate(power.tolist()):
        if p > cp:
            current -= p - cp
        else:
            current += (cp - p) * (w_prime - current) / w_prime
        current = min(current, w_prime)
        balance[i] = current
    minimum = float(balance.min()) if len(balance) else w_prime
    series = [
        {"t": int(i), "pct": round(float(balance[i]) / w_prime * 100.0, 1)}
        for i in range(0, len(balance), WBAL_SERIES_STEP)
    ]
    return {
        "cp": round(cp, 1),
        "w_prime": round(w_prime),
        "min_j": round(minimum),
        "min_pct": round(minimum / w_prime * 100.0, 1),
        "series": series,
    }


def _mean_positive(arr: Optional[np.ndarray]) -> Optional[float]:
    if arr is None or len(arr) == 0:
        return None
    positive = arr[arr > 0]
    return round(float(np.mean(positive)), 1) if len(positive) else None


def detect_intervals(
    power: np.ndarray,
    hr: Optional[np.ndarray],
    cadence: Optional[np.ndarray],
    ftp: float,
) -> List[Dict[str, Any]]:
    if ftp <= 0 or len(power) < INTERVAL_MIN_SECONDS:
        return []
    threshold = INTERVAL_FTP_FRACTION * ftp
    smooth = np.convolve(power, np.ones(30) / 30.0, mode="same")
    runs = _merge_runs(_runs(smooth >= threshold), 30)

    intervals: List[Dict[str, Any]] = []
    for start, end in runs:
        if end - start < INTERVAL_MIN_SECONDS:
            continue
        segment = power[start:end]
        if float(np.mean(segment)) < threshold:
            continue
        np_val = _normalized(segment)
        avg_hr = _mean_positive(hr[start:end]) if hr is not None else None
        intervals.append({
            "start_s": start,
            "duration_s": end - start,
            "avg_power": round(float(np.mean(segment))),
            "np": round(np_val) if np_val else None,
            "pct_ftp": round(float(np.mean(segment)) / ftp * 100.0),
            "avg_hr": avg_hr,
            "avg_cadence": _mean_positive(cadence[start:end]) if cadence is not None else None,
            "ef": round(np_val / avg_hr, 2) if np_val and avg_hr else None,
        })
    return intervals


def detect_climbs(
    altitude: Optional[np.ndarray],
    distance: Optional[np.ndarray],
    power: np.ndarray,
    moving: np.ndarray,
    weight_kg: float,
) -> List[Dict[str, Any]]:
    if altitude is None or distance is None or len(distance) < 100:
        return []
    dist = np.maximum.accumulate(distance)
    if dist[-1] - dist[0] < CLIMB_MIN_LENGTH_M:
        return []

    alt = _smooth(altitude, 15)
    targets = np.arange(dist[0], dist[-1], CLIMB_STEP_M)
    idx = np.unique(np.clip(np.searchsorted(dist, targets, side="left"), 0, len(dist) - 1))
    if len(idx) < 6:
        return []

    d = dist[idx]
    a = alt[idx]
    step = np.diff(d)
    valid = step > 0
    grade = np.where(valid, np.diff(a) / np.where(valid, step, 1.0) * 100.0, 0.0)
    grade = np.convolve(grade, np.ones(3) / 3.0, mode="same")
    runs = _merge_runs(_runs(grade > CLIMB_MIN_GRADE), 2)

    climbs: List[Dict[str, Any]] = []
    for start, end in runs:
        length = float(d[end] - d[start])
        gain = float(a[end] - a[start])
        if gain <= CLIMB_MIN_GAIN_M or length < CLIMB_MIN_LENGTH_M:
            continue
        i0, i1 = int(idx[start]), int(idx[end])
        seconds = int(np.sum(moving[i0:i1] > 0)) or (i1 - i0)
        if seconds <= 0:
            continue
        avg_power = float(np.mean(power[i0:i1]))
        climbs.append({
            "start_s": i0,
            "duration_s": seconds,
            "length_km": round(length / 1000.0, 2),
            "gain_m": round(gain),
            "avg_grade": round(gain / length * 100.0, 1),
            "vam": round(gain / (seconds / 3600.0)),
            "avg_power": round(avg_power),
            "wkg": round(avg_power / weight_kg, 2) if weight_kg > 0 else None,
        })
    return climbs


def compute_quick_stats(
    power_stream: Optional[Sequence[Optional[float]]],
    hr_stream: Optional[Sequence[Optional[float]]],
    moving_stream: Optional[Sequence[Optional[float]]],
    moving_time: Optional[int],
    tss: Optional[float],
    avg_watts: Optional[float],
    kilojoules: Optional[float],
) -> Dict[str, Any]:
    stats: Dict[str, Any] = {
        "duration_s": moving_time or 0,
        "tss": tss,
        "kj": kilojoules,
        "vi": None,
        "decoupling_pct": None,
        "decoupling_status": None,
    }
    power = _to_array(power_stream)
    if power is None:
        if stats["kj"] is None and avg_watts and moving_time:
            stats["kj"] = round(avg_watts * moving_time / 1000.0, 1)
        return stats

    n = len(power)
    moving = _aligned(moving_stream, n)
    hr = _aligned(hr_stream, n)
    active = moving > 0 if moving is not None else np.ones(n, dtype=bool)

    stats["kj"] = round(float(power.sum()) / 1000.0, 1)
    pedalled = power[active]
    np_val = _normalized(pedalled)
    avg_power = float(np.mean(pedalled)) if len(pedalled) else 0.0
    if np_val and avg_power > 0:
        stats["vi"] = round(np_val / avg_power, 2)

    if moving is not None and hr is not None:
        decoupling = aerobic_decoupling(power, hr, moving, int(active.sum()))
        stats["decoupling_pct"] = decoupling["decoupling_pct"]
        stats["decoupling_status"] = decoupling["decoupling_status"]
    return stats


def analyse_ride(
    power_stream: Optional[Sequence[Optional[float]]],
    hr_stream: Optional[Sequence[Optional[float]]],
    cadence_stream: Optional[Sequence[Optional[float]]],
    altitude_stream: Optional[Sequence[Optional[float]]],
    distance_stream: Optional[Sequence[Optional[float]]],
    moving_stream: Optional[Sequence[Optional[float]]],
    ftp: float,
    cp: float,
    w_prime: float,
    weight_kg: float,
) -> Dict[str, Any]:
    power = _to_array(power_stream)
    if power is None or ftp <= 0:
        return {"available": False, "reason": "no_power_stream"}

    n = len(power)
    moving = _aligned(moving_stream, n)
    hr = _aligned(hr_stream, n)
    cadence = _aligned(cadence_stream, n)
    altitude = _aligned(altitude_stream, n)
    distance = _aligned(distance_stream, n)
    has_aligned = moving is not None
    moving_arr = moving if moving is not None else np.ones(n, dtype=float)
    active = moving_arr > 0

    pedalled = power[active]
    np_val = _normalized(pedalled) or 0.0
    avg_power = float(np.mean(pedalled)) if len(pedalled) else 0.0

    durability: Dict[str, Any] = {
        "decoupling_pct": None,
        "decoupling_status": None,
        "drift_per_hour": None,
        "drift_status": None,
        "ef_hourly": [],
        "warmup_excluded_s": WARMUP_SECONDS,
    }
    if has_aligned and hr is not None:
        durability.update(aerobic_decoupling(power, hr, moving_arr, int(active.sum())))

    return {
        "available": True,
        "legacy_streams": not has_aligned,
        "pacing": {
            "np": round(np_val),
            "avg_power": round(avg_power),
            "vi": round(np_val / avg_power, 2) if avg_power > 0 else None,
            "if": round(np_val / ftp, 2),
            "ftp": round(ftp),
            "kj": round(float(power.sum()) / 1000.0, 1),
        },
        "zones": work_per_zone(power, moving_arr, ftp),
        "durability": durability,
        "w_prime": w_prime_balance(power, cp if cp > 0 else ftp, w_prime if w_prime > 0 else DEFAULT_W_PRIME),
        "intervals": detect_intervals(power, hr, cadence, ftp),
        "climbs": detect_climbs(altitude, distance, power, moving_arr, weight_kg),
    }