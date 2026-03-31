"""
Generate Garmin FIT files for structured workouts.
FIT (Flexible and Interoperable Data Transfer) is Garmin's binary format.
We generate workout FIT files that can be imported into Garmin Connect.

Reference: https://developer.garmin.com/fit/protocol/
"""
import struct
import logging
from datetime import datetime
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

# FIT protocol constants
FIT_EPOCH = 631065600  # seconds between Unix epoch and FIT epoch (Dec 31, 1989)
ENDIAN = '<'  # little-endian

# FIT message numbers (from official FIT SDK)
MESG_FILE_ID = 0
MESG_WORKOUT = 26
MESG_WORKOUT_STEP = 27

# FIT base types
BASE_ENUM = 0x00
BASE_UINT8 = 0x02
BASE_UINT16 = 0x84
BASE_UINT32 = 0x86
BASE_STRING = 0x07
BASE_UINT32Z = 0x8C

# Sport types
SPORT_CYCLING = 2

# Workout step duration types
DURATION_TIME = 0          # fixed time
DURATION_OPEN = 3          # open / until button press

# Workout step target types  
TARGET_POWER = 6           # power zone target
TARGET_OPEN = 0            # no target

# Workout step intensity
INTENSITY_ACTIVE = 0
INTENSITY_REST = 1
INTENSITY_WARMUP = 2
INTENSITY_COOLDOWN = 3


def to_fit_time(dt: datetime) -> int:
    """Convert datetime to FIT timestamp."""
    return int(dt.timestamp()) - FIT_EPOCH


