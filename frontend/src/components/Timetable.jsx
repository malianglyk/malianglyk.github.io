import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  generateTimetable,
  reorderTimetable,
  getConstraints,
  updateConstraints,
  getModelStats,
  trainModel,
} from '../api';

/* ==========================================================================
   Sortable Slot (draggable study slot)
   ========================================================================== */
function SortableSlot({ slot, id }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  let slotClass = 'study-medium';
  if (slot.priority === 'high') slotClass = 'study-high';
  else if (slot.priority === 'low') slotClass = 'study-low';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`time-slot ${slotClass}${isDragging ? ' dragging' : ''}`}
    >
      <span className="time-label">{slot.start_time} – {slot.end_time}</span>
      <div className="slot-subject">
        <span className="drag-handle" {...attributes} {...listeners}>
          ⠿
        </span>
        {slot.name}
        {slot.is_paper_based && <span className="paper-badge">📝 Paper</span>}
      </div>
      <div className="slot-desc">
        {slot.category} &middot; {slot.duration} min
        &middot; <span className="difficulty-stars">{'⭐'.repeat(slot.difficulty || 3)}</span>
        {slot.priority && ` · ${slot.priority.toUpperCase()} priority`}
        {slot.deadline ? ` · 📅 Due: ${slot.deadline}` : ''}
      </div>
    </div>
  );
}

/* ==========================================================================
   Static Break Slot (not draggable)
   ========================================================================== */
function BreakSlot({ slot }) {
  return (
    <div className="time-slot break">
      <span className="time-label">{slot.start_time} – {slot.end_time}</span>
      <div className="slot-subject">{slot.name}</div>
      <div className="slot-desc">{slot.duration} min — stretch, hydrate, rest your eyes</div>
    </div>
  );
}

/* ==========================================================================
   Main Timetable Component
   ========================================================================== */
