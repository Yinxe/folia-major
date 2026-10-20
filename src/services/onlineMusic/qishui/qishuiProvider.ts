import type {
    AudioQualityPreference,
    LoginState,
    OnlineMusicProvider,
    ProviderLyricsResult,
    ProviderUser,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { SongResult } from '../../../types';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { describeQishuiFailure } from './qishuiFailure';
import { normalizeQishuiCollection, normalizeQishuiSong, normalizeQishuiUser, qishuiPage } from './qishuiNormalize';
import { getQishuiTransportAvailability, requestQishui } from './qishuiTransport';
import { qishuiCatalog } from './qishuiCatalog';
import { qishuiLibrary } from './qishuiLibrary';
import { qishuiMutations } from './qishuiMutations';
import { qishuiRecommendations } from './qishuiRecommendations';

// src/services/onlineMusic/qishui/qishuiProvider.ts
// Qishui Music (SodaMusic) as an Omni provider. The protocol lives in electron/qishui; this file
// normalizes its answers and declares what the platform can do.

interface QishuiQuality {
    quality: string;
    url: string;
    backupUrl?: string;
    bytes?: number;
    bitrate?: number;
}

interface QishuiAudioAnswer {
    qualities: QishuiQuality[];
    preview: { startMs: number; durationMs: number } | null;
    expiresAt: number;
}

// Qishui names its qualities medium/higher/highest/lossless. `highest` is about 256 kbit/s, not
// lossless, so it stands for `high`; lossless is only there when the account may play it.
const QUALITY_ORDER: Record<AudioQualityPreference, string[]> = {
    standard: ['medium', 'higher', 'highest'],
    high: ['highest', 'higher', 'medium'],
    ultra: ['highest', 'higher', 'medium'],
    lossless: ['lossless', 'highest', 'higher', 'medium'],
    hires: ['lossless', 'highest', 'higher', 'medium'],
};

const LEVEL_OF: Record<string, AudioQualityPreference> = {
    medium: 'standard',
    higher: 'high',
    highest: 'high',
    lossless: 'lossless',
};

let qishuiVip = false;

const songId = (song: SongResult): string => {
    const source = getPlaybackSourceRef(song);
    if (source?.kind !== 'online' || source.providerId !== 'qishui') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to Qishui', 'qishui');
    }
    return String(source.mediaId);
};

const readLogin = async (): Promise<{ user: ProviderUser; vip: boolean } | null> => {
    const data = await requestQishui<{ user: ProviderUser; vip: boolean } | null>('login_status');
    if (!data) {
        qishuiVip = false;
        return null;
    }
    qishuiVip = Boolean(data.vip);
    return { user: normalizeQishuiUser(data.user), vip: Boolean(data.vip) };
};

