import { useState } from 'react';

const CATEGORIES = ['Math', 'Science', 'History', 'English', 'CS', 'Language', 'Art', 'Other'];

export default function TaskForm({ onSubmit }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Math');
  const [priority, setPriority] = useState('medium');
  const [duration, setDuration] = useState(45);
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('23:59');
  const [difficulty, setDifficulty] = useState(3);
  const [isPaperBased, setIsPaperBased] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);

    // Build deadline string: "YYYY-MM-DD HH:MM" or null
    let deadline = null;
    if (deadlineDate) {
      deadline = `${deadlineDate} ${deadlineTime || '23:59'}`;
    }

    await onSubmit({
      name: name.trim(),
      category,
      priority,
      duration: Number(duration),
      deadline,
      difficulty: Number(difficulty),
      is_paper_based: isPaperBased,
      description: description.trim() || null,
    });
    setName('');
    setDescription('');
    setDuration(45);
    setDeadlineDate('');
    setDeadlineTime('23:59');
    setDifficulty(3);
    setIsPaperBased(false);
    setBusy(false);
  }

  return (
    <div className="card">
      <h2>➕ Add a New Task</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Subject / Task Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Math Homework, History Essay…" required />
          </div>
          <div className="form-group">
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Estimated Time (min)</label>
            <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)}
              min={5} max={480} step={5} />
          </div>
          <div className="form-group">
            <label>Difficulty (1-5)</label>
            <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
              <option value={1}>1 — Very Easy</option>
              <option value={2}>2 — Easy</option>
              <option value={3}>3 — Medium</option>
              <option value={4}>4 — Hard</option>
              <option value={5}>5 — Very Hard</option>
            </select>
          </div>
          <div className="form-group">
            <label>Deadline Date</label>
            <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Deadline Time</label>
            <input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isPaperBased}
              onChange={(e) => setIsPaperBased(e.target.checked)}
              id="paper-basis"
              style={{ width: 'auto' }}
            />
            <label htmlFor="paper-basis" style={{ marginBottom: 0, cursor: 'pointer' }}>
              📝 Paper-based (handwritten task)
            </label>
          </div>
          <div className="form-group" style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              ➕ Add Task
            </button>
          </div>
        </div>
        <div className="form-group">
          <label>🔍 Search Query / Notes (optional — used to find web resources)</label>
          <textarea rows="2" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="What to search for? e.g., quadratic equations practice, photosynthesis explained, WWI causes…" />
        </div>
      </form>
    </div>
  );
}
