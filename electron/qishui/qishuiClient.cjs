const crypto = require('node:crypto');

// electron/qishui/qishuiClient.cjs
// The thin Qishui Music (SodaMusic) protocol client: only the endpoints the adapter asks for.
// The request shape follows the PC client 3.7.0 (aid 386088) and the measurements recorded in
// qishui-api (MIT): common query parameters, device registration, the passport QR login, and the
// anonymous h5 track endpoint (`/luna/h5/track_v2`, which needs `device_platform=web`).
// Keep this file free of Electron APIs: the bridge owns storage and encryption.

const API_BASE = 'https://api.qishui.com';
const APP_ID = '386088';
const APP_VERSION = '3.7.0';
const CHANNEL = 'official';
const PACKAGE = 'com.soda.music';
const USER_AGENT = `LunaPC/${APP_VERSION}(${CHANNEL})`;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DEVICE_KEY = 'QISHUI_DEVICE_V1';
const SESSION_KEY = 'QISHUI_SESSION_V1';
const REQUEST_TIMEOUT_MS = 20_000;

class QishuiError extends Error {
    constructor(code, message, status, rawCode) {
        super(message);
        this.name = 'QishuiError';
        this.code = code;
        this.status = status;
        this.rawCode = rawCode;
    }
}

const md5 = value => crypto.createHash('md5').update(value).digest('hex').toUpperCase();

const text = value => (value == null ? '' : String(value));

const mapStatus = code => {
    if (code === 1000016) return 'auth-required';
    if (code === 1000062) return 'unavailable';
    return 'invalid-response';
};

// The PC client's getTTCommonParams(): the values it sends on every luna request.
const commonParams = device => ({
    aid: APP_ID,
    app_name: 'luna_pc',
    region: 'cn',
    geo_region: 'cn',
    os_region: 'cn',
    sim_region: '',
    device_id: device.deviceId,
    cdid: '',
    iid: device.installId,
    version_name: APP_VERSION,
    version_code: APP_VERSION,
    channel: CHANNEL,
    build_mode: 'master',
    network_carrier: '',
    ac: 'wifi',
    tz_name: 'Asia/Shanghai',
    resolution: '',
    device_platform: 'windows',
    device_type: 'Windows',
    os_version: 'Windows 10 Pro',
    fp: device.deviceId,
});

// utils/image.ts: url_cover / url_avatar are a prefix plus a uri plus a template suffix.
const imageUrl = (image, width = 400) => {
    if (!image || typeof image !== 'object') return '';
    const prefix = Array.isArray(image.urls) ? text(image.urls[0]) : '';
    const uri = text(image.uri);
    if (prefix && uri) {
        const suffix = image.template_prefix
            ? `${image.template_prefix}-crop-center:${width}:${width}.jpg`
            : `c5_${width}x${width}.jpg`;
        return `${prefix}${uri}~${suffix}`;
    }
    return prefix;
};

// KRC: `[line start,line length]<word offset,word length,pitch>word…`. The word text follows its
// own timestamp; offsets are relative to the line start. Copied from qishui-api's parseKrc.
const parseKrc = content => {
    if (typeof content !== 'string' || !content.trim()) return null;
    const lineHead = /^\[(\d+),(\d+)\]/;
    const wordMark = /<(\d+),(\d+),?\d*>/g;
    const sentences = [];
    for (const line of content.split(/\r?\n/)) {
        const head = lineHead.exec(line);
        if (!head) continue;
        const start = Number(head[1]);
        const end = start + Number(head[2]);
        const rest = line.slice(head[0].length);
        const marks = [];
        for (const match of rest.matchAll(wordMark)) {
            marks.push({
                at: match.index,
                tagEnd: match.index + match[0].length,
                offset: Number(match[1]),
                duration: Number(match[2]),
            });
        }
        if (!marks.length) {
            const body = rest.trim();
            if (!body) continue;
            sentences.push({ text: body, start_ms: start, end_ms: end, words: [{ text: body, start_ms: start, end_ms: end }], type: 'lrc' });
            continue;
        }
        const words = marks.map((mark, index) => ({
            text: rest.slice(mark.tagEnd, marks[index + 1] ? marks[index + 1].at : rest.length),
            start_ms: start + mark.offset,
            end_ms: start + mark.offset + mark.duration,
        }));
        sentences.push({ text: words.map(word => word.text).join(''), start_ms: start, end_ms: end, words });
    }
    return sentences.length ? { lyric_type: 'krc', sentences } : null;
};

