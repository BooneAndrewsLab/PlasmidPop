import { type DigestProfile, bandProblems, describeBands } from '@/core';

import { useGelOptions } from '../state/useGel';

/**
 * The bands this enzyme alone would give, which is what a diagnostic digest
 * is actually chosen by: a cut count says nothing about whether the pieces
 * can be told apart. Bands that would run together, or off the end of the
 * gel, are said rather than left to be worked out from the numbers.
 */
export function BandLine({ profile }: { readonly profile: DigestProfile | null }) {
  if (profile === null) return null;
  return <BandLineOf profile={profile} />;
}

function BandLineOf({ profile }: { readonly profile: DigestProfile }) {
  const problems = bandProblems(profile, useGelOptions());
  // A single cutter gives one band and no warning: it linearises the
  // plasmid, which is what it is for. The mark is for a lane that hides
  // something, not for one with nothing to say.
  const clear = !profile.misleading;
  return (
    <span
      className={`enzyme-row__bands${clear ? '' : ' enzyme-row__bands--muddy'}`}
      data-tip={
        clear
          ? `On a gel: ${describeBands(profile, 12)}`
          : `On a gel: ${describeBands(profile, 12)} — ${problems.join('; ')}`
      }
    >
      {describeBands(profile)}
      {clear ? '' : ' ⚠'}
    </span>
  );
}
