import { type DragEvent, useState } from 'react';

import { EmptyState } from './components/EmptyState';
import { FeatureList } from './components/FeatureList';
import { LinearSequenceView } from './components/LinearSequenceView';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { openFile } from './openFile';
import { useEditorState } from './state/useEditorStore';

export function App() {
  const { history } = useEditorState();
  const doc = history?.present ?? null;
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file !== undefined) void openFile(file);
  };

  return (
    <div
      className={`app${dragging ? ' app--dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Toolbar doc={doc} />
      {doc === null ? (
        <main className="app__main app__main--empty">
          <EmptyState />
        </main>
      ) : (
        <main className="app__main">
          <LinearSequenceView doc={doc} />
          <FeatureList doc={doc} />
        </main>
      )}
      <StatusBar doc={doc} />
    </div>
  );
}
