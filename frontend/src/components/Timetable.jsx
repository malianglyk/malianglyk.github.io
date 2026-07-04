import { useState } from 'react';
import { generateTimetable } from '../api';

export default function Timetable() {
  const [slots, setSlots] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const data = await generateTimetable();
      setSlots(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ marginBottom: 0 }}>🕐 Optimized Daily Timetable</h2>
          <button className="btn btn-accent" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Generating…' : '✨ Generate Timetable'}
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginTop: 4 }}>
          Tasks are scheduled by priority &amp; deadline. Harder tasks go in the morning. Includes breaks.
        </p>
      </div>

      <div className="card">
        {!slots ? (
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>No timetable yet.<br />Add some tasks and click <strong>Generate Timetable</strong> above.</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>Add tasks first, then generate a timetable.</p>
          </div>
        ) : (
          <div className="timetable">
            {slots.map((s, i) => {
              let slotClass = 'study-medium';
              if (s.is_break) slotClass = 'break';
              else if (s.priority === 'high') slotClass = 'study-high';
              else if (s.priority === 'low') slotClass = 'study-low';

              return (
                <div className={`time-slot ${slotClass}`} key={i}>
                  <span className="time-label">{s.start_time} – {s.end_time}</span>
                  {s.is_break ? (
                    <>
                      <div className="slot-subject">{s.name}</div>
                      <div className="slot-desc">{s.duration} min — stretch, hydrate, rest your eyes</div>
                    </>
                  ) : (
                    <>
                      <div className="slot-subject">{s.name}</div>
                      <div className="slot-desc">
                        {s.category} &middot; {s.duration} min &middot; {s.priority?.toUpperCase()} priority
                        {s.deadline ? ` · 📅 Due: ${s.deadline}` : ''}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