def crc16(data: bytes, crc: int = 0) -> int:
    """Calculate FIT CRC-16."""
    crc_table = [
        0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
        0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
    ]
    for byte in data:
        tmp = crc_table[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ crc_table[byte & 0xF]
        tmp = crc_table[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ crc_table[(byte >> 4) & 0xF]
    return crc


class FitWriter:
    """Builds a FIT file byte by byte."""

    def __init__(self):
        self.records = bytearray()
        self.definitions = {}  # local_mesg_num -> field list

    def _write_definition(self, local_num: int, global_mesg_num: int, fields: List[tuple]) -> bytes:
        """Write a definition message. fields = [(field_def_num, size, base_type)]"""
        data = bytearray()
        data.append(0x40 | local_num)  # definition message header
        data.append(0)                  # reserved
        data.append(0)                  # little endian architecture
        data += struct.pack('<H', global_mesg_num)
        data.append(len(fields))
        for field_def_num, size, base_type in fields:
            data.append(field_def_num)
            data.append(size)
            data.append(base_type)
        self.definitions[local_num] = fields
        return bytes(data)

    def _write_data(self, local_num: int, values: List) -> bytes:
        """Write a data message."""
        fields = self.definitions[local_num]
        data = bytearray()
        data.append(local_num)  # data message header
        for (field_def_num, size, base_type), value in zip(fields, values):
            if base_type == BASE_STRING:
                encoded = (value or '').encode('utf-8')[:size-1] + b'\x00'
                encoded = encoded.ljust(size, b'\x00')
                data += encoded
            elif size == 1:
                data.append(value if value is not None else 0xFF)
            elif size == 2:
                data += struct.pack('<H', value if value is not None else 0xFFFF)
            elif size == 4:
                data += struct.pack('<I', value if value is not None else 0xFFFFFFFF)
        return bytes(data)

    def add(self, definition: bytes, data: bytes):
        self.records += definition
        self.records += data

    def build(self) -> bytes:
        """Assemble the complete FIT file with header and CRC."""
        data_size = len(self.records)

        # File header (14 bytes)
        header = bytearray()
        header.append(14)          # header size
        header.append(0x10)        # protocol version
        header += struct.pack('<H', 2132)  # profile version
        header += struct.pack('<I', data_size)
        header += b'.FIT'
        header_crc = crc16(bytes(header))
        header += struct.pack('<H', header_crc)

        body = bytes(header) + bytes(self.records)
        body_crc = crc16(bytes(self.records))
        return body + struct.pack('<H', body_crc)


def generate_workout_fit(workout) -> bytes:
    """
    Generate a FIT file for a PlannedWorkout.
    Returns raw bytes of the .fit file.
    """
    writer = FitWriter()
    now_fit = to_fit_time(datetime.now())
    workout_name = (workout.title or 'Workout')[:16]  # FIT string field limit

    # ── file_id message (local 0) ──────────────────────────────────────────
    defn = writer._write_definition(0, MESG_FILE_ID, [
        (0, 1, BASE_ENUM),     # type: 5 = workout
        (1, 2, BASE_UINT16),   # manufacturer: 1 = Garmin
        (2, 2, BASE_UINT16),   # product
        (4, 4, BASE_UINT32),   # time_created
    ])
    data = writer._write_data(0, [5, 1, 0, now_fit])
    writer.add(defn, data)

    # ── workout message (local 1) ──────────────────────────────────────────
    intervals = workout.intervals or []
    num_steps = _count_steps(intervals)

    defn = writer._write_definition(1, MESG_WORKOUT, [
        (4, 1, BASE_ENUM),     # sport (1 byte enum)
        (5, 2, BASE_UINT16),   # num_valid_steps
        (8, 16, BASE_STRING),  # wkt_name (max 16 chars)
    ])
    data = writer._write_data(1, [SPORT_CYCLING, num_steps, workout_name])
    writer.add(defn, data)

    # ── workout_step messages (local 2) ────────────────────────────────────
    defn = writer._write_definition(2, MESG_WORKOUT_STEP, [
        (0, 2, BASE_UINT16),   # message_index
        (1, 16, BASE_STRING),  # wkt_step_name
        (2, 1, BASE_ENUM),     # duration_type
        (3, 4, BASE_UINT32),   # duration_value (ms)
        (4, 1, BASE_ENUM),     # target_type
        (5, 4, BASE_UINT32),   # target_value
        (6, 4, BASE_UINT32),   # custom_target_value_low (watts)
        (7, 4, BASE_UINT32),   # custom_target_value_high (watts)
        (11, 1, BASE_ENUM),    # intensity
    ])

    step_index = 0
    if not intervals:
        # Simple single-step workout
        duration_s = (workout.target_duration_minutes or 60) * 60
        data = writer._write_data(2, [
            step_index, 'Ride',
            DURATION_TIME, duration_s * 1000,
            TARGET_OPEN, 0, 0, 0,
            INTENSITY_ACTIVE,
        ])
        writer.add(defn, data)
    else:
        for interval in intervals:
            steps = _interval_to_steps(interval, step_index)
            for step in steps:
                data = writer._write_data(2, [
                    step['index'], step['name'],
                    step['duration_type'], step['duration_value'],
                    step['target_type'], step['target_value'],
                    step['target_low'], step['target_high'],
                    step['intensity'],
                ])
                writer.add(defn, data)
                step_index = step['index'] + 1

    return writer.build()


def _count_steps(intervals: List[Dict]) -> int:
    """Count total workout steps including repeats."""
    if not intervals:
        return 1
    count = 0
    for interval in intervals:
        repeats = interval.get('repeats', 1)
        has_rest = interval.get('rest_seconds', 0) > 0
        if repeats > 1:
            count += repeats * (2 if has_rest else 1)
        else:
            count += 1
    return count


def _interval_to_steps(interval: Dict, start_index: int) -> List[Dict]:
    """Convert an interval definition to FIT workout steps."""
    steps = []
    itype = interval.get('type', 'work')
    duration_s = interval.get('duration_seconds', 300)
    repeats = interval.get('repeats', 1)
    rest_s = interval.get('rest_seconds', 0)
    power_low = interval.get('power_low')
    power_high = interval.get('power_high')

    has_target = power_low is not None
    target_type = TARGET_POWER if has_target else TARGET_OPEN
    target_value = 0
    t_low = int(power_low) if power_low else 0
    t_high = int(power_high) if power_high else 0

    intensity_map = {
        'work': INTENSITY_ACTIVE,
        'recovery': INTENSITY_REST,
        'warmup': INTENSITY_WARMUP,
        'cooldown': INTENSITY_COOLDOWN,
    }
    intensity = intensity_map.get(itype, INTENSITY_ACTIVE)

    idx = start_index
    for rep in range(repeats):
        name = f'Interval {rep+1}' if repeats > 1 else itype.capitalize()
        steps.append({
            'index': idx,
            'name': name[:16],
            'duration_type': DURATION_TIME,
            'duration_value': duration_s * 1000,  # milliseconds
            'target_type': target_type,
            'target_value': target_value,
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
                'duration_value': rest_s * 1000,
                'target_type': TARGET_OPEN,
                'target_value': 0,
                'target_low': 0,
                'target_high': 0,
                'intensity': INTENSITY_REST,
            })
            idx += 1

    return steps
