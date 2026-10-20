import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineProviderError } from '@/types/onlineMusic';
import { qishuiProvider } from '@/services/onlineMusic/qishui/qishuiProvider';

// test/unit/onlineMusic/qishuiProvider.test.ts — the adapter's own rules, with the bridge replaced.

const song = {
    id: '1',
    name: 'Song',
    artists: [],
    album: { id: '2', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online' as const, providerId: 'qishui', mediaId: '1' },
};

const stub = (answer: Record<string, unknown>) => {
    vi.stubGlobal('window', { electron: { qishuiRequest: vi.fn(async () => ({ ok: true, data: answer })) } });
};

const stubRequest = () => {
    const request = vi.fn(async (_operation: string, _params: Record<string, unknown>) => ({
        ok: true,
        data: {
            items: [{
                id: '1',
                type: 'track',
                entity: {
                    track_wrapper: {
                        track: {
                            id: '1',
                            name: 'Feed Song',
                            duration: 1000,
                            album: {
                                id: '2',
                                name: 'Album',
                                url_cover: {
                                    urls: ['https://cover.test/'],
                                    uri: 'cover',
                                    template_prefix: 'tpl',
                                },
                            },
                            artists: [{ id: '3', name: 'Artist' }],
                        },
                    },
                },
            }],
        },
    }));
    vi.stubGlobal('window', { electron: { qishuiRequest: request } });
    return request;
};

afterEach(() => vi.unstubAllGlobals());

describe('Qishui playback', () => {
    it('maps the platform quality names onto the shared levels', async () => {
        stub({ qualities: [{ quality: 'highest', url: 'https://audio.test/a.m4a' }], preview: null, expiresAt: 123 });
        const source = await qishuiProvider.playback!.getAudioSource(song, 'high');
        expect(source).toMatchObject({ url: 'https://audio.test/a.m4a', quality: 'high', expiresAt: 123000 });
    });

    it('hands out a clip as a preview and says where in the song it starts', async () => {
        stub({ qualities: [{ quality: 'highest', url: 'https://audio.test/a.m4a' }], preview: { startMs: 208320, durationMs: 30001 }, expiresAt: 123 });
        await expect(qishuiProvider.playback!.getAudioSource(song, 'high')).resolves.toMatchObject({
            url: 'https://audio.test/a.m4a',
            quality: 'high',
            preview: true,
            clipStartMs: 208320,
        });
    });

    it('marks a clip that starts at the beginning without carrying an offset', async () => {
        stub({ qualities: [{ quality: 'medium', url: 'https://audio.test/a.m4a' }], preview: { startMs: 0, durationMs: 30000 }, expiresAt: 0 });
        const source = await qishuiProvider.playback!.getAudioSource(song, 'standard');
        expect(source).toMatchObject({ preview: true });
        expect(source).not.toHaveProperty('clipStartMs');
    });

    it('reports no audio where the platform has no quality left', async () => {
        stub({ qualities: [], preview: null, expiresAt: 0 });
        await expect(qishuiProvider.playback!.getAudioSource(song, 'high')).rejects.toBeInstanceOf(OnlineProviderError);
    });
});

describe('Qishui lyrics', () => {
    it('turns KRC sentences and words into the shared line shape', async () => {
        stub({ lyrics: { sentences: [{ text: '一个', start_ms: 1000, end_ms: 2000, words: [{ text: '一', start_ms: 1000, end_ms: 1500 }, { text: '个', start_ms: 1500, end_ms: 2000 }] }] } });
        const result = await qishuiProvider.lyrics!.getLyrics(song);
        expect(result.lyrics?.lines[0]).toMatchObject({ fullText: '一个', startTime: 1, endTime: 2 });
        expect(result.lyrics?.lines[0].words).toEqual([
            { text: '一', startTime: 1, endTime: 1.5 },
            { text: '个', startTime: 1.5, endTime: 2 },
        ]);
        expect(result.lyrics?.isWordByWord).toBe(true);
    });
});

describe('Qishui recommendations', () => {
    const paramsOf = (request: ReturnType<typeof stubRequest>) => request.mock.calls[0][1];

    it('declares recommendation support and Personal FM modes', () => {
        expect(qishuiProvider.capabilities.recommendations).toBe(true);
        expect(qishuiProvider.capabilities.personalFmModes).toBe(true);
    });

    it('asks for the familiar preference and unwraps the feed rows', async () => {
        const request = stubRequest();
        const songs = await qishuiProvider.recommendations!.getPersonalFm!({ mode: 'FAMILIAR' });

        expect(request.mock.calls[0][0]).toBe('feed_song_tab');
        expect(paramsOf(request)).toMatchObject({ preferenceMode: 'familiar', count: 12 });
        expect(paramsOf(request)).not.toHaveProperty('sceneModeId');
        expect(songs[0]).toMatchObject({
            id: '1',
            name: 'Feed Song',
            artists: [{ id: '3', name: 'Artist' }],
            album: { id: '2', name: 'Album', coverUrl: 'https://cover.test/cover~tpl-crop-center:400:400.jpg' },
            sourceRef: { kind: 'online', providerId: 'qishui', mediaId: '1' },
        });
    });

    it('maps fresh onto the explore mode', async () => {
        const request = stubRequest();
        await qishuiProvider.recommendations!.getPersonalFm!({ mode: 'EXPLORE' });
        expect(paramsOf(request)).toMatchObject({ preferenceMode: 'fresh' });
        expect(paramsOf(request)).not.toHaveProperty('sceneModeId');
    });

    it('sends a scene in the shape the upstream honours', async () => {
        const request = stubRequest();
        await qishuiProvider.recommendations!.getPersonalFm!({ mode: 'SCENE_RCMD', submode: 'JAPANESE' });
        expect(paramsOf(request)).toMatchObject({ preferenceMode: 'default', sceneModeId: 30 });
    });

    it('falls back to the default feed for a scene Qishui has no counterpart for', async () => {
        const request = stubRequest();
        await qishuiProvider.recommendations!.getPersonalFm!({ mode: 'SCENE_RCMD', submode: 'CHINESE' });
        expect(paramsOf(request)).toMatchObject({ preferenceMode: 'default' });
        expect(paramsOf(request)).not.toHaveProperty('sceneModeId');
    });

    it('reads recommended playlists from the playlist square', async () => {
        const request = vi.fn(async () => ({
            ok: true,
            data: {
                items: [
                    {
                        id: 'p1',
                        type: 'playlist',
                        entity: {
                            playlist: {
                                id: 'p1',
                                title: 'Square Playlist',
                                desc: 'Playlist description',
                                count_tracks: 24,
                                type: 3,
                                url_cover: { urls: ['https://cover.test/'], uri: 'cover', template_prefix: 'tpl' },
                            },
                        },
                    },
                    { id: 'p2', title: 'Loose Playlist', count_tracks: 3, type: 3 },
                    { nope: true },
                ],
            },
        }));
        vi.stubGlobal('window', { electron: { qishuiRequest: request } });

        const playlists = await qishuiProvider.recommendations!.getRecommendedCollections!(10);

        expect(request.mock.calls[0]).toEqual(['playlist_square', { categoryId: 0 }]);
        expect(playlists.map(playlist => playlist.id)).toEqual(['p1', 'p2']);
        expect(playlists[0]).toMatchObject({
            providerId: 'qishui',
            type: 'playlist',
            name: 'Square Playlist',
            description: 'Playlist description',
            trackCount: 24,
            coverUrl: 'https://cover.test/cover~tpl-crop-center:400:400.jpg',
        });
    });

    it('keeps at most the requested number of recommended playlists', async () => {
        vi.stubGlobal('window', {
            electron: {
                qishuiRequest: vi.fn(async () => ({
                    ok: true,
                    data: { items: [{ id: 'p1', title: 'One', count_tracks: 1 }, { id: 'p2', title: 'Two', count_tracks: 2 }] },
                })),
            },
        });
        const playlists = await qishuiProvider.recommendations!.getRecommendedCollections!(1);
        expect(playlists.map(playlist => playlist.id)).toEqual(['p1']);
    });
});
