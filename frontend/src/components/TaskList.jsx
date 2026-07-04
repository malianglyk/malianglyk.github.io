import { useState, useEffect, useCallback } from 'react';
import { getTasks, createTask, deleteTask } from '../api';
import TaskForm from './TaskForm';

export default function TaskList() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(() => {
    getTasks()
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function handleAdd(data) {
    await createTask(data);
    fetchTasks();
  }

  async function handleDelete(id) {
    await deleteTask(id);
    fetchTasks();
  }

  // Stats
  const high = tasks.filter((t) => t.priority === 'high').length;
  const totalMin = tasks.reduce((s, t) => s + t.duration, 0);
  const hrs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const withDeadline = tasks.filter((t) => t.deadline).length;

  return (
    <>
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card"><div className="value">{tasks.length}</div><div className="label">Total Tasks</div></div>
        <div className="stat-card"><div className="value" style={{ color: 'var(--danger)' }}>{high}</div><div className="label">High Priority</div></div>
        <div className="stat-card"><div className="value">{hrs}h {min}m</div><div className="label">Est. Total Time</div></div>
        <div className="stat-card"><div className="value">{withDeadline}</div><div className="label">With Deadline</div></div>
      </div>

      {/* Add Task Form */}
      <TaskForm onSubmit={handleAdd} />

      {/* Task List */}
      <div className="card">
        <h2>📌 My Tasks ({tasks.length})</h2>
        {loading ? (
          <div className="empty-state"><p>Loading tasks…</p></div>
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📋</div>
            <p>No tasks yet. Add your first task above!</p>
          </div>
        ) : (
          tasks.map((t) => (
            <div className="task-item" key={t.id}>
              <div className={`task-priority ${t.priority}`} />
              <div className="task-info">
                <div className="name">{t.name}</div>
                <div className="meta">
                  {t.category} &middot; {t.duration} min
                  {t.deadline ? ` · 📅 ${t.deadline}` : ''}
                  {t.description ? ` · ${t.description.substring(0, 60)}${t.description.length > 60 ? '…' : ''}` : ''}
                </div>
              </div>
              <div className="task-actions">
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.id)}>🗑</button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