const qishuiProvider: OnlineMusicProvider = {
    id: 'qishui',
    displayName: '汽水音乐',
    shortName: '汽水',
    mark: { letter: '汽', color: '#FF4D4F' },
    getAvailability: getQishuiTransportAvailability,
    describeFailure: describeQishuiFailure,
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        auth: true,
        userLibrary: true,
        playlists: true,
        albums: true,
        artists: true,
        recommendations: true,
        personalFmModes: true,
        mutations: true,
        wordByWordLyrics: true,
        likes: true,
        playlistTrackMutations: true,
    },
    normalizeSong: normalizeQishuiSong,
    normalizeUser: normalizeQishuiUser,
    normalizeCollection: normalizeQishuiCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    getSongPageUrl(song) {
        const source = getPlaybackSourceRef(song);
        if (source?.kind !== 'online' || source.providerId !== 'qishui') return null;
        return `https://www.qishui.com/share/track?track_id=${encodeURIComponent(String(source.mediaId))}`;
    },
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return qishuiPage([], { offset, limit });
            const data = await requestQishui<{ items: unknown[]; nextCursor: string; hasMore: boolean }>('search', {
                query,
                offset,
            });
            return qishuiPage(data.items.map(normalizeQishuiSong), {
                hasMore: data.hasMore,
                nextCursor: data.nextCursor,
                offset,
                limit,
            });
        },
    },
    playback: {
        async getSongDetail(id) {
            const data = await requestQishui<{ track: unknown }>('song_detail', { id });
            return data.track ? normalizeQishuiSong(data.track) : null;
        },
        get audioQualityLevels(): readonly AudioQualityPreference[] {
            return qishuiVip ? ['standard', 'high', 'lossless'] : ['standard', 'high'];
        },
        async getAudioSource(song, quality) {
            const data = await requestQishui<QishuiAudioAnswer>('audio', { id: songId(song) });
            const wanted = QUALITY_ORDER[quality] || QUALITY_ORDER.high;
            const chosen = wanted
                .map(name => data.qualities.find(item => item.quality === name))
                .find(Boolean);
            if (!chosen) throw new OnlineProviderError('not-playable', 'Qishui has no audio for this song', 'qishui');
            // An account that may not play the whole song gets a clip from somewhere inside it
            // (measured: 208 s in). The clip plays like any other preview; `clipStartMs` lets the
            // player line the lyrics up with the part it contains.
            const clipStartMs = Math.max(0, Number(data.preview?.startMs) || 0);
            return {
                url: chosen.url,
                fetchedAt: Date.now(),
                ...(data.expiresAt ? { expiresAt: data.expiresAt * 1000 } : {}),
                quality: LEVEL_OF[chosen.quality] || 'high',
                ...(data.preview ? { preview: true, ...(clipStartMs ? { clipStartMs } : {}) } : {}),
            };
        },
    },
    lyrics: {
        async getLyrics(song) {
            const data = await requestQishui<{ lyrics: { sentences?: Array<{ text: string; start_ms?: number; end_ms?: number; words?: Array<{ text: string; start_ms?: number; end_ms?: number }> }> } | null }>('lyrics', { id: songId(song) });
            const sentences = data.lyrics?.sentences;
            if (!Array.isArray(sentences) || !sentences.length) return { lyrics: null, isPureMusic: false };
            const lines = sentences.map(sentence => ({
                words: (sentence.words || []).map(word => ({
                    text: word.text,
                    startTime: (word.start_ms || 0) / 1000,
                    endTime: (word.end_ms || sentence.end_ms || 0) / 1000,
                })),
                startTime: (sentence.start_ms || 0) / 1000,
                endTime: (sentence.end_ms || sentence.start_ms || 0) / 1000,
                fullText: sentence.text,
            }));
            return { lyrics: { lines, isWordByWord: true }, isPureMusic: false } satisfies ProviderLyricsResult;
        },
    },
    auth: {
        async getLoginStatus() {
            const result = await readLogin();
            return result?.user ?? null;
        },
        async startLogin() {
            const data = await requestQishui<{ key: string; imageUrl: string }>('login_qr_start');
            return data.key;
        },
        async createQr(key) {
            const data = await requestQishui<{ imageUrl: string }>('login_qr_image', { key });
            return data.imageUrl;
        },
        async checkLogin(key): Promise<LoginState> {
            const data = await requestQishui<{ state: LoginState['state'] }>('login_qr_check', { key });
            if (data.state === 'confirmed') await readLogin();
            return { state: data.state } as LoginState;
        },
        async cancelLogin(key) {
            await requestQishui('login_qr_cancel', { key });
        },
        async logout() {
            qishuiVip = false;
            await requestQishui('logout');
        },
        getLoginTexts: () => ({ title: 'home.loginTitleQishui', note: 'home.loginNoteQishui' }),
        getLoginTtlMs: () => 5 * 60 * 1000,
    },
    library: qishuiLibrary,
    catalog: qishuiCatalog,
    recommendations: qishuiRecommendations,
    mutations: qishuiMutations,
};

export { qishuiProvider };
