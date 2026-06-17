import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKioskMode } from '../hooks/useKioskMode';
import { User, ShoppingBag } from 'lucide-react';
import { format } from 'date-fns';
import RanawLogo from '../components/RanawLogo';

export default function KioskPage() {
  const navigate = useNavigate();
  const [time, setTime] = useState(new Date());
  const [hasInteracted, setHasInteracted] = useState(false);

  // Kiosk logic: Reset to self (or refresh) on 60s idle
  const handleIdle = () => {
    // Hard refresh or re-navigate to root kiosk page
    window.location.reload();
  };

  const { requestFullscreen } = useKioskMode(handleIdle, 60000);

  // Live Clock Update
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // First interaction handler to initiate fullscreen
  const handleFirstTouch = () => {
    if (!hasInteracted) {
      setHasInteracted(true);
      requestFullscreen();
    }
  };

  return (
    <div
      className="min-h-screen bg-[#0a0e1a] text-white flex flex-col font-sans relative overflow-hidden"
      onClick={handleFirstTouch}
      onTouchStart={handleFirstTouch}
    >
      {/* Optional Animated Background / Glass effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-emerald-600/10 rounded-full blur-[150px] pointer-events-none" />

      {/* 1. TOP BAR / HEADER */}
      <header className="flex justify-between items-center p-8 bg-slate-900/40 backdrop-blur-md border-b border-slate-800/50 z-10">
        <div className="flex items-center gap-4 w-1/3">
          <RanawLogo variant="nav" className="shrink-0 scale-110 origin-left" />
        </div>



        <div className="w-1/3 text-right">
          <div className="text-2xl font-bold tracking-wider text-cyan-50">
            {format(time, 'hh:mm:ss a')}
          </div>
          <div className="text-sm font-medium text-slate-400 uppercase tracking-widest mt-1">
            {format(time, 'EEEE, MMMM d, yyyy')}
          </div>
        </div>
      </header>

      {/* 2. HERO / BRANDING SECTION */}
      <main className="flex-1 flex flex-col items-center justify-center p-8 z-10">
        <div className="text-center mb-16 animate-in fade-in slide-in-from-bottom-8 duration-1000">
          <h2 className="text-5xl md:text-7xl font-extrabold text-white mb-6 drop-shadow-2xl">
            Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">RANAW PICKLEBALL COURT</span>
          </h2>
          <p className="text-xl md:text-2xl text-slate-300 font-light max-w-2xl mx-auto tracking-wide">
            Your Premium Pickleball & Food Court Experience
          </p>
        </div>

        {/* 3. MAIN ACTION AREA */}
        <div className="flex flex-col md:flex-row gap-8 w-full max-w-5xl justify-center items-stretch px-4">

          {/* BUTTON 1: Sign Up / Login */}
          <a
            href="https://pickleball-app-inky.vercel.app/"
            className="group flex-1 bg-slate-800/80 hover:bg-cyan-600 border border-slate-700 hover:border-cyan-400 backdrop-blur-md rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all duration-300 shadow-2xl hover:shadow-cyan-500/20 active:scale-95 min-h-[250px] cursor-pointer"
          >
            <div className="w-20 h-20 bg-slate-900 group-hover:bg-cyan-700 rounded-2xl flex items-center justify-center mb-6 transition-colors shadow-inner">
              <User size={40} className="text-cyan-400 group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-3xl font-bold text-white mb-3 tracking-wide">Sign Up / Login</h3>
            <p className="text-slate-400 group-hover:text-cyan-100 text-lg">Access your player account</p>
          </a>

          {/* BUTTON 2: Order Food */}
          <button
            onClick={() => navigate('/foodcourt')}
            className="group flex-1 bg-slate-800/80 hover:bg-emerald-600 border border-slate-700 hover:border-emerald-400 backdrop-blur-md rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all duration-300 shadow-2xl hover:shadow-emerald-500/20 active:scale-95 min-h-[250px] cursor-pointer"
          >
            <div className="w-20 h-20 bg-slate-900 group-hover:bg-emerald-700 rounded-2xl flex items-center justify-center mb-6 transition-colors shadow-inner">
              <ShoppingBag size={40} className="text-emerald-400 group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-3xl font-bold text-white mb-3 tracking-wide">Order</h3>
            <p className="text-slate-400 group-hover:text-emerald-100 text-lg">Order from our food court</p>
          </button>

        </div>
      </main>

      {/* 4. FOOTER */}
      <footer className="p-8 text-center z-10 border-t border-slate-800/50 bg-slate-900/30">
        <p className="text-slate-500 text-sm mb-2 font-medium tracking-widest uppercase">
          {!hasInteracted ? "Tap anywhere to start" : "Tap a button above to continue"}
        </p>
        <p className="text-slate-600 text-xs">
          &copy; 2026 RANAW SYSTEM. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
