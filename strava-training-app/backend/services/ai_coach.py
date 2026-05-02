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
      "description": "Coach-style description derived strictly from the intervals[] you designed.",
      "workout_type": "endurance|threshold|vo2max|recovery|race",
      "target_tss": 75,
      "target_duration_minutes": 90,
      "target_if": 0.75,
      "indoor": false,
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

        prompt = f"""You are an expert cycling coach. Generate a structured training week as JSON.

## Athlete
- FTP: {ftp}W
- CTL: {current_ctl:.1f} | ATL: {current_atl:.1f} | TSB: {current_tsb:.1f}
{global_context}
## Power Zones
{zones_str}

## Goal
- Event: {goal.event_name} on {goal.event_date.strftime("%Y-%m-%d")}
- Distance: {goal.event_distance_km or "?"}km, Elevation: {goal.event_elevation_m or "?"}m
- Athlete goal: {goal.goal_description}

## This Week's Schedule
{chr(10).join(day_lines)}

## Rules
- Only generate workouts on days with workout_minutes > 0
- Never exceed workout_minutes for each day
- TSB={current_tsb:.1f}: {"prioritize recovery" if current_tsb < -20 else "can push hard" if current_tsb > 5 else "normal training"}
- Indoor: more structured intervals. Outdoor: terrain cues.

## How to build each workout

### Step 1 — Design the intervals[] array first. This is what goes to Garmin.
Each element is one block:
- "type": warmup / work / recovery / cooldown
- "duration_seconds": total seconds for this block
- "repeats": how many times to repeat (default 1)
- "rest_seconds": rest between repeats (0 if none)
- "power_low" / "power_high": watt targets
- "steps": sub-steps array — use this when a block has mixed intensities

STEPS RULE: When a block alternates between two intensities (e.g. 2min tempo + 15sec punch, repeated), list every sub-step explicitly in "steps". The sum of step durations must equal duration_seconds.

Example — 3x block of [2min@252-270W + 15sec@320W], 3min rest:
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

For warmup/cooldown with sub-elements (e.g. leg openers): use separate consecutive blocks instead of steps:
  [{{"type":"cooldown","duration_seconds":360,"power_low":120,"power_high":150}},
   {{"type":"work","repeats":2,"rest_seconds":30,"duration_seconds":30,"power_low":220,"power_high":240}},
   {{"type":"cooldown","duration_seconds":60,"power_low":100,"power_high":130}}]

### Step 2 — Write description STRICTLY based on the intervals[] you just built
- Describe exactly what is in intervals[], nothing more
- Include cadence cues where relevant (these don't change the structure)
- Vivid, coach-style language. No warmup→steady→cooldown template.
- Watt targets must match intervals[]

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

            # Log what the AI generated so we can debug step generation
            for w in (result.get("workouts") or []):
                for iv in (w.get("intervals") or []):
                    logger.info(
                        "AI interval: type=%s dur=%s repeats=%s has_steps=%s desc=%s",
                        iv.get("type"), iv.get("duration_seconds"),
                        iv.get("repeats"), bool(iv.get("steps")),
                        (iv.get("description") or "")[:80]
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
