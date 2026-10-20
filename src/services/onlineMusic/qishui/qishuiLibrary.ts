import type { MediaId, OnlineLibraryProvider, ProviderCollection } from '../../../types/onlineMusic';
import { normalizeQishuiCollection, qishuiPage } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';

// src/services/onlineMusic/qishui/qishuiLibrary.ts
// The account's own lists. "我喜欢的音乐" is a playlist of type 1; the account's own playlists are
// type 2, and the Douyin-saved list is type 4. The liked ids come from reading that playlist.

export const qishuiLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(_userId: MediaId, limit: number, offset: number) {
        const data = await requestQishui<{ playlists: unknown[]; total: number }>('my_playlists');
        const items: ProviderCollection[] = data.playlists.map(item => normalizeQishuiCollection(item));
        return qishuiPage(items.slice(offset, offset + limit), {
            hasMore: offset + limit < items.length,
            offset,
            limit,
            total: items.length,
        });
    },
    async getLikedSongIds() {
        const data = await requestQishui<{ ids: string[]; whole: boolean; total: number }>('liked_songs');
        return { ids: data.ids, whole: data.whole };
    },
    async getLikedSongCount() {
        const data = await requestQishui<{ total: number | null }>('liked_count');
        return data.total;
    },
};
