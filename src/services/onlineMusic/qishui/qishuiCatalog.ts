import type { MediaId, OnlineCatalogProvider, ProviderCollection } from '../../../types/onlineMusic';
import { normalizeQishuiCollection, normalizeQishuiSong, qishuiPage } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';

// src/services/onlineMusic/qishui/qishuiCatalog.ts
// Playlist, album and artist reads. Qishui pages by an opaque cursor that is an offset; the
// response's next_cursor is authoritative (a page may hold fewer rows than asked for).

interface QishuiTrackPage {
    tracks: unknown[];
    nextCursor: string;
    hasMore: boolean;
    total?: number;
}

export const qishuiCatalog: OnlineCatalogProvider = {
    canResolveSongCatalogRefs: song => song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qishui',
    resolveSongCatalogRefs: async song => song,
    async getPlaylistTracks(id: MediaId, limit: number, offset: number) {
        const data = await requestQishui<QishuiTrackPage>('playlist_tracks', { id, limit, offset });
        return qishuiPage(data.tracks.map(normalizeQishuiSong), {
            hasMore: data.hasMore,
            nextCursor: data.nextCursor,
            offset,
            limit,
            total: data.total,
        });
    },
    async getPlaylistDetail(id: MediaId) {
        const data = await requestQishui<{ playlist: unknown }>('playlist_detail', { id });
        return data.playlist ? normalizeQishuiCollection(data.playlist) : null;
    },
    async getAlbumTracks(id: MediaId, limit = 50, offset = 0) {
        const data = await requestQishui<{ tracks: unknown[] }>('album_tracks', { id });
        const all = data.tracks.map(normalizeQishuiSong);
        const items = all.slice(offset, offset + limit);
        return qishuiPage(items, {
            hasMore: offset + items.length < all.length,
            offset,
            limit,
            total: all.length,
        });
    },
    async getAlbumDetail(id: MediaId) {
        const data = await requestQishui<{ album: unknown }>('album_detail', { id });
        return data.album ? normalizeQishuiCollection(data.album, 'album') : null;
    },
    async getArtistDetail(id: MediaId) {
        const data = await requestQishui<{ artist: unknown }>('artist_detail', { id });
        return data.artist ? normalizeQishuiCollection(data.artist, 'artist') : null;
    },
    async getArtistSongs(id: MediaId, limit: number, offset: number) {
        const data = await requestQishui<QishuiTrackPage>('artist_tracks', { id, limit, offset });
        return qishuiPage(data.tracks.map(normalizeQishuiSong), {
            hasMore: data.hasMore,
            nextCursor: data.nextCursor,
            offset,
            limit,
        });
    },
    async getArtistAlbums(id: MediaId, limit: number, offset: number) {
        const data = await requestQishui<{ albums: unknown[]; nextCursor: string; hasMore: boolean }>('artist_albums', { id, limit, offset });
        const items: ProviderCollection[] = data.albums.map(album => normalizeQishuiCollection(album, 'album'));
        return qishuiPage(items, {
            hasMore: data.hasMore,
            nextCursor: data.nextCursor,
            offset,
            limit,
        });
    },
};
