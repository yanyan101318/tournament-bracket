import { useState, useEffect } from "react";
import { subscribeToTournamentV2, subscribeToDivisions, subscribeToTeams } from "../../services/tournamentV2Service";
import InfoTab from "./tabs/InfoTab";
import DivisionsTab from "./tabs/DivisionsTab";
import TeamsTab from "./tabs/TeamsTab";
import PoolsTab from "./tabs/PoolsTab";
import BracketsTab from "./tabs/BracketsTab";
import CourtsTabV2 from "./tabs/CourtsTabV2";

const TABS = [
  { id: "info", label: "Info" },
  { id: "divisions", label: "Divisions" },
  { id: "teams", label: "Teams" },
  { id: "pools", label: "Initial Brackets" },
  { id: "brackets", label: "Medal Brackets" },
  { id: "courts", label: "Courts" },
];

export default function TournamentTabs({ tournamentId, onBack }) {
  const [activeTab, setActiveTab] = useState("info");
  const [tournament, setTournament] = useState(null);
  const [divisions, setDivisions] = useState([]);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    const unsubT = subscribeToTournamentV2(tournamentId, setTournament);
    const unsubD = subscribeToDivisions(tournamentId, setDivisions);
    const unsubTm = subscribeToTeams(tournamentId, setTeams);
    return () => { unsubT(); unsubD(); unsubTm(); };
  }, [tournamentId]);

  if (!tournament) return <div className="ad-loading"><div className="ad-spinner" /></div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-6">
        <button className="p-2 bg-slate-800 rounded-lg text-slate-300 hover:text-white" onClick={onBack}>
          &larr; Back
        </button>
        <div>
          <h2 className="text-xl font-bold text-white leading-none">{tournament.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] uppercase font-bold text-slate-400">ID: {tournamentId}</span>
            <span className="text-[10px] text-slate-500">|</span>
            <a href={`/tournament-v2/${tournamentId}`} target="_blank" rel="noreferrer" className="text-[10px] uppercase font-bold text-cyan-400 hover:underline flex items-center gap-1">
              Public Link <span className="material-symbols-outlined text-[10px]">open_in_new</span>
            </a>
            <span className="text-[10px] text-slate-500">|</span>
            <a href={`/tournament-v2/${tournamentId}/led-wall`} target="_blank" rel="noreferrer" className="text-[10px] uppercase font-bold text-[#CCFF00] hover:underline flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">desktop_windows</span> Open LED Wall
            </a>
          </div>
        </div>
      </div>

      <div className="ad-filter-tabs flex-wrap mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ad-filter-tab ${activeTab === t.id ? "active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 bg-[#151e2d] border border-slate-800 rounded-xl p-4 sm:p-6 overflow-y-auto">
        {activeTab === "info" && <InfoTab tournament={tournament} onBack={onBack} />}
        {activeTab === "divisions" && <DivisionsTab tournamentId={tournamentId} divisions={divisions} />}
        {activeTab === "teams" && <TeamsTab tournamentId={tournamentId} divisions={divisions} teams={teams} />}
        {activeTab === "pools" && <PoolsTab tournamentId={tournamentId} divisions={divisions} teams={teams} />}
        {activeTab === "brackets" && <BracketsTab tournamentId={tournamentId} divisions={divisions} />}
        {activeTab === "courts" && <CourtsTabV2 tournamentId={tournamentId} />}
      </div>
    </div>
  );
}
