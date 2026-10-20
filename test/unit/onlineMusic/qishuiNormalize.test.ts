import { describe, expect, it } from 'vitest';
import {
    normalizeQishuiCollection,
    normalizeQishuiSong,
    normalizeQishuiUser,
    qishuiImageUrl,
    qishuiPage,
} from '@/services/onlineMusic/qishui/qishuiNormalize';

// test/unit/onlineMusic/qishuiNormalize.test.ts — Qishui entities as the PC endpoints return them.

const cover = {
    urls: ['https://p3-luna.douyinpic.com/img/'],
    uri: 'tos-cn-v-2774c002/cover',
    template_prefix: 'tplv-b829550vbb',
};

describe('Qishui normalization', () => {
    it('keeps the song source and the preview clip position', () => {
        const song = normalizeQishuiSong({
            id: '7631943484455995443',
            name: '别说我的眼泪你无所谓',
            duration: 291818,
            vid: 'v02ad6g10000d7l220fog65jv8ovd9j0',
            artists: [{ id: '7054128507940505639', name: '王超然' }],
            album: { id: '7631943484455962675', name: '别说我的眼泪你无所谓', url_cover: cover },
            preview: { start: 208320, duration: 30001 },
        });
        expect(song).toMatchObject({
            id: '7631943484455995443',
            name: '别说我的眼泪你无所谓',
            durationMs: 291818,
            artists: [{ id: '7054128507940505639', name: '王超然' }],
            album: { id: '7631943484455962675', name: '别说我的眼泪你无所谓' },
            sourceRef: {
                kind: 'online',
                providerId: 'qishui',
                mediaId: '7631943484455995443',
                providerData: { vid: 'v02ad6g10000d7l220fog65jv8ovd9j0', previewStartMs: 208320, previewDurationMs: 30001 },
            },
        });
        expect(song.album.coverUrl).toBe('https://p3-luna.douyinpic.com/img/tos-cn-v-2774c002/cover~tplv-b829550vbb-crop-center:400:400.jpg');
    });

    it('marks the liked list and only the account-own playlists', () => {
        const liked = normalizeQishuiCollection({ id: '1', title: '我喜欢的音乐', type: 1, count_tracks: 12, url_cover: cover });
        expect(liked).toMatchObject({ providerId: 'qishui', id: '1', type: 'playlist', name: '我喜欢的音乐', isLiked: true, trackCount: 12 });
        expect(liked.isOwned).toBeUndefined();

        const own = normalizeQishuiCollection({ id: '2', title: 'My list', type: 2 });
        expect(own.isOwned).toBe(true);
        expect(own.isLiked).toBeUndefined();

        const album = normalizeQishuiCollection({ id: '3', name: 'Album', count_tracks: 10, url_cover: cover }, 'album');
        expect(album).toMatchObject({ type: 'album', name: 'Album', trackCount: 10 });
    });

    it('uses the platform cursor as the next offset', () => {
        expect(qishuiPage(['a'], { nextCursor: '20', hasMore: true, offset: 0, limit: 10 })).toMatchObject({
            items: ['a'],
            nextOffset: 20,
            hasMore: true,
        });
        expect(qishuiPage(['a', 'b'], { offset: 10, limit: 2 })).toMatchObject({ nextOffset: 12, hasMore: true });
    });

    it('reads a user avatar from either shape', () => {
        expect(normalizeQishuiUser({ id: 7, nickname: 'Listener', larger_avatar_url: cover }).avatarUrl)
            .toBe('https://p3-luna.douyinpic.com/img/tos-cn-v-2774c002/cover~tplv-b829550vbb-crop-center:400:400.jpg');
        expect(normalizeQishuiUser({ id: '8', nickname: 'Listener', avatarUrl: 'https://example.test/a.jpg' }).avatarUrl)
            .toBe('https://example.test/a.jpg');
    });

    it('leaves an already normalized song alone', () => {
        const song = normalizeQishuiSong({ id: '1', name: 'A', artists: [], album: { id: '2', name: 'B' }, durationMs: 1000 });
        expect(normalizeQishuiSong(song)).toBe(song);
    });

    it('builds a cover URL with the template suffix and without one', () => {
        expect(qishuiImageUrl(cover, 600)).toBe('https://p3-luna.douyinpic.com/img/tos-cn-v-2774c002/cover~tplv-b829550vbb-crop-center:600:600.jpg');
        expect(qishuiImageUrl({ urls: ['https://example.test/'], uri: 'x' })).toBe('https://example.test/x~c5_400x400.jpg');
    });
});
