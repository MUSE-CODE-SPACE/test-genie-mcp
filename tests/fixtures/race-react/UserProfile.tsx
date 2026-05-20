// Intentionally broken: useState setter called after await without mount guard.
// Also: useEffect with async fetch and no AbortController/cleanup.
// Also: forEach with await.
import { useEffect, useState } from 'react';

interface User { id: string; name: string; }

export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<string[]>([]);

  // BAD: async fetch in useEffect, no AbortController, no cleanup.
  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/users/${userId}`);
      const data = await res.json();
      // BAD: setUser may fire after unmount.
      setUser(data);
    }
    load();
  }, [userId]);

  async function refreshAll(ids: string[]) {
    // BAD: forEach with await — silent fire-and-forget.
    ids.forEach(async (id) => {
      const r = await fetch(`/api/posts/${id}`);
      const j = await r.json();
      setPosts((p) => [...p, j.title]);
    });
  }

  return null;
}
