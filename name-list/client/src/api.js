const request = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  // DELETE returns 204 with no body.
  if (response.status === 204) return null;

  const body = await response.json().catch(() => null);

  // fetch() does not reject on 4xx/5xx, so surface the server's message.
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return body;
};

export const api = {
  list: () => request('/names'),

  create: (name) =>
    request('/names', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  update: (id, name) =>
    request(`/names/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  remove: (id) =>
    request(`/names/${id}`, {
      method: 'DELETE',
    }),
};
