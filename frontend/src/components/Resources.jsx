import { useState } from 'react';
import { searchWeb, searchTasksWeb } from '../api';

export default function Resources() {
  const [query, setQuery] = useState('');
  const [webResults, setWebResults] = useState(null);
  const [taskResults, setTaskResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // ── Baidu web search ─────────────────────────────────────────────
  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setWebResults(null);
    try {
      const data = await searchWeb(query.trim());
      setWebResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  }

  // ── Search web for all tasks ─────────────────────────────────────
  async function handleSearchAllTasks() {
    setAnalyzing(true);
    setTaskResults(null);
    try {
      const data = await searchTasksWeb();
      setTaskResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      {/* Search Bar */}
      <div className="card">
        <h2>🔍 Baidu Web Search</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginBottom: 12 }}>
          Search the web via Baidu for real-time educational resources.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search the web… (e.g., calculus practice problems, WWII timeline)"
            style={{ flex: 1, minWidth: 240, padding: '10px 14px', border: '2px solid var(--border)', borderRadius: 'var(--radius-xs)', fontSize: '.95rem', outline: 'none' }}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
            {searching ? 'Searching…' : '🔍 Search'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-accent btn-sm" onClick={handleSearchAllTasks} disabled={analyzing}>
            🌐 Search Web for All Tasks
          </button>
          {analyzing && <span style={{ color: 'var(--text-muted)', fontSize: '.85rem', alignSelf: 'center' }}>Searching…</span>}
        </div>
      </div>

      {/* Web Search Results */}
      {webResults !== null && (
        <div className="card">
          <h2>🌐 Web Results: "{query}" ({webResults.length})</h2>
          {webResults.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🔍</div>
              <p>No results found. Try a different keyword.</p>
            </div>
          ) : (
            <div className="resource-grid">
              {webResults.map((r, i) => (
                <div className="resource-card" key={i}>
                  <span className="task-tag">{r.kind || 'Web'}</span>
                  <h3>{r.title}</h3>
                  <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                    {r.summary?.substring(0, 250)}{r.summary?.length > 250 ? '…' : ''}
                  </p>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontSize: '.85rem', fontWeight: 600 }}>
                      🔗 Open →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task-based Results */}
      {taskResults !== null && (
        <div className="card">
          <h2>📋 Resources for My Tasks ({taskResults.length})</h2>
          {taskResults.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📋</div>
              <p>No tasks to search. Add tasks first.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {taskResults.map((tr, i) => (
                <div key={i} className="resource-card" style={{ border: '2px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span className="task-tag">{tr.category}</span>
                    <span className="task-tag" style={{ background: '#eef2ff', color: 'var(--primary)' }}>🌐 Baidu Search</span>
                  </div>
                  <h3>{tr.task_name}</h3>
                  <p style={{ fontSize: '.75rem', color: 'var(--text-light)', marginBottom: 8 }}>
                    Query: "{tr.search_query}"
                  </p>
                  {tr.results?.length > 0 ? (
                    <ul className="resource-links">
                      {tr.results.map((r, j) => (
                        <li key={j} style={{ marginBottom: 6 }}>
                          <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                            🔗 {r.title}
                          </a>
                          <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', margin: '2px 0 0 12px' }}>
                            {r.summary?.substring(0, 150)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ fontSize: '.8rem', color: 'var(--text-light)' }}>
                      No web results found. Try adding a more specific description to your task.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
