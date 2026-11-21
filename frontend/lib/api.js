// A trailing slash would turn "/api" into "//api" (a 404 on the server).
const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

class ApiRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const jsonOrNull = async (res) => {
  try {
    return await res.json();
  } catch {
    return null; // no JSON body (e.g. a network-level failure)
  }
};

async function rawFetch(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  const data = await jsonOrNull(res);
  if (!res.ok) throw new ApiRequestError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

// ---- session handling -------------------------------------------------------
// The access token is short-lived (15 minutes). A refresh token silently gets a
// new one; every refresh also rotates the refresh token. Screens keep passing
// `token` as before, but the freshest token held here always wins, so a refresh
// in the middle of a session is invisible to them.
const session = { accessToken: null, refreshToken: null, onChange: null, onExpired: null };
let refreshInFlight = null;

export function setSession({ accessToken, refreshToken, onChange, onExpired } = {}) {
  if (accessToken !== undefined) session.accessToken = accessToken;
  if (refreshToken !== undefined) session.refreshToken = refreshToken;
  if (onChange !== undefined) session.onChange = onChange;
  if (onExpired !== undefined) session.onExpired = onExpired;
}

export function clearSession() {
  session.accessToken = null;
  session.refreshToken = null;
}

// Idempotency keys: one per user ACTION, reused on automatic retries, so a double
// tap or a flaky-network retry can never create two rides or two top-ups.
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function refreshSession() {
  if (!session.refreshToken) throw new ApiRequestError(401, 'Please sign in again.');
  if (!refreshInFlight) {
    refreshInFlight = rawFetch('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } })
      .then((data) => {
        session.accessToken = data.accessToken;
        session.refreshToken = data.refreshToken;
        session.onChange?.({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return data;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function apiFetch(path, options = {}) {
  const wantsAuth = options.token !== undefined;
  const attempt = () => rawFetch(path, { ...options, token: wantsAuth ? session.accessToken || options.token : undefined });
  try {
    return await attempt();
  } catch (err) {
    if (!(wantsAuth && err instanceof ApiRequestError && err.status === 401 && session.refreshToken)) throw err;
    try {
      await refreshSession();
    } catch (refreshErr) {
      clearSession();
      session.onExpired?.();
      throw refreshErr;
    }
    return attempt();
  }
}

export const api = {
  signup: (payload) => apiFetch('/api/v1/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => apiFetch('/api/v1/auth/login', { method: 'POST', body: payload }),
  refresh: (refreshToken) => apiFetch('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken } }),
  logout: (refreshToken) => rawFetch('/api/v1/auth/logout', { method: 'POST', body: { refreshToken } }),
  me: (token) => apiFetch('/api/v1/auth/me', { token }),

  // public: follow a trip someone shared with you (no account needed)
  publicTrip: (token) => rawFetch(`/api/v1/trips/${encodeURIComponent(token)}`),

  // admin console
  adminStats: (token) => apiFetch('/api/v1/admin/stats', { token }),
  adminRides: (token, status) => apiFetch(`/api/v1/admin/rides?limit=50${status ? `&status=${status}` : ''}`, { token }),
  adminRide: (token, id) => apiFetch(`/api/v1/admin/rides/${id}`, { token }),
  adminReconcile: (token) => apiFetch('/api/v1/admin/reconcile', { token }),
  adminDrivers: (token, status) => apiFetch(`/api/v1/admin/drivers${status ? `?status=${status}` : ''}`, { token }),
  adminReviewDriver: (token, userId, decision, note) =>
    apiFetch(`/api/v1/admin/drivers/${userId}/${decision === 'VERIFIED' ? 'verify' : 'reject'}`, { method: 'POST', body: { note }, token }),

  zones: () => apiFetch('/api/v1/zones'),

  wallet: (token) => apiFetch('/api/v1/wallet', { token }),
  topUpWallet: (token, amountPaisa) => apiFetch('/api/v1/wallet/topup', { method: 'POST', body: { amountPaisa }, token, headers: { 'Idempotency-Key': newIdempotencyKey() } }),

  myTeslas: (token) => apiFetch('/api/v1/teslas/mine', { token }),
  createTesla: (token, payload) => apiFetch('/api/v1/teslas', { method: 'POST', body: payload, token }),
  setTeslaActive: (token, id, isActive) =>
    apiFetch(`/api/v1/teslas/${id}/active`, { method: 'PATCH', body: { isActive }, token }),

  createRideRequest: (token, payload) => apiFetch('/api/v1/ride-requests', { method: 'POST', body: payload, token, headers: { 'Idempotency-Key': newIdempotencyKey() } }),
  myRideRequests: (token) => apiFetch('/api/v1/ride-requests/mine', { token }),
  openRideRequests: (token) => apiFetch('/api/v1/ride-requests/open', { token }),
  cancelRideRequest: (token, id, reason) =>
    apiFetch(`/api/v1/ride-requests/${id}/cancel`, { method: 'PATCH', body: { reason }, token }),
  confirmRideRequest: (token, id) => apiFetch(`/api/v1/ride-requests/${id}/confirm`, { method: 'POST', token }),
  declineRideRequest: (token, id, reason) =>
    apiFetch(`/api/v1/ride-requests/${id}/decline`, { method: 'POST', body: { reason }, token }),
  // An existing pool member answering "OK to share with this newcomer?" —
  // every party affected by a proposed join has to approve, and any one
  // rejection removes the newcomer.
  approvePoolConsent: (token, consentId) => apiFetch(`/api/v1/pool-consents/${consentId}/approve`, { method: 'POST', token }),
  rejectPoolConsent: (token, consentId, reason) =>
    apiFetch(`/api/v1/pool-consents/${consentId}/reject`, { method: 'POST', body: { reason }, token }),
  acceptRideRequest: (token, id, payload) =>
    apiFetch(`/api/v1/ride-requests/${id}/accept`, { method: 'POST', body: payload, token }),

  myPools: (token) => apiFetch('/api/v1/pools/mine', { token }),
  poolDetail: (token, id) => apiFetch(`/api/v1/pools/${id}`, { token }),
  arrivePool: (token, id) => apiFetch(`/api/v1/pools/${id}/arrive`, { method: 'PATCH', token }),
  startPool: (token, id) => apiFetch(`/api/v1/pools/${id}/start`, { method: 'PATCH', token }),
  completePool: (token, id) => apiFetch(`/api/v1/pools/${id}/complete`, { method: 'PATCH', token }),
  cancelPool: (token, id, reason) => apiFetch(`/api/v1/pools/${id}/cancel`, { method: 'PATCH', body: { reason }, token }),
};

export { ApiRequestError };
