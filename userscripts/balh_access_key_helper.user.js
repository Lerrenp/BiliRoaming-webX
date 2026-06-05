// ==UserScript==
// @name         BALH access_key 助手
// @name:en      BALH access_key Helper
// @namespace    https://github.com/ipcjs/bilibili-helper
// @version      3.2.0
// @description  「解除B站区域限制」配套脚本: 在原脚本地球图标旁提供 access_key 助手浮层 (手动输入 + 自动获取)
// @author       ipcjs (改造 by Claude)
// @supportURL   https://github.com/ipcjs/bilibili-helper
// @compatible   chrome
// @compatible   firefox
// @license      MIT
// @match        *://www.bilibili.com/video/av*
// @match        *://www.bilibili.com/video/BV*
// @match        *://www.bilibili.com/bangumi/play/ep*
// @match        *://www.bilibili.com/bangumi/play/ss*
// @match        *://m.bilibili.com/bangumi/play/ep*
// @match        *://m.bilibili.com/bangumi/play/ss*
// @match        *://bangumi.bilibili.com/anime/*
// @match        *://bangumi.bilibili.com/movie/*
// @match        *://www.bilibili.com/bangumi/media/md*
// @match        *://space.bilibili.com/*
// @match        *://www.bilibili.com/
// @match        *://www.bilibili.com/?*
// @grant        none
// @run-at       document-end
// ==/UserScript==

/*
 * v3.2.0: 增加独立模式 (standalone mode)
 *         - 在 B 站主页 (www.bilibili.com/ 或 www.bilibili.com/?*) 上, 即使
 *           找不到 #balh-unblock-btn / #balh-settings-btn, 也会注入一个
 *           独立的浮动 access_key 按钮, 让用户在主页就能管理 access_key
 *         - 在其它页面上保留原逻辑 (依赖 BALH 主按钮, 找不到则不显示)
 * v3.1.0: 适配新版 BALH 解锁脚本 (#balh-unblock-btn); 双模式按钮注入 (浮动/内联);
 *         改善 SPA 导航下的按钮生存能力
 * v3.0.1: 删除方式 3 (备用授权), 方式 2 已正常工作
 * v3.0.0: 内联标准 MD5 实现, 完全去除外部依赖
 * 原因: B站 md5.js 是 eval(...) packed 脚本, Tampermonkey @grant none 下
 * 通过 <script> 注入到页面后全局变量不总是可见, 导致 "md5 is not defined"
 * 解决方案: 内置纯 JS 标准 MD5 算法 (RFC 1321), 0 外部依赖
 * 与主脚本 sign 生成逻辑完全一致 (sorted keys + raw concatenation + appsec)
 */

'use strict';

