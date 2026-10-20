import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';

// src/services/onlineMusic/qishui/qishuiTransport.ts
// The renderer's only way into the Qishui bridge. Credentials and device identity stay in the
// main process; this file names operations and turns the bridge's answer into provider errors.

export const QISHUI_OPERATIONS = [
    'login_qr_start', 'login_qr_image', 'login_qr_check', 'login_qr_cancel', 'login_status', 'logout',
    'search', 'song_detail', 'audio', 'lyrics',
    'playlist_detail', 'playlist_tracks', 'album_detail', 'album_tracks',
    'artist_detail', 'artist_tracks', 'artist_albums',
    'my_playlists', 'liked_songs', 'liked_count', 'like', 'unlike', 'recent_played',
    'check_tracks', 'share_info', 'discover_home', 'feed_song_tab', 'playlist_square',
    'create_playlist', 'playlist_add_tracks', 'playlist_del_tracks',
    'collect_playlist', 'uncollect_playlist', 'collect_album', 'uncollect_album',
] as const;

export type QishuiOperation = typeof QISHUI_OPERATIONS[number];
export type QishuiParams = Record<string, unknown>;

export interface QishuiBridgeError {
    code: string;
    message: string;
    status?: number;
    rawCode?: number;
}

export type QishuiBridgeResult =
    | { ok: true; data: any }
    | { ok: false; error: QishuiBridgeError };

export const QISHUI_NEEDS_DESKTOP = 'Qishui requires the desktop app';
export const QISHUI_BRIDGE_FAILED = 'Qishui desktop request failed';

export const getQishuiTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.qishuiRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

const ERROR_CODES: readonly ProviderErrorCode[] = [
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable',
    'preview-only', 'subscription-required', 'region-restricted', 'network', 'invalid-response',
];

const providerCode = (code: string): ProviderErrorCode => {
    if (code === 'rate-limited') return 'network';
    return ERROR_CODES.includes(code as ProviderErrorCode) ? code as ProviderErrorCode : 'invalid-response';
};

export async function requestQishui<T = any>(operation: QishuiOperation, params: QishuiParams = {}): Promise<T> {
    if (!getQishuiTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', QISHUI_NEEDS_DESKTOP, 'qishui');
    }
    let result: QishuiBridgeResult;
    try {
        result = await window.electron!.qishuiRequest(operation, params);
    } catch (error) {
        throw new OnlineProviderError('network', QISHUI_BRIDGE_FAILED, 'qishui', error);
    }
    if (!result.ok) {
        const error = new OnlineProviderError(
            providerCode(result.error.code),
            result.error.message,
            'qishui',
            undefined,
            result.error.status,
        );
        throw error;
    }
    return result.data as T;
}
