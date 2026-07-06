import { useState, useEffect, useCallback, useRef } from 'react';
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
  deleteTask,
  getConstraints,
  updateConstraints,
  getModelStats,
  trainModel,
  updateSlots,
  deleteSlot,
  moveSlot,
} from '../api';

/* ==========================================================================
   Inline Editor for break start_time / duration
   ========================================================================== */
function InlineEdit({ value, onChange, type }) {
  if (type === 'time') {
    // Convert "7:00 AM" → "07:00" for time input
    let timeVal = value;
    try {
      const [time, ampm] = value.split(' ');
      const [h, m] = time.split(':');
      let hh = parseInt(h);
      if (ampm === 'PM' && hh !== 12) hh += 12;
      if (ampm === 'AM' && hh === 12) hh = 0;
      timeVal = `${String(hh).padStart(2, '0')}:${m}`;
    } catch { timeVal = '12:00'; }

    return (
      <input
        type="time"
        value={timeVal}
        onChange={(e) => onChange(e.target.value)}
        className="inline-edit-input"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 95, padding: '2px 4px', fontSize: '.78rem' }}
      />
    );
  }
  return (
    <input
      type="number"
      min={5}
      max={180}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value) || 10)}
      className="inline-edit-input"
      onClick={(e) => e.stopPropagation()}
      style={{ width: 55, padding: '2px 4px', fontSize: '.78rem' }}
    />
  );
}

/* ==========================================================================
   Table Row — handles ALL row types
   ========================================================================== */