// ========== 内联 MD5 实现 (RFC 1321) ==========
// 与 B站 static.hdslb.com/js/md5.js 功能等价
function md5(string) {
    function RotateLeft(lValue, iShiftBits) {
        return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
    }
    function AddUnsigned(lX, lY) {
        var lX4, lY4, lX8, lY8, lResult;
        lX8 = (lX & 0x80000000);
        lY8 = (lY & 0x80000000);
        lX4 = (lX & 0x40000000);
        lY4 = (lY & 0x40000000);
        lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
        if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
        if (lX4 | lY4) {
            if (lResult & 0x40000000) return lResult ^ 0xC0000000 ^ lX8 ^ lY8;
            else return lResult ^ 0x40000000 ^ lX8 ^ lY8;
        } else return lResult ^ lX8 ^ lY8;
    }
    function F(x, y, z) { return (x & y) | ((~x) & z); }
    function G(x, y, z) { return (x & z) | (y & (~z)); }
    function H(x, y, z) { return (x ^ y ^ z); }
    function I(x, y, z) { return (y ^ (x | (~z))); }
    function FF(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    }
    function GG(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    }
    function HH(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    }
    function II(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    }
    function ConvertToWordArray(string) {
        var lWordCount, lMessageLength = string.length, lNumberOfWords_temp1 = lMessageLength + 8, lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64, lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16, lWordArray = Array(lNumberOfWords - 1), lBytePosition = 0, lByteCount = 0;
        while (lByteCount < lMessageLength) {
            lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
            lByteCount++;
        }
        lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
        lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
        lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
        return lWordArray;
    }
    function WordToHex(lValue) {
        var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
        for (lCount = 0; lCount <= 3; lCount++) {
            lByte = (lValue >>> (lCount * 8)) & 255;
            WordToHexValue_temp = "0" + lByte.toString(16);
            WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
        }
        return WordToHexValue;
    }
    function Utf8Encode(string) {
        string = string.replace(/\r\n/g, "\n");
        var utftext = "";
        for (var n = 0; n < string.length; n++) {
            var c = string.charCodeAt(n);
            if (c < 128) utftext += String.fromCharCode(c);
            else if ((c > 127) && (c < 2048)) {
                utftext += String.fromCharCode((c >> 6) | 192);
                utftext += String.fromCharCode((c & 63) | 128);
            } else {
                utftext += String.fromCharCode((c >> 12) | 224);
                utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                utftext += String.fromCharCode((c & 63) | 128);
            }
        }
        return utftext;
    }
    var x = Array(), k, AA, BB, CC, DD, a, b, c, d, S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20, S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
    string = Utf8Encode(string);
    x = ConvertToWordArray(string);
    a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
    for (k = 0; k < x.length; k += 16) {
        AA = a; BB = b; CC = c; DD = d;
        a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
        d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
        b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
        d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
        c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
        b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
        d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
        c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
        b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
        d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
        b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
        a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
        d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
        b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
        d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
        b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
        d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
        b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
        d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
        b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
        a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
        d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
        b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
        d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
        b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
        d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
        c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
        b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
        d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
        b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
        a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
        d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
        c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
        b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
        d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
        c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
        b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
        d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
        c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
        b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
        d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
        b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
        a = AddUnsigned(a, AA);
        b = AddUnsigned(b, BB);
        c = AddUnsigned(c, CC);
        d = AddUnsigned(d, DD);
    }
    return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
}

// ========== Converters (sign 生成, 与主脚本一致) ==========
const Converters = {
    generateSign: function(params, appsec) {
        const sArr = Object.keys(params).sort();
        let raw = '';
        sArr.forEach(function(k, i) { raw += (i === 0 ? '' : '&') + k + '=' + params[k]; });
        var searchParams = new URLSearchParams();
        sArr.forEach(function(k) { searchParams.append(k, params[k]); });
        return { sign: md5(raw + appsec), params: searchParams.toString() };
    }
};

// ========== cookie ==========
function getBiliCookie(key) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : undefined;
}

// ========== 钥匙按钮 ==========
var balhBtnAdded = false;
var balhBtnPoll = 0;
var BALH_BTN_MAX = 60;
var balhBtnMode = null; // 'standalone' | 'anchored'

// 判断当前页面是否是 B 站主页 (https://www.bilibili.com/ 或 https://www.bilibili.com/?*)
function balhIsHomePage() {
    if (location.host !== 'www.bilibili.com') return false;
    var p = location.pathname;
    return p === '/' || p === '';
}

function balhTryAddButton() {
    if (balhBtnAdded) return;
    if (!document.body) { balhScheduleBtn(); return; }

    // 已有按钮? 检查是否需要切换模式
    var existing = document.getElementById('balh-ak-btn');
    if (existing) {
        // 如果当前是主页 + 独立模式, 保持; 否则保留
        balhBtnAdded = true;
        return;
    }

    var onHome = balhIsHomePage();
    var settingsBtn = document.getElementById('balh-unblock-btn') || document.getElementById('balh-settings-btn');

    // 优先锚定 BALH 主按钮; 找不到时退化为独立浮动按钮
    // 这样 access_key 助手在所有匹配页面都可独立工作, 不再依赖「解除B站区域限制」主脚本。
    // 仅改变入口按钮挂载方式, 不改变 access_key 保存/获取等业务逻辑。
    if (settingsBtn) {
        balhInjectAnchoredButton(settingsBtn);
        balhBtnAdded = true;
        balhBtnMode = 'anchored';
        return;
    }

    balhInjectStandaloneButton(onHome);
    balhBtnAdded = true;
    balhBtnMode = 'standalone';
}
function balhScheduleBtn() {
    balhBtnPoll++;
    if (balhBtnPoll > BALH_BTN_MAX) return;
    setTimeout(balhTryAddButton, 500);
}

