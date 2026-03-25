"""
AI-powered workout planning using the Anthropic Claude API.
Generates structured weekly workouts based on:
- Current fitness (CTL, ATL, TSB)
- FTP and power zones
- Training goal and target event
- Recent training history
"""
import anthropic
import json
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from ..models.database import TrainingGoal, PlannedWorkout
from .training_science import get_power_zones

logger = logging.getLogger(__name__)


WORKOUT_SCHEMA = """
{
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "title": "Workout title",
      "description": "Detailed description of the workout and its purpose",
      "workout_type": "endurance|tempo|threshold|vo2max|sprint|recovery|rest",
      "target_tss": 80,
      "target_duration_minutes": 90,
      "target_if": 0.72,
      "intervals": [
        {
          "type": "warmup|work|recovery|cooldown",
          "duration_seconds": 600,
          "repeats": 1,
          "power_low": 180,
          "power_high": 210,
          "rest_seconds": 0,
          "description": "Warmup at zone 2"
        }
      ]
    }
  ],
  "week_summary": "Brief coaching summary of the week's training plan",
  "weekly_tss": 350
}
"""


class AICoachService:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)

    async def generate_weekly_plan(
        self,
        goal: TrainingGoal,
        current_ctl: float,
        current_atl: float,
        current_tsb: float,
        ftp: float,
        recent_activities: List[Dict],
        week_start: datetime,
        available_days: List[int] = None,  # 0=Mon, 6=Sun
    ) -> Optional[Dict]:
        """
        Generate a structured weekly training plan using Claude.
        """
        if available_days is None:
            available_days = [1, 2, 3, 4, 6]  # Tue-Thu + Sat default

        zones = get_power_zones(ftp)
        days_to_event = (goal.event_date - week_start).days
        week_start_str = week_start.strftime("%Y-%m-%d")

        # Build recent activity summary
        recent_summary = []
        for act in recent_activities[-14:]:  # last 2 weeks
            recent_summary.append(
                f"- {act['start_date'][:10]}: {act['name']} "
                f"({act['sport_type']}, {round(act.get('distance', 0)/1000, 1)}km, "
                f"TSS: {act.get('tss', '?')})"
            )

        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        available_day_names = [day_names[d] for d in available_days]

        # Compute explicit date for each available day so AI doesn't have to calculate
        available_day_dates = []
        for d in sorted(available_days):
            day_date = week_start + timedelta(days=d)
            available_day_dates.append(f"{day_names[d]} {day_date.strftime('%Y-%m-%d')}")

        prompt = f"""You are an expert cycling coach creating a structured training plan.

## Athlete Profile
- FTP: {ftp}W
- Current Fitness (CTL): {current_ctl:.1f}
- Current Fatigue (ATL): {current_atl:.1f}  
- Current Form (TSB): {current_tsb:.1f}

## Power Zones
{json.dumps([{"zone": z["zone"], "name": z["name"], "range": f"{z['min']}-{z['max']}W"} for z in zones], indent=2)}

## Training Goal
- Event: {goal.event_name}
- Date: {goal.event_date.strftime("%Y-%m-%d")} ({days_to_event} days away)
- Distance: {goal.event_distance_km or "unknown"}km
- Elevation: {goal.event_elevation_m or "unknown"}m
- Athlete goal: {goal.goal_description}

## Recent Training (last 2 weeks)
{chr(10).join(recent_summary) if recent_summary else "No recent activities"}

## Available Training Days (use EXACTLY these dates)
{chr(10).join(f"- {d}" for d in available_day_dates)}

## Instructions
Create a weekly training plan using ONLY the dates listed above.
- Use the exact dates provided — do not use any other dates
- Balance stress and recovery based on current TSB ({current_tsb:.1f})
- TSB < -20: reduce intensity, TSB > +20: can push harder  
- Progress toward the event ({days_to_event} days away)
- Include warmup and cooldown in all interval sessions
- All power targets must be in watts (use FTP={ftp}W as reference)
- For endurance rides use zone 2 ({zones[1]['min']}-{zones[1]['max']}W)
- Be specific about intervals: duration, power targets, repeats, rest

Respond ONLY with valid JSON matching this exact schema:
{WORKOUT_SCHEMA}"""

        try:
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = message.content[0].text
            # Strip any markdown fences
            response_text = response_text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1]
                response_text = response_text.rsplit("```", 1)[0]

            plan = json.loads(response_text)
            logger.info("Generated weekly plan with %d workouts", len(plan.get("workouts", [])))
            return plan

        except json.JSONDecodeError as e:
            logger.error("Failed to parse AI workout plan JSON: %s", e)
            return None
        except Exception as e:
            logger.error("AI workout generation failed: %s", e)
            return None

    async def suggest_goal_plan(
        self,
        goal: TrainingGoal,
        current_ctl: float,
        ftp: float,
    ) -> Optional[str]:
        """
        Generate a high-level periodization plan summary for a training goal.
        """
        days_to_event = (goal.event_date - datetime.now()).days

        prompt = f"""You are an expert cycling coach. Provide a concise periodization overview 
for an athlete preparing for {goal.event_name} ({goal.event_distance_km}km) in {days_to_event} days.

Athlete: FTP={ftp}W, Current CTL={current_ctl:.0f}
Goal: {goal.goal_description}

Outline the training phases (base, build, peak, taper) with approximate durations and focus areas.
Keep response under 300 words. Be specific and actionable."""

        try:
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            return message.content[0].text
        except Exception as e:
            logger.error("Goal plan generation failed: %s", e)
            return None
