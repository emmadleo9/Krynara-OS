import React, { useEffect, useState } from 'react';
import { fetchJson } from '../../utils/fetchJson';

/**
 * Simple folder/tab management for the Telegram‑clone.
 * Stores folder definitions in a JSON file (folders.json) inside the project.
 * Allows creating, renaming, re‑ordering and deleting folders.
 */
interface Folder {
  id: string;
  name: string;
  order: number;
}

export const FolderTabs: React.FC<{ activeFolderId: string; onSelect: (id: string) => void }> = ({ activeFolderId, onSelect }) => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [newName, setNewName] = useState('');

  // Load folders from the backend (simple JSON file exposed via a static route)
  useEffect(() => {
    fetchJson<Folder[]>('/api/telegram/folders')
      .then(setFolders)
      .catch(() => setFolders([]));
  }, []);

  const saveFolders = (updated: Folder[]) => {
    // optimistic UI
    setFolders(updated);
    fetchJson('/api/telegram/folders', { method: 'POST', body: JSON.stringify(updated) })
      .catch(() => {
        // revert on error
        fetchJson<Folder[]>('/api/telegram/folders').then(setFolders);
      });
  };

  const addFolder = () => {
    if (!newName.trim()) return;
    const newFolder: Folder = { id: crypto.randomUUID(), name: newName.trim(), order: folders.length };
    saveFolders([...folders, newFolder]);
    setNewName('');
  };

  const renameFolder = (id: string, name: string) => {
    const updated = folders.map((f) => (f.id === id ? { ...f, name } : f));
    saveFolders(updated);
  };

  const deleteFolder = (id: string) => {
    const updated = folders.filter((f) => f.id !== id);
    saveFolders(updated);
  };

  const moveFolder = (id: string, direction: 'up' | 'down') => {
    const idx = folders.findIndex((f) => f.id === id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= folders.length) return;
    const newOrder = [...folders];
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
    // re‑assign order numbers
    const reordered = newOrder.map((f, i) => ({ ...f, order: i }));
    saveFolders(reordered);
  };

  return (
    <div className="folder-tabs">
      <div className="tabs-list">
        {folders
          .sort((a, b) => a.order - b.order)
          .map((folder) => (
            <div
              key={folder.id}
              className={`folder-tab ${folder.id === activeFolderId ? 'active' : ''}`}
              onClick={() => onSelect(folder.id)}
            >
              <span>{folder.name}</span>
              <div className="tab-actions">
                <button onClick={(e) => { e.stopPropagation(); renameFolder(folder.id, prompt('New name', folder.name) ?? folder.name); }}>✏️</button>
                <button onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }}>🗑️</button>
                <button onClick={(e) => { e.stopPropagation(); moveFolder(folder.id, 'up'); }}>🔼</button>
                <button onClick={(e) => { e.stopPropagation(); moveFolder(folder.id, 'down'); }}>🔽</button>
              </div>
            </div>
          ))}
      </div>
      <div className="new-folder">
        <input
          type="text"
          placeholder="New folder name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button onClick={addFolder}>Add</button>
      </div>
    </div>
  );
};