// 独立模式: 浮动按钮 (无 BALH 主按钮时的通用兜底)
function balhInjectStandaloneButton(onHome) {
    var btn = document.createElement('div');
    btn.id = 'balh-ak-btn';
    btn.title = 'BALH access_key 助手 (独立模式)';
    btn.style.cssText =
        'position:fixed;right:18px;bottom:' + (onHome ? '80px' : '140px') + ';z-index:99998;' +
        'width:48px;height:48px;cursor:pointer;' +
        'border:1px solid #ddd;border-radius:24px;' +
        'background:#fff;' +
        'display:flex;align-items:center;justify-content:center;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.18);' +
        'transition:transform .2s,background .2s,border-color .2s;';

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.style.fill = '#00a1d6';
    svg.style.transition = 'fill 0.2s';
    svg.innerHTML = '<path d="M336 352c97.2 0 176-78.8 176-176S433.2 0 336 0S160 78.8 160 176c0 18.6 2.9 36.5 8.2 53.1L7.7 389.6C2.8 394.5 0 401 0 407.7c0 6.7 2.8 13.2 7.7 18.1l78.4 78.4c4.9 4.9 11.4 7.7 18.1 7.7c6.7 0 13.2-2.8 18.1-7.7L283 345.5c16.6 5.3 34.5 8.2 53.1 8.2zM336 80c53 0 96 43 96 96s-43 96-96 96s-96-43-96-96s43-96 96-96z"/>';
    btn.appendChild(svg);

    // Hover effects
    btn.addEventListener('mouseenter', function() {
        btn.style.transform = 'scale(1.1)';
        btn.style.background = '#00a1d6';
        btn.style.borderColor = '#00a1d6';
        svg.style.fill = '#fff';
    });
    btn.addEventListener('mouseleave', function() {
        btn.style.transform = 'scale(1)';
        btn.style.background = '#fff';
        btn.style.borderColor = '#ddd';
        svg.style.fill = '#00a1d6';
    });

    btn.addEventListener('click', balhOpenOverlay);
    document.body.appendChild(btn);
}

