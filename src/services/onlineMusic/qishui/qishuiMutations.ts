import type { MediaId, OnlineMutationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { SongResult } from '../../../types';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { normalizeQishuiCollection } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';

// src/services/onlineMusic/qishui/qishuiMutations.ts
// The account's writes: liking a song, changing an owned playlist, saving a playlist or album.
// Each one is a single named bridge operation; the bridge never lets the renderer send a raw path.

const songId = (song: MediaId | SongResult): string => {
    if (typeof song !== 'object') return String(song);
    const source = getPlaybackSourceRef(song);
    if (source?.kind !== 'online' || source.providerId !== 'qishui') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to Qishui', 'qishui');
    }
    return String(source.mediaId);
};

const playlistId = (playlist: MediaId | ProviderCollection): string => {
    if (typeof playlist !== 'object') return String(playlist);
    if (playlist.providerId !== 'qishui' || playlist.type !== 'playlist') {
        throw new OnlineProviderError('unsupported', 'Playlist does not belong to Qishui', 'qishui');
    }
    return String(playlist.id);
};

const isOwnedPlaylist = (playlist: ProviderCollection): boolean => (
    playlist.providerId === 'qishui' && playlist.type === 'playlist' && playlist.isOwned === true
);

export const qishuiMutations: OnlineMutationProvider = {
    canAddToPlaylist: isOwnedPlaylist,
    canEditPlaylistTracks: isOwnedPlaylist,
    canSubscribe: collection => collection.providerId === 'qishui' && (collection.type === 'playlist' || collection.type === 'album'),
    async likeSong(song, liked) {
        await requestQishui(liked ? 'like' : 'unlike', { id: songId(song) });
    },
    async updatePlaylistTracks(operation, playlist, tracks) {
        if (!tracks.length) return;
        if (tracks.length > 100) throw new OnlineProviderError('unsupported', 'Select at most 100 tracks per operation', 'qishui');
        await requestQishui(operation === 'add' ? 'playlist_add_tracks' : 'playlist_del_tracks', {
            playlistId: playlistId(playlist),
            trackIds: tracks.map(songId),
        });
    },
    async createPlaylist(name) {
        const data = await requestQishui<{ playlist: unknown }>('create_playlist', { name });
        if (data.playlist) return normalizeQishuiCollection(data.playlist);
        return {
            providerId: 'qishui',
            id: '',
            type: 'playlist',
            name,
            isOwned: true,
        };
    },
    async subscribePlaylist(playlist, subscribed) {
        await requestQishui(subscribed ? 'collect_playlist' : 'uncollect_playlist', { id: playlistId(playlist) });
    },
    async subscribeAlbum(id, subscribed) {
        await requestQishui(subscribed ? 'collect_album' : 'uncollect_album', { id: String(id) });
    },
};
