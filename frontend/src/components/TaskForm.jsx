import { useState } from 'react';

const CATEGORIES = ['Math', 'Science', 'History', 'English', 'CS', 'Language', 'Art', 'Other'];

export default function TaskForm({ onSubmit }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Math');
  const [priority, setPriority] = useState('medium');
  const [duration, setDuration] = useState(45);
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await onSubmit({
      name: name.trim(),
      category,
      priority,
      duration: Number(duration),
      deadline: deadline || null,
      description: description.trim() || null,
    });
    setName('');
    setDescription('');
    setDuration(45);
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
            <label>Deadline</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div className="form-group" style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              ➕ Add Task
            </button>
          </div>
        </div>
        <div className="form-group">
          <label>Description / Notes (optional)</label>
          <textarea rows="2" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Any extra details…" />
        </div>
      </form>
    </div>
  );
}
