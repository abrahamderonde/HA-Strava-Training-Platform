# TrainIQ — Enhancement Wishlist

---

## 1. Eddington map upgrades

**Effort:** Low
**Status:** implemented 11-06 - testing
**Notes:**: Count logic tweak

**progress bar**
- show progress from last mile stone. So if you are at 90 and you need 3 rides of 91+ km to reach 91, the progress is 0/3 1/3 2/3 etc.

---

## 2. Dashboard tooltip with activity name

**Effort:** low
**Status:** implemented 11-06 - testing
**Notes:**: Just add to existing PMC tooltip

New: When you go over the graph, you see the summary of that day.. TSS etc. Would be nice to also see the name of the activity of that day. If there are multiple it is sufficient to show only the activity with the largest TSS. 

---

## 3. Merge dashboard

**Effort:** Medium
**Status:** implemented 11-06 - testing
**Notes:**: New page layout

Merge with PMC. Little added value of PMC. 
Requirements.
Show graph as in PMC. This one is more clear
Show selectors for selected time

---

## 4. FTP Testing

**Effort:** low
**Status:** Open

**FTP testing**
- I will give you the template workout with steps
- recommendate to do every 2 months
- Show on planning page in red that FTP test is due
- Make indoor/outdoor toggle a indoor/outdoor/FTP selector

---

## 5. PMC upgrades

**Effort:** low
**Status:** Pending
**Notes** Math is straightforward, UI needs work

**Show planning / future**
- show future PMC curve based on detailed and global workout planning

---

## 6. Power curve 'ideal' overlay

**Effort:** Medium / high
**Status:** Open
**Notes:** CP model already there, needs curve math

Add 'ideal' curve, so you have an impression what 2min, or 5min efforts you could do, based on your power curve.
  
---

## 7. Strava import cleanp

**Effort:** low
**Status:** Pending

Cleanup all buttons and settings on pages for strava imports. Maybe keep backend just in case. 

---

## 8. Hide historical Commute Generator from sidebar

**Effort:** Low
**Status:** Pending

Hide from side bar, only access page from setting page (add button?), as this is not in the daily workflow

---

## 9. Gui improvements for mobile

**Effort:** Medium - High
**Status:** Pending

**GUI improvements for mobile**
- On mobile the pages don't show up very nicely.
- Maybe the side bar can collapse or so

Investigate other options. 

---

## 10. Equipment / Gear Tracking

**Effort:** high
**Status:** Pending

Track bikes and components, log distance/hours per item, get alerts when service intervals are due.

**Requirements:**
- List of bikes synced from Strava gear (already in API response)
- Per-bike total distance and hours (auto-calculated from activities)
- Manual component log per bike:
  - Chain (replace every ~2,000–3,000 km)
  - Tyres front/rear
  - Bar tape
  - Brake pads
  - Cassette
  - Custom components
- Each component: install date, install distance/odometer, replacement interval (km or months)
- Dashboard alert when a component is approaching or past its service interval
- Activity → bike assignment (from Strava `gear_id`)

**Notes:**
- New DB table needed: `equipment` and `equipment_service_log`
- Strava `gear_id` is already stored on `Activity`

---

## Other (not so concrete) ideas

- Power plan generation (inspired on best bike split)

---

*Last updated: June 2026*
