import React, { useCallback, useEffect, useState } from 'react';
import { BatchHistoryTable } from './components/BatchHistoryTable';
import { LoginScreen } from './components/LoginScreen';
import { UploadWorkspace } from './components/UploadWorkspace';
import { isSupabaseConfigured, supabase } from './config/supabaseClient';
import type { StoreMaster } from './domain/types';
import {
  type AdminProfile,
  getCurrentAdminProfile,
  signOutAdmin,
} from './services/authService';
import { fetchActiveStores } from './services/storeService';

export const App: React.FC = () => {
  const [initializing, setInitializing] = useState(true);
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreMaster[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [storesError, setStoresError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<'upload' | 'history'>('upload');
  const [historyRefreshCount, setHistoryRefreshCount] = useState(0);

  const loadStoresForAdmin = useCallback(async () => {
    setStoresError(null);
    const res = await fetchActiveStores();
    if (res.error) {
      setStoresError(res.error);
    } else {
      setStores(res.stores);
      if (res.stores.length > 0) {
        setSelectedStoreId((prev) => prev || res.stores[0].id);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      try {
        const res = await getCurrentAdminProfile();
        if (!mounted) return;
        if (res.error) {
          setAuthError(res.error);
        }
        setAdmin(res.admin);
        if (res.admin) {
          await loadStoresForAdmin();
        }
      } finally {
        if (mounted) {
          setInitializing(false);
        }
      }
    };

    void initSession();

    if (isSupabaseConfigured) {
      const { data: sub } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          setAdmin(null);
          setStores([]);
          setSelectedStoreId('');
        }
      });

      return () => {
        mounted = false;
        sub.subscription.unsubscribe();
      };
    }

    return () => {
      mounted = false;
    };
  }, [loadStoresForAdmin]);

  const handleLoginSuccess = async (loggedInAdmin: AdminProfile) => {
    setAuthError(null);
    setAdmin(loggedInAdmin);
    await loadStoresForAdmin();
  };

  const handleSignOut = async () => {
    await signOutAdmin();
    setAdmin(null);
    setStores([]);
    setSelectedStoreId('');
  };

  if (initializing) {
    return (
      <div className="login-layout">
        <div className="login-card">
          <div className="spinner" aria-hidden="true" />
          <p className="subtitle mt-sm">Verifying administrator session...</p>
        </div>
      </div>
    );
  }

  if (!admin) {
    return (
      <LoginScreen
        initialError={authError}
        onLoginSuccess={(profile) => void handleLoginSuccess(profile)}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="badge badge-primary">Urban Connect</span>
          <strong>Daily Store Order Ingestion Portal</strong>
        </div>

        <nav className="topbar-nav" aria-label="Primary Navigation">
          <button
            type="button"
            className={`btn btn-sm ${
              activeView === 'upload' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveView('upload')}
          >
            Upload & Validate Workbook
          </button>
          <button
            type="button"
            className={`btn btn-sm ${
              activeView === 'history' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveView('history')}
          >
            Batch Audit History
          </button>
        </nav>

        <div className="topbar-user">
          <span className="user-pill" title={admin.email}>
            Admin: <strong>{admin.email}</strong>
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleSignOut()}
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="main-container">
        {storesError && (
          <div className="alert alert-error mb-md" role="alert">
            <strong>Store Master Error:</strong> {storesError}
          </div>
        )}

        {activeView === 'upload' ? (
          <UploadWorkspace
            stores={stores}
            selectedStoreId={selectedStoreId}
            onSelectStoreId={setSelectedStoreId}
            onBatchCommitted={() =>
              setHistoryRefreshCount((prev) => prev + 1)
            }
          />
        ) : (
          <BatchHistoryTable
            stores={stores}
            refreshTrigger={historyRefreshCount}
          />
        )}
      </main>
    </div>
  );
};

export default App;
