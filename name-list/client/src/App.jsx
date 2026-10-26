import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function App() {
  const [names, setNames] = useState([]);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    api
      .list()
      .then((data) => {
        if (!cancelled) setNames(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    run(async () => {
      const created = await api.create(name);
      setNames((current) => [created, ...current]);
      setNewName('');
    });
  };

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setEditingName(entry.name);
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleUpdate = (event) => {
    event.preventDefault();
    const name = editingName.trim();
    if (!name) return;

    run(async () => {
      const updated = await api.update(editingId, name);
      setNames((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry))
      );
      cancelEdit();
    });
  };

  const handleDelete = (entry) => {
    if (!window.confirm(`Delete "${entry.name}"?`)) return;

    run(async () => {
      await api.remove(entry.id);
      setNames((current) => current.filter((item) => item.id !== entry.id));
    });
  };

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">MERN · Docker Compose</p>
        <h1>Name List</h1>
        <p className="subtitle">
          A tiny CRUD demo: React talks to Express, Express talks to MongoDB.
        </p>
      </header>

      <main className="card">
        <form className="create-form" onSubmit={handleCreate}>
          <label className="sr-only" htmlFor="new-name">
            Name
          </label>
          <input
            id="new-name"
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Add a name…"
            maxLength={100}
            autoComplete="off"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !newName.trim()}>
            Add
          </button>
        </form>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p className="empty">Loading names…</p>
        ) : names.length === 0 ? (
          <p className="empty">No names yet. Add the first one above.</p>
        ) : (
          <ul className="name-list">
            {names.map((entry) => (
              <li key={entry.id} className="name-row">
                {editingId === entry.id ? (
                  <form className="edit-form" onSubmit={handleUpdate}>
                    <label className="sr-only" htmlFor={`edit-${entry.id}`}>
                      Edit {entry.name}
                    </label>
                    <input
                      id={`edit-${entry.id}`}
                      type="text"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      maxLength={100}
                      autoFocus
                      disabled={busy}
                    />
                    <button
                      type="submit"
                      className="small"
                      disabled={busy || !editingName.trim()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      onClick={cancelEdit}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="name-text">{entry.name}</span>
                    <span className="row-actions">
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => startEdit(entry)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="small danger"
                        onClick={() => handleDelete(entry)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="meta">
        {names.length} {names.length === 1 ? 'name' : 'names'} · API on{' '}
        <code>/api/names</code>
      </footer>
    </div>
  );
}
