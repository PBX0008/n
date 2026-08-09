(function (window) {
  'use strict';

  const STORAGE_KEY = 'pbxNursingDeviceAuthV1';
  const DEVICE_KEY = 'pbxNursingDeviceIdV1';
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

  const HOUR_KEY = Object.freeze({
    '00':'u','01':'d','02':'a','03':'i','04':'h','05':'v','06':'e','07':'y','08':'r','09':'c','10':'n','11':'x',
    '12':'o','13':'b','14':'s','15':'l','16':'w','17':'p','18':'k','19':'f','20':'g','21':'t','22':'z','23':'j'
  });

  const MINUTE_KEY = Object.freeze({
    '00':'rr','01':'xf','02':'ky','03':'ag','04':'gh','05':'qq','06':'nk','07':'gd','08':'im','09':'ng',
    '10':'ea','11':'dq','12':'oz','13':'dv','14':'od','15':'no','16':'xu','17':'kk','18':'bs','19':'sc',
    '20':'vd','21':'ex','22':'ox','23':'dc','24':'vt','25':'lo','26':'yt','27':'yj','28':'og','29':'wt',
    '30':'ho','31':'ct','32':'bu','33':'iz','34':'lk','35':'dd','36':'je','37':'dz','38':'rw','39':'za',
    '40':'oj','41':'gk','42':'op','43':'nz','44':'ig','45':'kn','46':'zn','47':'cv','48':'xz','49':'gt',
    '50':'va','51':'jq','52':'gl','53':'sf','54':'oy','55':'kq','56':'zf','57':'vy','58':'iq','59':'mu'
  });

  function safeStorage() {
    try {
      const testKey = '__pbx_auth_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return localStorage;
    } catch (_) {
      return null;
    }
  }

  function getDeviceId() {
    const storage = safeStorage();
    if (!storage) return '';
    let id = storage.getItem(DEVICE_KEY);
    if (!id) {
      try {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) {
        id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      storage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  // Lightweight integrity check against accidental/localStorage edits. This is not a server-side security signature.
  function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function stateSignature(state) {
    const deviceId = getDeviceId();
    return fnv1a(['PBX-NURSING-AUTH-V1', deviceId, state.issuedAt, state.expiresAt].join('|'));
  }

  function readState() {
    const storage = safeStorage();
    if (!storage) return null;
    try {
      const state = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (!state || state.version !== 1 || !Number.isFinite(state.issuedAt) || !Number.isFinite(state.expiresAt)) return null;
      if (state.signature !== stateSignature(state)) return null;
      return state;
    } catch (_) {
      return null;
    }
  }

  function writeState(state) {
    const storage = safeStorage();
    if (!storage) return false;
    state.signature = stateSignature(state);
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  }

  function clearState() {
    const storage = safeStorage();
    if (storage) storage.removeItem(STORAGE_KEY);
  }

  function addThreeCalendarMonthsIST(epochMs) {
    const ist = new Date(epochMs + IST_OFFSET_MS);
    const year = ist.getUTCFullYear();
    const month = ist.getUTCMonth();
    const day = ist.getUTCDate();
    const hour = ist.getUTCHours();
    const minute = ist.getUTCMinutes();
    const second = ist.getUTCSeconds();
    const millisecond = ist.getUTCMilliseconds();

    const targetMonthIndex = month + 3;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const targetDay = Math.min(day, lastDay);

    return Date.UTC(targetYear, targetMonth, targetDay, hour, minute, second, millisecond) - IST_OFFSET_MS;
  }

  function getISTParts(epochMs) {
    const ist = new Date(epochMs + IST_OFFSET_MS);
    return {
      hour: String(ist.getUTCHours()).padStart(2, '0'),
      minute: String(ist.getUTCMinutes()).padStart(2, '0')
    };
  }

  function expectedPassword(epochMs) {
    const parts = getISTParts(epochMs);
    return (HOUR_KEY[parts.hour] || '') + (MINUTE_KEY[parts.minute] || '');
  }

  function authenticate(password) {
    const storage = safeStorage();
    if (!storage) return { ok: false, reason: 'storage' };

    const entered = String(password || '').trim().toLowerCase();
    const now = Date.now();
    if (!entered || entered !== expectedPassword(now)) {
      return { ok: false, reason: 'password' };
    }

    const state = {
      version: 1,
      issuedAt: now,
      expiresAt: addThreeCalendarMonthsIST(now)
    };

    if (!writeState(state)) return { ok: false, reason: 'storage' };
    return { ok: true, state: state };
  }

  function status() {
    const now = Date.now();
    const state = readState();
    if (!state) return { valid: false, reason: 'missing', remainingMs: 0, state: null };

    if (state.expiresAt <= state.issuedAt || now >= state.expiresAt) {
      clearState();
      return { valid: false, reason: 'expired', remainingMs: 0, state: null };
    }

    // A newly-issued token cannot logically be far in the future. This catches major clock rollback after activation.
    if (now + CLOCK_ROLLBACK_TOLERANCE_MS < state.issuedAt) {
      return { valid: false, reason: 'clock', remainingMs: 0, state: state };
    }

    return { valid: true, reason: 'active', remainingMs: state.expiresAt - now, state: state };
  }

  function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }

  function formatIST(epochMs) {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      }).format(new Date(epochMs)) + ' IST';
    } catch (_) {
      const d = new Date(epochMs + IST_OFFSET_MS);
      return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} IST`;
    }
  }

  function requireValidAccess() {
    const current = status();
    if (current.valid) return true;

    const target = 'index.html?access=' + encodeURIComponent(current.reason || 'required');
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.replace(target);
      } else {
        window.location.replace(target);
      }
    } catch (_) {
      window.location.replace(target);
    }
    return false;
  }

  window.PBXAuth = Object.freeze({
    authenticate,
    status,
    clearState,
    formatRemaining,
    formatIST,
    requireValidAccess
  });
})(window);
