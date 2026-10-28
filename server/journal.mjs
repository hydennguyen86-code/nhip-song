/**
 * Journal tags and descriptive next-day correlations.
 *
 * The insight is deliberately descriptive: "on days after this tag, the
 * recovery index averaged X points lower among N entries". It is not a causal
 * claim, and it is hidden until there are at least 3 tagged days.
 */

export const JOURNAL_TAGS = Object.freeze([
  { id: 'alcohol', label: 'Rượu' },
  { id: 'late_caffeine', label: 'Cà phê sau 14h' },
  { id: 'late_workout', label: 'Tập sau 19h' },
  { id: 'stress', label: 'Căng thẳng' },
  { id: 'late_meal', label: 'Ăn muộn' },
  { id: 'unwell', label: 'Ốm / không khoẻ' },
]);

const BY_ID = new Map(JOURNAL_TAGS.map((t) => [t.id, t]));

export function normalizeTags(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(String).filter((id) => BY_ID.has(id)))].slice(0, JOURNAL_TAGS.length);
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * @param checkins rows with .local_date and .tags (array of ids)
 * @param history [{date, score}] recovery history, oldest → newest
 */
export function buildJournalInsights({ checkins, history }) {
  const scoreByDate = new Map(history.filter((h) => h.score != null).map((h) => [h.date, h.score]));
  const allScores = [...scoreByDate.values()];
  const taggedDates = new Set();
  const byTag = new Map();

  for (const c of checkins) {
    const tags = Array.isArray(c.tags) ? c.tags : [];
    if (!tags.length) continue;
    const next = addDays(String(c.local_date).slice(0, 10), 1);
    const score = scoreByDate.get(next);
    if (score == null) continue;
    taggedDates.add(next);
    for (const id of tags) {
      if (!byTag.has(id)) byTag.set(id, []);
      byTag.get(id).push(score);
    }
  }

  const untagged = [...scoreByDate.entries()].filter(([d]) => !taggedDates.has(d)).map(([, s]) => s);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const insights = [];
  const pending = [];
  for (const tag of JOURNAL_TAGS) {
    const scores = byTag.get(tag.id) || [];
    if (scores.length < 3 || untagged.length < 3) {
      if (scores.length > 0 || checkins.some((c) => (c.tags || []).includes(tag.id))) {
        pending.push({ id: tag.id, label: tag.label, days: scores.length, need: 3 });
      }
      continue;
    }
    const a = mean(scores);
    const b = mean(untagged);
    insights.push({
      id: tag.id,
      label: tag.label,
      days: scores.length,
      avgTagged: Math.round(a),
      avgOther: Math.round(b),
      delta: Math.round(a - b),
    });
  }

  insights.sort((a, b) => a.delta - b.delta);
  const baseline = allScores.length ? Math.round(mean(allScores)) : null;
  return {
    insights,
    pending,
    baseline,
    sampleDays: allScores.length,
    note: 'Tương quan mô tả giữa thói quen và chỉ số hồi phục sáng hôm sau. Không phải quan hệ nhân quả.',
  };
}
