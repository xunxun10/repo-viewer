// 菜单图标生成：几何绘制 16x16 图标，保证视觉大小统一
const zlib = require('zlib');
const { nativeImage } = require('electron');

// ---------- 绘图基元 ----------
function _set(px, x, y) {
    if (x < 0 || x >= 16 || y < 0 || y >= 16) return;
    var i = (y * 16 + x) * 4;
    px[i] = 0x99; px[i + 1] = 0x99; px[i + 2] = 0x99; px[i + 3] = 0xFF;
}
function _line(px, x1, y1, x2, y2) {
    var dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
    var sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1, err = dx + dy;
    while (true) {
        _set(px, x1, y1);
        if (x1 === x2 && y1 === y2) break;
        var e2 = 2 * err;
        if (e2 >= dy) { err += dy; x1 += sx; }
        if (e2 <= dx) { err += dx; y1 += sy; }
    }
}
function _rect(px, x, y, w, h) {
    _line(px, x, y, x + w - 1, y);
    _line(px, x + w - 1, y, x + w - 1, y + h - 1);
    _line(px, x + w - 1, y + h - 1, x, y + h - 1);
    _line(px, x, y + h - 1, x, y);
}
function _circle(px, cx, cy, r) {
    var x = 0, y = r, d = 3 - 2 * r;
    while (x <= y) {
        _set(px, cx + x, cy + y); _set(px, cx - x, cy + y);
        _set(px, cx + x, cy - y); _set(px, cx - x, cy - y);
        _set(px, cx + y, cy + x); _set(px, cx - y, cy + x);
        _set(px, cx + y, cy - x); _set(px, cx - y, cy - x);
        if (d < 0) { d += 4 * x + 6; } else { d += 4 * (x - y) + 10; y--; }
        x++;
    }
}

// ---------- 各图标绘制函数 ----------
var DRAW = {
    // 钥匙：小圆 + 斜杆 + 齿
    key: function (px) {
        _circle(px, 5, 8, 2);
        _line(px, 7, 8, 14, 6);
        _line(px, 11, 7, 14, 9);
    },
    // 文件夹：上框 + 下框
    dir: function (px) {
        _line(px, 2, 5, 5, 5);
        _line(px, 5, 5, 7, 3);
        _line(px, 7, 3, 14, 3);
        _line(px, 14, 3, 14, 13);
        _line(px, 14, 13, 2, 13);
        _line(px, 2, 13, 2, 5);
    },
    // 齿轮：外圆 + 内圆 + 齿
    gear: function (px) {
        _circle(px, 8, 8, 5);
        _circle(px, 8, 8, 2);
        for (var a = 0; a < 6; a++) {
            var angle = a * Math.PI / 3;
            var x1 = 8 + Math.round(4 * Math.cos(angle));
            var y1 = 8 + Math.round(4 * Math.sin(angle));
            var x2 = 8 + Math.round(6 * Math.cos(angle));
            var y2 = 8 + Math.round(6 * Math.sin(angle));
            _line(px, x1, y1, x2, y2);
        }
    },
    // 列表：三条横线 + 圆点
    list: function (px) {
        _line(px, 4, 4, 14, 4);
        _line(px, 4, 8, 14, 8);
        _line(px, 4, 12, 14, 12);
        _circle(px, 2, 4, 1);
        _circle(px, 2, 8, 1);
        _circle(px, 2, 12, 1);
    },
    // 信息：圆 + i
    info: function (px) {
        _circle(px, 8, 8, 6);
        _line(px, 8, 6, 8, 6);
        _line(px, 8, 8, 8, 11);
    },
    // 文档：矩形 + 内线
    doc: function (px) {
        _rect(px, 2, 3, 12, 10);
        _line(px, 5, 6, 10, 6);
        _line(px, 5, 8, 10, 8);
        _line(px, 5, 10, 8, 10);
    },
};

// ---------- PNG 生成 ----------
function _MakePng(rgba) {
    var rawStride = 16 * 4 + 1;
    var raw = Buffer.alloc(rawStride * 16, 0);
    for (var y = 0; y < 16; y++) {
        raw[y * rawStride] = 0;
        for (var x = 0; x < 16; x++) {
            var s = (y * 16 + x) * 4, d = y * rawStride + 1 + x * 4;
            raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1];
            raw[d + 2] = rgba[s + 2]; raw[d + 3] = rgba[s + 3];
        }
    }
    var deflated = zlib.deflateSync(raw);
    function crc32(buf) {
        if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
        var c = 0xFFFFFFFF, t = new Int32Array(256);
        for (var i = 0; i < 256; i++) { var v = i; for (var j = 0; j < 8; j++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1); t[i] = v; }
        for (var i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function chk(type, data) {
        var l = Buffer.alloc(4); l.writeUInt32BE(data.length);
        var tb = Buffer.from(type, 'ascii'), cd = Buffer.concat([tb, data]);
        var cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(cd));
        return Buffer.concat([l, tb, data, cb]);
    }
    var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    var ih = Buffer.alloc(13); ih.writeUInt32BE(16, 0); ih.writeUInt32BE(16, 4);
    ih[8] = 8; ih[9] = 6; ih[10] = 0; ih[11] = 0; ih[12] = 0;
    return nativeImage.createFromBuffer(Buffer.concat([sig, chk('IHDR', ih), chk('IDAT', deflated), chk('IEND', Buffer.alloc(0))]));
}

/**
 * 获取菜单图标
 * @param {string} name 'key'|'dir'|'gear'|'list'|'info'|'doc'
 */
function MenuIcon(name) {
    var draw = DRAW[name];
    if (!draw) return null;
    var rgba = Buffer.alloc(16 * 16 * 4, 0);
    draw(rgba);
    return _MakePng(rgba);
}

module.exports = { MenuIcon };
