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

  function handleCreateRoom() {
    if (!displayName.trim()) return;
    setIsJoining(true);
    const room = uuidv4().slice(0, 8);
    router.push(`${basePath}/${room}?name=${encodeURIComponent(displayName.trim())}`);
  }

  const sfuFeatures = [
    { icon: '⚡', label: 'Ultra-low latency' },
    { icon: '🔒', label: 'End-to-end encrypted' },
    { icon: '👥', label: 'Scales to large groups' },
  ];

  const p2pFeatures = [
    { icon: '🔗', label: 'Direct peer connections' },
    { icon: '🔒', label: 'End-to-end encrypted' },
    { icon: '🖥️', label: 'No media server needed' },
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
          <span className="logo-icon">📹</span>
          <h1 className="logo-title">FaceTime</h1>
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
            <span className="mode-btn-icon">⚡</span>
            <span className="mode-btn-label">SFU Mode</span>
            <span className="mode-btn-desc">Scalable · Server-routed</span>
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === 'p2p' ? 'mode-btn--active' : ''}`}
            onClick={() => setMode('p2p')}
          >
            <span className="mode-btn-icon">🔗</span>
            <span className="mode-btn-label">P2P Mesh</span>
            <span className="mode-btn-desc">Direct · Browser-to-browser</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="lobby-form">
          {/* Display name */}
          <div className="form-group">
            <label htmlFor="displayName" className="form-label">
              Your Name
            </label>
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
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCreateRoom}
              disabled={!displayName.trim() || isJoining}
            >
              + Create New Room
            </button>
          </div>
        </form>

        <div className="lobby-features">
          {features.map((f) => (
            <div key={f.label} className="feature">
              <span className="feature-icon">{f.icon}</span>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
