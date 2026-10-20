import type { Artist, UnifiedSong } from '../../../types';
import type {
    JsonValue,
    MediaId,
    ProviderCollection,
    ProviderPage,
    ProviderUser,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/qishui/qishuiNormalize.ts
// Qishui entities as the platform returns them, turned into the provider-neutral shapes. The
// fields are the ones measured on the PC endpoints (qishui-api) and on `/luna/h5/track_v2`.

export type QishuiRecord = Record<string, any>;

const record = (value: unknown): QishuiRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as QishuiRecord : {}
);

const text = (value: unknown) => (value == null ? '' : String(value));
const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

// utils/image.ts: a cover is a prefix + uri + template suffix, or already a full URL.
export const qishuiImageUrl = (image: unknown, width = 400): string => {
    const source = record(image);
    const prefix = Array.isArray(source.urls) ? text(source.urls[0]) : '';
    const uri = text(source.uri);
    if (prefix && uri) {
        const suffix = source.template_prefix
            ? `${text(source.template_prefix)}-crop-center:${width}:${width}.jpg`
            : `c5_${width}x${width}.jpg`;
        return `${prefix}${uri}~${suffix}`;
    }
    return prefix;
};

const artistRef = (raw: QishuiRecord): Artist => ({
    id: text(raw.id),
    name: text(raw.name),
    ...(raw.id ? { catalogRef: { providerId: 'qishui', kind: 'artist' as const, id: text(raw.id) } } : {}),
});

export const normalizeQishuiSong = (raw: unknown): UnifiedSong => {
    const item = record(raw);
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'qishui') return item as UnifiedSong;
    const id = text(item.id);
    if (!id) throw new OnlineProviderError('invalid-response', 'Qishui song has no id', 'qishui');
    const album = record(item.album);
    const coverUrl = qishuiImageUrl(album.url_cover);
    const providerData: Record<string, JsonValue> = {};
    if (item.vid) providerData.vid = text(item.vid);
    if (item.media_type) providerData.mediaType = text(item.media_type);
    const preview = record(item.preview);
    if (preview.start !== undefined) providerData.previewStartMs = number(preview.start);
    if (preview.duration !== undefined) providerData.previewDurationMs = number(preview.duration);
    return {
        id,
        name: text(item.name),
        artists: (Array.isArray(item.artists) ? item.artists : []).map(artistRef),
        album: {
            id: text(album.id),
            name: text(album.name),
            ...(coverUrl ? { coverUrl } : {}),
            ...(album.id ? { catalogRef: { providerId: 'qishui', kind: 'album' as const, id: text(album.id) } } : {}),
        },
        durationMs: number(item.duration),
        sourceRef: { kind: 'online', providerId: 'qishui', mediaId: id, ...(Object.keys(providerData).length ? { providerData } : {}) },
    };
};

export const normalizeQishuiUser = (raw: unknown): ProviderUser => {
    const item = record(raw);
    const id = text(item.id);
    const avatarUrl = text(item.avatarUrl)
        || qishuiImageUrl(item.larger_avatar_url || item.medium_avatar_url || item.url_avatar);
    return {
        id,
        nickname: text(item.nickname),
        ...(avatarUrl ? { avatarUrl } : {}),
    };
};

export const normalizeQishuiCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = record(raw);
    if (item.providerId === 'qishui') return item as ProviderCollection;
    const id = text(item.id);
    if (!id) throw new OnlineProviderError('invalid-response', `Qishui ${type} has no id`, 'qishui');
    if (type === 'album') {
        const coverUrl = qishuiImageUrl(item.url_cover);
        return {
            providerId: 'qishui',
            id,
            type: 'album',
            name: text(item.name),
            ...(coverUrl ? { coverUrl } : {}),
            ...(item.count_tracks != null ? { trackCount: number(item.count_tracks) } : {}),
            ...(Array.isArray(item.artists) ? { artists: item.artists.map(artistRef) } : {}),
            ...(item.release_date ? { publishedAt: number(item.release_date) * 1000 } : {}),
            ...(item.intro || item.desc ? { description: text(item.intro || item.desc) } : {}),
        };
    }
    if (type === 'artist') {
        const avatarUrl = qishuiImageUrl(item.url_avatar || item.larger_avatar_url || item.medium_avatar_url);
        return {
            providerId: 'qishui',
            id,
            type: 'artist',
            name: text(item.name || item.nickname || item.simple_display_name),
            ...(avatarUrl ? { coverUrl: avatarUrl } : {}),
            ...(item.count_tracks != null ? { trackCount: number(item.count_tracks) } : {}),
            ...(item.count_albums != null ? { albumCount: number(item.count_albums) } : {}),
            ...(item.desc || item.artist_profile?.desc ? { description: text(item.desc || item.artist_profile?.desc) } : {}),
        };
    }
    const qishuiType = number(item.type);
    const coverUrl = qishuiImageUrl(item.url_cover);
    return {
        providerId: 'qishui',
        id,
        type: 'playlist',
        name: text(item.title || item.name),
        ...(coverUrl ? { coverUrl } : {}),
        ...(item.desc ? { description: text(item.desc) } : {}),
        ...(item.count_tracks != null ? { trackCount: number(item.count_tracks) } : {}),
        ...(qishuiType === 1 ? { isLiked: true } : {}),
        ...(qishuiType === 2 ? { isOwned: true } : {}),
        providerData: { qishuiType },
    };
};

export interface QishuiPageInput {
    hasMore?: boolean;
    nextCursor?: string | number;
    offset: number;
    limit: number;
    total?: number;
}

export const qishuiPage = <T>(items: T[], input: QishuiPageInput): ProviderPage<T> => {
    const next = Number(input.nextCursor);
    const nextOffset = Number.isFinite(next) && next > input.offset ? next : input.offset + items.length;
    return {
        items,
        ...(input.total !== undefined && Number.isFinite(input.total) ? { total: input.total } : {}),
        hasMore: input.hasMore ?? items.length >= input.limit,
        nextOffset,
    };
};

/** The id a song, playlist, album or artist is named by, whichever shape it arrives in. */
export const qishuiMediaId = (value: MediaId): string => text(value);
