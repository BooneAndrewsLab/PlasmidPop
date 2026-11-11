import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TableSpacer } from './TableSpacer';

describe('TableSpacer', () => {
  it('is one hidden row of the given height spanning the given columns', () => {
    const { container } = render(
      <table>
        <tbody>
          <TableSpacer height={140} columns={7} />
        </tbody>
      </table>,
    );
    const row = container.querySelector('tr.wst__spacer');
    expect(row?.getAttribute('aria-hidden')).toBe('true');
    expect((row as HTMLElement).style.height).toBe('140px');
    expect(row?.querySelector('td')?.getAttribute('colspan')).toBe('7');
  });
});
