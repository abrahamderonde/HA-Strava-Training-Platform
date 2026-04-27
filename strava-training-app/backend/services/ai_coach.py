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
      "title": "Workout title",
      "description": "Detailed description with specific intervals, power targets, cadence cues, race-inspired elements",
      "icu_description": "intervals.icu description language",
      "workout_type": "endurance|threshold|vo2max|recovery|race",
      "target_tss": 75,
      "target_duration_minutes": 90,
      "target_if": 0.75,
      "indoor": false,
      "intervals": [
        {
          "type": "work|recovery|warmup|cooldown",
          "duration_seconds": 720,
          "repeats": 3,
          "rest_seconds": 180,
          "power_low": 270,
          "power_high": 300,
          "description": "Interval cue",
          "steps": [
            {"duration_seconds": 120, "power_low": 252, "power_high": 270},
            {"duration_seconds": 15,  "power_low": 275, "power_high": 275}
          ]
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

        prompt = f"""You are an expert cycling coach. Create a detailed training plan for this specific week.

## Athlete
- FTP: {ftp}W
- Current Fitness (CTL): {current_ctl:.1f}
- Current Fatigue (ATL): {current_atl:.1f}
- Current Form (TSB): {current_tsb:.1f}
{global_context}
## Power Zones
{zones_str}

## Goal
- Event: {goal.event_name} on {goal.event_date.strftime("%Y-%m-%d")}
- Distance: {goal.event_distance_km or "?"}km
- Athlete goal: {goal.goal_description}

## Recent Training
{chr(10).join(recent_summary) if recent_summary else "No recent data"}

## This Week's Schedule (USE EXACTLY THESE DATES)
{chr(10).join(day_lines)}

## Workout Design Rules
- Only generate workouts on days that have workout_minutes > 0
- NEVER exceed the workout_minutes specified for each day — you may reduce if TSB < -25
- Factor in commute TSS when estimating daily total load
- TSB = {current_tsb:.1f}: {"reduce intensity, prioritize recovery" if current_tsb < -20 else "good form, can push hard" if current_tsb > 5 else "balanced, normal training"}
- Indoor workouts: can be more structured, complex intervals, higher intensity
- Outdoor workouts: terrain cues, surges on climbs, group ride dynamics

## Workout Style (IMPORTANT)
- NEVER use the pattern: warm-up → long steady block → cool-down
- Every workout MUST include at least 2 race-inspired or playful elements
- Include micro-variability: cadence changes, brief surges, terrain cues
- Write descriptions as a coach talking to an athlete — specific, energetic, concrete
- Example of good style: "3 sets of 12min sweetspot intervals. Every 4 minutes, throw in a 20sec punch at 120% FTP — stand up and attack it like you're going for the city limit sprint. Recover fully between sets."
- Include specific watt targets, cadence targets, and vivid cues in descriptions

## intervals[] field (IMPORTANT)
Each interval block represents one section of the workout. Use the "steps" sub-array whenever a block contains internal micro-surges or alternating intensities — this applies to warmup, cooldown, AND work intervals.

Example — 3x (8min sweetspot with 15sec surge every 2min, 3min rest):
  "type": "work", "repeats": 3, "rest_seconds": 180, "duration_seconds": 495,
  "steps": [
    {{"duration_seconds": 120, "power_low": 252, "power_high": 270}},
    {{"duration_seconds": 15,  "power_low": 275, "power_high": 275}},
    {{"duration_seconds": 120, "power_low": 252, "power_high": 270}},
    {{"duration_seconds": 15,  "power_low": 275, "power_high": 275}},
    {{"duration_seconds": 120, "power_low": 252, "power_high": 270}},
    {{"duration_seconds": 15,  "power_low": 275, "power_high": 275}},
    {{"duration_seconds": 120, "power_low": 252, "power_high": 270}},
    {{"duration_seconds": 15,  "power_low": 275, "power_high": 275}}
  ]

Example — 8min cooldown with 2x 30sec leg openers:
  "type": "cooldown", "repeats": 1, "duration_seconds": 480,
  "steps": [
    {{"duration_seconds": 210, "power_low": 120, "power_high": 150}},
    {{"duration_seconds": 30,  "power_low": 220, "power_high": 240}},
    {{"duration_seconds": 180, "power_low": 120, "power_high": 150}},
    {{"duration_seconds": 30,  "power_low": 220, "power_high": 240}},
    {{"duration_seconds": 30,  "power_low": 120, "power_high": 150}}
  ]

Rules:
- If a block has uniform intensity throughout, omit "steps" and use power_low/power_high directly
- If a block has ANY internal structure (surges, openers, build, fade), ALWAYS use "steps"
- duration_seconds on the parent must equal the sum of all steps durations exactly
- steps are repeated once per repeat (the "repeats" field wraps the whole steps block)


This field must be valid intervals.icu description language that EXACTLY matches the workout structure described in "description". Rules:
- Use "- Xm Y-ZW" for a step with watt range (e.g. "- 12m 250-290W")
- Use "- Xm Y%" for a step as FTP percentage (e.g. "- 15m 55%")
- Use "- Xs Y-ZW" for steps under 1 minute (e.g. "- 30s 440-500W")
- "Nx" on its own line means: repeat ALL the following "- " lines N times as one block
- The repeat block ends when there are no more indented "- " lines or a new non-indented line appears
- CRITICAL: if a set contains multiple sub-steps (e.g. 4x climbing with surges every 2min = 8 sub-steps per set), ALL sub-steps must be listed inside the repeat block
- Example for "4x 8min climbing with 15sec surge every 2min, 4min rest between sets":
  4x
  - 2m 252-290W
  - 15s 320-340W
  - 2m 252-290W
  - 15s 320-340W
  - 2m 252-290W
  - 15s 320-340W
  - 2m 252-290W
  - 15s 320-340W
  - 4m 50%
- Do NOT use nested Nx blocks — flatten all repeats into explicit steps
- The total time of all steps must equal target_duration_minutes

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
            return json.loads(text.strip())
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