// 锚定模式: 紧贴 BALH 主按钮 (原行为)
function balhInjectAnchoredButton(settingsBtn) {
    var isNewScript = settingsBtn.id === 'balh-unblock-btn';

    var btn = document.createElement('div');
    btn.id = 'balh-ak-btn';
    btn.title = 'access_key 助手 (BALH 配套)';

    if (isNewScript) {
        // 新脚本: 浮动圆形按钮, 位置在主按钮上方
        btn.style.cssText =
            'position:fixed;right:12px;bottom:140px;z-index:99998;' +
            'width:44px;height:44px;cursor:pointer;' +
            'border:1px solid #ddd;border-radius:22px;' +
            'background:#fff;' +
            'display:flex;align-items:center;justify-content:center;' +
            'box-shadow:0 2px 8px rgba(0,0,0,.15);' +
            'transition:transform .2s,background .2s,border-color .2s;';
    } else {
        // 旧脚本: 继承父容器定位 (内联在固定导航栏中)
        btn.style.cssText =
            'width:45px;height:45px;cursor:pointer;' +
            'border:1px solid #e5e9ef;border-radius:4px;' +
            'background:#f6f9fa;margin-top:4px;' +
            'display:flex;align-items:center;justify-content:center;' +
            'transition:background 0.2s, border-color 0.2s;';
    }

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('width', isNewScript ? '22' : '24');
    svg.setAttribute('height', isNewScript ? '22' : '24');
    svg.style.fill = isNewScript ? '#00a1d6' : 'rgb(153,162,170)';
    svg.style.transition = 'fill 0.2s';
    svg.innerHTML = '<path d="M336 352c97.2 0 176-78.8 176-176S433.2 0 336 0S160 78.8 160 176c0 18.6 2.9 36.5 8.2 53.1L7.7 389.6C2.8 394.5 0 401 0 407.7c0 6.7 2.8 13.2 7.7 18.1l78.4 78.4c4.9 4.9 11.4 7.7 18.1 7.7c6.7 0 13.2-2.8 18.1-7.7L283 345.5c16.6 5.3 34.5 8.2 53.1 8.2zM336 80c53 0 96 43 96 96s-43 96-96 96s-96-43-96-96s43-96 96-96z"/>';
    btn.appendChild(svg);

    // Hover effects
    btn.addEventListener('mouseenter', function() {
        if (isNewScript) {
            btn.style.transform = 'scale(1.1)';
            btn.style.background = '#00a1d6';
            btn.style.borderColor = '#00a1d6';
            svg.style.fill = '#fff';
        } else {
            btn.style.background = '#00a1d6';
            btn.style.borderColor = '#00a1d6';
            svg.style.fill = '#fff';
        }
    });
    btn.addEventListener('mouseleave', function() {
        if (isNewScript) {
            btn.style.transform = 'scale(1)';
            btn.style.background = '#fff';
            btn.style.borderColor = '#ddd';
            svg.style.fill = '#00a1d6';
        } else {
            btn.style.background = '#f6f9fa';
            btn.style.borderColor = '#e5e9ef';
            svg.style.fill = 'rgb(153,162,170)';
        }
    });

    btn.addEventListener('click', balhOpenOverlay);

    if (isNewScript) {
        // 新脚本: 浮动按钮直接挂在 body 上
        document.body.appendChild(btn);
    } else {
        // 旧脚本: 作为兄弟节点插入到设置按钮后面
        if (settingsBtn.nextSibling) {
            settingsBtn.parentNode.insertBefore(btn, settingsBtn.nextSibling);
        } else {
            settingsBtn.parentNode.appendChild(btn);
        }
    }
}

// ========== 浮层 ==========
function balhOpenOverlay() {
    if (document.getElementById('balh-ak-overlay')) {
        document.getElementById('balh-ak-overlay').style.display = 'flex';
        balhRefreshCur();
        return;
    }
    var overlay = document.createElement('div');
    overlay.id = 'balh-ak-overlay';
    overlay.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Microsoft YaHei,Arial,sans-serif;';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.style.display = 'none'; });
    var panel = document.createElement('div');
    panel.id = 'balh-ak-panel';
    panel.style.cssText = 'background:#fff;border-radius:10px;padding:20px 20px 20px 20px;width:560px;max-width:90vw;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3);position:relative;';
    panel.innerHTML = balhBuildHTML();
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    balhMakeDraggable(panel);
    balhBindEvents();
    balhRefreshCur();
    balhSetStatus('请选择一种方式获取 access_key', '');
}

