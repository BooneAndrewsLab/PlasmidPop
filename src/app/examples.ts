import pBR322 from '@/io/fixtures/J01749.gb?raw';

export interface Example {
  readonly id: string;
  readonly label: string;
  readonly fileName: string;
  readonly text: string;
}

export const EXAMPLES: readonly Example[] = [
  { id: 'pbr322', label: 'pBR322 (4,361 bp, circular)', fileName: 'pBR322.gb', text: pBR322 },
];
