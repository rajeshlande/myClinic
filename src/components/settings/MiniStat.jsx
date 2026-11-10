/**
 * The small stat tile the sync and about tabs both show.
 */

export default function MiniStat({ label, value, tone = 'neutral' }) {
  return (
    <div className={`card pad sync-stat ${tone}`} style={{ padding: 11, boxShadow: 'none' }}>
      <span className="tiny muted">{label}</span>
      <div className="small strong" style={{ marginTop: 3 }}>{value}</div>
    </div>
  );
}
