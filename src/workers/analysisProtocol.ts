import { type CutSite, type Orf, type OrfOptions, type Topology } from '@/core';

/** Requests the main thread sends to the analysis worker. */
export type AnalysisRequest =
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
    };

export type AnalysisResponse =
  | { readonly id: number; readonly kind: 'cutSites'; readonly sites: CutSite[] }
  | { readonly id: number; readonly kind: 'orfs'; readonly orfs: Orf[] }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
