import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="navbar">
      <div className="logo">📚 Student Planner</div>
      <nav>
        <NavLink to="/tasks" className={({ isActive }) => isActive ? 'active' : ''}>
          📋 Tasks
        </NavLink>
        <NavLink to="/timetable" className={({ isActive }) => isActive ? 'active' : ''}>
          🕐 Timetable
        </NavLink>
      </nav>
      <div className="user-bar">
        <span>👤 {user?.username}</span>
        <button className="btn btn-danger btn-sm" onClick={logout}>🚪 Logout</button>
      </div>
    </header>
  );
}
