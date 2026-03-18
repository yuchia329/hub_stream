'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { UseRoomResult, RemoteParticipant, ChatMessage } from './useRoom';

// Global lock to prevent concurrent getUserMedia calls
let gumLock = Promise.resolve();

const getP2PWsUrl = () => {
    if (typeof window === 'undefined') return '';
    if (process.env.NEXT_PUBLIC_WS_URL) {
        return process.env.NEXT_PUBLIC_WS_URL.replace('/ws', '/ws-p2p');
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws-p2p`;
};

// ─── ICE config ──────────────────────────────────────────────────────────────
const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useRoomP2P(roomId: string, displayName: string): UseRoomResult {
    const wsRef = useRef<WebSocket | null>(null);

    // peerId → { pc, stream, displayName }
    const peerConnectionsRef = useRef<
        Map<string, { pc: RTCPeerConnection; stream: MediaStream; displayName: string }>
    >(new Map());

    const localStreamRef = useRef<MediaStream | null>(null);
    const localPeerIdRef = useRef<string>('');

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

    // Sync participants array from ref map
    function syncParticipants() {
        setParticipants(
            [...peerConnectionsRef.current.entries()].map(([pid, { stream, displayName: dn }]) => ({
                peerId: pid,
                displayName: dn,
                stream,
                isCamPaused: false,
            }))
        );
    }

    // ── WebSocket helpers ─────────────────────────────────────────────────────

    function wsSend(type: string, data?: unknown) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({ type, data }));
    }

    // ── Create an RTCPeerConnection for a remote peer ─────────────────────────

    function createPeerConnection(remotePeerId: string, remoteDisplayName: string): RTCPeerConnection {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        const remoteStream = new MediaStream();

        peerConnectionsRef.current.set(remotePeerId, {
            pc,
            stream: remoteStream,
            displayName: remoteDisplayName,
        });

        // Add all local tracks
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStreamRef.current!);
            });
        }

        pc.ontrack = ({ track }) => {
            const entry = peerConnectionsRef.current.get(remotePeerId);
            if (entry) {
                entry.stream.addTrack(track);
                syncParticipants();
            }
        };

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                wsSend('iceCandidate', { targetPeerId: remotePeerId, candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                peerConnectionsRef.current.delete(remotePeerId);
                syncParticipants();
            }
        };

        return pc;
    }

    // ── Main init effect ──────────────────────────────────────────────────────

    useEffect(() => {
        if (!roomId || !displayName) return;

        let cancelled = false;
        let localWs: WebSocket | null = null;
        let localMediaStream: MediaStream | null = null;

        async function init() {
            // Check for multiple cameras
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                setHasMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1);
            } catch (e) {
                console.warn('Could not enumerate devices', e);
            }

            // 1. Get local media (serialized)
            await gumLock;
            let releaseLock: () => void;
            gumLock = new Promise((r) => { releaseLock = r as () => void; });

            let stream: MediaStream;
            try {
                if (cancelled) { releaseLock!(); return; }
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                    audio: { echoCancellation: true, noiseSuppression: true },
                });
            } finally {
                releaseLock!();
            }

            localMediaStream = stream;
            localStreamRef.current = stream;
            if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
            setLocalStream(stream);

            // 2. Connect WebSocket
            await new Promise<void>((resolve, reject) => {
                localWs = new WebSocket(getP2PWsUrl());
                wsRef.current = localWs;
                localWs.onopen = () => resolve();
                localWs.onerror = () => reject(new Error('P2P WebSocket connection failed'));

                localWs.onmessage = async (evt) => {
                    const msg = JSON.parse(evt.data as string) as {
                        type: string;
                        id?: string;
                        data: Record<string, unknown>;
                    };
                    const { type, data } = msg;

                    // Route signaling messages
                    switch (type) {
                        case 'joined': {
                            const { peerId, existingPeers } = data as {
                                peerId: string;
                                existingPeers: { peerId: string; displayName: string }[];
                            };
                            localPeerIdRef.current = peerId;
                            setIsConnected(true);

                            // Create offers to all existing peers
                            for (const ep of existingPeers) {
                                const pc = createPeerConnection(ep.peerId, ep.displayName);
                                const offer = await pc.createOffer();
                                await pc.setLocalDescription(offer);
                                wsSend('offer', { targetPeerId: ep.peerId, sdp: offer });
                            }
                            break;
                        }

                        case 'peerJoined': {
                            const { peerId: remotePeerId, displayName: remoteDn } = data as {
                                peerId: string;
                                displayName: string;
                            };
                            // The new peer will send us an offer; register the entry now
                            // so ontrack fires into the right stream
                            createPeerConnection(remotePeerId, remoteDn);
                            break;
                        }

                        case 'offer': {
                            const { fromPeerId, sdp } = data as { fromPeerId: string; sdp: RTCSessionDescriptionInit };
                            let entry = peerConnectionsRef.current.get(fromPeerId);
                            let pc: RTCPeerConnection;
                            if (!entry) {
                                // Peer joined just before we processed peerJoined
                                pc = createPeerConnection(fromPeerId, 'Peer');
                            } else {
                                pc = entry.pc;
                            }
                            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                            const answer = await pc.createAnswer();
                            await pc.setLocalDescription(answer);
                            wsSend('answer', { targetPeerId: fromPeerId, sdp: answer });
                            syncParticipants();
                            break;
                        }

                        case 'answer': {
                            const { fromPeerId, sdp } = data as { fromPeerId: string; sdp: RTCSessionDescriptionInit };
                            const entry = peerConnectionsRef.current.get(fromPeerId);
                            if (entry) {
                                await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
                            }
                            break;
                        }

                        case 'iceCandidate': {
                            const { fromPeerId, candidate } = data as {
                                fromPeerId: string;
                                candidate: RTCIceCandidateInit;
                            };
                            const entry = peerConnectionsRef.current.get(fromPeerId);
                            if (entry && candidate) {
                                try {
                                    await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
                                } catch (e) {
                                    console.warn('[P2P] Failed to add ICE candidate', e);
                                }
                            }
                            break;
                        }

                        case 'peerLeft': {
                            const { peerId: leftPeerId } = data as { peerId: string };
                            const entry = peerConnectionsRef.current.get(leftPeerId);
                            if (entry) {
                                entry.pc.close();
                                peerConnectionsRef.current.delete(leftPeerId);
                                syncParticipants();
                            }
                            break;
                        }

                        case 'chatMsg': {
                            setChatMessages((prev) => [...prev, data as unknown as ChatMessage]);
                            break;
                        }

                        default:
                            break;
                    }
                };

                localWs.onclose = () => setIsConnected(false);
            });

            if (cancelled) { localWs?.close(); return; }

            // 3. Join room
            wsSend('join', { roomId, displayName });
        }

        init().catch((err) => {
            if (cancelled) return;
            console.error('[useRoomP2P] init error:', err);
            setError(err instanceof Error ? err.message : String(err));
        });

        return () => {
            cancelled = true;
            // Close all peer connections
            peerConnectionsRef.current.forEach(({ pc }) => pc.close());
            peerConnectionsRef.current.clear();
            localWs?.close();
            wsRef.current?.close();
            localMediaStream?.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
            setLocalStream(null);
            setParticipants([]);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId, displayName]);

    // ── Controls ───────────────────────────────────────────────────────────────

    const toggleMic = useCallback(() => {
        if (!localStream) return;
        localStream.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
        setIsMuted((m) => !m);
    }, [localStream]);

    const toggleCam = useCallback(() => {
        if (!localStream) return;
        localStream.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
        setIsCamOff((c) => !c);
    }, [localStream]);

    const switchCamera = useCallback(async () => {
        if (!localStream) return;
        // No mediasoup producer to replace — just update the local stream tracks
        // and replace the track in all peer connections
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
        const newTrack = newStream.getVideoTracks()[0];
        peerConnectionsRef.current.forEach(({ pc }) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(newTrack);
        });
        setLocalStream((prev) => {
            if (!prev) return null;
            prev.getVideoTracks().forEach((t) => { t.stop(); prev.removeTrack(t); });
            prev.addTrack(newTrack);
            return prev;
        });
        localStreamRef.current = localStream;
    }, [localStream]);

    const sendChat = useCallback((text: string) => {
        if (!text.trim()) return;
        wsSend('chat', { text });
        setChatMessages((prev) => [
            ...prev,
            {
                id: Math.random().toString(36).slice(2),
                peerId: 'local',
                displayName,
                text,
                timestamp: Date.now(),
            },
        ]);
    }, [displayName]);

    const leave = useCallback(() => {
        wsSend('leave');
        peerConnectionsRef.current.forEach(({ pc }) => pc.close());
        peerConnectionsRef.current.clear();
        wsRef.current?.close();
        localStream?.getTracks().forEach((t) => t.stop());
        setLocalStream(null);
        setParticipants([]);
    }, [localStream]);

    // setWatchedVideoPeers is a no-op in P2P (no server-side consumer pausing)
    const setWatchedVideoPeers = useCallback(() => {}, []);

    return {
        localStream,
        participants,
        isMuted,
        isCamOff,
        isConnected,
        error,
        hasMultipleCameras,
        activeSpeakerIds: [],
        dominantSpeakerId: null,
        localLastSpokeAt: 0,
        chatMessages,
        toggleMic,
        toggleCam,
        switchCamera,
        sendChat,
        setWatchedVideoPeers,
        leave,
    };
}
