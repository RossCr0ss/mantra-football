'use client';

import Image from 'next/image';
import type { SquadPlayer } from '@/types/squad';
import type { PlayerInjuryInfo } from '@/lib/fotmob';
import { isReturningToday } from '@/lib/injuryDate';

export interface InjuryEditForm { name: string; expectedReturnDate: string }

interface Props {
  injuredPlayers: SquadPlayer[];
  injuries: Record<number, PlayerInjuryInfo>;
  editingInjuryId: number | null;
  editForm: InjuryEditForm;
  onEditFormChange: (updater: (f: InjuryEditForm) => InjuryEditForm) => void;
  savingInjury: boolean;
  injuryActionId: number | null;
  refreshingInjuries: boolean;
  onRefresh: () => void;
  onStartEdit: (player: SquadPlayer) => void;
  onCancelEdit: () => void;
  onClear: (playerId: number) => void;
  onResetToFotmob: (playerId: number) => void;
  onSave: (playerId: number) => void;
}

/** Injury report list with quick "Healed" action and inline override editor. Presentational — state lives in TeamSquadView. */
export function InjuryReportSection({
  injuredPlayers, injuries, editingInjuryId, editForm, onEditFormChange, savingInjury, injuryActionId,
  refreshingInjuries, onRefresh, onStartEdit, onCancelEdit, onClear, onResetToFotmob, onSave,
}: Props) {
  if (injuredPlayers.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-red-950 px-2.5 py-1 text-xs font-bold tracking-widest text-red-400">
            INJURIES
          </span>
          <h2 className="text-sm font-semibold text-white">Injury Report</h2>
          <span className="text-xs text-gray-600">({injuredPlayers.length})</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshingInjuries}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          {refreshingInjuries ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="divide-y divide-red-500/10 overflow-hidden rounded-2xl border border-red-500/15">
        {injuredPlayers.map((player) => {
          const info = injuries[player.id];
          const returning = info ? isReturningToday(info) : false;
          const isEditingThis = editingInjuryId === player.id;

          return (
            <div key={player.id} className="bg-red-950/15 px-4 py-4 sm:px-5">
              <div className="flex items-center gap-4">
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-800">
                  <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{player.name}</p>
                  <div className="mt-0.5 flex items-center gap-1">
                    <div className="relative h-3.5 w-3.5 shrink-0">
                      <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`} alt="" fill className="object-contain" unoptimized />
                    </div>
                    <p className="text-xs text-gray-500">{player.position} · {player.teamName}</p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  {info ? (
                    <>
                      <div className="flex items-center justify-end gap-1.5">
                        <p className="text-sm font-semibold text-red-400">{info.name}</p>
                        {info.overridden && (
                          <span className="rounded bg-yellow-900/50 px-1.5 py-0.5 text-xs text-yellow-400">
                            custom
                          </span>
                        )}
                      </div>
                      {returning ? (
                        <p className="mt-0.5 text-xs font-semibold text-green-400">Returns today!</p>
                      ) : info.expectedReturn ? (
                        <p className="text-xs text-gray-500">Return: {info.expectedReturn}</p>
                      ) : (
                        <p className="text-xs text-gray-600">Date unknown</p>
                      )}
                      {info.lastUpdated && (
                        <p className="text-xs text-gray-700">
                          {new Date(info.lastUpdated).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-red-400">Injured</p>
                  )}
                </div>

                <div className="flex shrink-0 gap-1.5">
                  {/* Quick clear — always visible */}
                  {!isEditingThis && (
                    <button
                      onClick={() => onClear(player.id)}
                      disabled={injuryActionId === player.id}
                      className="rounded-lg bg-green-900/40 px-2.5 py-1.5 text-xs font-semibold text-green-400 transition hover:bg-green-900/70 disabled:opacity-40"
                    >
                      {injuryActionId === player.id ? '…' : 'Healed'}
                    </button>
                  )}
                  <button
                    onClick={() => isEditingThis ? onCancelEdit() : onStartEdit(player)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      isEditingThis
                        ? 'bg-white/15 text-white'
                        : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {isEditingThis ? 'Cancel' : 'Edit'}
                  </button>
                </div>
              </div>

              {isEditingThis && (
                <div className="mt-3 rounded-xl border border-white/8 bg-gray-950 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-gray-400">Injury name</span>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => onEditFormChange((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Muscle Strain"
                        className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 transition focus:border-white/25 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-gray-400">Expected return</span>
                      <input
                        type="date"
                        value={editForm.expectedReturnDate}
                        onChange={(e) => onEditFormChange((f) => ({ ...f, expectedReturnDate: e.target.value }))}
                        className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white transition focus:border-white/25 focus:outline-none [color-scheme:dark]"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    {/* Left side: destructive actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => onClear(player.id)}
                        disabled={injuryActionId === player.id}
                        className="rounded-lg bg-green-900/40 px-3 py-1.5 text-xs font-semibold text-green-400 transition hover:bg-green-900/70 disabled:opacity-40"
                      >
                        {injuryActionId === player.id ? '…' : 'Mark as healed'}
                      </button>
                      {info?.overridden && (
                        <button
                          onClick={() => onResetToFotmob(player.id)}
                          disabled={injuryActionId === player.id}
                          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                        >
                          {injuryActionId === player.id ? '…' : 'Use live data'}
                        </button>
                      )}
                    </div>
                    {/* Right: save */}
                    <button
                      onClick={() => onSave(player.id)}
                      disabled={savingInjury || !editForm.name.trim()}
                      className="rounded-lg bg-red-700 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-40"
                    >
                      {savingInjury ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
