// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type Assembly,
  alignEitherStrand,
  assembleReads,
  findReadPairs,
  reverseComplement,
} from '@/core';

import { AssemblyResult } from './AssemblyResult';

afterEach(cleanup);

/** Integer-only, so the bases are the same everywhere. */
function randomBases(n: number, seed: number): string {
  let x = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out += 'ACGT'.charAt((x >>> 8) % 4);
  }
  return out;
}

async function assemble(truth: string, spans: readonly (readonly [number, number])[]) {
  const reads = spans.map(([a, b], i) => ({
    name: `read${i + 1}`,
    sequence: truth.slice(a, b),
    qualities: new Array<number>(b - a).fill(40),
  }));
  const assembly: Assembly = await assembleReads(reads, {
    align: (a, b, o) => Promise.resolve(alignEitherStrand(a, b, o)),
  });
  return { assembly, names: reads.map((r) => r.name) };
}

const repeat = randomBases(200, 74);
/** U1 R U2 R U3, the copies at 300-500 and 700-900. */
const repeated =
  randomBases(300, 71) + repeat + randomBases(200, 72) + repeat + randomBases(300, 73);

describe('AssemblyResult warnings (#347)', () => {
  it('says a repeat may have fooled the assembly, lists each warning and shades its stretch', async () => {
    // Reads from inside the two copies, with a flank each side, pile onto one copy.
    const { assembly, names } = await assemble(repeated, [
      [0, 440],
      [760, 1200],
      [320, 480],
      [720, 880],
      [330, 470],
      [730, 870],
    ]);
    expect(assembly.contigs[0]?.warnings.map((w) => w.kind)).toEqual(['possible-repeat-collapse']);
    const { container } = render(<AssemblyResult assembly={assembly} readNames={names} />);
    expect(screen.getByText(/A repeat may have fooled the assembly/)).toBeVisible();
    const list = screen.getByRole('list', { name: 'Contig warnings' });
    expect(list).toHaveTextContent(/two copies of a repeat/);
    expect(container.querySelectorAll('rect.assembly__warned')).toHaveLength(1);
    expect(screen.getByText(/the shaded stretches are repeat warnings/)).toBeVisible();
  });

  it('names the read of an ambiguous join', async () => {
    const { assembly, names } = await assemble(repeated, [
      [0, 1200],
      [350, 450],
    ]);
    render(<AssemblyResult assembly={assembly} readNames={names} />);
    expect(screen.getByRole('list', { name: 'Contig warnings' })).toHaveTextContent(
      /read2 fits this contig at more than one place/,
    );
  });

  it('marks a contig that has a warning in the picker, and shows none for one that has none', async () => {
    const warned = await assemble(repeated, [
      [0, 1200],
      [350, 450],
    ]);
    const other = await assemble(randomBases(500, 5), [
      [0, 300],
      [200, 500],
    ]);
    const assembly: Assembly = {
      ...warned.assembly,
      contigs: [...warned.assembly.contigs, ...other.assembly.contigs],
    };
    render(<AssemblyResult assembly={assembly} readNames={warned.names} />);
    const picker = screen.getByRole('combobox', { name: 'Contig' });
    expect(screen.getByRole('option', { name: /Contig 1: .*repeat warning/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Contig 2: 500 bp, 2 reads$/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Contig warnings' })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: '1' } });
    expect(screen.queryByRole('list', { name: 'Contig warnings' })).not.toBeInTheDocument();
    expect(screen.queryByText(/A repeat may have fooled/)).not.toBeInTheDocument();
  });

  describe('the way out: align to a reference', () => {
    const collapse = () =>
      assemble(repeated, [
        [0, 440],
        [760, 1200],
        [320, 480],
        [720, 880],
        [330, 470],
        [730, 870],
      ]);

    it('offers the batch against the open document with a warning, and runs it on click', async () => {
      const { assembly, names } = await collapse();
      const onAlign = vi.fn();
      render(
        <AssemblyResult
          assembly={assembly}
          readNames={names}
          reference={{ name: 'pTest', busy: false, onAlign }}
        />,
      );
      const button = screen.getByRole('button', { name: 'Align these reads to pTest' });
      expect(button).toBeEnabled();
      expect(onAlign).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(onAlign).toHaveBeenCalledTimes(1);
    });

    it('disables the button while a batch runs', async () => {
      const { assembly, names } = await collapse();
      render(
        <AssemblyResult
          assembly={assembly}
          readNames={names}
          reference={{ name: 'pTest', busy: true, onAlign: vi.fn() }}
        />,
      );
      expect(screen.getByRole('button', { name: 'Align these reads to pTest' })).toBeDisabled();
    });

    it('tells the user to open a reference when there is none', async () => {
      const { assembly, names } = await collapse();
      render(<AssemblyResult assembly={assembly} readNames={names} />);
      expect(screen.getByText(/open the plasmid or reference they came from/)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: /Align these reads to/ }),
      ).not.toBeInTheDocument();
    });

    it('offers nothing without a warning', async () => {
      const clean = await assemble(randomBases(500, 5), [
        [0, 300],
        [200, 500],
      ]);
      expect(clean.assembly.contigs[0]?.warnings).toEqual([]);
      render(
        <AssemblyResult
          assembly={clean.assembly}
          readNames={clean.names}
          reference={{ name: 'pTest', busy: false, onAlign: vi.fn() }}
        />,
      );
      expect(
        screen.queryByRole('button', { name: /Align these reads to/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/open the plasmid or reference/)).not.toBeInTheDocument();
    });
  });
});

describe('AssemblyResult read pairs (#347, item 130)', () => {
  const pairedReads = (spans: readonly (readonly [string, number, number, boolean])[]) =>
    spans.map(([name, a, b, reverse]) => {
      const piece = repeated.slice(a, b);
      return {
        name,
        sequence: reverse ? reverseComplement(piece) : piece,
        qualities: new Array<number>(b - a).fill(40),
      };
    });
  const run = async (
    reads: ReturnType<typeof pairedReads>,
    insertSize: number | null,
  ): Promise<{ assembly: Assembly; names: string[] }> => ({
    assembly: await assembleReads(reads, {
      align: (a, b, o) => Promise.resolve(alignEitherStrand(a, b, o)),
      pairs: findReadPairs(reads.map((r) => r.name)).pairs,
      insertSize,
    }),
    names: reads.map((r) => r.name),
  });

  it('says the read pairs do not fit a contig that lost the stretch between mates, and marks it in the picker', async () => {
    const reads = pairedReads([
      ['p_F', 100, 480, false],
      ['p_R', 800, 1160, true],
    ]);
    const { assembly, names } = await run(reads, 1060);
    render(<AssemblyResult assembly={assembly} readNames={names} />);
    expect(screen.getByText(/Read pairs do not fit this layout/)).toBeVisible();
    expect(screen.queryByText(/A repeat may have fooled/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Contig warnings' })).toHaveTextContent(
      /p_F and p_R are mates, but only .* bp apart/,
    );
    expect(screen.getByText(/the shaded stretches are warnings/)).toBeVisible();
    expect(screen.getByText(/1 read pair: 1 does not fit\./)).toBeVisible();
  });

  it('names the picker option of a contig with a pair warning', async () => {
    const reads = pairedReads([
      ['p_F', 100, 480, false],
      ['p_R', 800, 1160, true],
    ]);
    const { assembly, names } = await run(reads, 1060);
    const other = await assemble(randomBases(500, 5), [
      [0, 300],
      [200, 500],
    ]);
    render(
      <AssemblyResult
        assembly={{ ...assembly, contigs: [...assembly.contigs, ...other.assembly.contigs] }}
        readNames={names}
      />,
    );
    expect(
      screen.getByRole('option', { name: /Contig 1: .*read pair warning/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /repeat warning/ })).not.toBeInTheDocument();
  });

  it('with no insert size, says what distances the mates are at and warns of nothing', async () => {
    const reads = pairedReads([
      ['p_F', 100, 480, false],
      ['p_R', 800, 1160, true],
    ]);
    const { assembly, names } = await run(reads, null);
    render(<AssemblyResult assembly={assembly} readNames={names} />);
    expect(screen.queryByRole('list', { name: 'Contig warnings' })).not.toBeInTheDocument();
    expect(screen.getByText(/1 read pair: 1 face each other in a contig\./)).toBeVisible();
    expect(screen.getByText(/are \d+ bp apart; enter the insert size/)).toBeVisible();
  });

  it('lists the contigs the pairs link, with the gap or the overlap', async () => {
    const reads = pairedReads([
      ['x1', 0, 350, false],
      ['k_F', 300, 600, false],
      ['y1', 900, 1200, false],
      ['k_R', 900, 1200, true],
    ]);
    const { assembly, names } = await run(reads, 1000);
    expect(assembly.contigs).toHaveLength(2);
    render(<AssemblyResult assembly={assembly} readNames={names} />);
    const list = screen.getByRole('list', { name: 'Contigs the pairs link' });
    expect(list).toHaveTextContent(
      /Contig 1.* then contig 2.*: 1 pair, (about [\d,]+ bp between them|overlapping by about [\d,]+ bp)/,
    );
    expect(screen.getByText(/1 read pair: 1 join two contigs\./)).toBeVisible();
  });

  it('shows nothing about pairs when none were given', async () => {
    const clean = await assemble(randomBases(500, 5), [
      [0, 300],
      [200, 500],
    ]);
    render(<AssemblyResult assembly={clean.assembly} readNames={clean.names} />);
    expect(screen.queryByText(/read pair/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Contigs the pairs link' })).not.toBeInTheDocument();
  });
});
