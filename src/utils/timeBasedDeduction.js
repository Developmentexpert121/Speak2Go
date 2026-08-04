/**
 * Spec section 4.C — applied EXCLUSIVELY to Part B / Project, question 2,
 * in COBE 4 & 5 point levels. Deducts from ALL criteria (i.e. the raw_score
 * as a whole), based on total spoken duration.
 */
function computeTimeBasedDeduction(durationSeconds) {
  if (durationSeconds > 120) {
    // Spec table only defines a LOWER bound (1:00-2:00 = full credit).
    // Nothing in the spec penalizes running long, so treat anything over
    // 2:00 the same as the 1:00-2:00 band: full credit. Flag to client if
    // there should actually be an upper-bound rule.
    return { deductionPct: 0, band: "over 2:00 (treated as full credit)" };
  }
  if (durationSeconds >= 60) {
    return { deductionPct: 0, band: "1:00-2:00" };
  }
  if (durationSeconds >= 40) {
    return { deductionPct: 20, band: "0:40-0:59" };
  }
  if (durationSeconds >= 20) {
    return { deductionPct: 50, band: "0:20-0:39" };
  }
  // below 0:20 — note this overlaps with the general "<20s = 0 for entire
  // section" rule already in applyPenalties.js. Confirm with the client
  // which rule should win; this module reports 100% either way so the
  // outcome is the same regardless of which path applies it.
  return { deductionPct: 100, band: "below 0:20" };
}

module.exports = { computeTimeBasedDeduction };
