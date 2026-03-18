'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import type { types as mediasoupTypes } from 'mediasoup-client';

// Global lock to prevent concurrent getUserMedia calls (fixes Mac Safari/Chrome AbortError in React StrictMode)
let gumLock = Promise.resolve();

const getWsUrl = () => {
    if (typeof window === 'undefined') return '';
    if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // We configured Next.js rewrites to proxy `/ws` directly to `localhost:4000/ws`.
    // This means the frontend can just talk to its own host (e.g., ngrok) on the same port!
    return `${protocol}//${window.location.host}/ws`;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RemoteParticipant {
    peerId: string;
    displayName: string;
    stream: MediaStream;
    isCamPaused?: boolean;
    lastSpokeAt?: number;
}

export interface ChatMessage {
    id: string;
    peerId: string;
    displayName: string;
    text: string;
    timestamp: number;
}

export interface UseRoomResult {
    localStream: MediaStream | null;
    participants: RemoteParticipant[];
    isMuted: boolean;
    isCamOff: boolean;
    isConnected: boolean;
    error: string | null;
    hasMultipleCameras: boolean;
    activeSpeakerIds: string[];
    dominantSpeakerId: string | null;
    localLastSpokeAt: number;
    chatMessages: ChatMessage[];
    toggleMic: () => void;
    toggleCam: () => void;
    switchCamera: () => void;
    sendChat: (text: string) => void;
    setWatchedVideoPeers: (peerIds: string[]) => void;
    leave: () => void;
}

// ─── Helper: request–response over WebSocket ─────────────────────────────────

type PendingCallback = (data: Record<string, unknown>) => void;

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useRoom(
    roomId: string,
    displayName: string
): UseRoomResult {
    const wsRef = useRef<WebSocket | null>(null);
    const pendingRef = useRef<Map<string, PendingCallback>>(new Map());
    const listenersRef = useRef<Map<string, (data: Record<string, unknown>) => void>>(new Map());

    const deviceRef = useRef<mediasoupClient.Device | null>(null);
    const sendTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const recvTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const localVideoProducerRef = useRef<mediasoupTypes.Producer | null>(null);
    const localAudioProducerRef = useRef<mediasoupTypes.Producer | null>(null);

    // peerId → { stream, displayName, consumers, isCamPaused, lastSpokeAt }
    const peerStreamsRef = useRef<Map<string, { stream: MediaStream; displayName: string; consumers: Map<string, mediasoupTypes.Consumer>; isCamPaused?: boolean; lastSpokeAt?: number }>>(new Map());

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);
    const [dominantSpeakerId, setDominantSpeakerId] = useState<string | null>(null);
    const [localLastSpokeAt, setLocalLastSpokeAt] = useState(0);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [watchedVideoPeers, setWatchedVideoPeersState] = useState<string[]>([]);
    
    const setWatchedVideoPeers = useCallback((newPeers: string[]) => {
        setWatchedVideoPeersState(prev => {
            if (prev.length === newPeers.length && prev.every(p => newPeers.includes(p))) return prev;
            return newPeers;
        });
    }, []);

    // Derive participants array from ref map
    function syncParticipants() {
        setParticipants(
            [...peerStreamsRef.current.entries()].map(([pid, { stream, displayName: dn, isCamPaused, lastSpokeAt }]) => ({
                peerId: pid,
                displayName: dn,
                stream,
                isCamPaused,
                lastSpokeAt,
            }))
        );
    }

    // ── WebSocket send helpers ────────────────────────────────────────────────

    function wsSend(type: string, data?: unknown, id?: string) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.warn(`[wsSend] Cannot send ${type}, WebSocket is not open (readyState: ${wsRef.current?.readyState})`);
            return;
        }
        wsRef.current.send(JSON.stringify({ type, id, data }));
    }

    function wsRequest<T = Record<string, unknown>>(type: string, data?: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = Math.random().toString(36).slice(2);
            const timeout = setTimeout(() => {
                pendingRef.current.delete(id);
                reject(new Error(`Timeout waiting for "${type}" response`));
            }, 10_000);

            pendingRef.current.set(id, (responseData) => {
                clearTimeout(timeout);
                if ((responseData as Record<string, unknown>).message) {
                    reject(new Error(String((responseData as Record<string, unknown>).message)));
                } else {
                    resolve(responseData as T);
                }
            });

            wsSend(type, data, id);
        });
    }

    function on(type: string, handler: (data: Record<string, unknown>) => void) {
        listenersRef.current.set(type, handler);
    }

    // ── Consume a remote producer ─────────────────────────────────────────────

    async function consumeProducer(
        producerId: string,
        producerPeerId: string,
        producerDisplayName: string,
        kind: 'audio' | 'video'
    ) {
        if (!deviceRef.current || !recvTransportRef.current) return;

        const data = await wsRequest<{
            consumerId: string;
            producerId: string;
            kind: string;
            rtpParameters: mediasoupTypes.RtpParameters;
        }>('consume', {
            producerId,
            rtpCapabilities: deviceRef.current.rtpCapabilities,
            transportId: recvTransportRef.current.id,
        });

        const consumer = await recvTransportRef.current.consume({
            id: data.consumerId,
            producerId: data.producerId,
            kind: data.kind as mediasoupTypes.MediaKind,
            rtpParameters: data.rtpParameters,
        });

        await wsRequest('resumeConsumer', { consumerId: data.consumerId });

        // Build/update per-peer MediaStream
        if (!peerStreamsRef.current.has(producerPeerId)) {
            peerStreamsRef.current.set(producerPeerId, {
                stream: new MediaStream(),
                displayName: producerDisplayName,
                consumers: new Map(),
                isCamPaused: false,
            });
        }
        const entry = peerStreamsRef.current.get(producerPeerId)!;
        entry.consumers.set(consumer.id, consumer);
        entry.stream.addTrack(consumer.track);
        syncParticipants();

        consumer.on('trackended', () => {
            entry.stream.removeTrack(consumer.track);
            entry.consumers.delete(consumer.id);
            consumer.close();
            syncParticipants();
        });
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
                const videoInputs = devices.filter(d => d.kind === 'videoinput');
                setHasMultipleCameras(videoInputs.length > 1);
            } catch (e) {
                console.warn('Could not enumerate devices', e);
            }

            // 1. Get local media
            // Serialize getUserMedia to prevent Mac AbortError: Timeout starting video source in StrictMode
            await gumLock;
            let releaseLock: () => void;
            gumLock = new Promise(r => { releaseLock = r as () => void; });

            let stream: MediaStream;
            try {
                if (cancelled) {
                    releaseLock!();
                    return;
                }
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                    audio: { echoCancellation: true, noiseSuppression: true },
                });
            } finally {
                releaseLock!();
            }

            localMediaStream = stream;
            if (cancelled) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            setLocalStream(stream);

            // 2. Connect WebSocket
            await new Promise<void>((resolve, reject) => {
                localWs = new WebSocket(getWsUrl());
                wsRef.current = localWs;

                localWs.onopen = () => resolve();
                localWs.onerror = () => reject(new Error('WebSocket connection failed'));

                localWs.onmessage = (evt) => {
                    const msg = JSON.parse(evt.data as string) as { type: string; id?: string; data: Record<string, unknown> };
                    const { type, id, data } = msg;

                    // Resolve pending request by ID
                    if (id && pendingRef.current.has(id)) {
                        pendingRef.current.get(id)!(data);
                        pendingRef.current.delete(id);
                    }

                    // Dispatch push events (no id)
                    if (!id) {
                        listenersRef.current.get(type)?.(data);
                    }
                };

                localWs.onclose = () => setIsConnected(false);
            });

            if (cancelled) {
                localWs?.close();
                return;
            }

            // 3. Join room
            const joined = await wsRequest<{
                peerId: string;
                routerRtpCapabilities: mediasoupTypes.RtpCapabilities;
                existingProducers: Array<{ producerId: string; peerId: string; displayName: string; kind: string }>;
            }>('join', { roomId, displayName });

            if (cancelled) return;

            setIsConnected(true);

            // 4. Load mediasoup Device
            const device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: joined.routerRtpCapabilities });
            deviceRef.current = device;

            // 5. Create send transport
            const sendParams = await wsRequest<mediasoupTypes.TransportOptions>('createTransport', { direction: 'send' });
            if (cancelled) return;

            const sendTransport = device.createSendTransport(sendParams as mediasoupTypes.TransportOptions & { id: string });
            sendTransportRef.current = sendTransport;

            sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                wsRequest('connectTransport', { transportId: sendTransport.id, dtlsParameters })
                    .then(callback)
                    .catch(errback);
            });

            sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                wsRequest<{ producerId: string }>('produce', {
                    transportId: sendTransport.id,
                    kind,
                    rtpParameters,
                    appData,
                })
                    .then(({ producerId }) => callback({ id: producerId }))
                    .catch(errback);
            });

            // 6. Produce local audio + video
            const audioTrack = stream.getAudioTracks()[0];
            const videoTrack = stream.getVideoTracks()[0];
            if (audioTrack) {
                const audioProducer = await sendTransport.produce({ track: audioTrack });
                localAudioProducerRef.current = audioProducer;
            }
            if (videoTrack) {
                const videoProducer = await sendTransport.produce({ track: videoTrack });
                localVideoProducerRef.current = videoProducer;
            }

            // 7. Create recv transport
            const recvParams = await wsRequest<mediasoupTypes.TransportOptions>('createTransport', { direction: 'recv' });
            if (cancelled) return;

            const recvTransport = device.createRecvTransport(recvParams as mediasoupTypes.TransportOptions & { id: string });
            recvTransportRef.current = recvTransport;

            recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                wsRequest('connectTransport', { transportId: recvTransport.id, dtlsParameters })
                    .then(callback)
                    .catch(errback);
            });

            // 8. Consume existing producers
            for (const ep of joined.existingProducers) {
                await consumeProducer(ep.producerId, ep.peerId, ep.displayName, ep.kind as 'audio' | 'video');
            }

            // 9. Listen for new producers
            on('newProducer', async ({ producerId, peerId: remotePeerId, displayName: dn, kind }) => {
                await consumeProducer(
                    producerId as string,
                    remotePeerId as string,
                    (dn as string) || 'Unknown',
                    kind as 'audio' | 'video'
                );
            });

            // 10. Peer left event
            on('peerLeft', ({ peerId: leftPeerId }) => {
                const entry = peerStreamsRef.current.get(leftPeerId as string);
                if (entry) {
                    // Close all consumers belonging to this peer
                    entry.consumers.forEach((c) => c.close());
                }
                peerStreamsRef.current.delete(leftPeerId as string);
                syncParticipants();
            });

            // 11. Consumer closed (producer gone)
            on('consumerClosed', () => {
                // Handled per-consumer via trackended above
            });

            // 11.5 remote producer paused/resumed
            on('producerPaused', ({ peerId: pausedPeerId, kind }) => {
                if (kind === 'video') {
                    const entry = peerStreamsRef.current.get(pausedPeerId as string);
                    if (entry) {
                        entry.isCamPaused = true;
                        syncParticipants();
                    }
                }
            });

            on('producerResumed', ({ peerId: resumedPeerId, kind }) => {
                if (kind === 'video') {
                    const entry = peerStreamsRef.current.get(resumedPeerId as string);
                    if (entry) {
                        entry.isCamPaused = false;
                        syncParticipants();
                    }
                }
            });

            // 12. Chat Messages
            on('chatMsg', (data) => {
                setChatMessages((prev) => [...prev, data as unknown as ChatMessage]);
            });

            // 13. Active Speakers
            on('activeSpeakers', (speakersObj) => {
                const speakersList = speakersObj as unknown as { peerId: string; volume: number }[];
                const speakerIds = speakersList.map(s => s.peerId === joined.peerId ? 'local' : s.peerId);

                const now = Date.now();
                let needsSync = false;

                speakerIds.forEach(id => {
                    if (id === 'local') {
                        setLocalLastSpokeAt(now);
                    } else {
                        const entry = peerStreamsRef.current.get(id);
                        if (entry) {
                            entry.lastSpokeAt = now;
                            needsSync = true;
                        }
                    }
                });

                setActiveSpeakerIds(speakerIds);
                if (speakerIds.length > 0) {
                    setDominantSpeakerId(speakerIds[0]);
                }
                
                if (needsSync) syncParticipants();
            });
        }

        init().catch((err) => {
            if (cancelled) return;
            console.error('[useRoom] init error:', err);
            setError(err instanceof Error ? err.message : String(err));
        });

        return () => {
            cancelled = true;
            sendTransportRef.current?.close();
            recvTransportRef.current?.close();
            localWs?.close();
            wsRef.current?.close();
            localMediaStream?.getTracks().forEach((t) => t.stop());
            setLocalStream(null);
            peerStreamsRef.current.clear();
            setParticipants([]);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId, displayName]);

    // ── Bandwidth Optimization: Dynamic Consumer Pausing ──────────────────────
    useEffect(() => {
        // Wait until connected
        if (!isConnected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        peerStreamsRef.current.forEach((entry, peerId) => {
            const isWatched = watchedVideoPeers.includes(peerId);
            
            entry.consumers.forEach((consumer) => {
                if (consumer.kind === 'video') {
                    if (!isWatched && !consumer.paused) {
                        // Pause downloading this video if they are off-screen
                        consumer.pause();
                        wsRequest('pauseConsumer', { consumerId: consumer.id }).catch(e => console.warn('Failed to pause consumer', e));
                    } else if (isWatched && consumer.paused) {
                        // Resume downloading this video if they scrolled into view
                        consumer.resume();
                        wsRequest('resumeConsumer', { consumerId: consumer.id }).catch(e => console.warn('Failed to resume consumer', e));
                    }
                }
            });
        });
    }, [watchedVideoPeers, isConnected]);

    // ── Controls ──────────────────────────────────────────────────────────────

    const toggleMic = useCallback(async () => {
        if (!localStream) return;
        localStream.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
        setIsMuted((m) => !m);

        if (localAudioProducerRef.current) {
            const isNowMuted = localStream.getAudioTracks().every(t => !t.enabled);
            try {
                if (isNowMuted) {
                    localAudioProducerRef.current.pause();
                    await wsRequest('pauseProducer', { producerId: localAudioProducerRef.current.id });
                } else {
                    localAudioProducerRef.current.resume();
                    await wsRequest('resumeProducer', { producerId: localAudioProducerRef.current.id });
                }
            } catch (err) {
                console.warn('Failed to signal audio pause/resume', err);
            }
        }
    }, [localStream, wsRequest]);

    const toggleCam = useCallback(async () => {
        if (!localStream) return;
        localStream.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
        setIsCamOff((c) => !c);

        if (localVideoProducerRef.current) {
            const isNowOff = localStream.getVideoTracks().every(t => !t.enabled);
            try {
                if (isNowOff) {
                    localVideoProducerRef.current.pause();
                    await wsRequest('pauseProducer', { producerId: localVideoProducerRef.current.id });
                } else {
                    localVideoProducerRef.current.resume();
                    await wsRequest('resumeProducer', { producerId: localVideoProducerRef.current.id });
                }
            } catch (err) {
                console.warn('Failed to signal pause/resume', err);
            }
        }
    }, [localStream, wsRequest]);

    const switchCamera = useCallback(async () => {
        if (!localStream || !localVideoProducerRef.current) return;

        const newFacingMode = facingMode === 'user' ? 'environment' : 'user';

        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { exact: newFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                audio: false
            });
            const newVideoTrack = newStream.getVideoTracks()[0];

            // Maintain enabled state if camera was currently muted
            if (isCamOff) {
                newVideoTrack.enabled = false;
            }

            // Replace track in mediasoup producer to hit the network
            await localVideoProducerRef.current.replaceTrack({ track: newVideoTrack });

            // Stop the old video track and swap it in the local preview
            setLocalStream((prevStream) => {
                if (!prevStream) return null;
                prevStream.getVideoTracks().forEach(t => {
                    t.stop();
                    prevStream.removeTrack(t);
                });
                prevStream.addTrack(newVideoTrack);
                return prevStream;
            });

            setFacingMode(newFacingMode);
        } catch (err) {
            console.error('Failed to switch camera', err);
        }
    }, [localStream, facingMode, isCamOff]);

    const sendChat = useCallback((text: string) => {
        if (!text.trim()) return;
        wsSend('chat', { text });
        // Optimistically add to local state
        setChatMessages((prev) => [
            ...prev,
            {
                id: Math.random().toString(36).slice(2),
                peerId: 'local',
                displayName: displayName, // Local display name
                text: text,
                timestamp: Date.now(),
            }
        ]);
    }, [displayName]);

    const leave = useCallback(() => {
        wsSend('leave');
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();
        wsRef.current?.close();
        localStream?.getTracks().forEach((t) => t.stop());
        setLocalStream(null);
        setParticipants([]);
        peerStreamsRef.current.clear();
    }, [localStream]);

    return {
        localStream,
        participants,
        isMuted,
        isCamOff,
        isConnected,
        error,
        hasMultipleCameras,
        activeSpeakerIds,
        dominantSpeakerId,
        localLastSpokeAt,
        chatMessages,
        toggleMic,
        toggleCam,
        switchCamera,
        sendChat,
        setWatchedVideoPeers,
        leave
    };
}
