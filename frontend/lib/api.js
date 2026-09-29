const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class ApiRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // No JSON body (e.g. a network-level failure) — fall through with data=null.
  }

  if (!res.ok) {
    throw new ApiRequestError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  signup: (payload) => apiFetch('/api/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => apiFetch('/api/auth/login', { method: 'POST', body: payload }),
  me: (token) => apiFetch('/api/auth/me', { token }),

  zones: () => apiFetch('/api/zones'),

  myTeslas: (token) => apiFetch('/api/teslas/mine', { token }),
  createTesla: (token, payload) => apiFetch('/api/teslas', { method: 'POST', body: payload, token }),
  setTeslaActive: (token, id, isActive) =>
    apiFetch(`/api/teslas/${id}/active`, { method: 'PATCH', body: { isActive }, token }),

  createRideRequest: (token, payload) => apiFetch('/api/ride-requests', { method: 'POST', body: payload, token }),
  myRideRequests: (token) => apiFetch('/api/ride-requests/mine', { token }),
  openRideRequests: (token) => apiFetch('/api/ride-requests/open', { token }),
  cancelRideRequest: (token, id, reason) =>
    apiFetch(`/api/ride-requests/${id}/cancel`, { method: 'PATCH', body: { reason }, token }),
  confirmRideRequest: (token, id) => apiFetch(`/api/ride-requests/${id}/confirm`, { method: 'POST', token }),
  declineRideRequest: (token, id, reason) =>
    apiFetch(`/api/ride-requests/${id}/decline`, { method: 'POST', body: { reason }, token }),
  // An existing pool member answering "OK to share with this newcomer?" —
  // every party affected by a proposed join has to approve, and any one
  // rejection removes the newcomer.
  approvePoolConsent: (token, consentId) => apiFetch(`/api/pool-consents/${consentId}/approve`, { method: 'POST', token }),
  rejectPoolConsent: (token, consentId, reason) =>
    apiFetch(`/api/pool-consents/${consentId}/reject`, { method: 'POST', body: { reason }, token }),
  acceptRideRequest: (token, id, payload) =>
    apiFetch(`/api/ride-requests/${id}/accept`, { method: 'POST', body: payload, token }),

  myPools: (token) => apiFetch('/api/pools/mine', { token }),
  poolDetail: (token, id) => apiFetch(`/api/pools/${id}`, { token }),
  arrivePool: (token, id) => apiFetch(`/api/pools/${id}/arrive`, { method: 'PATCH', token }),
  startPool: (token, id) => apiFetch(`/api/pools/${id}/start`, { method: 'PATCH', token }),
  completePool: (token, id) => apiFetch(`/api/pools/${id}/complete`, { method: 'PATCH', token }),
};

export { ApiRequestError };
