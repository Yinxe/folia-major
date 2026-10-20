const { createQishuiClient, QishuiError } = require('./qishuiClient.cjs');

// electron/qishui/qishuiApiBridge.cjs
// The only surface the renderer has on Qishui. Credentials and the device identity stay in this
// process; the renderer names an operation and the bridge decides which protocol call it means.

const QISHUI_OPERATIONS = Object.freeze([
    'login_qr_start', 'login_qr_image', 'login_qr_check', 'login_qr_cancel', 'login_status', 'logout',
    'search', 'song_detail', 'audio', 'lyrics',
    'playlist_detail', 'playlist_tracks', 'album_detail', 'album_tracks',
    'artist_detail', 'artist_tracks', 'artist_albums',
    'my_playlists', 'liked_songs', 'liked_count', 'like', 'unlike', 'recent_played',
    'check_tracks', 'share_info', 'discover_home', 'feed_song_tab', 'playlist_square',
    'create_playlist', 'playlist_add_tracks', 'playlist_del_tracks',
    'collect_playlist', 'uncollect_playlist', 'collect_album', 'uncollect_album',
]);

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorResult = error => {
    if (error instanceof QishuiError) {
        return {
            ok: false,
            error: {
                code: error.code,
                message: error.message,
                ...(error.status ? { status: error.status } : {}),
                ...(error.rawCode ? { rawCode: error.rawCode } : {}),
            },
        };
    }
    return { ok: false, error: { code: 'network', message: 'Qishui request failed' } };
};

