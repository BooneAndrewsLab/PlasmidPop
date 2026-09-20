import {
  type Alignment,
  type AlignmentOptions,
  type CutSite,
  type EnzymeSet,
  type Orf,
  type OrfOptions,
  type Topology,
} from '@/core';

/** Requests the main thread sends to the analysis worker. */
export type AnalysisRequest =
  | {
      /**
       * Installs the enzyme set to scan with. Sent once whenever a worker
       * is started, since a worker has its own module state and would
       * otherwise fall back to the bundled table. `set` null means the
       * bundled table.
       */
      readonly id: number;
      readonly kind: 'setEnzymes';
      readonly set: EnzymeSet | null;
    }
  | {
      readonly id: number;
      readonly kind: 'cutSites';
      readonly sequence: string;
      readonly topology: Topology;
      readonly enzymes?: readonly string[];
    }
  | {
      readonly id: number;
      readonly kind: 'orfs';
      readonly sequence: string;
      readonly topology: Topology;
      readonly options: OrfOptions;
    }
  | {
      readonly id: number;
      readonly kind: 'align';
      readonly a: string;
      readonly b: string;
      readonly options: AlignmentOptions;
    };

export type AnalysisResponse =
  | { readonly id: number; readonly kind: 'setEnzymes' }
  | { readonly id: number; readonly kind: 'cutSites'; readonly sites: CutSite[] }
  | { readonly id: number; readonly kind: 'orfs'; readonly orfs: Orf[] }
  | { readonly id: number; readonly kind: 'align'; readonly alignment: Alignment }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
