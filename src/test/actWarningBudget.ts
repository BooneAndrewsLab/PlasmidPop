/**
 * How many "not wrapped in act(...)" warnings each DOM test file may still
 * print (#324); a file not listed may print none. `setup.ts` fails a file
 * that goes over, so a new warning cannot join the noise unseen.
 *
 * What is left comes from the app's start-up restore and a few components'
 * storage reads finishing while a synchronous test runs, so a file's count
 * differs by a few from run to run (`compare.test.tsx` printed 3 and 4):
 * each number here is a ceiling a little above what was seen (63 in all, from
 * 3,470), not an exact count. Lower one when its file is fixed (`await` what
 * is pending in the test, or wrap the store call in `act`); never raise one.
 */
export const actWarningBudget: Readonly<Record<string, number>> = {
  'src/app/components/BrowseFiles.test.tsx': 25,
  'src/app/protein.test.tsx': 20,
  'src/app/circularCaret.test.tsx': 20,
  'src/app/components/EmptyState.test.tsx': 14,
  'src/app/components/NcbiSearch.test.tsx': 8,
  'src/app/components/ExportFigureDialog.test.tsx': 6,
  'src/app/components/CrisprPanel.test.tsx': 6,
  'src/app/compare.test.tsx': 8,
  'src/app/components/PrimerCollection.test.tsx': 5,
  'src/app/components/CloningDesign.test.tsx': 4,
};
