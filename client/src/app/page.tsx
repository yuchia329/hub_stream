'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';

type Mode = 'sfu' | 'p2p';

export default function LobbyPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [mode, setMode] = useState<Mode>('sfu');

  const basePath = mode === 'sfu' ? '/room' : '/room-p2p';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setIsJoining(true);
    const room = roomId.trim() || uuidv4().slice(0, 8);
    router.push(`${basePath}/${room}?name=${encodeURIComponent(displayName.trim())}`);
  }

  const sfuFeatures = [
    { label: 'Ultra-low latency' },
    { label: 'End-to-end encrypted' },
    { label: 'Scales to large groups' },
  ];

  const p2pFeatures = [
    { label: 'Direct peer connections' },
    { label: 'End-to-end encrypted' },
    { label: 'No media server needed' },
  ];

  const features = mode === 'sfu' ? sfuFeatures : p2pFeatures;

  return (
    <main className="lobby-page">
      {/* Background orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      <div className="lobby-card">
        {/* Logo */}
        <div className="lobby-logo">
          <h1 className="logo-title">Hubstream</h1>
        </div>
        <p className="lobby-subtitle">
          {mode === 'sfu'
            ? 'Crystal-clear video chat, powered by WebRTC SFU'
            : 'Direct peer-to-peer video chat, no media server'}
        </p>

        {/* Mode selector */}
        <div className="mode-selector">
          <button
            type="button"
            className={`mode-btn ${mode === 'sfu' ? 'mode-btn--active' : ''}`}
            onClick={() => setMode('sfu')}
          >
            SFU Mode
            <span className="mode-btn-desc">Scalable · Server-routed</span>
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === 'p2p' ? 'mode-btn--active' : ''}`}
            onClick={() => setMode('p2p')}
          >
            Mesh P2P
            <span className="mode-btn-desc">Direct · Browser-to-browser</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="lobby-form">
          {/* Display name */}
          <div className="form-group">
            <label htmlFor="displayName" className="form-label">
              Your Name
            </label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              {['🦫 Beaver', '🐹 Hamster', '🐨 Koala'].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDisplayName(n)}
                  style={{
                    flex: 1, padding: '6px', background: 'rgba(255,255,255,0.05)',
                    border: displayName === n ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', color: '#fff', fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              id="displayName"
              type="text"
              placeholder="Enter your name…"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="form-input"
              maxLength={30}
              required
              autoFocus
            />
          </div>

          {/* Room ID */}
          <div className="form-group">
            <label htmlFor="roomId" className="form-label">
              Room ID <span className="label-hint">(leave blank to create new)</span>
            </label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              {['1', '2', '3'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoomId(r)}
                  style={{
                    flex: 1, padding: '6px', background: 'rgba(255,255,255,0.05)',
                    border: roomId === r ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', color: '#fff', fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              id="roomId"
              type="text"
              placeholder="e.g. abc12345"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="form-input"
              maxLength={20}
            />
          </div>

          <div className="lobby-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!displayName.trim() || isJoining}
            >
              {isJoining ? (
                <span className="btn-loading">
                  <span className="spinner" /> Joining…
                </span>
              ) : (
                '→ Join Room'
              )}
            </button>
          </div>
        </form>

        <div className="lobby-features">
          {features.map((f, idx) => (
            <div key={idx} className="feature">
              <span className="feature-label">{f.label}</span>
            </div>
          ))}
        </div>

        <div className="lobby-footer" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <a
            href="https://github.com/yuchia329/hubstream"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text-secondary, #94a3b8)', textDecoration: 'none', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            <svg height="16" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="16" fill="currentColor">
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
            </svg>
            Source Code
          </a>
        </div>
      </div>
    </main>
  );
}