const endpoint = (method, path, pathKeys = []) => ({ method, path, pathKeys });

const ENDPOINTS = {
    GetMyInfo: endpoint('GET', () => '/luna/me'),
    GetMyPlaylists: endpoint('GET', () => '/luna/me/playlist'),
    GetPlaylistDetail: endpoint('GET', () => '/luna/playlist/detail'),
    GetAlbumDetail: endpoint('GET', params => `/luna/albums/${encodeURIComponent(params.album_id)}`, ['album_id']),
    GetArtistDetail: endpoint('GET', params => `/luna/artists/${encodeURIComponent(params.artist_id)}`, ['artist_id']),
    ListArtistTracks: endpoint('GET', params => `/luna/artists/${encodeURIComponent(params.artist_id)}/tracks`, ['artist_id']),
    ListArtistAlbums: endpoint('GET', params => `/luna/artists/${encodeURIComponent(params.artist_id)}/albums`, ['artist_id']),
    GetRecentPlayedTracks: endpoint('GET', () => '/luna/me/recently-played'),
    Search: endpoint('GET', params => `/luna/search/${encodeURIComponent(params.search_type || 'track')}`, ['search_type']),
    GetChartDetail: endpoint('GET', params => `/luna/charts/${encodeURIComponent(params.chart_id)}`, ['chart_id']),
    GetShareInfo: endpoint('GET', () => '/luna/share_info'),
    DiscoverView: endpoint('POST', () => '/luna/discover'),
    // PC 变体。通用路径 /luna/feed/song-tab 对这台 PC 设备回 1000006「当前设备无法访问」。
    FeedSongTab: endpoint('POST', () => '/luna/pc/feed/song-tab'),
    FeedPlaylistSquare: endpoint('POST', () => '/luna/feed/playlist-square'),
    MCheckTrack: endpoint('POST', () => '/luna/track/mcheck'),
    CollectTracks: endpoint('POST', () => '/luna/me/collection/track'),
    MDeleteCollectedTracks: endpoint('POST', () => '/luna/me/collection/track/delete'),
    CreatePlaylist: endpoint('POST', () => '/luna/me/playlist'),
    MAppendPlaylistMedia: endpoint('POST', () => '/luna/me/playlist/media/append'),
    DeletePlaylistMedia: endpoint('POST', () => '/luna/me/playlist/media/delete'),
    CollectPlaylists: endpoint('POST', () => '/luna/me/collection/playlist'),
    MDeleteCollectedPlaylists: endpoint('POST', () => '/luna/me/collection/playlist/delete'),
    CollectAlbums: endpoint('POST', () => '/luna/me/collection/album'),
    MDeleteCollectedAlbums: endpoint('POST', () => '/luna/me/collection/album/delete'),
};

