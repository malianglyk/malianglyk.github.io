import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import AuthPage from './components/AuthPage';
import TaskList from './components/TaskList';
import Timetable from './components/Timetable';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  // Not logged in → auth page
  if (!user) {
    return (
      <Routes>
        <Route path="/*" element={<AuthPage />} />
      </Routes>
    );
  }

  // Logged in → main app
  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<TaskList />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/timetable" element={<Timetable />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
