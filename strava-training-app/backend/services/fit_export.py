"""
Generate Garmin FIT files for structured workouts.
FIT (Flexible and Interoperable Data Transfer) — Garmin's binary format.

Key references:
- Message numbers: FIT SDK profile.xlsx
- Duration type 0 = "time" (value in seconds)
- Target type 6 = "power" (value = zone, or 0 for custom low/high in watts)
"""
import struct
import logging
from datetime import datetime
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

FIT_EPOCH = 631065600  # Unix epoch - FIT epoch (Dec 31, 1989)

# FIT global message numbers
MESG_FILE_ID      = 0
MESG_WORKOUT      = 26
MESG_WORKOUT_STEP = 27

# FIT base types
ENUM    = 0x00
UINT8   = 0x02
UINT16  = 0x84
UINT32  = 0x86
STRING  = 0x07

# Duration types
DURATION_TIME = 0   # fixed time, value in seconds
DURATION_OPEN = 3   # lap button press

# Target types
TARGET_POWER = 6    # power (custom low/high in watts)
TARGET_OPEN  = 0    # no target

# Intensity
ACTIVE   = 0
REST     = 1
WARMUP   = 2
COOLDOWN = 3

# Sport
CYCLING = 2


def fit_time(dt: datetime) -> int:
    return int(dt.timestamp()) - FIT_EPOCH


