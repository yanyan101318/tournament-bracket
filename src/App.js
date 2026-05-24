// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute   from "./auth/ProtectedRoute";

// Auth
import LoginPage    from "./auth/LoginPage";
import RegisterPage from "./auth/RegisterPage";

// Admin
import AdminLayout          from "./admin/AdminLayout";
import AdminDashboard       from "./admin/AdminDashboard";
import CourtManager         from "./admin/CourtManager";
import BookingManager       from "./admin/BookingManager";
import Analytics            from "./admin/Analytics";
import CrmPage               from "./admin/CrmPage";
import AnnouncementManager  from "./admin/AnnouncementManager";
import AdminTournament      from "./admin/AdminTournament";
import AdminSchedule        from "./admin/AdminSchedule";
import Book                 from "./components/Book";
import InventoryPage        from "./admin/InventoryPage";
import PaddleStackingPage   from "./admin/PaddleStackingPage";
import PosPage              from "./admin/PosPage";
import SalesHistoryPage     from "./admin/SalesHistoryPage";

// Tournament public pages (scorer / viewer)
import ScorerPage from "./pages/ScorerPage";
import ViewerPage from "./pages/ViewerPage";
import OrderPage from "./pages/OrderPage";
import PaddleViewerPage from "./pages/PaddleViewerPage";
import PaddleScorerPage from "./pages/PaddleScorerPage";

import "./App.css";
import "./admin/admin.css";
import "./auth/auth.css";
import { Toaster } from "react-hot-toast";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: "#151e2d", color: "#e2e8f0", border: "1px solid #334155" },
          }}
        />
        <Routes>

          {/* ── PUBLIC ── */}
          <Route path="/login"    element={<LoginPage/>}/>
          <Route path="/register" element={<RegisterPage/>}/>

          {/* ── PUBLIC TOURNAMENT VIEWS & ORDERING ── */}
          <Route path="/bracket/:tournamentId"           element={<ViewerPage/>}/>
          <Route path="/score/:tournamentId/:matchId"    element={<ScorerPage/>}/>
          <Route path="/order"                           element={<OrderPage/>}/>
          <Route path="/paddle-viewer"                   element={<PaddleViewerPage/>}/>
          <Route path="/paddle-score/:courtId?"          element={<PaddleScorerPage/>}/>

          {/* ── ADMIN PANEL ── */}
          <Route path="/admin" element={
            <ProtectedRoute requiredRole="admin">
              <AdminLayout/>
            </ProtectedRoute>
          }>
            <Route index                element={<Navigate to="/admin/dashboard" replace/>}/>
            <Route path="dashboard"     element={<AdminDashboard/>}/>
            <Route path="schedule"      element={<AdminSchedule/>}/>
            <Route path="new-booking"   element={<Book/>}/>
            <Route path="courts"        element={<CourtManager/>}/>
            <Route path="bookings"      element={<BookingManager/>}/>
            <Route path="crm"           element={<CrmPage/>}/>
            <Route path="pos"           element={<PosPage/>}/>
            <Route path="sales-history" element={<SalesHistoryPage/>}/>
            <Route path="tournament"    element={<AdminTournament/>}/>
            <Route path="paddle-stack"  element={<PaddleStackingPage/>}/>
            <Route path="analytics"     element={<Analytics/>}/>
            <Route path="equipment"     element={<InventoryPage/>}/>
            <Route path="inventory"       element={<Navigate to="/admin/equipment" replace />}/>
            <Route path="announcements" element={<AnnouncementManager/>}/>
          </Route>

          {/* ── CUSTOMER PANEL (placeholder for Phase 2) ── */}
          <Route path="/user/*" element={
            <ProtectedRoute requiredRole="customer">
              <div style={{padding:"2rem",color:"#fff"}}>
                Customer panel coming soon. Phase 2! 🚀
              </div>
            </ProtectedRoute>
          }/>

          {/* ── FALLBACK ── */}
          <Route path="/" element={<Navigate to="/login" replace/>}/>
          <Route path="*" element={<Navigate to="/login" replace/>}/>

        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}