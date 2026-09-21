import { type ReactNode } from 'react';

import {
  type Block,
  type Inline,
  anchorTarget,
  guideLinkTarget,
  headingSlug,
  parseMarkdown,
  plainText,
} from './markdown';

interface Props {
  readonly markdown: string;
  /** Called for links to other guide pages; other links open in a new tab. */
  readonly onNavigate: (pageId: string) => void;
  /** Called for a `#…` link, with the id of the heading it points at. */
  readonly onAnchor: (slug: string) => void;
}

function renderInlines(
  inlines: readonly Inline[],
  onNavigate: Props['onNavigate'],
  onAnchor: Props['onAnchor'],
): ReactNode[] {
  return inlines.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'strong':
        return <strong key={i}>{renderInlines(node.children, onNavigate, onAnchor)}</strong>;
      case 'em':
        return <em key={i}>{renderInlines(node.children, onNavigate, onAnchor)}</em>;
      case 'link': {
        // A link into the same page scrolls rather than opening a tab: the
        // guide is a dialog, and `#working-copies` is not a URL here.
        const anchor = anchorTarget(node.href);
        if (anchor !== null) {
          return (
            <button
              key={i}
              type="button"
              className="help__page-link"
              onClick={() => {
                onAnchor(anchor);
              }}
            >
              {renderInlines(node.children, onNavigate, onAnchor)}
            </button>
          );
        }
        const page = guideLinkTarget(node.href);
        if (page !== null) {
          return (
            <button
              key={i}
              type="button"
              className="help__page-link"
              onClick={() => {
                onNavigate(page);
              }}
            >
              {renderInlines(node.children, onNavigate, onAnchor)}
            </button>
          );
        }
        return (
          <a key={i} href={node.href} target="_blank" rel="noreferrer">
            {renderInlines(node.children, onNavigate, onAnchor)}
          </a>
        );
      }
    }
  });
}

function renderBlock(
  block: Block,
  key: number,
  onNavigate: Props['onNavigate'],
  onAnchor: Props['onAnchor'],
): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const content = renderInlines(block.children, onNavigate, onAnchor);
      // Every heading is a target: a `#…` link in the guide scrolls to it,
      // and so does the guide opened at a section from elsewhere in the app.
      const id = headingSlug(plainText(block.children));
      // The page title is an h2 (the dialog's title is the h1 of the help), sections h3/h4.
      if (block.level === 1)
        return (
          <h2 key={key} id={id}>
            {content}
          </h2>
        );
      if (block.level === 2)
        return (
          <h3 key={key} id={id}>
            {content}
          </h3>
        );
      return (
        <h4 key={key} id={id}>
          {content}
        </h4>
      );
    }
    case 'paragraph':
      return <p key={key}>{renderInlines(block.children, onNavigate, onAnchor)}</p>;
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>{renderInlines(item, onNavigate, onAnchor)}</li>
      ));
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case 'code':
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <table key={key}>
          <thead>
            <tr>
              {block.header.map((cell, i) => (
                <th key={i}>{renderInlines(cell, onNavigate, onAnchor)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{renderInlines(cell, onNavigate, onAnchor)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

/** Renders guide Markdown (see `markdown.ts` for the supported subset). */
export function Markdown({ markdown, onNavigate, onAnchor }: Props) {
  return <>{parseMarkdown(markdown).map((b, i) => renderBlock(b, i, onNavigate, onAnchor))}</>;
}
