import { create } from 'zustand';
import type { SquadPlayer } from '@/types/squad';

interface SquadStore {
  squad: SquadPlayer[];
  leagueId: number | null;
  setLeagueId: (id: number) => void;
  setSquad: (players: SquadPlayer[]) => void;
  addPlayer: (player: SquadPlayer) => void;
  removePlayer: (id: number) => void;
}

export const useSquadStore = create<SquadStore>((set) => ({
  squad: [],
  leagueId: null,
  setLeagueId: (id) =>
    set((state) => {
      // Reset squad when switching leagues
      if (state.leagueId !== id) return { leagueId: id, squad: [] };
      return { leagueId: id };
    }),
  setSquad: (players) => set({ squad: players }),
  addPlayer: (player) =>
    set((state) => {
      if (state.squad.some((p) => p.id === player.id)) return state;
      return { squad: [...state.squad, player] };
    }),
  removePlayer: (id) =>
    set((state) => ({ squad: state.squad.filter((p) => p.id !== id) })),
}));
