"""
AI Coach service using Claude API.
Generates:
  1. Global training plan (phased, week by week) from goal + weekly hours
  2. Detailed weekly workout plan with per-day context (commutes, indoor/outdoor, time)
"""
import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict

from anthropic import Anthropic
from ..services.training_science import get_power_zones

logger = logging.getLogger(__name__)

GLOBAL_PLAN_SCHEMA = """
{
  "phases": [
    {
      "name": "Base",
      "weeks": [
        {
          "week_number": 1,
          "week_start": "YYYY-MM-DD",
          "phase": "Base",
          "target_hours": 8.0,
          "target_tss": 420,
          "description": "One line description of what this week focuses on"
        }
      ]
    }
  ]
}
"""

WORKOUT_SCHEMA = """
{
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "title": "Short workout title",
      "description": "Coach description based on intervals[] — purpose + cadence cues if used",
      "engagement_notes": "optional — which engagement pattern was used and why",
      "workout_type": "endurance|threshold|vo2max|recovery|race",
      "target_tss": 75,
      "target_duration_minutes": 90,
      "target_if": 0.75,
      "indoor": false,
      "zone_seconds": {"Z1": 0, "Z2": 0, "Z3": 0, "Z4": 0, "Z5": 0},
      "intervals": [
        {
          "type": "warmup|work|recovery|cooldown",
          "duration_seconds": 900,
          "repeats": 1,
          "rest_seconds": 0,
          "power_low": 140,
          "power_high": 180,
          "steps": []
        }
      ]
    }
  ]
}
"""







