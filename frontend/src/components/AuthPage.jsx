import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { signup, login } from '../api';

export default function AuthPage() {
  const { saveAuth } = useAuth();
  const [mode, setMode] = useState('login');   // 'login' | 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isLogin = mode === 'login';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    if (!isLogin && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }

    setBusy(true);
    try {
      const data = isLogin
        ? await login(username.trim(), password)
        : await signup(username.trim(), password);
      saveAuth(data.access_token, data.user);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Something went wrong.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{isLogin ? '👋 Welcome Back' : '📝 Create Account'}</h1>
        <p>{isLogin ? 'Log in to your Student Planner' : 'Sign up to get started'}</p>

        <form onSubmit={handleSubmit} autoComplete="off">
          <label>Username</label>
          <input
            type="text" value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your username" autoComplete="off"
          />

          <label>Password</label>
          <input
            type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" autoComplete="off"
          />

          {!isLogin && (
            <>
              <label>Confirm Password</label>
              <input
                type="password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••" autoComplete="off"
              />
            </>
          )}

          <div className="auth-error">{error}</div>

          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? 'Please wait…' : isLogin ? '🔓 Log In' : '✨ Create Account'}
          </button>
        </form>

        <button className="btn btn-ghost" onClick={() => { setMode(isLogin ? 'signup' : 'login'); setError(''); }}
          style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
