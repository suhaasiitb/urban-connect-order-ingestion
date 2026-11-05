import React, { useCallback, useEffect, useState } from 'react';
import { AnalyticsSection } from './components/AnalyticsSection';
import { LoginScreen } from './components/LoginScreen';
import { PlanningSection } from './components/PlanningSection';
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

  const [activeView, setActiveView] = useState<'upload' | 'analytics' | 's2p_otp' | 'planning'>('analytics');

  // Sub-section states synchronized with the auto-retractable side panel
  const [planningSubView, setPlanningSubView] = useState<'FORWARD_PLAN' | 'PLAN_VS_ACTUAL_AUDIT'>('FORWARD_PLAN');
  const [analyticsSubView, setAnalyticsSubView] = useState<'performance' | 'management' | 'new-riders'>('performance');
  const [uploadSubView, setUploadSubView] = useState<'orders' | 'riders' | 'dnr' | 'snop'>('orders');

  // Auto-retractable Side Navigation Panel pin state (false = auto-expand on hover, true = pinned open)
  const [isSidebarPinned, setIsSidebarPinned] = useState<boolean>(false);

  // Basedash Midnight Dark / Light Theme State (Dark by default)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = window.localStorage.getItem('uc_dashboard_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore storage errors
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('uc_dashboard_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

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
          <span className="badge badge-primary basedash-brand-pill">
            <span className="basedash-live-dot" aria-hidden="true" />
            Urban Connect
          </span>
          <strong className="topbar-editorial-title">Daily Store Order Ingestion Portal</strong>
        </div>

        <div className="topbar-user">
          <button
            type="button"
            className="btn-theme-toggle"
            onClick={toggleTheme}
            title={
              theme === 'dark'
                ? 'Switch to Light Mode'
                : 'Switch to Basedash Midnight Dark Mode'
            }
            aria-label="Toggle Dark and Light Theme"
          >
            {theme === 'dark' ? (
              <>
                <span className="theme-toggle-dot theme-dot-midnight" aria-hidden="true" />
                <span>Midnight</span>
              </>
            ) : (
              <>
                <span className="theme-toggle-dot theme-dot-light" aria-hidden="true" />
                <span>Light</span>
              </>
            )}
          </button>

          {currentUser.role === 'admin' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setIsStoreLoginsModalOpen(true)}
              title="Manage store user accounts and permissions"
            >
              Store Logins
            </button>
          )}
        </div>
      </header>

      <div className="app-body-layout">
        {/* Auto-Retractable Side Navigation Rail */}
        <aside
          className={`app-side-panel ${isSidebarPinned ? 'sidebar-pinned' : ''}`}
          aria-label="Section & Sub-Section Navigation"
        >
          <div className="side-panel-header">
            <span className="side-panel-heading-text">Navigation</span>
            <button
              type="button"
              className={`side-panel-pin-btn ${isSidebarPinned ? 'active' : ''}`}
              onClick={() => setIsSidebarPinned((v) => !v)}
              title={isSidebarPinned ? 'Unpin sidebar (auto-retract)' : 'Pin sidebar open'}
              aria-label={isSidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </div>

          <div className="side-panel-scroll">
            {/* Group 1: S2P & OTP */}
            <div className={`side-nav-group ${activeView === 's2p_otp' ? 'group-active' : ''}`}>
              <button
                type="button"
                className={`side-nav-item ${activeView === 's2p_otp' ? 'active' : ''}`}
                onClick={() => setActiveView('s2p_otp')}
                title="S2P, OTP, DPH & DSR Summary"
              >
                <span className="side-nav-icon" aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </span>
                <span className="side-nav-label">S2P &amp; OTP</span>
              </button>

              <div className="side-subnav-list">
                <button
                  type="button"
                  className={`side-subnav-item ${activeView === 's2p_otp' ? 'active' : ''}`}
                  onClick={() => setActiveView('s2p_otp')}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">Daily S2P, OTP &amp; DPH</span>
                </button>
              </div>
            </div>

            {/* Group 2: Planning */}
            <div className={`side-nav-group ${activeView === 'planning' ? 'group-active' : ''}`}>
              <button
                type="button"
                className={`side-nav-item ${activeView === 'planning' ? 'active' : ''}`}
                onClick={() => setActiveView('planning')}
                title="Planning & Workforce Sizing"
              >
                <span className="side-nav-icon" aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </span>
                <span className="side-nav-label">Planning</span>
              </button>

              <div className="side-subnav-list">
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'planning' && planningSubView === 'FORWARD_PLAN' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('planning');
                    setPlanningSubView('FORWARD_PLAN');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">Forward Slot Plan</span>
                </button>
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'planning' && planningSubView === 'PLAN_VS_ACTUAL_AUDIT' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('planning');
                    setPlanningSubView('PLAN_VS_ACTUAL_AUDIT');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">Plan vs Actual Audit</span>
                  <span className="side-subnav-tag">Audit</span>
                </button>
              </div>
            </div>

            {/* Group 3: Rider Analytics */}
            <div className={`side-nav-group ${activeView === 'analytics' ? 'group-active' : ''}`}>
              <button
                type="button"
                className={`side-nav-item ${activeView === 'analytics' ? 'active' : ''}`}
                onClick={() => setActiveView('analytics')}
                title="Rider Analytics & Management"
              >
                <span className="side-nav-icon" aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                <span className="side-nav-label">Rider Analytics</span>
              </button>

              <div className="side-subnav-list">
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'analytics' && analyticsSubView === 'performance' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('analytics');
                    setAnalyticsSubView('performance');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">Rider Performance</span>
                </button>
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'analytics' && analyticsSubView === 'management' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('analytics');
                    setAnalyticsSubView('management');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">Rider Management</span>
                </button>
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'analytics' && analyticsSubView === 'new-riders' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('analytics');
                    setAnalyticsSubView('new-riders');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">New Rider Onboarding</span>
                  <span className="side-subnav-tag">7D</span>
                </button>
              </div>
            </div>

            {/* Group 4: Data Ingestion */}
            <div className={`side-nav-group ${activeView === 'upload' ? 'group-active' : ''}`}>
              <button
                type="button"
                className={`side-nav-item ${activeView === 'upload' ? 'active' : ''}`}
                onClick={() => setActiveView('upload')}
                title="Data Ingestion & Uploads"
              >
                <span className="side-nav-icon" aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </span>
                <span className="side-nav-label">Data Ingestion</span>
              </button>

              <div className="side-subnav-list">
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'upload' && uploadSubView === 'orders' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('upload');
                    setUploadSubView('orders');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">Daily Orders</span>
                </button>
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'upload' && uploadSubView === 'riders' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('upload');
                    setUploadSubView('riders');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">Active Riders Roster</span>
                </button>
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'upload' && uploadSubView === 'dnr' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('upload');
                    setUploadSubView('dnr');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">DNR Reports</span>
                </button>
                <button
                  type="button"
                  className={`side-subnav-item ${
                    activeView === 'upload' && uploadSubView === 'snop' ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveView('upload');
                    setUploadSubView('snop');
                  }}
                >
                  <span className="subnav-dot" />
                  <span className="side-subnav-label">SNOP Forecast</span>
                </button>
              </div>
            </div>
          </div>

          {/* Dedicated Side Panel Footer: User Info & Sign Out */}
          <div className="side-panel-footer">
            <div className="side-user-card" title={currentUser.email}>
              <div className="side-user-avatar" aria-hidden="true">
                {currentUser.email.slice(0, 1).toUpperCase()}
              </div>
              <div className="side-user-details">
                <span className={`side-user-role-badge ${currentUser.role === 'admin' ? 'role-admin' : 'role-store'}`}>
                  {currentUser.role === 'admin' ? 'Admin' : currentUser.store_code ?? 'Store'}
                </span>
                <span className="side-user-email" title={currentUser.email}>
                  {currentUser.email}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="side-signout-btn"
              onClick={() => void handleSignOut()}
              title={`Sign out (${currentUser.email})`}
              aria-label="Sign out"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="side-signout-text">Sign Out</span>
            </button>
          </div>
        </aside>

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

          {activeView === 'planning' && (
            <PlanningSection
              stores={stores}
              selectedStoreId={selectedStoreId}
              onSelectStoreId={setSelectedStoreId}
              currentUser={currentUser}
              planningMode={planningSubView}
              onChangePlanningMode={setPlanningSubView}
              onNavigateToUploadSnop={() => {
                setActiveView('upload');
                setUploadSubView('snop');
              }}
            />
          )}

          {activeView === 'analytics' && (
            <AnalyticsSection
              stores={stores}
              selectedStoreId={selectedStoreId}
              onSelectStoreId={setSelectedStoreId}
              currentUser={currentUser}
              activeTab={analyticsSubView}
              onChangeTab={setAnalyticsSubView}
            />
          )}

          {activeView === 'upload' && (
            <UploadWorkspace
              stores={stores}
              selectedStoreId={selectedStoreId}
              onSelectStoreId={setSelectedStoreId}
              currentUser={currentUser}
              uploadType={uploadSubView}
              onChangeUploadType={setUploadSubView}
              onNavigateToPlanning={() => {
                setActiveView('planning');
                setPlanningSubView('FORWARD_PLAN');
              }}
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
    </div>
  );
};

export default App;
