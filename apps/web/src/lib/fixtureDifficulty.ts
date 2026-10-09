/** Difficulty 1 = hardest (opponent near top of table) … 5 = easiest. See buildTeamFixtures in fixturesCache.ts. */
export const DIFFICULTY_STYLE: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: 'bg-red-600',    text: 'text-red-100',    label: 'Very Hard' },
  2: { bg: 'bg-orange-500', text: 'text-orange-950', label: 'Hard'      },
  3: { bg: 'bg-yellow-500', text: 'text-yellow-950', label: 'Medium'    },
  4: { bg: 'bg-green-500',  text: 'text-green-950',  label: 'Easy'      },
  5: { bg: 'bg-green-700',  text: 'text-green-100',  label: 'Very Easy' },
};
