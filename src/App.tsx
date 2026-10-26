import React, { useCallback, useEffect, useState } from 'react';
import { AnalyticsSection } from './components/AnalyticsSection';
import { LoginScreen } from './components/LoginScreen';
import { S2POtpSection } from './components/S2POtpSection';
import { StoreLoginsModal } from './components/StoreLoginsModal';
import { UploadWorkspace } from './components/UploadWorkspace';
import { isSupabaseConfigured, supabase } from './config/supabaseClient';
import type { StoreMaster } from './domain/types';
import {
  type UserProfile,
  getCurrentUserProfile,
  signOutUser,
} from './services/authService';
import { fetchActiveStores } from './services/storeService';

export const App: React.FC = () => {
  const [initializing, setInitializing] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreMaster[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [storesError, setStoresError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<'upload' | 'analytics' | 's2p_otp'>('s2p_otp');

  // Store logins administration modal (Superadmin only)
  const [isStoreLoginsModalOpen, setIsStoreLoginsModalOpen] = useState(false);

  const loadStoresForUser = useCallback(async (user: UserProfile) => {
    setStoresError(null);
    const res = await fetchActiveStores();
    if (res.error) {
      setStoresError(res.error);
    } else {
      let userStores = res.stores;
      // If store operator, restrict strictly to their assigned store
      if (user.role === 'store_user' && user.store_id) {
        userStores = userStores.filter((s) => s.id === user.store_id);
      }
      setStores(userStores);
      if (user.role === 'store_user' && user.store_id) {
        setSelectedStoreId(user.store_id);
      } else if (userStores.length > 0) {
        setSelectedStoreId((prev) =>
          userStores.some((s) => s.id === prev) ? prev : userStores[0].id
        );
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      try {
        const res = await getCurrentUserProfile();
        if (!mounted) return;
        if (res.error) {
          setAuthError(res.error);
        }
        setCurrentUser(res.user);
        if (res.user) {
          await loadStoresForUser(res.user);
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
          setCurrentUser(null);
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
  }, [loadStoresForUser]);

  const handleLoginSuccess = async (loggedInUser: UserProfile) => {
    setAuthError(null);
    setCurrentUser(loggedInUser);
    await loadStoresForUser(loggedInUser);
  };

  const handleSignOut = async () => {
    await signOutUser();
    setCurrentUser(null);
    setStores([]);
    setSelectedStoreId('');
  };

  if (initializing) {
    return (
      <div className="login-layout">
        <div className="login-card">
          <div className="spinner" aria-hidden="true" />
          <p className="subtitle mt-sm">Verifying session credentials...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
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
              activeView === 's2p_otp' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveView('s2p_otp')}
          >
            S2P &amp; OTP
          </button>
          <button
            type="button"
            className={`btn btn-sm ${
              activeView === 'analytics' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveView('analytics')}
          >
            Rider Analytics
          </button>
          <button
            type="button"
            className={`btn btn-sm ${
              activeView === 'upload' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveView('upload')}
          >
            Data Ingestion
          </button>
        </nav>

        <div className="topbar-user">
          {currentUser.role === 'admin' ? (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsStoreLoginsModalOpen(true)}
                title="Manage store user accounts and permissions"
              >
                Store Logins
              </button>
              <span className="user-pill" title={currentUser.email}>
                Admin: <strong>{currentUser.email}</strong>
              </span>
            </>
          ) : (
            <span className="user-pill user-pill-store" title={currentUser.email}>
              Store (<strong>{currentUser.store_code ?? 'Assigned'}</strong>): {currentUser.email}
            </span>
          )}
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

        {activeView === 's2p_otp' && (
          <S2POtpSection
            stores={stores}
            selectedStoreId={selectedStoreId}
            onSelectStoreId={setSelectedStoreId}
            currentUser={currentUser}
          />
        )}

        {activeView === 'analytics' && (
          <AnalyticsSection
            stores={stores}
            selectedStoreId={selectedStoreId}
            onSelectStoreId={setSelectedStoreId}
            currentUser={currentUser}
          />
        )}

        {activeView === 'upload' && (
          <UploadWorkspace
            stores={stores}
            selectedStoreId={selectedStoreId}
            onSelectStoreId={setSelectedStoreId}
            currentUser={currentUser}
          />
        )}

        {/* Superadmin Store Logins Management Modal */}
        {currentUser.role === 'admin' && (
          <StoreLoginsModal
            stores={stores}
            isOpen={isStoreLoginsModalOpen}
            onClose={() => setIsStoreLoginsModalOpen(false)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
