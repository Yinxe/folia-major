// electron/qishui/mediaCors.cjs
// Qishui's audio and cover CDNs do not answer the renderer's cross-origin reads with CORS
// headers. Scope the relaxation to URLs the bridge handed out and to Qishui's own media hosts.

function createQishuiMediaPolicy({ now = Date.now } = {}) {
    const issuedUrls = new Map();
    const ttl = 2 * 60 * 60 * 1000;

    const normalize = value => {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
            url.hash = '';
            return url;
        } catch {
            return null;
        }
    };

    const register = value => {
        const url = normalize(value);
        if (!url) return;
        issuedUrls.delete(url.href);
        issuedUrls.set(url.href, now() + ttl);
        while (issuedUrls.size > 2048) issuedUrls.delete(issuedUrls.keys().next().value);
    };

    const isAudioHost = hostname => hostname === 'douyinvod.com' || hostname.endsWith('.douyinvod.com');
    const isImageHost = hostname => hostname === 'douyinpic.com' || hostname.endsWith('.douyinpic.com');

    const allows = details => {
        if (!['media', 'xhr', 'image'].includes(details.resourceType)) return false;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(details.method)) return false;
        const url = normalize(details.url);
        if (!url) return false;
        const expiry = issuedUrls.get(url.href);
        if (expiry > now()) return true;
        if (expiry !== undefined) issuedUrls.delete(url.href);
        if (details.resourceType === 'image') return isImageHost(url.hostname);
        return isAudioHost(url.hostname);
    };

    return {
        register,
        allows,
        followRedirect(details) {
            if (allows(details)) register(details.redirectURL);
        },
    };
}

module.exports = { createQishuiMediaPolicy };