const createQishuiClient = ({ store, safeStorage, fetchImpl = fetch, now = Date.now, logger = () => {} }) => {
    const canEncrypt = () => Boolean(safeStorage?.isEncryptionAvailable?.())
        && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

    const readDevice = () => {
        const value = store.get(DEVICE_KEY);
        if (!value || typeof value !== 'object') return null;
        if (!value.deviceId || !value.installId) return null;
        return value;
    };

    const readSession = () => {
        try {
            const sealed = store.get(SESSION_KEY);
            if (typeof sealed !== 'string' || !canEncrypt()) return { cookies: {}, user: null };
            const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
            if (value?.version !== 1) return { cookies: {}, user: null };
            return {
                cookies: value.cookies && typeof value.cookies === 'object' ? value.cookies : {},
                user: value.user && typeof value.user === 'object' ? value.user : null,
            };
        } catch {
            logger('[Qishui] The saved session could not be read');
            return { cookies: {}, user: null };
        }
    };

    let device = readDevice();
    let devicePromise = null;
    const cookies = new Map();
    let user = null;
    let vip = false;
    let sessionLoaded = false;

    // safeStorage is only usable after the app is ready; the session is read on first use.
    const ensureSession = () => {
        if (sessionLoaded) return;
        sessionLoaded = true;
        const restored = readSession();
        for (const [name, value] of Object.entries(restored.cookies)) cookies.set(name, value);
        user = restored.user;
        vip = Boolean(restored.user?.isVip);
    };

    const cookieHeader = () => {
        ensureSession();
        return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    };
    const isLoggedIn = () => {
        ensureSession();
        return cookies.has('sessionid') || cookies.has('sessionid_ss');
    };

    const saveSession = () => {
        ensureSession();
        try {
            if (!canEncrypt()) {
                store.delete(SESSION_KEY);
                return;
            }
            const value = { version: 1, cookies: Object.fromEntries(cookies), user };
            store.set(SESSION_KEY, safeStorage.encryptString(JSON.stringify(value)).toString('base64'));
        } catch {
            logger('[Qishui] The session could not be saved');
        }
    };

    const absorb = headers => {
        const values = typeof headers.getSetCookie === 'function'
            ? headers.getSetCookie()
            : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
        let changed = false;
        for (const line of values) {
            const pair = String(line).split(';')[0];
            const at = pair.indexOf('=');
            if (at <= 0) continue;
            cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
            changed = true;
        }
        if (changed) saveSession();
    };

    const registerDevice = async () => {
        const cdid = crypto.randomUUID();
        const payload = {
            header: {
                device_id: '',
                install_id: '',
                os: 'Windows',
                device_platform: 'PC',
                sdk_version: '1.0',
                sdk_version_code: 1,
                aid: Number(APP_ID),
                mc: '00:00:00:00:00:00',
                channel: CHANNEL,
                package: PACKAGE,
                language: 'zh-CN',
                app_version: APP_VERSION,
                os_version: 'Windows 10: 10.0',
                device_model: 'no detected',
                time_zone: 'Asia/Shanghai',
                tz_name: 'Asia/Shanghai',
                tz_offset: 0,
                resolution: 'no detected',
                app_region: 'cn',
                app_language: 'zh-CN',
                display_name: '汽水音乐',
                pc_uuid: cdid,
                pc_serial: '',
            },
            gen_time: now(),
            magic_tag: 'ss_app_log',
        };
        const query = new URLSearchParams({
            aid: APP_ID,
            channel: CHANNEL,
            os: 'Windows',
            os_version: 'Windows 10: 10.0',
            device_platform: 'PC',
            app_version: APP_VERSION,
        });
        const response = await fetchImpl(`${API_BASE}/service/2/desktop/device_register/?${query}`, {
            method: 'POST',
            headers: { 'user-agent': USER_AGENT, 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const json = await response.json().catch(() => null);
        if (!json?.device_id_str) throw new QishuiError('network', `Qishui device registration failed (HTTP ${response.status})`, response.status);
        const value = {
            deviceId: String(json.device_id_str),
            installId: String(json.install_id_str || ''),
            cdid,
        };
        store.set(DEVICE_KEY, value);
        return value;
    };

    const ensureDevice = async () => {
        if (device) return device;
        if (!devicePromise) {
            devicePromise = registerDevice()
                .then(value => { device = value; return value; })
                .finally(() => { devicePromise = null; });
        }
        return devicePromise;
    };

    const httpRequest = async ({ method, path, query = {}, body, form, headers = {}, useCommon = true, timeout = REQUEST_TIMEOUT_MS }) => {
        const current = useCommon ? await ensureDevice() : null;
        const url = new URL(path, API_BASE);
        const allQuery = useCommon ? { ...commonParams(current), ...query } : { ...query };
        for (const [key, value] of Object.entries(allQuery)) {
            if (value === undefined || value === null) continue;
            if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
            else url.searchParams.set(key, String(value));
        }
        const finalHeaders = { 'user-agent': USER_AGENT, accept: 'application/json', ...headers };
        let payload;
        if (form) {
            payload = new URLSearchParams(form).toString();
            finalHeaders['content-type'] = 'application/x-www-form-urlencoded';
        } else if (body !== undefined) {
            payload = JSON.stringify(body);
            finalHeaders['content-type'] = 'application/json; charset=utf-8';
            finalHeaders['x-ss-stub'] = md5(payload);
        }
        const cookie = cookieHeader();
        if (cookie) finalHeaders.cookie = cookie;
        finalHeaders['x-luna-is-local-user'] = isLoggedIn() ? '1' : '0';

        logger(`[Qishui] ${method} ${url.pathname}`);
        const response = await fetchImpl(url.toString(), {
            method,
            headers: finalHeaders,
            body: payload,
            signal: AbortSignal.timeout(timeout),
        });
        absorb(response.headers);
        if (response.headers.get('bdturing-verify')) {
            throw new QishuiError('rate-limited', 'Qishui asks for a captcha', response.status);
        }
        const raw = await response.text();
        if (!response.ok) throw new QishuiError('network', `Qishui HTTP ${response.status}`, response.status);
        if (!raw) throw new QishuiError('invalid-response', 'Qishui returned an empty response', response.status);
        let json;
        try {
            json = JSON.parse(raw);
        } catch {
            throw new QishuiError('invalid-response', 'Qishui returned a response that is not JSON', response.status);
        }
        const code = json?.status_code;
        if (typeof code === 'number' && code !== 0) {
            const message = text(json?.status_info?.status_msg || json?.status_info?.status_desc) || `Qishui rejected the request (code ${code})`;
            throw new QishuiError(mapStatus(code), message, response.status, code);
        }
        return json;
    };

    const request = async (key, params = {}) => {
        const definition = ENDPOINTS[key];
        if (!definition) throw new QishuiError('invalid-response', `Unknown Qishui endpoint: ${key}`);
        const rest = { ...params };
        for (const pathKey of definition.pathKeys) delete rest[pathKey];
        const path = definition.path(params);
        if (definition.method === 'GET') return httpRequest({ method: 'GET', path, query: rest });
        return httpRequest({ method: 'POST', path, body: rest });
    };

    const trackDetail = async id => {
        const trackId = text(id).trim();
        if (!trackId) throw new QishuiError('invalid-response', 'Qishui track id is missing');
        const url = new URL(`${API_BASE}/luna/h5/track_v2`);
        url.searchParams.set('track_id', trackId);
        url.searchParams.set('device_platform', 'web');
        const trackHeaders = { 'user-agent': BROWSER_USER_AGENT, accept: 'application/json' };
        const cookie = cookieHeader();
        if (cookie) trackHeaders.cookie = cookie;
        const response = await fetchImpl(url.toString(), {
            headers: trackHeaders,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new QishuiError('network', `Qishui track HTTP ${response.status}`, response.status);
        const raw = await response.text();
        if (!raw) throw new QishuiError('invalid-response', 'Qishui returned an empty track response', response.status);
        let json;
        try {
            json = JSON.parse(raw);
        } catch {
            throw new QishuiError('invalid-response', 'Qishui returned a track response that is not JSON', response.status);
        }
        if (typeof json?.status_code === 'number' && json.status_code !== 0) {
            const message = text(json?.status_info?.status_msg) || `Qishui rejected the track request (code ${json.status_code})`;
            throw new QishuiError(mapStatus(json.status_code), message, response.status, json.status_code);
        }
        const track = json?.track;
        if (!track?.id) throw new QishuiError('not-playable', 'Qishui has no such track');
        let player = json?.track_player || {};
        if (typeof player.video_model === 'string') {
            try { player = { ...player, video_model: JSON.parse(player.video_model) }; } catch { player = { ...player, video_model: null }; }
        }
        const model = player.video_model || {};
        const clipDurationMs = Number(track.preview?.duration) || Number(track.audition_info?.duration_ms) || 0;
        const clipStartMs = Number(track.preview?.start) || Number(track.audition_info?.start_time_ms) || 0;
        // An empty `preview` object comes with a whole track; a clip carries its length.
        const isPreview = clipDurationMs > 0;
        const qualities = (Array.isArray(model.video_list) ? model.video_list : []).map(item => ({
            quality: text(item?.video_meta?.quality),
            url: text(item?.main_url),
            backupUrl: text(item?.backup_url),
            bytes: Number(item?.video_meta?.size) || 0,
            bitrate: Number(item?.video_meta?.bitrate) || 0,
        })).filter(item => item.url);
        return {
            track,
            qualities,
            preview: isPreview ? { startMs: clipStartMs, durationMs: clipDurationMs } : null,
            expiresAt: Number(json?.expire_at) || Number(model.url_expire) || 0,
            lyrics: json?.lyric?.content ? parseKrc(json.lyric.content) : null,
        };
    };

    const search = async (query, offset = 0) => {
        const data = await request('Search', {
            search_type: 'track',
            q: query,
            cursor: String(offset || 0),
            search_id: crypto.randomUUID(),
            search_method: 'track',
            from_search_id: '',
            search_scene: '',
        });
        const groups = Array.isArray(data.result_groups) ? data.result_groups : [];
        const group = groups.find(item => item?.id === 'tracks')
            || groups.find(item => (Array.isArray(item?.data) && item.data.length) || (Array.isArray(item?.items) && item.items.length))
            || { data: [] };
        const rawItems = Array.isArray(group.data) ? group.data : (Array.isArray(group.items) ? group.items : []);
        const items = rawItems
            .map(item => item?.entity?.track || item?.entity?.track_wrapper?.track || item?.track)
            .filter(Boolean);
        return { items, nextCursor: text(group.next_cursor), hasMore: Boolean(group.has_more) };
    };

    const myPlaylists = async () => {
        const data = await request('GetMyPlaylists', { cursor: 0, count: 50, ab_param: '' });
        return {
            playlists: Array.isArray(data.playlists) ? data.playlists : [],
            total: Number(data.total_num) || 0,
        };
    };

    const playlistDetail = async (id, cursor = 0, count = 50) => {
        const data = await request('GetPlaylistDetail', {
            playlist_id: text(id),
            cursor,
            count,
            session_id: '',
            reverse: false,
            ab_param: '',
        });
        const tracks = (Array.isArray(data.media_resources) ? data.media_resources : [])
            .map(item => item?.entity?.track_wrapper?.track || item?.entity?.track || item?.track || (item?.id ? item : null))
            .filter(Boolean);
        return {
            playlist: data.playlist || null,
            tracks,
            nextCursor: text(data.next_cursor),
            hasMore: Boolean(data.has_more),
            total: Number(data.total_num) || 0,
        };
    };

    const likedPlaylist = async () => {
        const { playlists } = await myPlaylists();
        return playlists.find(item => Number(item?.type) === 1)
            || playlists.find(item => /喜欢/.test(text(item?.title)))
            || null;
    };

    const likedSongs = async () => {
        const liked = await likedPlaylist();
        if (!liked) return { ids: [], whole: true, total: 0 };
        const ids = new Set();
        let cursor = 0;
        let whole = false;
        const total = Number(liked.count_tracks) || 0;
        for (let page = 0; page < 50; page += 1) {
            const result = await playlistDetail(liked.id, cursor, 200);
            for (const track of result.tracks) if (track.id != null) ids.add(text(track.id));
            if (!result.hasMore) { whole = true; break; }
            const next = Number(result.nextCursor);
            if (!Number.isFinite(next) || next <= cursor) break;
            cursor = next;
        }
        return { ids: [...ids], whole, total };
    };

    const likedCount = async () => {
        const liked = await likedPlaylist();
        return { total: liked ? Number(liked.count_tracks) || 0 : 0 };
    };

    const albumDetail = async id => {
        const data = await request('GetAlbumDetail', { album_id: text(id), ignore_tracks: false });
        return {
            album: data.album_info || null,
            tracks: Array.isArray(data.tracks) ? data.tracks : [],
        };
    };

    const artistDetail = async id => {
        const data = await request('GetArtistDetail', { artist_id: text(id), locate_item_id: 0 });
        return {
            artist: data.artist_info || null,
            hotTracks: Array.isArray(data.hot_tracks) ? data.hot_tracks : [],
        };
    };

    const artistTracks = async (id, cursor = 0, count = 50) => {
        const data = await request('ListArtistTracks', { artist_id: text(id), cursor, count });
        return {
            tracks: Array.isArray(data.tracks) ? data.tracks : [],
            nextCursor: text(data.next_cursor),
            hasMore: Boolean(data.has_more),
        };
    };

    const artistAlbums = async (id, cursor = 0, count = 50) => {
        const data = await request('ListArtistAlbums', { artist_id: text(id), cursor, count });
        return {
            albums: Array.isArray(data.albums) ? data.albums : [],
            nextCursor: text(data.next_cursor),
            hasMore: Boolean(data.has_more),
        };
    };

    const recentPlayed = async (cursor = 0, count = 50) => {
        const data = await request('GetRecentPlayedTracks', { cursor, count });
        return {
            tracks: Array.isArray(data.tracks) ? data.tracks : [],
            nextCursor: text(data.next_cursor),
            hasMore: Boolean(data.has_more),
        };
    };

    const checkTracks = async ids => {
        if (!Array.isArray(ids) || !ids.length) return [];
        const data = await request('MCheckTrack', { track_ids: ids.map(text), scene: 0 });
        return Array.isArray(data.track_status) ? data.track_status : [];
    };

    const shareInfo = async id => {
        const data = await request('GetShareInfo', { item_type: 'track', item_id: text(id) });
        return data.share_info || null;
    };

    const loginQrStart = async () => {
        await ensureDevice();
        const common = {
            ...commonParams(device),
            device_platform: 'PC',
            os: 'Windows',
            language: 'zh',
            passport_jssdk_version: '4.2.3',
            passport_jssdk_type: 'lite',
            is_from_ttaccountsdk: '1',
            account_sdk_source: 'web',
            next: API_BASE,
            need_logo: 'false',
            need_short_url: 'false',
            is_new_login: '1',
        };
        const json = await httpRequest({ method: 'GET', path: '/passport/web/get_qrcode/', query: common, useCommon: false });
        const data = json?.data || {};
        if (!data.token) throw new QishuiError('invalid-response', 'Qishui did not return a login token');
        const expiresAt = Math.min(
            (Number(data.expire_time) || Math.floor(now() / 1000) + 60) * 1000,
            now() + 5 * 60 * 1000,
        );
        return {
            token: text(data.token),
            qrImage: typeof data.qrcode === 'string' ? data.qrcode : '',
            expiresAt,
        };
    };

    const loginQrCheck = async token => {
        await ensureDevice();
        const common = {
            ...commonParams(device),
            device_platform: 'PC',
            os: 'Windows',
            language: 'zh',
            passport_jssdk_version: '4.2.3',
            passport_jssdk_type: 'lite',
            is_from_ttaccountsdk: '1',
            account_sdk_source: 'web',
        };
        const json = await httpRequest({
            method: 'POST',
            path: '/passport/web/check_qrconnect/',
            query: common,
            form: {
                need_logo: 'false',
                need_short_url: 'false',
                is_frontier: 'true',
                token: text(token),
                is_new_login: '1',
                next: API_BASE,
            },
            useCommon: false,
        });
        const status = text(json?.data?.status);
        if (status === '3' || status === 'confirmed' || status === 'confirm') {
            const signedIn = await loginStatus();
            if (!signedIn) throw new QishuiError('auth-required', 'Qishui confirmed the scan but did not sign in');
            return { state: 'confirmed' };
        }
        if (status === '2' || status === 'scanned' || status === 'scan') return { state: 'scanned' };
        if (status === '4' || status === 'expired') return { state: 'expired' };
        if (status === '1' || status === 'waiting' || status === 'new') return { state: 'waiting' };
        return { state: 'waiting' };
    };

    const loginStatus = async () => {
        try {
            const data = await request('GetMyInfo', {});
            const info = data?.my_info;
            if (!info?.id) return null;
            user = {
                id: text(info.id),
                nickname: text(info.nickname),
                avatarUrl: imageUrl(info.larger_avatar_url || info.medium_avatar_url || info.url_avatar),
                isVip: Boolean(info.is_vip),
                vipStage: text(info.vip_stage),
            };
            vip = Boolean(info.is_vip);
            saveSession();
            return user;
        } catch (error) {
            if (error?.code === 'auth-required') return null;
            throw error;
        }
    };

    const logout = async () => {
        ensureSession();
        cookies.clear();
        user = null;
        vip = false;
        store.delete(SESSION_KEY);
    };

    return {
        get vip() { ensureSession(); return vip; },
        get user() { ensureSession(); return user; },
        isLoggedIn,
        search,
        trackDetail,
        myPlaylists,
        playlistDetail,
        likedPlaylist,
        likedSongs,
        likedCount,
        albumDetail,
        artistDetail,
        artistTracks,
        artistAlbums,
        recentPlayed,
        checkTracks,
        shareInfo,
        loginQrStart,
        loginQrCheck,
        loginStatus,
        logout,
        request,
    };
};

module.exports = {
    createQishuiClient,
    QishuiError,
    imageUrl,
    parseKrc,
    API_BASE,
    APP_ID,
    APP_VERSION,
    DEVICE_KEY,
    SESSION_KEY,
};