const createQishuiApiBridge = ({ store, safeStorage, onAudioSource = () => {}, fetchImpl, logger }) => {
    const client = createQishuiClient({ store, safeStorage, fetchImpl, logger });
    const pending = new Map();

    const request = async (operation, params = {}) => {
        try {
            if (!QISHUI_OPERATIONS.includes(operation)) {
                return { ok: false, error: { code: 'unsupported', message: 'Unsupported Qishui operation' } };
            }
            const input = isRecord(params) ? params : {};
            switch (operation) {
                case 'login_qr_start': {
                    const qr = await client.loginQrStart();
                    pending.set(qr.token, qr);
                    return { ok: true, data: { key: qr.token, imageUrl: qr.qrImage, expiresAt: qr.expiresAt } };
                }
                case 'login_qr_image': {
                    const qr = pending.get(String(input.key || ''));
                    return { ok: true, data: { imageUrl: qr?.qrImage || '' } };
                }
                case 'login_qr_check': {
                    const key = String(input.key || '');
                    const state = await client.loginQrCheck(key);
                    if (state.state === 'confirmed' || state.state === 'expired') pending.delete(key);
                    return { ok: true, data: state };
                }
                case 'login_qr_cancel': {
                    pending.delete(String(input.key || ''));
                    return { ok: true, data: {} };
                }
                case 'login_status': {
                    const user = await client.loginStatus();
                    return { ok: true, data: user ? { user, vip: client.vip } : null };
                }
                case 'logout': {
                    await client.logout();
                    pending.clear();
                    return { ok: true, data: {} };
                }
                case 'search': {
                    const result = await client.search(String(input.query || ''), Number(input.offset) || 0);
                    return { ok: true, data: result };
                }
                case 'song_detail': {
                    const detail = await client.trackDetail(input.id);
                    return {
                        ok: true,
                        data: {
                            track: detail.track,
                            preview: detail.preview,
                            expiresAt: detail.expiresAt,
                        },
                    };
                }
                case 'audio': {
                    const detail = await client.trackDetail(input.id);
                    for (const quality of detail.qualities) {
                        if (quality.url) onAudioSource(quality.url);
                        if (quality.backupUrl) onAudioSource(quality.backupUrl);
                    }
                    return {
                        ok: true,
                        data: {
                            qualities: detail.qualities,
                            preview: detail.preview,
                            expiresAt: detail.expiresAt,
                        },
                    };
                }
                case 'lyrics': {
                    const detail = await client.trackDetail(input.id);
                    return { ok: true, data: { lyrics: detail.lyrics } };
                }
                case 'playlist_detail': {
                    const result = await client.playlistDetail(input.id, 0, 1);
                    return { ok: true, data: { playlist: result.playlist } };
                }
                case 'playlist_tracks': {
                    const result = await client.playlistDetail(
                        input.id,
                        Number(input.offset) || 0,
                        Number(input.limit) || 50,
                    );
                    return {
                        ok: true,
                        data: {
                            tracks: result.tracks,
                            nextCursor: result.nextCursor,
                            hasMore: result.hasMore,
                            total: result.total,
                        },
                    };
                }
                case 'album_detail': {
                    const result = await client.albumDetail(input.id);
                    return { ok: true, data: { album: result.album, tracks: result.tracks } };
                }
                case 'album_tracks': {
                    const result = await client.albumDetail(input.id);
                    return { ok: true, data: { tracks: result.tracks } };
                }
                case 'artist_detail': {
                    const result = await client.artistDetail(input.id);
                    return { ok: true, data: { artist: result.artist, hotTracks: result.hotTracks } };
                }
                case 'artist_tracks': {
                    const result = await client.artistTracks(
                        input.id,
                        Number(input.offset) || 0,
                        Number(input.limit) || 50,
                    );
                    return { ok: true, data: result };
                }
                case 'artist_albums': {
                    const result = await client.artistAlbums(
                        input.id,
                        Number(input.offset) || 0,
                        Number(input.limit) || 50,
                    );
                    return { ok: true, data: result };
                }
                case 'my_playlists': {
                    const result = await client.myPlaylists();
                    return { ok: true, data: result };
                }
                case 'liked_songs': {
                    const result = await client.likedSongs();
                    return { ok: true, data: result };
                }
                case 'liked_count': {
                    const result = await client.likedCount();
                    return { ok: true, data: result };
                }
                case 'like':
                case 'unlike': {
                    await client.request(operation === 'like' ? 'CollectTracks' : 'MDeleteCollectedTracks', {
                        track_ids: [String(input.id || '')],
                    });
                    return { ok: true, data: {} };
                }
                case 'recent_played': {
                    const result = await client.recentPlayed(
                        Number(input.offset) || 0,
                        Number(input.limit) || 50,
                    );
                    return { ok: true, data: result };
                }
                case 'check_tracks': {
                    const result = await client.checkTracks(Array.isArray(input.ids) ? input.ids : []);
                    return { ok: true, data: { statuses: result } };
                }
                case 'share_info': {
                    const result = await client.shareInfo(input.id);
                    return { ok: true, data: { shareInfo: result } };
                }
                case 'discover_home': {
                    const result = await client.request('DiscoverView', {});
                    return { ok: true, data: result };
                }
                case 'feed_song_tab': {
                    const preferenceMode = input.preferenceMode === 'familiar' || input.preferenceMode === 'fresh'
                        ? input.preferenceMode
                        : 'default';
                    const sceneModeId = Number(input.sceneModeId);
                    const count = Math.min(50, Math.max(1, Number(input.count) || 6));
                    const total = Math.max(1, Number(input.totalRequestCount) || 1);
                    const modeCount = Math.max(1, Number(input.preferenceModeRequestCount) || 1);
                    const result = await client.request('FeedSongTab', {
                        feed_mode: 'track',
                        preference_mode: preferenceMode,
                        count,
                        // The official client sends these on every request; the upstream accepts a
                        // smaller body, but matching it keeps the recommendation session coherent.
                        is_first_request: total === 1,
                        total_request_count: total,
                        preference_mode_request_count: modeCount,
                        is_did_first_request: Boolean(input.isDidFirstRequest),
                        did_first_use_time: Math.max(0, Number(input.didFirstUseTime) || Math.floor(Date.now() / 1000)),
                        feed_counts: { mix_session_count: total },
                        // Flat {scene_mode_id}: the only shape the upstream honours for a scene.
                        feed_preference: Number.isSafeInteger(sceneModeId) && sceneModeId > 0
                            ? { scene_mode_id: sceneModeId }
                            : { preference_mode: preferenceMode },
                    });
                    return { ok: true, data: { items: Array.isArray(result?.items) ? result.items : [] } };
                }
                case 'playlist_square': {
                    const categoryId = Number(input.categoryId);
                    const result = await client.request('FeedPlaylistSquare', {
                        category_id: Number.isSafeInteger(categoryId) && categoryId > 0 ? categoryId : 0,
                    });
                    return { ok: true, data: { items: Array.isArray(result?.items) ? result.items : [] } };
                }
                case 'create_playlist': {
                    const result = await client.request('CreatePlaylist', {
                        name: String(input.name || ''),
                        is_private: Boolean(input.isPrivate),
                    });
                    return { ok: true, data: { playlist: result?.playlist || null } };
                }
                case 'playlist_add_tracks':
                case 'playlist_del_tracks': {
                    const trackIds = Array.isArray(input.trackIds) ? input.trackIds.map(String) : [];
                    if (!trackIds.length) return { ok: true, data: {} };
                    await client.request(operation === 'playlist_add_tracks' ? 'MAppendPlaylistMedia' : 'DeletePlaylistMedia', {
                        playlist_id: String(input.playlistId || ''),
                        media: trackIds.map(id => ({ id, type: 'track' })),
                    });
                    return { ok: true, data: {} };
                }
                case 'collect_playlist':
                case 'uncollect_playlist': {
                    await client.request(operation === 'collect_playlist' ? 'CollectPlaylists' : 'MDeleteCollectedPlaylists', {
                        playlist_ids: [String(input.id || '')],
                    });
                    return { ok: true, data: {} };
                }
                case 'collect_album':
                case 'uncollect_album': {
                    await client.request(operation === 'collect_album' ? 'CollectAlbums' : 'MDeleteCollectedAlbums', {
                        album_ids: [String(input.id || '')],
                    });
                    return { ok: true, data: {} };
                }
                default:
                    return { ok: false, error: { code: 'unsupported', message: 'Unsupported Qishui operation' } };
            }
        } catch (error) {
            return errorResult(error);
        }
    };

    return { request, operations: QISHUI_OPERATIONS };
};

module.exports = { createQishuiApiBridge, QISHUI_OPERATIONS };