class AICoachService:
    def __init__(self, api_key: str):
        self.client = Anthropic(api_key=api_key)

    async def generate_global_plan(
        self,
        goal,
        weekly_hours: float,
        current_ctl: float,
        ftp: float,
        actual_last_weeks: List[Dict] = None,  # recent actual TSS per week
    ) -> Optional[Dict]:
        """
        Generate a phased global training plan from today to event date.
        Returns week-by-week structure with phase, target hours, TSS, description.
        """
        weeks_to_event = max(1, (goal.event_date - datetime.now()).days // 7)
        today = datetime.now().strftime("%Y-%m-%d")

        # Build week list
        week_starts = []
        for i in range(weeks_to_event):
            week_starts.append((datetime.now() + timedelta(weeks=i)).strftime("%Y-%m-%d"))

        recent_summary = ""
        if actual_last_weeks:
            lines = [f"- Week of {w['week']}: {w['actual_hours']:.1f}h / {w['actual_tss']:.0f} TSS"
                     for w in actual_last_weeks[-4:]]
            recent_summary = "\n".join(lines)

        prompt = f"""You are an expert cycling coach. Create a periodized training plan.

## Athlete
- FTP: {ftp}W
- Current CTL (fitness): {current_ctl:.0f}
- Target weekly hours: {weekly_hours}h

## Goal
- Event: {goal.event_name}
- Date: {goal.event_date.strftime("%Y-%m-%d")} ({weeks_to_event} weeks away)
- Distance: {goal.event_distance_km or "unknown"}km
- Elevation: {goal.event_elevation_m or "unknown"}m
- Athlete goal: {goal.goal_description}

## Recent Actual Training
{recent_summary if recent_summary else "No recent data"}

## Week start dates to plan
{chr(10).join(f"- Week {i+1}: {d}" for i, d in enumerate(week_starts))}

## Instructions
- Divide the plan into phases: Base → Build → Peak → Taper
- Taper = final 1-2 weeks before event
- Target hours per week should vary ±20% around {weekly_hours}h with planned recovery weeks (every 4th week ~60% load)
- TSS = hours × IF² × 100, typical IF: endurance 0.65, threshold 0.85
- Keep descriptions to one concrete sentence per week (what to focus on, not generic advice)
- If recent training was below target, extend base phase slightly

Respond ONLY with valid JSON:
{GLOBAL_PLAN_SCHEMA}"""

        try:
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}],
            )
            text = message.content[0].text.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text.strip())
        except Exception as e:
            logger.error("Global plan generation failed: %s", e)
            return None

    async def generate_weekly_plan(
        self,
        goal,
        current_ctl: float,
        current_atl: float,
        current_tsb: float,
        ftp: float,
        recent_activities: List[Dict],
        week_start: datetime,
        day_settings: List[Dict],  # [{date, workout_minutes, indoor, commute_minutes}]
        global_plan_week: Dict = None,  # current week from global plan
    ) -> Optional[Dict]:
        """
        Generate a detailed weekly training plan.
        day_settings: one entry per training day with time, indoor flag, commute time.
        """
        zones = get_power_zones(ftp)
        zones_str = json.dumps([{"zone": z["zone"], "name": z["name"], "range": f"{z['min']}-{z['max']}W"} for z in zones], indent=2)
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

        # Build day context — explicit dates + commute TSS
        day_lines = []
        for ds in day_settings:
            date = datetime.fromisoformat(ds["date"])
            day_name = day_names[date.weekday()]
            workout_min = ds.get("workout_minutes", 0)
            indoor = ds.get("indoor", False)
            commute_min = ds.get("commute_minutes", 0)
            commute_tss = round((commute_min / 60) * (0.65 ** 2) * 100, 1) if commute_min else 0

            parts = [f"{day_name} {ds['date']}:"]
            if workout_min:
                parts.append(f"workout {workout_min}min ({'indoor' if indoor else 'outdoor'})")
            else:
                parts.append("rest day (no workout)")
            if commute_min:
                parts.append(f"commute {commute_min}min (~{commute_tss} TSS)")
            day_lines.append(" | ".join(parts))

        # Recent activity summary
        recent_summary = []
        for act in recent_activities[-10:]:
            recent_summary.append(
                f"- {act['start_date'][:10]}: {act['name']} "
                f"({act['sport_type']}, {round(act.get('distance', 0)/1000, 1)}km, "
                f"TSS: {act.get('tss', '?')})"
            )

        # Global plan context
        global_context = ""
        if global_plan_week:
            global_context = f"""
## This Week in the Global Plan
- Phase: {global_plan_week.get('phase', 'Build')}
- Target hours: {global_plan_week.get('target_hours', '?')}h
- Target TSS: {global_plan_week.get('target_tss', '?')}
- Focus: {global_plan_week.get('description', '')}
"""

        # Determine weeks to event and phase
        from datetime import date as date_type
        event_date = goal.event_date if hasattr(goal.event_date, 'year') else goal.event_date
        today = date_type.today()
        weeks_to_event = max(0, (event_date.toordinal() - today.toordinal()) // 7)
        phase = ("Base" if weeks_to_event > 8 else "Build" if weeks_to_event > 4 else "Peak" if weeks_to_event > 1 else "Taper")
        phase_dist = {"Base":"80% Z1-Z2 · 10% Z3 · 10% Z4","Build":"70% Z1-Z2 · 15% Z3-Z4 · 15% Z4-Z5","Peak":"65% Z1-Z2 · 20% Z3-Z4 · 15% Z5+","Taper":"80% Z1-Z2 · 20% Z3-Z4 · no Z5+"}[phase]
        tsb_rule = ("RECOVERY — Z1-Z2 only, no intervals" if current_tsb < -25 else "FATIGUED — max one quality session" if current_tsb < -10 else "BALANCED — follow phase" if current_tsb < 5 else "FRESH — one quality session ok")

        prompt = f"""You are a cycling coach. Science first, engagement second.

## Athlete
FTP {ftp}W | CTL {current_ctl:.1f} | ATL {current_atl:.1f} | TSB {current_tsb:.1f} | {weeks_to_event}w to event

## Phase: {phase} — {phase_dist}
## TSB: {tsb_rule}
{global_context}
## Zones
{zones_str}

## Schedule
{chr(10).join(day_lines)}

---

## Step 1 — Assign day intent
For each training day, assign: ENDURANCE / QUALITY / RECOVERY / TECHNIQUE

Rules:
- No two consecutive days with >15min at Z4+
- If commute_minutes > 0 same day: downgrade QUALITY → ENDURANCE or TECHNIQUE
- TSB < -25: all days RECOVERY or ENDURANCE only
- Taper: no QUALITY in final 3 days

## Step 2 — Design intervals[] for each day

### Indoor rules (indoor=true)
- Break work blocks ≤12min unless threshold+
- No steady Z2 longer than 25min without variation
- Use at least one of: power ramp (increasing steps), over-unders, neuromuscular spins, terrain sim, or split the block into shorter repeats

### Allowed engagement patterns (1-2x per week, scientifically valid)
IMPORTANT: Every pattern below MUST be encoded as discrete steps in intervals[]. Never describe a pattern in text without encoding it.

Encodable patterns — use these:
- Neuromuscular spins: 6-8 separate work steps of 10s@Z6 each, with 50s@Z1 recovery between. Encode each 10s burst as its own step.
- Low-cadence strength: 3-5 repeats of 6min@Z3-Z4. Mention "55-65rpm" in description — no cadence in steps (Garmin doesn't enforce cadence).
- Over-unders: strictly alternate 2min@95%FTP steps with 1min@105%FTP steps in a steps[] array (Build/Peak only).
- Terrain sim: strictly alternate 4min@Z3 steps with 3min@Z2-low-cadence steps in a steps[] array.
- Power ramp: increasing power steps e.g. 5min@180W → 5min@190W → 5min@200W (separate blocks, not one flat block).

Do NOT use these (cannot be encoded in Garmin steps):
- Cadence ladders — cadence targets are not displayed on most Garmin devices
- Micro-shifts ±10W — too fine-grained, AI consistently fails to encode them

### Cadence cues (description only, not enforced by device)
- Z1-Z2: 85-95rpm | Sweetspot/threshold: 88-95rpm | VO2max: 90-100rpm
- Low-cadence strength: 50-65rpm seated | Sprint/punch: 105-115rpm

### Steps rule
When a block alternates intensities, list every sub-step in "steps". Sum must equal duration_seconds.
Example — 3x [2min@252-270W + 15sec@320W], 3min rest:
  {{"type":"work","repeats":3,"rest_seconds":180,"duration_seconds":495,"steps":[
    {{"duration_seconds":120,"power_low":252,"power_high":270}},
    {{"duration_seconds":15,"power_low":320,"power_high":320}},
    {{"duration_seconds":120,"power_low":252,"power_high":270}},
    {{"duration_seconds":15,"power_low":320,"power_high":320}},
    {{"duration_seconds":120,"power_low":252,"power_high":270}},
    {{"duration_seconds":15,"power_low":320,"power_high":320}},
    {{"duration_seconds":120,"power_low":252,"power_high":270}},
    {{"duration_seconds":15,"power_low":320,"power_high":320}}
  ]}}
For warmup/cooldown sub-elements: use separate consecutive blocks.

## Step 3 — Verify zone compliance
Compute zone_seconds per workout. Weekly totals must match phase: {phase_dist} (±10%).
Adjust if needed before writing description.

## Step 4 — Write description
- State the workout intent and training purpose
- Include cadence cues if an engagement pattern was used
- Direct coach language, no hype. Watts must match intervals[].
- Add "engagement_notes" field if an engagement pattern was used

Respond ONLY with valid JSON:
{WORKOUT_SCHEMA}"""

        try:
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}],
            )
            text = message.content[0].text.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            result = json.loads(text.strip())

            # Log and fix: ensure power_low/power_high exist on every interval
            for w in (result.get("workouts") or []):
                for iv in (w.get("intervals") or []):
                    # If AI used "power" instead of "power_low"/"power_high", fix it
                    if iv.get("power") and not iv.get("power_low"):
                        iv["power_low"] = iv["power"]
                        iv["power_high"] = iv["power"]
                    # If parent has no power but steps do, inherit from first step
                    if not iv.get("power_low") and iv.get("steps"):
                        first = next((s for s in iv["steps"] if s.get("power_low")), None)
                        if first:
                            iv["power_low"] = first["power_low"]
                            iv["power_high"] = first.get("power_high", first["power_low"])
                    logger.info(
                        "AI interval: type=%s dur=%s repeats=%s power=%s-%s has_steps=%s",
                        iv.get("type"), iv.get("duration_seconds"),
                        iv.get("repeats"), iv.get("power_low"), iv.get("power_high"),
                        bool(iv.get("steps"))
                    )
            return result
        except Exception as e:
            logger.error("Weekly plan generation failed: %s", e)
            return None

    async def generate_goal_summary(self, goal, ftp: float, ctl: float) -> Optional[str]:
        """Short periodization overview when a goal is created."""
        weeks = max(1, (goal.event_date - datetime.now()).days // 7)
        prompt = f"""Cycling coach summary for: {goal.event_name} in {weeks} weeks.
Athlete FTP: {ftp}W, CTL: {ctl:.0f}, goal: {goal.goal_description}.
Distance: {goal.event_distance_km}km, elevation: {goal.event_elevation_m}m.
Write 2-3 sentences on recommended training phases. Be specific and concise."""
        try:
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            return message.content[0].text.strip()
        except Exception as e:
            logger.error("Goal summary failed: %s", e)
            return None