function balhMakeDraggable(el) {
    var dragging = false, startX, startY, startLeft, startTop;
    var h = el.querySelector('h3');
    if (!h) return;
    h.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        var r = el.getBoundingClientRect();
        startLeft = r.left; startTop = r.top;
        el.style.position = 'fixed';
        el.style.left = startLeft + 'px';
        el.style.top = startTop + 'px';
        el.style.margin = '0';
        e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        el.style.left = (startLeft + e.clientX - startX) + 'px';
        el.style.top = (startTop + e.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', function() { dragging = false; });
}

function balhSetStatus(text, cls) {
    var el = document.getElementById('balh-ak-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'balh-ak-status' + (cls ? ' ' + cls : '');
}
function balhLogCaptured(text) {
    var el = document.getElementById('balh-ak-captured');
    if (!el) return;
    var line = '[' + new Date().toLocaleTimeString() + '] ' + text;
    el.textContent = (el.textContent === '暂无' ? '' : el.textContent + '\n') + line;
    el.scrollTop = el.scrollHeight;
}
function balhRefreshCur() {
    var cur = document.getElementById('balh-ak-cur');
    var expEl = document.getElementById('balh-ak-exp');
    if (!cur || !expEl) return;
    var ak = localStorage.access_key;
    cur.innerHTML = ak ? '<code>' + ak + '</code>' : '<i>无</i>';
    var exp = localStorage.oauth_expires_at;
    if (exp) {
        var d = new Date(+exp);
        expEl.textContent = '过期于: ' + d.toLocaleString() + (Date.now() < +exp ? ' (未过期)' : ' (已过期)');
    } else {
        expEl.textContent = '过期时间: 未设置';
    }
}
function balhSaveAk(ak, refreshToken, expiresAt) {
    if (!ak) return;
    localStorage.access_key = ak;
    if (refreshToken) localStorage.refresh_token = refreshToken;
    if (expiresAt) localStorage.oauth_expires_at = expiresAt;
    balhRefreshCur();
    balhSetStatus('access_key 已保存!\naccess_key = ' + ak
        + (expiresAt ? '\n过期于 ' + new Date(+expiresAt).toLocaleString() : '')
        + '\n\n可以关闭此浮层, 然后刷新番剧页面。', 'ok');
}

function balhBindEvents() {
    document.getElementById('balh-ak-btn-save').onclick = function() {
        var v = (document.getElementById('balh-ak-manual').value || '').trim();
        if (!v) { balhSetStatus('access_key 不能为空', 'err'); return; }
        var exp = localStorage.oauth_expires_at || (Date.now() + 365 * 24 * 3600 * 1000);
        balhSaveAk(v, localStorage.refresh_token || '', exp);
        balhLogCaptured('手动保存 access_key');
    };
    document.getElementById('balh-ak-btn-clear').onclick = function() {
        if (!confirm('确定清除已保存的 access_key?')) return;
        delete localStorage.access_key;
        delete localStorage.refresh_token;
        delete localStorage.oauth_expires_at;
        balhRefreshCur();
        balhSetStatus('已清除', 'ok');
        balhLogCaptured('已清除 access_key');
    };
    document.getElementById('balh-ak-btn-copy').onclick = function() {
        var ak = localStorage.access_key || '';
        if (!ak) { balhSetStatus('当前没有可复制的 access_key', 'err'); return; }
        var ta = document.createElement('textarea');
        ta.value = ak;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); balhSetStatus('已复制 access_key 到剪贴板', 'ok'); }
        catch (e) { balhSetStatus('复制失败, 请手动从下方选中复制', 'err'); }
        ta.remove();
    };
    document.getElementById('balh-ak-btn-close').onclick = function() {
        var ol = document.getElementById('balh-ak-overlay');
        if (ol) ol.remove();
    };
    document.getElementById('balh-ak-btn-refresh').onclick = function() { balhRefreshCur(); balhSetStatus('已刷新', 'ok'); };

    // 方式 2: 自动二维码
    document.getElementById('balh-ak-btn-auto').onclick = async function() {
        balhSetStatus('正在获取授权, 请稍候…');
        try {
            var s1 = Converters.generateSign({ appkey: '27eb53fc9058f8c3', local_id: "0", ts: (Date.now() / 1000).toFixed(0) }, 'c2ed53a74eeefe3cf99fbd01d8c9c375');
            var data1 = await (await fetch('https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code?' + s1.params + '&sign=' + s1.sign, { method: 'POST' })).json();
            if (!(data1.code === 0 && data1.data.auth_code)) {
                balhSetStatus('获取 auth_code 失败, 请先登录主站\n响应: ' + JSON.stringify(data1), 'err');
                return;
            }
            var authCode = data1.data.auth_code;
            balhSetStatus('auth_code 已获取, 请用 B 站手机 App 扫码: ' + authCode);
            var bili_jct = getBiliCookie('bili_jct') || '';
            var s2 = Converters.generateSign({ auth_code: authCode, build: "7082000", csrf: bili_jct }, 'c2ed53a74eeefe3cf99fbd01d8c9c375');
            var data2 = await (await fetch('https://passport.bilibili.com/x/passport-tv-login/h5/qrcode/confirm?' + s2.params, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            })).json();
            if (!(data2.code === 0 && (data2.message === "0" || data2.message === "OK"))) {
                balhSetStatus('二维码确认失败: ' + JSON.stringify(data2) + '\n可改用方式 1 手动输入', 'err');
                balhLogCaptured('data2: ' + JSON.stringify(data2));
                return;
            }
            balhSetStatus('已确认 (message=' + data2.message + '), 正在获取 token…');
            balhLogCaptured('data2.message=' + data2.message + ' (OK 表示主站已登录)');
            var s3 = Converters.generateSign({ appkey: '27eb53fc9058f8c3', local_id: "0", auth_code: authCode, ts: (Date.now() / 1000).toFixed(0) }, 'c2ed53a74eeefe3cf99fbd01d8c9c375');
            var data3 = await (await fetch('https://passport.bilibili.com/x/passport-tv-login/qrcode/poll?' + s3.params + '&sign=' + s3.sign, { method: 'POST' })).json();
            if (!(data3.code === 0 && (data3.message === "0" || data3.message === "OK") && data3.data && data3.data.token_info)) {
                balhSetStatus('获取 token 失败: ' + JSON.stringify(data3) + '\n可改用方式 1 手动输入', 'err');
                balhLogCaptured('data3: ' + JSON.stringify(data3));
                return;
            }
            var access_token = data3.data.token_info.access_token;
            var oauth_expires_at = (Date.now() / 1000 + data3.data.token_info.expires_in) * 1000;
            balhSaveAk(access_token, data3.data.token_info.refresh_token, oauth_expires_at);
            balhLogCaptured('自动获取成功, access_key = ' + access_token);
        } catch (e) {
            balhSetStatus('授权出错: ' + (e && e.message ? e.message : e) + '\n可改用方式 1 手动输入', 'err');
            balhLogCaptured('异常: ' + (e && e.stack ? e.stack : e));
        }
    };

}