def crc16(data: bytes, crc: int = 0) -> int:
    table = [
        0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
        0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
    ]
    for byte in data:
        tmp = table[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc ^= tmp ^ table[byte & 0xF]
        tmp = table[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc ^= tmp ^ table[(byte >> 4) & 0xF]
    return crc


def encode_string(value: str, size: int) -> bytes:
    """Encode a string to exactly `size` bytes, null-terminated and null-padded."""
    encoded = (value or '').encode('utf-8')[:size - 1]  # leave room for null
    return encoded + b'\x00' * (size - len(encoded))    # pad to exact size


def write_definition(local_num: int, global_num: int, fields: List[tuple]) -> bytes:
    """
    Build a FIT definition message.
    fields: list of (field_def_num, size_bytes, base_type)
    """
    buf = bytearray()
    buf.append(0x40 | (local_num & 0x0F))  # definition header
    buf.append(0)                            # reserved
    buf.append(0)                            # little-endian
    buf += struct.pack('<H', global_num)
    buf.append(len(fields))
    for fnum, fsize, ftype in fields:
        buf.append(fnum)
        buf.append(fsize)
        buf.append(ftype)
    return bytes(buf)


def write_data(local_num: int, fields: List[tuple], values: List) -> bytes:
    """
    Build a FIT data message.
    fields: same list as write_definition
    values: list of values in same order
    """
    buf = bytearray()
    buf.append(local_num & 0x0F)  # data header
    for (fnum, fsize, ftype), value in zip(fields, values):
        if ftype == STRING:
            buf += encode_string(str(value) if value else '', fsize)
        elif fsize == 1:
            v = value if value is not None else 0xFF
            buf.append(int(v) & 0xFF)
        elif fsize == 2:
            v = value if value is not None else 0xFFFF
            buf += struct.pack('<H', int(v) & 0xFFFF)
        elif fsize == 4:
            v = value if value is not None else 0xFFFFFFFF
            buf += struct.pack('<I', int(v) & 0xFFFFFFFF)
    return bytes(buf)


def build_fit(records: bytearray) -> bytes:
    """Wrap records in FIT file header + CRC."""
    data_size = len(records)
    hdr = bytearray()
    hdr.append(14)                          # header size
    hdr.append(0x10)                        # protocol version 1.0
    hdr += struct.pack('<H', 2132)          # profile version
    hdr += struct.pack('<I', data_size)
    hdr += b'.FIT'
    hdr += struct.pack('<H', crc16(bytes(hdr)))
    return bytes(hdr) + bytes(records) + struct.pack('<H', crc16(bytes(records)))


def generate_workout_fit(workout) -> bytes:
    """Generate a valid FIT workout file from a PlannedWorkout."""
    records = bytearray()
    now = fit_time(datetime.now())
    name = (workout.title or 'Workout')[:16]
    intervals = workout.intervals or []
    num_steps = _count_steps(intervals)

    # ── file_id (local 0) ─────────────────────────────────────────────────
    FILE_ID_FIELDS = [
        (0, 1, ENUM),    # type: 5 = workout
        (1, 2, UINT16),  # manufacturer: 255 = development
        (2, 2, UINT16),  # product
        (4, 4, UINT32),  # time_created
    ]
    records += write_definition(0, MESG_FILE_ID, FILE_ID_FIELDS)
    records += write_data(0, FILE_ID_FIELDS, [5, 255, 0, now])

    # ── workout (local 1) ─────────────────────────────────────────────────
    WORKOUT_FIELDS = [
        (4, 1,  ENUM),    # sport: 2 = cycling
        (5, 2,  UINT16),  # num_valid_steps
        (8, 16, STRING),  # wkt_name
    ]
    records += write_definition(1, MESG_WORKOUT, WORKOUT_FIELDS)
    records += write_data(1, WORKOUT_FIELDS, [CYCLING, num_steps, name])

    # ── workout_step (local 2) ────────────────────────────────────────────
    STEP_FIELDS = [
        (0,  2,  UINT16),  # message_index
        (1,  16, STRING),  # wkt_step_name
        (2,  1,  ENUM),    # duration_type
        (3,  4,  UINT32),  # duration_value (seconds for DURATION_TIME)
        (4,  1,  ENUM),    # target_type
        (5,  4,  UINT32),  # target_value (0 for custom power)
        (6,  4,  UINT32),  # custom_target_value_low  (watts)
        (7,  4,  UINT32),  # custom_target_value_high (watts)
        (11, 1,  ENUM),    # intensity
    ]
    records += write_definition(2, MESG_WORKOUT_STEP, STEP_FIELDS)

    if not intervals:
        duration_s = (workout.target_duration_minutes or 60) * 60
        records += write_data(2, STEP_FIELDS, [
            0, 'Ride',
            DURATION_TIME, duration_s,
            TARGET_OPEN, 0, 0, 0,
            ACTIVE,
        ])
    else:
        idx = 0
        for interval in intervals:
            for step in _interval_to_steps(interval, idx):
                records += write_data(2, STEP_FIELDS, [
                    step['index'], step['name'],
                    step['duration_type'], step['duration_value'],
                    step['target_type'], step['target_value'],
                    step['target_low'], step['target_high'],
                    step['intensity'],
                ])
                idx = step['index'] + 1

    return build_fit(records)


def _count_steps(intervals: List[Dict]) -> int:
    if not intervals:
        return 1
    count = 0
    for iv in intervals:
        reps = iv.get('repeats', 1)
        has_rest = iv.get('rest_seconds', 0) > 0
        count += reps * (2 if has_rest else 1)
    return count


def _interval_to_steps(interval: Dict, start_index: int) -> List[Dict]:
    itype      = interval.get('type', 'work')
    duration_s = int(interval.get('duration_seconds', 300))
    repeats    = int(interval.get('repeats', 1))
    rest_s     = int(interval.get('rest_seconds', 0))
    power_low  = interval.get('power_low')
    power_high = interval.get('power_high')

    has_power  = power_low is not None and power_high is not None
    t_type     = TARGET_POWER if has_power else TARGET_OPEN
    t_low      = int(power_low)  if power_low  else 0
    t_high     = int(power_high) if power_high else 0

    intensity_map = {
        'work': ACTIVE, 'recovery': REST,
        'warmup': WARMUP, 'cooldown': COOLDOWN,
    }
    intensity = intensity_map.get(itype, ACTIVE)

    steps = []
    idx = start_index
    for rep in range(repeats):
        step_name = f'Int {rep+1}/{repeats}' if repeats > 1 else itype.capitalize()
        steps.append({
            'index': idx,
            'name': step_name[:16],
            'duration_type': DURATION_TIME,
            'duration_value': duration_s,   # seconds — NOT milliseconds
            'target_type': t_type,
            'target_value': 0,              # 0 = use custom low/high
            'target_low': t_low,
            'target_high': t_high,
            'intensity': intensity,
        })
        idx += 1

        if rest_s > 0:
            steps.append({
                'index': idx,
                'name': 'Rest',
                'duration_type': DURATION_TIME,
                'duration_value': rest_s,
                'target_type': TARGET_OPEN,
                'target_value': 0,
                'target_low': 0,
                'target_high': 0,
                'intensity': REST,
            })
            idx += 1

    return steps
