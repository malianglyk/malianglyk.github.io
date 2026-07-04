import { useState } from 'react';
import { searchResources, analyzeTasks } from '../api';

export default function Resources() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [taskResources, setTaskResources] = useState(null);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await searchResources(query.trim());
      setSearchResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      const data = await analyzeTasks();
      setTaskResources(data);
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      {/* Search */}
      <div className="card">
        <h2>🔍 Search Learning Resources</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginBottom: 12 }}>
          Search our educational database powered by Wikipedia and Khan Academy.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search any topic… (e.g., algebra, photosynthesis, World War I)"
            style={{ flex: 1, minWidth: 240, padding: '10px 14px', border: '2px solid var(--border)', borderRadius: 'var(--radius-xs)', fontSize: '.95rem', outline: 'none' }}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
            {searching ? 'Searching…' : '🔍 Search'}
          </button>
          <button className="btn btn-outline" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? 'Analyzing…' : '📋 Analyze My Tasks'}
          </button>
        </div>
      </div>

      {/* Search Results */}
      {searchResults !== null && (
        <div className="card">
          <h2>Search Results: "{query}" ({searchResults.length})</h2>
          {searchResults.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🔍</div>
              <p>No results found. Try a different keyword.</p>
            </div>
          ) : (
            <div className="resource-grid">
              {searchResults.map((r, i) => (
                <div className="resource-card" key={i}>
                  <span className="task-tag">{r.kind}</span>
                  {r.category && <span className="task-tag" style={{ background: '#f0fdf4', color: 'var(--success)' }}>{r.category}</span>}
                  <h3>{r.title}</h3>
                  <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                    {r.summary?.substring(0, 250)}{r.summary?.length > 250 ? '…' : ''}
                  </p>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener" style={{ color: 'var(--primary)', fontSize: '.85rem', fontWeight: 600 }}>
                      🔗 Open →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task-based Resources */}
      {taskResources !== null && (
        <div className="card">
          <h2>📋 Resources for My Tasks</h2>
          {taskResources.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📋</div>
              <p>No tasks to analyze. Add tasks first.</p>
            </div>
          ) : (
            <div className="resource-grid">
              {taskResources.map((tr, i) => (
                <div className="resource-card" key={i}>
                  <span className="task-tag">{tr.category}</span>
                  <h3>{tr.task_name}</h3>
                  <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {tr.priority?.toUpperCase()} &middot; {tr.duration} min
                  </p>
                  <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 2 }}>📺 <strong>Videos:</strong></p>
                  <ul className="resource-links">
                    {tr.videos?.length > 0
                      ? tr.videos.map(([label, url], j) => (
                          <li key={j}><a href={url} target="_blank" rel="noopener">🔗 {label}</a></li>
                        ))
                      : <li style={{ color: 'var(--text-light)', fontSize: '.8rem' }}>None available</li>}
                  </ul>
                  <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '6px 0 2px' }}>✏️ <strong>Practice:</strong></p>
                  <ul className="resource-links">
                    {tr.practice?.length > 0
                      ? tr.practice.map(([label, url], j) => (
                          <li key={j}><a href={url} target="_blank" rel="noopener">🔗 {label}</a></li>
                        ))
                      : <li style={{ color: 'var(--text-light)', fontSize: '.8rem' }}>None available</li>}
                  </ul>
                  <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '6px 0 2px' }}>📖 <strong>Reference:</strong></p>
                  <ul className="resource-links">
                    {tr.reference?.length > 0
                      ? tr.reference.map(([label, url], j) => (
                          <li key={j}><a href={url} target="_blank" rel="noopener">🔗 {label}</a></li>
                        ))
                      : <li style={{ color: 'var(--text-light)', fontSize: '.8rem' }}>None available</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