function balhBuildHTML() {
    return '<style>'
        + '.balh-ak-row{margin:12px 0}'
        + '.balh-ak-h{border-left:4px solid #00a1d6;padding-left:8px;margin:16px 0 8px 0;font-size:14px}'
        + '.balh-ak-input{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #aaa;border-radius:4px;font-size:13px;word-break:break-all;font-family:Consolas,monospace}'
        + '.balh-ak-btn{padding:6px 12px;margin:4px 4px 4px 0;border:1px solid #1e90ff;background:#1e90ff;color:#fff;border-radius:4px;cursor:pointer;font-size:13px}'
        + '.balh-ak-btn:hover{background:#0077e6}'
        + '.balh-ak-btn.gray{border-color:#888;background:#888}'
        + '.balh-ak-btn.gray:hover{background:#666}'
        + '.balh-ak-btn.danger{border-color:#d33;background:#d33}'
        + '.balh-ak-btn.danger:hover{background:#a00}'
        + '.balh-ak-status{background:#f4f4f4;padding:10px;border-radius:4px;white-space:pre-wrap;word-break:break-all;font-size:13px;line-height:1.6;font-family:Consolas,monospace;min-height:30px}'
        + '.balh-ak-status.ok{background:#e6ffe6;color:#060;border-left:4px solid #0c0}'
        + '.balh-ak-status.err{background:#ffe6e6;color:#a00;border-left:4px solid #c00}'
        + '.balh-ak-tip{color:#666;font-size:12px;line-height:1.6;background:#fff8e1;padding:8px;border-radius:4px;border-left:3px solid #ffa726}'
        + 'h3{margin:0 0 8px 0;font-size:18px}'
        + '.balh-ak-close{position:absolute;right:12px;top:12px;width:30px;height:30px;border:none;background:transparent;font-size:22px;cursor:pointer;color:#888;line-height:1}'
        + '.balh-ak-close:hover{color:#000}'
        + 'code{background:#eef;padding:2px 4px;border-radius:3px;font-family:Consolas,monospace;font-size:12px;word-break:break-all}'
        + 'hr{border:0;border-top:1px dashed #ccc;margin:18px 0}'
        + '</style>'
        + '<button class="balh-ak-close" id="balh-ak-btn-close" title="关闭">&times;</button>'
        + '<h3>&#128273; BALH access_key 助手</h3>'
        + '<div class="balh-ak-tip">access_key 与 B 站账号绑定, 不绑定 session; 一次获取, 过期前可重复使用。本脚本与「解除B站区域限制」独立, 关闭此浮层不影响已保存的 access_key。</div>'
        + '<div class="balh-ak-h">当前已保存</div>'
        + '<div class="balh-ak-row">access_key: <span id="balh-ak-cur"><i>无</i></span></div>'
        + '<div class="balh-ak-row"><span id="balh-ak-exp">过期时间: 未设置</span> <button class="balh-ak-btn gray" id="balh-ak-btn-refresh" style="padding:2px 8px;font-size:12px">刷新</button></div>'
        + '<div class="balh-ak-row">'
        +   '<button class="balh-ak-btn" id="balh-ak-btn-copy">复制 access_key</button>'
        +   '<button class="balh-ak-btn danger" id="balh-ak-btn-clear">清除已保存的 access_key</button>'
        + '</div>'
        + '<hr/>'
        + '<div class="balh-ak-h">方式 1: 手动输入 access_key</div>'
        + '<div class="balh-ak-row"><input class="balh-ak-input" id="balh-ak-manual" placeholder="把已经获取到的 access_key 粘贴到这里, 例如: 4b9b27a1f..."/></div>'
        + '<div class="balh-ak-row"><button class="balh-ak-btn" id="balh-ak-btn-save">保存 access_key</button></div>'
        + '<hr/>'
        + '<div class="balh-ak-h">方式 2: 二维码自动获取</div>'
        + '<div class="balh-ak-row"><button class="balh-ak-btn" id="balh-ak-btn-auto">自动获取 access_key</button></div>'
        + '<div class="balh-ak-h">操作状态</div>'
        + '<div class="balh-ak-row"><div class="balh-ak-status" id="balh-ak-status">准备就绪</div></div>'
        + '<div class="balh-ak-h">捕获日志</div>'
        + '<div class="balh-ak-row"><div class="balh-ak-status" id="balh-ak-captured" style="max-height:160px;overflow:auto">暂无</div></div>';
}

