import { buildQueries, queryAllByAttribute, type Matcher } from '@testing-library/react';

/**
 * Queries by the app's tooltip text (item 95): `data-tip` took the place of
 * `title`, which Testing Library's `*ByTitle` read. Used as
 * `getByTip(document.body, 'Zoom in')`, or with a RegExp.
 */
const queryAllByTip = (container: HTMLElement, text: Matcher): HTMLElement[] =>
  queryAllByAttribute('data-tip', container, text);

const [queryByTip, getAllByTip, getByTip, findAllByTip, findByTip] = buildQueries(
  queryAllByTip,
  (_container, text: Matcher) => `Found multiple elements with the tip: ${String(text)}`,
  (_container, text: Matcher) => `Unable to find an element with the tip: ${String(text)}`,
);

export { queryAllByTip, queryByTip, getAllByTip, getByTip, findAllByTip, findByTip };
