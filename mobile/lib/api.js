// Trailing slashes are stripped: "https://host/" + "/api/x" would otherwise
// produce "//api/x", which the server answers with a 404.
const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

export class ApiRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch rejects only when the network itself failed (offline, DNS, server asleep).
    throw new ApiRequestError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no JSON body — fall through with data = null
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

  wallet: (token) => apiFetch('/api/wallet', { token }),
  topUpWallet: (token, amountPaisa) => apiFetch('/api/wallet/topup', { method: 'POST', body: { amountPaisa }, token }),

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
  cancelPool: (token, id, reason) => apiFetch(`/api/pools/${id}/cancel`, { method: 'PATCH', body: { reason }, token }),
};