// ========== mcbbs.png 广播 ==========
{
    if (location.href.match(/^https:\/\/www\.mcbbs\.net\/template\/mcbbs\/image\/special_photo_bg\.png/) != null) {
        if (location.href.match('access_key') != null) {
            try { window.stop(); } catch (e) {}
            try { document.children[0].innerHTML = '<title>BALH access_key 助手 - 授权</title><meta charset="UTF-8" name="viewport" content="width=device-width">已捕获 access_key, 正在回传…'; } catch (e) {}
            var msgg = 'balh-login-credentials: ' + location.href;
            try { window.opener && window.opener.postMessage(msgg, '*'); } catch (e) {}
            try { window.parent !== window && window.parent.postMessage(msgg, '*'); } catch (e) {}
            try { window.top !== window && window.top.postMessage(msgg, '*'); } catch (e) {}
            try { if (typeof BroadcastChannel !== 'undefined') { var bc = new BroadcastChannel('balh-login'); bc.postMessage(msgg); bc.close(); } } catch (e) {}
            try { localStorage.setItem('__balh_last_credentials__', msgg); } catch (e) {}
        }
    }
}

// ========== 启动 ==========
balhTryAddButton();
try {
    var observer = new MutationObserver(function() {
        var akBtn = document.getElementById('balh-ak-btn');
        if (!akBtn) {
            // 按钮不存在 (可能被SPA删除), 重新创建
            balhBtnAdded = false;
            balhTryAddButton();
        }
        // 注: 不再检查 offsetParent 状态来重新定位按钮
        // B站新页面频繁触发 DOM mutation, 会导致 offsetParent 短暂为 null 而误判
        // 按钮存在即视为有效, 避免无限重建循环
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
} catch (e) {}
