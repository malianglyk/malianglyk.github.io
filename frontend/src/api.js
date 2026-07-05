/** Centralized API helper — all requests to the FastAPI backend. */
import axios from 'axios';

// In dev, Vite proxies /api → localhost:8000. In production, use the env variable.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear token and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.hash = '#/login';
    }
    return Promise.reject(err);
  }
);

// ---- Auth ----
export const signup = (username, password) =>
  api.post('/auth/signup', { username, password }).then((r) => r.data);

export const login = (username, password) =>
  api.post('/auth/login', { username, password }).then((r) => r.data);

export const getMe = () => api.get('/auth/me').then((r) => r.data);

// ---- Tasks ----
export const getTasks = () => api.get('/tasks').then((r) => r.data);

export const createTask = (data) => api.post('/tasks', data).then((r) => r.data);

export const updateTask = (id, data) => api.put(`/tasks/${id}`, data).then((r) => r.data);

export const deleteTask = (id) => api.delete(`/tasks/${id}`);

// ---- Timetable ----
export const generateTimetable = () =>
  api.post('/timetable/generate').then((r) => r.data);

export const reorderTimetable = (orderedTaskIds) =>
  api.post('/timetable/order', { ordered_task_ids: orderedTaskIds }).then((r) => r.data);

// ---- Resources ----
export const searchResources = (query) =>
  api.get('/resources/search', { params: { q: query } }).then((r) => r.data);

export const analyzeTasks = () =>
  api.post('/resources/analyze').then((r) => r.data);

// ---- Preferences ----
export const getConstraints = () =>
  api.get('/preferences/constraints').then((r) => r.data);

export const updateConstraints = (data) =>
  api.put('/preferences/constraints', data).then((r) => r.data);

export const getWeights = () =>
  api.get('/preferences/weights').then((r) => r.data);

export const trainModel = () =>
  api.post('/preferences/train').then((r) => r.data);

export const getModelStats = () =>
  api.get('/preferences/stats').then((r) => r.data);