function TableRow({ slot, id, isDragDisabled, onDelete, onDeleteSlot, onSlotEdit, onMoveSlot }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: isDragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // ── Day Header ──────────────────────────────────────────────────
  if (slot.is_header) {
    return (
      <tr ref={setNodeRef} style={style} className="timetable-row day-header">
        <td colSpan={7}>
          <strong>📅 {slot.day_label}</strong>
          {slot.date && <span className="day-date">({slot.date})</span>}
        </td>
      </tr>
    );
  }

  // ── School Block ────────────────────────────────────────────────
  if (slot.is_school) {
    return (
      <tr ref={setNodeRef} style={style} className="timetable-row school-block">
        <td className="td-time">{slot.start_time}</td>
        <td className="td-date"></td>
        <td colSpan={5} className="td-task">
          🏫 <strong>{slot.name}</strong> — {slot.duration}m
          <span style={{ fontSize: '.72rem', color: 'var(--danger)', marginLeft: 8, fontWeight: 600 }}>
            (NO tasks — school hours)
          </span>
        </td>
      </tr>
    );
  }

  // ── Meal Row (editable) ─────────────────────────────────────────
  if (slot.is_meal) {
    return (
      <tr ref={setNodeRef} style={style} className="timetable-row meal">
        <td className="td-time">
          <InlineEdit
            type="time"
            value={slot.start_time}
            onChange={(val) => onSlotEdit(slot.slot_id, 'start_time', val)}
          />
        </td>
        <td className="td-date"></td>
        <td className="td-task" colSpan={3}>
          🍽️ <strong>{slot.name}</strong> —{' '}
          <InlineEdit
            type="number"
            value={slot.duration}
            onChange={(val) => onSlotEdit(slot.slot_id, 'duration', val)}
          />m
        </td>
        <td className="td-act">
          <span style={{ fontSize: '.7rem', color: 'var(--text-light)' }}>editable</span>
        </td>
      </tr>
    );
  }

  // ── Quick Break (editable, deletable) ───────────────────────────
  if (slot.is_break) {
    return (
      <tr ref={setNodeRef} style={style} className="timetable-row break-row">
        <td className="td-time">
          <InlineEdit
            type="time"
            value={slot.start_time}
            onChange={(val) => onSlotEdit(slot.slot_id, 'start_time', val)}
          />
        </td>
        <td className="td-date"></td>
        <td className="td-task" colSpan={3} style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>
          ☕ {slot.name} —{' '}
          <InlineEdit
            type="number"
            value={slot.duration}
            onChange={(val) => onSlotEdit(slot.slot_id, 'duration', val)}
          />m
        </td>
        <td className="td-act">
          <button
            className="btn btn-sm btn-danger"
            onClick={() => onDeleteSlot(slot.slot_id)}
            title="Delete this break"
            style={{ padding: '2px 8px', fontSize: '.7rem' }}
          >
            ×
          </button>
        </td>
      </tr>
    );
  }

  // ── Study Task (draggable) ──────────────────────────────────────
  const prioColor = slot.priority === 'high' ? 'var(--danger)'
    : slot.priority === 'low' ? 'var(--success)' : 'var(--warning)';

  // Min/max dates for the date picker
  const today = new Date().toISOString().split('T')[0];
  const deadlineDate = slot.deadline
    ? slot.deadline.slice(0, 10).replace('T', ' ')
    : null;
  const maxDate = deadlineDate || today;

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`timetable-row study ${isDragging ? 'dragging' : ''}`}
    >
      <td className="td-time">
        <span className="drag-handle" {...attributes} {...listeners}>⠿</span>
        <InlineEdit
          type="time"
          value={slot.start_time}
          onChange={(val) => onSlotEdit(slot.slot_id, 'start_time', val)}
        />
      </td>
      <td className="td-date">
        <input
          type="date"
          value={slot.date || today}
          min={today}
          max={maxDate}
          onChange={(e) => onMoveSlot(slot.slot_id, e.target.value, slot.deadline)}
          title="Move to a different date"
          style={{ width: 115, padding: '3px 6px', fontSize: '.73rem' }}
        />
      </td>
      <td className="td-task">
        <strong>{slot.name}</strong>
        {slot.is_paper_based && <span className="paper-badge">📝</span>}
        <div className="td-sub">{slot.category}</div>
      </td>
      <td className="td-dur">{slot.duration}m</td>
      <td className="td-diff">
        <span className="difficulty-stars">{'⭐'.repeat(slot.difficulty || 3)}</span>
      </td>
      <td className="td-prio">
        <span className="prio-dot" style={{ background: prioColor }} />
        {slot.priority}
      </td>
      <td className="td-act">
        <button
          className="btn btn-sm btn-danger"
          onClick={() => onDelete(slot.task_id)}
          title="Mark as completed"
        >
          ✓ Done
        </button>
      </td>
    </tr>
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
  const [constraintsMsg, setConstraintsMsg] = useState('');
  const [modelStats, setModelStats] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [slotEdits, setSlotEdits] = useState({});
  const slotEditsRef = useRef({});  // Always-current ref to avoid stale closure in setTimeout
  const slotSaveTimer = useRef(null);       // Dedicated timer for slot edits (600ms)
  const constraintSaveTimer = useRef(null); // Dedicated timer for constraints (800ms)
  const [viewDate, setViewDate] = useState(null); // null = all days, or "YYYY-MM-DD"
  const [moveError, setMoveError] = useState('');

  // Keep ref in sync with state
  useEffect(() => { slotEditsRef.current = slotEdits; }, [slotEdits]);

  useEffect(() => {
    getConstraints().then(setConstraints).catch(() => {});
    getModelStats().then(setModelStats).catch(() => {});
  }, []);

  const refreshStats = useCallback(() => {
    getModelStats().then(setModelStats).catch(() => {});
  }, []);

  // ── Auto-save constraints on change ─────────────────────────────
  function updateConstraintField(field, value) {
    const updated = { ...constraints, [field]: value };
    setConstraints(updated);
    // Debounced auto-save (own timer — won't cancel slot saves)
    if (constraintSaveTimer.current) clearTimeout(constraintSaveTimer.current);
    constraintSaveTimer.current = setTimeout(async () => {
      try {
        await updateConstraints(updated);
        setConstraintsMsg('✅ Auto-saved');
        setTimeout(() => setConstraintsMsg(''), 2000);
      } catch (e) {
        console.error('Auto-save failed:', e);
      }
    }, 800);
  }

  // ── Generate ────────────────────────────────────────────────────
  async function handleGenerate() {
    setLoading(true);
    setSlotEdits({});
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

  // ── Save constraints ─────────────────────────────────────────────
  async function handleSaveConstraints() {
    setConstraintsMsg('Saving…');
    try {
      const updated = await updateConstraints(constraints);
      setConstraints(updated);
      setConstraintsMsg('✅ Saved!');
      setTimeout(() => setConstraintsMsg(''), 2500);
    } catch (err) {
      setConstraintsMsg('❌ Failed');
      console.error(err);
    }
  }

  // ── Train ────────────────────────────────────────────────────────
  async function handleTrain() {
    setTrainMsg('Training…');
    try {
      const stats = await trainModel();
      setModelStats(stats);
      setTrainMsg(`Done! Loss: ${stats.training_loss?.toFixed(4)}, pairs: ${stats.num_pairs_used}`);
      setTimeout(() => setTrainMsg(''), 4000);
    } catch (err) {
      setTrainMsg('Training failed');
    }
  }

  // ── Delete / Task Completed ──────────────────────────────────────
  async function handleDelete(taskId) {
    if (!confirm('Mark this task as completed and remove it?')) return;
    try {
      await deleteTask(taskId);
      const data = await generateTimetable();
      setSlots(data);
      setSlotEdits({});
      refreshStats();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  // ── Inline slot editing (all slot types) ─────────────────────────
  function handleSlotEdit(slotId, field, value) {
    // Find the slot for validation
    setSlots((prev) => {
      const slot = prev.find((s) => s.slot_id === slotId);
      if (!slot) return prev;

      // Validate
      const error = validateTimeEdit(slotId, field, value, slot);
      if (error) {
        setMoveError(error);
        setTimeout(() => setMoveError(''), 3000);
        return prev; // Reject the edit
      }

      const updated = prev.map((s) => {
        if (s.slot_id !== slotId) return s;
        const updatedSlot = { ...s };
        if (field === 'start_time') {
          // Convert "HH:MM" 24h → "H:MM AM/PM"
          try {
            const [h, m] = value.split(':');
            const hh = parseInt(h);
            const ampm = hh >= 12 ? 'PM' : 'AM';
            const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
            updatedSlot.start_time = `${h12}:${m} ${ampm}`;
          } catch { updatedSlot.start_time = value; }
        } else if (field === 'duration') {
          updatedSlot.duration = value;
        }
        return updatedSlot;
      });
      // Re-sort after optimistic update
      return sortSlotsByTime(updated);
    });

    // Track edits for batch save
    setSlotEdits((prev) => {
      const existing = prev[slotId] || {};
      return { ...prev, [slotId]: { ...existing, slot_id: slotId, [field]: value } };
    });
    setDirty(true);

    // Debounced save (own timer — won't cancel constraint saves)
    if (slotSaveTimer.current) clearTimeout(slotSaveTimer.current);
    slotSaveTimer.current = setTimeout(async () => {
      try {
        const editsList = Object.values(slotEditsRef.current).filter(
          (e) => e.slot_id && (e.start_time || e.duration)
        );
        if (editsList.length === 0) return;
        const data = await updateSlots(editsList);
        setSlots(sortSlotsByTime(data));
        setSlotEdits({});
        setDirty(false);
      } catch (e) {
        console.error('Slot update failed:', e);
      }
    }, 600);
  }

  // ── Delete break slot ────────────────────────────────────────────
  async function handleDeleteSlot(slotId) {
    if (!confirm('Delete this break?')) return;
    try {
      const data = await deleteSlot(slotId);
      setSlots(sortSlotsByTime(data));
    } catch (err) {
      console.error('Delete slot failed:', err);
    }
  }

  // ── Sort slots by (date, start_time) ─────────────────────────────
  function sortSlotsByTime(slotList) {
    const arr = [...slotList];
    arr.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      // Headers first within same date
      if (a.is_header && !b.is_header) return -1;
      if (!a.is_header && b.is_header) return 1;
      // Sort by start_time
      const timeA = parseTimeToMinutes(a.start_time);
      const timeB = parseTimeToMinutes(b.start_time);
      return timeA - timeB;
    });
    return arr;
  }

  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    try {
      const [time, ampm] = timeStr.split(' ');
      const [h, m] = time.split(':');
      let hh = parseInt(h);
      if (ampm === 'PM' && hh !== 12) hh += 12;
      if (ampm === 'AM' && hh === 12) hh = 0;
      return hh * 60 + parseInt(m);
    } catch { return 0; }
  }

  // ── Move task to different date ──────────────────────────────────
  async function handleMoveSlot(slotId, newDate, deadline) {
    // Validate date is not in the past
    const today = new Date().toISOString().split('T')[0];
    if (newDate < today) {
      setMoveError('Cannot move to a past date');
      setTimeout(() => setMoveError(''), 3000);
      return;
    }
    // Validate deadline
    if (deadline && newDate > deadline.split('T')[0].replace(' ', 'T').slice(0, 10)) {
      setMoveError(`Cannot move past deadline (${deadline.slice(0, 10)})`);
      setTimeout(() => setMoveError(''), 3000);
      return;
    }
    try {
      const data = await moveSlot(slotId, newDate);
      setSlots(sortSlotsByTime(data));
      setMoveError('');
    } catch (err) {
      const msg = err.response?.data?.detail || 'Move failed';
      setMoveError(msg);
      setTimeout(() => setMoveError(''), 4000);
      console.error('Move slot failed:', err);
    }
  }

  // ── Time validation helpers ──────────────────────────────────────
  function validateTimeEdit(slotId, field, value, slot) {
    if (field === 'duration') {
      const dur = parseInt(value);
      if (isNaN(dur) || dur < 5) return 'Duration must be at least 5 min';
      if (dur > 480) return 'Duration cannot exceed 480 min (8h)';
      return null;
    }
    if (field === 'start_time') {
      if (!value || !value.includes(':')) return 'Invalid time format';
      const [h, m] = value.split(':');
      const hh = parseInt(h), mm = parseInt(m);
      if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return 'Invalid time';
      const totalMin = hh * 60 + mm;
      // Validate against wake/sleep times
      const wakeMin = parseTimeToMinutes(constraints.wake_up_time);
      const sleepMin = parseTimeToMinutes(constraints.sleep_time);
      if (totalMin < wakeMin) return `Too early — wake time is ${constraints.wake_up_time}`;
      if (totalMin + (slot?.duration || 30) > sleepMin && !slot.is_break && !slot.is_meal)
        return `Too late — sleep time is ${constraints.sleep_time}`;
      // Validate against school hours (only for study tasks on weekdays)
      if (!slot.is_break && !slot.is_meal && !slot.is_school) {
        const schoolStart = parseTimeToMinutes(constraints.school_start);
        const schoolEnd = parseTimeToMinutes(constraints.school_end);
        if (totalMin >= schoolStart && totalMin < schoolEnd) {
          return 'During school hours — not allowed for tasks on weekdays';
        }
      }
      return null;
    }
    return null;
  }

  // ── Drag-and-drop (ALL rows in SortableContext) ──────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const allIds = displaySlots.map((s, i) =>
    (s.is_break || s.is_meal || s.is_header || s.is_school)
      ? `static-${s.slot_id || i}`
      : `task-${s.task_id}`
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = allIds.indexOf(active.id);
    const newIndex = allIds.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedIds = arrayMove(allIds, oldIndex, newIndex);
    const reorderedDisplay = arrayMove(displaySlots, oldIndex, newIndex);

    const newTaskOrder = [];
    for (const id of reorderedIds) {
      if (id.startsWith('task-')) {
        newTaskOrder.push(parseInt(id.replace('task-', ''), 10));
      }
    }

    // Build full task order from ALL slots (for backend, which needs complete order)
    const allTaskIds = [];
    for (const id of reorderedIds) {
      if (id.startsWith('task-')) {
        allTaskIds.push(parseInt(id.replace('task-', ''), 10));
      }
    }
    // Append any tasks from full slots that aren't in the filtered view
    for (const s of (slots || [])) {
      if (s.task_id && !allTaskIds.includes(s.task_id)) {
        allTaskIds.push(s.task_id);
      }
    }

    // Optimistic: update displaySlots visually
    setSlots((prev) => {
      // Build map of old positions in full slots array
      const fullIds = prev.map((s, i) => {
        const isStatic = s.is_break || s.is_meal || s.is_header || s.is_school;
        return isStatic ? `static-${s.slot_id || i}` : `task-${s.task_id}`;
      });
      // Apply the same relative reorder to the full array
      // For simplicity: if viewing all days, just use the reordered display
      if (!viewDate) {
        return reorderedDisplay;
      }
      // If viewing single day, merge reordered display back into full array
      const result = [...prev];
      let displayIdx = 0;
      for (let i = 0; i < result.length; i++) {
        const s = result[i];
        const sid = (s.is_break || s.is_meal || s.is_header || s.is_school)
          ? `static-${s.slot_id || i}` : `task-${s.task_id}`;
        if (allIds.includes(sid) && displayIdx < reorderedDisplay.length) {
          result[i] = reorderedDisplay[displayIdx];
          displayIdx++;
        }
      }
      return result;
    });
    setDirty(true);

    reorderTimetable(allTaskIds)
      .then((data) => {
        setSlots(sortSlotsByTime(data));
        setDirty(false);
        setSlotEdits({});
        refreshStats();
      })
      .catch((err) => console.error('Reorder failed:', err));
  }

  // ── Date navigation ──────────────────────────────────────────────
  const uniqueDates = [...new Set((slots || []).map((s) => s.date).filter(Boolean))].sort();
  const currentDateIndex = viewDate ? uniqueDates.indexOf(viewDate) : -1;

  function goPrevDay() {
    if (uniqueDates.length === 0) return;
    if (!viewDate) { setViewDate(uniqueDates[uniqueDates.length - 1]); return; }
    const idx = uniqueDates.indexOf(viewDate);
    if (idx > 0) setViewDate(uniqueDates[idx - 1]);
  }
  function goNextDay() {
    if (uniqueDates.length === 0) return;
    if (!viewDate) { setViewDate(uniqueDates[0]); return; }
    const idx = uniqueDates.indexOf(viewDate);
    if (idx < uniqueDates.length - 1) setViewDate(uniqueDates[idx + 1]);
  }
  function formatViewDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Filter slots by selected date
  const displaySlots = viewDate
    ? (slots || []).filter((s) => !s.date || s.date === viewDate || s.is_header)
    : (slots || []);

  // ── Render ───────────────────────────────────────────────────────
  const isDefaultModel = !modelStats || modelStats.num_comparisons < 5;

  return (
    <>
      {/* Controls Bar */}
      <div className="card">
        <div className="timetable-controls">
          <h2 style={{ marginBottom: 0 }}>🕐 Smart Timetable</h2>
          <div className="controls-buttons">
            <button className="btn btn-accent" onClick={handleGenerate} disabled={loading}>
              {loading ? 'Generating…' : '✨ Generate Timetable'}
            </button>
            <button className="btn btn-outline" onClick={() => setShowConstraints(!showConstraints)}>
              ⚙️ Settings
            </button>
          </div>
        </div>
        <div className="controls-info">
          <span className={`model-badge ${isDefaultModel ? '' : 'trained'}`}>
            {isDefaultModel ? '🧠 Model: Default' : `🧠 Model: Trained (${modelStats?.num_comparisons || 0})`}
          </span>
          {dirty && <span className="dirty-indicator">Unsaved changes…</span>}
          {moveError && <span className="move-error">⚠ {moveError}</span>}
        </div>
      </div>

      {/* Constraints Panel */}
      {showConstraints && (
        <div className="constraints-panel card">
          <h3>⚙️ Schedule Constraints</h3>
          <p className="constraints-desc">
            Set your daily routine. <strong>Weekdays:</strong> tasks only outside school hours.
            <strong> Weekends:</strong> full day open. All changes auto-save.
          </p>

          <div className="time-inputs">
            <div className="form-group">
              <label>🌅 Wake Up</label>
              <input type="time" value={constraints.wake_up_time}
                onChange={(e) => updateConstraintField('wake_up_time', e.target.value)} />
            </div>
            <div className="form-group">
              <label>🏫 School Starts</label>
              <input type="time" value={constraints.school_start}
                onChange={(e) => updateConstraintField('school_start', e.target.value)} />
            </div>
            <div className="form-group">
              <label>🏫 School Ends</label>
              <input type="time" value={constraints.school_end}
                onChange={(e) => updateConstraintField('school_end', e.target.value)} />
            </div>
            <div className="form-group">
              <label>🌙 Sleep</label>
              <input type="time" value={constraints.sleep_time}
                onChange={(e) => updateConstraintField('sleep_time', e.target.value)} />
            </div>
          </div>

          <div className="constraints-actions">
            <button className="btn btn-success" onClick={handleTrain}>🎓 Train Model</button>
            {constraintsMsg && <span className="train-msg" style={{ marginLeft: 8 }}>{constraintsMsg}</span>}
          </div>
          {trainMsg && <p className="train-msg">{trainMsg}</p>}

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
              {modelStats.top_features?.length > 0 && (
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

      {/* Date Navigation */}
      {slots && slots.length > 0 && uniqueDates.length > 0 && (
        <div className="card" style={{ padding: '8px 16px' }}>
          <div className="date-nav">
            <button className="date-nav-btn" onClick={goPrevDay} title="Previous day">◀</button>
            {viewDate ? (
              <>
                <span className="date-nav-current">{formatViewDate(viewDate)}</span>
                <input
                  type="date"
                  className="date-nav-input"
                  value={viewDate}
                  min={uniqueDates[0]}
                  max={uniqueDates[uniqueDates.length - 1]}
                  onChange={(e) => {
                    const d = e.target.value;
                    if (uniqueDates.includes(d)) setViewDate(d);
                  }}
                />
              </>
            ) : (
              <span className="date-nav-current">📅 All Days ({uniqueDates.length})</span>
            )}
            <button className="date-nav-btn" onClick={goNextDay} title="Next day">▶</button>
            <button
              className={`date-nav-btn ${!viewDate ? 'active' : ''}`}
              onClick={() => setViewDate(null)}
            >
              All Days
            </button>
          </div>
        </div>
      )}

      {/* Timetable Table */}
      <div className="card">
        {!slots ? (
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>No timetable yet.<br />Add tasks and click <strong>Generate Timetable</strong>.</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📅</div>
            <p>Add tasks first, then generate a timetable.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
              <div className="timetable-table-wrapper">
                <table className="timetable-table">
                  <thead>
                    <tr>
                      <th className="th-time">Time</th>
                      <th className="th-date-col">Date</th>
                      <th className="th-task">Task</th>
                      <th className="th-dur">Dur</th>
                      <th className="th-diff">Difficulty</th>
                      <th className="th-prio">Priority</th>
                      <th className="th-act">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displaySlots.map((s, i) => {
                      const isStatic = s.is_break || s.is_meal || s.is_header || s.is_school;
                      const id = isStatic
                        ? `static-${s.slot_id || i}`
                        : `task-${s.task_id}`;
                      return (
                        <TableRow
                          slot={s}
                          id={id}
                          key={id}
                          isDragDisabled={isStatic}
                          onDelete={handleDelete}
                          onDeleteSlot={handleDeleteSlot}
                          onSlotEdit={handleSlotEdit}
                          onMoveSlot={handleMoveSlot}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}