export default function Timetable() {
  const [slots, setSlots] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConstraints, setShowConstraints] = useState(false);
  const [trainMsg, setTrainMsg] = useState('');

  const [constraints, setConstraints] = useState({
    wake_up_time: '07:00',
    sleep_time: '22:00',
    school_start: '08:00',
    school_end: '15:00',
  });
  const [modelStats, setModelStats] = useState(null);
  const [dirty, setDirty] = useState(false); // local reorder before commit

  // Load constraints & stats on mount
  useEffect(() => {
    getConstraints()
      .then(setConstraints)
      .catch(() => {});
    getModelStats()
      .then(setModelStats)
      .catch(() => {});
  }, []);

  // Refresh stats
  const refreshStats = useCallback(() => {
    getModelStats().then(setModelStats).catch(() => {});
  }, []);

  // ---- Generate ----
  async function handleGenerate() {
    setLoading(true);
    try {
      const data = await generateTimetable();
      setSlots(data);
      setDirty(false);
      refreshStats();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // ---- Save constraints ----
  async function handleSaveConstraints() {
    try {
      const updated = await updateConstraints(constraints);
      setConstraints(updated);
    } catch (err) {
      console.error(err);
    }
  }

  // ---- Train model ----
  async function handleTrain() {
    setTrainMsg('Training…');
    try {
      const stats = await trainModel();
      setModelStats(stats);
      setTrainMsg(`Done! Loss: ${stats.training_loss?.toFixed(4)}, pairs: ${stats.num_pairs_used}`);
      setTimeout(() => setTrainMsg(''), 4000);
    } catch (err) {
      setTrainMsg('Training failed');
      console.error(err);
    }
  }

  // ---- Drag-and-drop ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Separate study slots (draggable) from break slots (static)
  const studySlots = (slots || []).filter((s) => !s.is_break);
  const studyIds = studySlots.map((s) => s.task_id);

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = studyIds.indexOf(active.id);
    const newIndex = studyIds.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder study slots
    const reordered = arrayMove(studySlots, oldIndex, newIndex);

    // Rebuild full slots list with breaks in their original positions
    const newSlots = [];
    let studyIdx = 0;
    for (const slot of slots) {
      if (slot.is_break) {
        newSlots.push(slot);
      } else {
        newSlots.push(reordered[studyIdx]);
        studyIdx++;
      }
    }
    setSlots(newSlots);
    setDirty(true);

    // Persist to backend
    const orderedIds = reordered.map((s) => s.task_id);
    reorderTimetable(orderedIds)
      .then((data) => {
        setSlots(data);
        setDirty(false);
        refreshStats();
      })
      .catch((err) => console.error('Reorder failed:', err));
  }

  // ---- Render ----
  const isDefaultModel = !modelStats || modelStats.num_comparisons < 5;

  return (
    <>
      {/* ================================================================
          Controls Bar
          ================================================================ */}
      <div className="card">
        <div className="timetable-controls">
          <h2 style={{ marginBottom: 0 }}>🕐 Smart Timetable</h2>
          <div className="controls-buttons">
            <button className="btn btn-accent" onClick={handleGenerate} disabled={loading}>
              {loading ? 'Generating…' : '✨ Generate Timetable'}
            </button>
            <button
              className="btn btn-outline"
              onClick={() => setShowConstraints(!showConstraints)}
            >
              ⚙️ Settings
            </button>
          </div>
        </div>
        <div className="controls-info">
          <span className={`model-badge ${isDefaultModel ? '' : 'trained'}`}>
            {isDefaultModel ? '🧠 Model: Default' : `🧠 Model: Trained (${modelStats?.num_comparisons || 0} comparisons)`}
          </span>
          {dirty && <span className="dirty-indicator">Reordering…</span>}
        </div>
      </div>

      {/* ================================================================
          Constraints Panel (collapsible)
          ================================================================ */}
      {showConstraints && (
        <div className="constraints-panel card">
          <h3>⚙️ Schedule Constraints</h3>
          <p className="constraints-desc">
            Set your daily routine so the timetable only uses your available time.
          </p>
          <div className="time-inputs">
            <div className="form-group">
              <label>🌅 Wake Up Time</label>
              <input
                type="time"
                value={constraints.wake_up_time}
                onChange={(e) => setConstraints({ ...constraints, wake_up_time: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>🏫 School Starts</label>
              <input
                type="time"
                value={constraints.school_start}
                onChange={(e) => setConstraints({ ...constraints, school_start: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>🏫 School Ends</label>
              <input
                type="time"
                value={constraints.school_end}
                onChange={(e) => setConstraints({ ...constraints, school_end: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>🌙 Sleep Time</label>
              <input
                type="time"
                value={constraints.sleep_time}
                onChange={(e) => setConstraints({ ...constraints, sleep_time: e.target.value })}
              />
            </div>
          </div>
          <div className="constraints-actions">
            <button className="btn btn-primary" onClick={handleSaveConstraints}>
              💾 Save Constraints
            </button>
            <button className="btn btn-success" onClick={handleTrain}>
              🎓 Train Model
            </button>
          </div>
          {trainMsg && <p className="train-msg">{trainMsg}</p>}

          {/* Model Stats */}
          {modelStats && (
            <div className="model-stats">
              <h4>📊 Model Stats</h4>
              <div className="stats-mini">
                <div className="stat-mini">
                  <span className="stat-mini-val">{modelStats.num_comparisons}</span>
                  <span className="stat-mini-label">Comparisons</span>
                </div>
                <div className="stat-mini">
                  <span className="stat-mini-val">
                    {modelStats.training_loss != null ? modelStats.training_loss.toFixed(4) : '—'}
                  </span>
                  <span className="stat-mini-label">Loss</span>
                </div>
                <div className="stat-mini">
                  <span className="stat-mini-val">
                    {modelStats.last_trained_at
                      ? new Date(modelStats.last_trained_at).toLocaleDateString()
                      : 'Never'}
                  </span>
                  <span className="stat-mini-label">Last Trained</span>
                </div>
              </div>
              {modelStats.top_features && modelStats.top_features.length > 0 && (
                <div className="top-features">
                  <span className="top-features-label">Top signals:</span>
                  {modelStats.top_features.slice(0, 5).map(([label, val]) => (
                    <span key={label} className={`feature-chip ${val > 0 ? 'pos' : 'neg'}`}>
                      {label.replace('subject_', '')}: {val > 0 ? '+' : ''}{val.toFixed(3)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================
          Timetable Display
          ================================================================ */}
      <div className="card">
        {!slots ? (
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>
              No timetable yet.
              <br />
              Add some tasks and click <strong>Generate Timetable</strong> above.
            </p>
          </div>
        ) : slots.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>Add tasks first, then generate a timetable.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={studyIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="timetable">
                {slots.map((s, i) =>
                  s.is_break ? (
                    <BreakSlot slot={s} key={`break-${i}`} />
                  ) : (
                    <SortableSlot
                      slot={s}
                      id={s.task_id}
                      key={s.task_id}
                    />
                  )
                )}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}
