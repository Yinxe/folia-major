import type { UnifiedSong } from '../../../types';
import type {
    OnlineRecommendationProvider,
    PersonalFmRequestOptions,
    ProviderCollection,
} from '../../../types/onlineMusic';
import { getPersonalFmRequestOptions } from '../../../stores/usePersonalFmModeStore';
import { normalizeQishuiCollection, normalizeQishuiSong } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';

// src/services/onlineMusic/qishui/qishuiRecommendations.ts
// Qishui's "listen" feed as Personal FM: the platform's default/familiar/fresh preference and
// its scene modes, fetched a batch at a time from FeedSongTab.

type QishuiFeedAnswer = { items?: unknown[] };

type QishuiPreferenceMode = 'default' | 'familiar' | 'fresh';

// Folia's Personal FM mode ids come from its existing catalogue. The three that have a Qishui
// counterpart keep their meaning; the others fall through to the default feed.
const QISHUI_PREFERENCE_OF_MODE: Record<string, QishuiPreferenceMode> = {
    DEFAULT: 'default',
    FAMILIAR: 'familiar',
    EXPLORE: 'fresh',
};

// Folia's scene picker carries the catalogue's scene ids; Qishui names its own by a numeric
// scene_mode_id. Only scenes with a clear counterpart in Qishui's 45-scene list are mapped:
// an unmapped selection asks for the default feed rather than a scene by a guessed id.
const QISHUI_SCENE_OF_FM_SCENE: Record<string, number> = {
    NIGHT_EMO: 4,
    CURE: 21,
    CHEERFUL: 5,
    RELAX: 3,
    SWEET: 19,
    EXERCISE: 2,
    FOCUS: 6,
    SLEEP_HELP: 8,
    TAKE_SHOWER: 41,
    COMMUTE: 1,
    GAMES: 37,
    DANCE: 7,
    RAINY: 35,
    RHYTHM_BLUES: 23,
    RAP: 24,
    K_POP: 22,
    ELECTRONIC: 11,
    ROCK: 28,
    FOLK: 29,
    GUDIAN: 32,
    COUNTRY: 27,
    LIGHT: 25,
    GUOFENG: 12,
    JINGDIAN: 16,
    ENGLISH: 15,
    YUEYU: 10,
    JAPANESE: 30,
};

// The official client sends these counters on every recommendation request. Kept per process
// and per preference/scene so a batch does not look like a cold start.
let feedRequestCount = 0;
const feedModeCounts = new Map<string, number>();
let firstUseTime: number | null = null;

const nextFeedSession = (key: string) => {
    feedRequestCount += 1;
    const modeCount = (feedModeCounts.get(key) ?? 0) + 1;
    feedModeCounts.set(key, modeCount);
    if (firstUseTime === null) firstUseTime = Math.floor(Date.now() / 1000);
    return {
        totalRequestCount: feedRequestCount,
        preferenceModeRequestCount: modeCount,
        didFirstUseTime: firstUseTime,
    };
};

// A feed row wraps its track as entity.track_wrapper.track; other row shapes carry it under
// entity.track/entity.media or directly. Dig to the track before normalizing.
const feedTrackOf = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const node = item as Record<string, any>;
    const entity = node.entity && typeof node.entity === 'object' && !Array.isArray(node.entity)
        ? node.entity as Record<string, any>
        : node;
    const wrapper = entity.track_wrapper;
    if (wrapper && typeof wrapper === 'object' && wrapper.track) return wrapper.track;
    return entity.track ?? entity.media ?? entity;
};

const normalizeFeedTrack = (item: unknown): UnifiedSong | null => {
    try {
        return normalizeQishuiSong(feedTrackOf(item));
    } catch (error) {
        void error;
        return null;
    }
};

// Playlist-square rows wrap the playlist as entity.playlist; older answers carry it directly.
const playlistOf = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const node = item as Record<string, any>;
    const entity = node.entity && typeof node.entity === 'object' && !Array.isArray(node.entity)
        ? node.entity as Record<string, any>
        : node;
    return entity.playlist ?? node.playlist ?? entity;
};

const normalizeSquarePlaylist = (item: unknown): ProviderCollection | null => {
    try {
        return normalizeQishuiCollection(playlistOf(item));
    } catch (error) {
        void error;
        return null;
    }
};

const resolveRequest = (options?: PersonalFmRequestOptions) => {
    const requested = options ?? getPersonalFmRequestOptions();
    const sceneModeId = requested.mode === 'SCENE_RCMD'
        ? QISHUI_SCENE_OF_FM_SCENE[requested.submode ?? '']
        : undefined;
    if (sceneModeId) {
        return { preferenceMode: 'default' as const, sceneModeId, sessionKey: `scene:${sceneModeId}` };
    }
    const preferenceMode = QISHUI_PREFERENCE_OF_MODE[requested.mode ?? ''] ?? 'default';
    return { preferenceMode, sceneModeId: undefined, sessionKey: `preference:${preferenceMode}` };
};

export const qishuiRecommendations: OnlineRecommendationProvider = {
    async getPersonalFm(options) {
        const request = resolveRequest(options);
        const data = await requestQishui<QishuiFeedAnswer>('feed_song_tab', {
            preferenceMode: request.preferenceMode,
            ...(request.sceneModeId ? { sceneModeId: request.sceneModeId } : {}),
            count: 12,
            ...nextFeedSession(request.sessionKey),
        });
        return (Array.isArray(data.items) ? data.items : [])
            .map(normalizeFeedTrack)
            .filter((song): song is UnifiedSong => song !== null);
    },
    // The radio tab's recommended playlists come from the playlist square (category 0 = all).
    async getRecommendedCollections(limit) {
        const data = await requestQishui<{ items?: unknown[] }>('playlist_square', { categoryId: 0 });
        return (Array.isArray(data.items) ? data.items : [])
            .map(normalizeSquarePlaylist)
            .filter((playlist): playlist is ProviderCollection => playlist !== null)
            .slice(0, Math.max(0, limit));
    },
};
