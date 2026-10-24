import React, { useCallback, useEffect, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import {
  deleteStoreUser,
  fetchStoreUsers,
  registerStoreUser,
  setStoreUserActive,
  type StoreUserRecord,
} from '../services/storeUserService';

interface StoreLoginsModalProps {
  stores: StoreMaster[];
  isOpen: boolean;
  onClose: () => void;
}

export const StoreLoginsModal: React.FC<StoreLoginsModalProps> = ({
  stores,
  isOpen,
  onClose,
}) => {
  const [users, setUsers] = useState<StoreUserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [newEmail, setNewEmail] = useState('');
  const [selectedStoreCode, setSelectedStoreCode] = useState(
    stores[0]?.store_code ?? ''
  );
  const [newFullName, setNewFullName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchStoreUsers();
      if (res.error) {
        setError(res.error);
      } else {
        setUsers(res.users);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadUsers();
      if (!selectedStoreCode && stores.length > 0) {
        setSelectedStoreCode(stores[0].store_code);
      }
    }
  }, [isOpen, loadUsers, selectedStoreCode, stores]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !selectedStoreCode) return;

    setError(null);
    setSuccessMsg(null);
    setSaving(true);

    try {
      const res = await registerStoreUser({
        email: newEmail.trim(),
        storeCode: selectedStoreCode,
        fullName: newFullName.trim() || undefined,
      });

      if (!res.ok) {
        setError(res.message || 'Failed to link user to store.');
      } else {
        setSuccessMsg(
          `Successfully linked ${newEmail.trim()} to store ${selectedStoreCode}!`
        );
        setNewEmail('');
        setNewFullName('');
        await loadUsers();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (user: StoreUserRecord) => {
    setError(null);
    setSuccessMsg(null);
    const nextStatus = !user.is_active;
    const res = await setStoreUserActive(user.user_id, nextStatus);
    if (!res.ok) {
      setError(res.error || 'Failed to update user status.');
    } else {
      await loadUsers();
    }
  };

  const handleDelete = async (user: StoreUserRecord) => {
    const storeName = user.stores?.store_code || 'assigned store';
    const confirmed = window.confirm(
      `Are you sure you want to remove store login access for ${user.email} (${storeName})?`
    );
    if (!confirmed) return;

    setError(null);
    setSuccessMsg(null);
    const res = await deleteStoreUser(user.user_id);
    if (!res.ok) {
      setError(res.error || 'Failed to remove store user.');
    } else {
      setSuccessMsg(`Removed store access for ${user.email}.`);
      await loadUsers();
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="store-logins-title">
      <div className="modal-card modal-wide">
        <div className="modal-header">
          <div className="flex-row items-center gap-sm">
            <span className="badge badge-primary">Admin Only</span>
            <h2 id="store-logins-title" className="modal-title">
              Manage Store Logins
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="subtitle mb-md">
            Assign store staff and operators to individual stores. When a store operator logs in, they will <strong>only see and upload data for their assigned store</strong>. Administrator access and multi-store controls remain unchanged.
          </p>

          {error && (
            <div className="alert alert-error mb-md" role="alert">
              <strong>Error:</strong> {error}
            </div>
          )}

          {successMsg && (
            <div className="alert alert-success mb-md" role="status">
              <strong>Success:</strong> {successMsg}
            </div>
          )}

          {/* Provisioning Form */}
          <form onSubmit={handleCreate} className="card p-md mb-lg bg-surface-subtle">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Link or Provision Store Operator
            </h3>
            <div className="grid grid-3 gap-md items-end">
              <div className="form-group mb-0">
                <label htmlFor="new-user-email">Operator Email *</label>
                <input
                  id="new-user-email"
                  type="email"
                  required
                  placeholder="store.operator@urbanconnect.in"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="form-group mb-0">
                <label htmlFor="new-user-store">Assigned Store *</label>
                <select
                  id="new-user-store"
                  className="input-select"
                  value={selectedStoreCode}
                  onChange={(e) => setSelectedStoreCode(e.target.value)}
                  disabled={saving}
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.store_code}>
                      {s.store_code} — {s.store_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group mb-0">
                <label htmlFor="new-user-fullname">Operator Name (Optional)</label>
                <input
                  id="new-user-fullname"
                  type="text"
                  placeholder="e.g. Ramesh Kumar"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="flex-between items-center mt-md">
              <p className="text-muted" style={{ fontSize: '0.78rem', margin: 0 }}>
                Note: The user should be registered in Supabase Auth (or invited). Once linked, their login will automatically be restricted to this store.
              </p>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={saving || !newEmail.trim()}
              >
                {saving ? 'Linking...' : '+ Link Store User'}
              </button>
            </div>
          </form>

          {/* Current Store Users Table */}
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Operator Email</th>
                  <th>Full Name</th>
                  <th>Status</th>
                  <th>Linked Date</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                      <div className="spinner" style={{ margin: '0 auto' }} aria-hidden="true" />
                      <p className="text-muted mt-sm">Loading store logins...</p>
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }} className="text-muted">
                      No store users registered yet. Add one above to create an individual store login.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.user_id}>
                      <td>
                        <span className="badge badge-primary">
                          {u.stores?.store_code ?? 'Store'}
                        </span>
                        <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                          {u.stores?.store_name ?? ''}
                        </div>
                      </td>
                      <td>
                        <strong>{u.email}</strong>
                      </td>
                      <td>{u.full_name || '—'}</td>
                      <td>
                        {u.is_active ? (
                          <span className="badge badge-success">Active</span>
                        ) : (
                          <span className="badge badge-warning">Inactive</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex-row justify-end gap-xs">
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => void handleToggleStatus(u)}
                            title={u.is_active ? 'Deactivate account' : 'Activate account'}
                          >
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-xs"
                            onClick={() => void handleDelete(u)}
                            title="Remove store access"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
