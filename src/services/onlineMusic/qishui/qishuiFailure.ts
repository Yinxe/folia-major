import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { QISHUI_BRIDGE_FAILED, QISHUI_NEEDS_DESKTOP } from './qishuiTransport';

// src/services/onlineMusic/qishui/qishuiFailure.ts
// What a failed Qishui request hands to the shared failure rules. The bridge passes the platform's
// own status code and sentence through; what they mean for playback is said here.

export const describeQishuiFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'qishui') return null;
    if (error.message === QISHUI_NEEDS_DESKTOP) return { case: 'not-configured' };
    if (error.message === QISHUI_BRIDGE_FAILED) return { case: 'local-service-stopped' };
    if (error.code === 'auth-required') return { signedOut: true };
    if (error.code === 'preview-only') return { case: 'preview-only' };
    if (error.code === 'region-restricted') return { message: error.message };
    // A status outside 2xx: "Qishui HTTP 503".
    const status = /^Qishui HTTP (\d{3})$/.exec(error.message)?.[1];
    if (status) return { httpStatus: Number(status) };
    // Qishui's own business code, quoted in "… (code 1000062)".
    const code = /\(code (-?\d{1,10})\)$/.exec(error.message)?.[1];
    if (code) return { code };
    if (error.code === 'network') return { message: error.message };
    return null;
};
