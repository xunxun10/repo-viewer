const crypto = require('crypto');
const si = require('systeminformation');
const { safeStorage } = require('electron');
const MyLog = require('./my_log');

class PasswordEncrypt {

    /**
     * 生成硬件指纹密钥（SHA-256）
     * 采集网卡MAC、CPU、系统UUID、主板序列号等硬件信息
     * @returns {Promise<Buffer>} 32 字节密钥
     */
    static async genEncrypKey() {
        // 分别采集各硬件信息，并记录耗时
        var start = Date.now();

        var [net, cpu, sys, board] = await Promise.all([
            PasswordEncrypt._timedQuery('networkInterfaces', () => si.networkInterfaces()),
            PasswordEncrypt._timedQuery('cpu', () => si.cpu()),
            PasswordEncrypt._timedQuery('system', () => si.system()),
            PasswordEncrypt._timedQuery('baseboard', () => si.baseboard()),
        ]);

        // 从 networkInterfaces 中提取 mac,ip4 字段
        var macInfo = net?.map(n => ({ mac: n.mac, ip4: n.ip4 }));

        var fingerprint = {
            mac: macInfo,
            cpu: cpu,
            uuid: sys?.uuid,
            board: board?.serial,
        };

        var total = Date.now() - start;
        MyLog.Info(`[PasswordEncrypt] hardware fingerprint collected, total: ${total}ms`);

        return crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest();
    }

    /**
     * 带耗时日志的 si 查询
     * @param {string} name
     * @param {Function} fn
     */
    static async _timedQuery(name, fn) {
        var start = Date.now();
        try {
            var result = await fn();
            var elapsed = Date.now() - start;
            MyLog.Info(`[PasswordEncrypt] si.${name} took ${elapsed}ms`);
            return result;
        } catch (e) {
            MyLog.Warn(`[PasswordEncrypt] si.${name} failed: ${e.message}`);
            return null;
        }
    }

    /**
     * safeStorage 是否可用
     * @returns {boolean}
     */
    static isSafeStorageAvailable() {
        return safeStorage.isEncryptionAvailable();
    }

    /**
     * 使用硬件指纹 AES-256-GCM 加密
     * @param {string} plaintext 明文
     * @param {Buffer} key 32 字节密钥
     * @returns {string} base64(IV + AuthTag + Ciphertext)
     */
    static hwEncrypt(plaintext, key) {
        const iv = crypto.randomBytes(12);  // GCM 推荐 12 字节 IV
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    }

    /**
     * 使用硬件指纹 AES-256-GCM 解密
     * @param {string} encoded base64(IV + AuthTag + Ciphertext)
     * @param {Buffer} key 32 字节密钥
     * @returns {string}
     */
    static hwDecrypt(encoded, key) {
        const buf = Buffer.from(encoded, 'base64');
        const iv = buf.subarray(0, 12);
        const authTag = buf.subarray(12, 28);
        const encrypted = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    }

    /**
     * 加密密码：优先 safeStorage，降级硬件指纹 AES-256-GCM
     * @param {string} password 明文密码
     * @param {Buffer} [hwKey] 硬件指纹密钥（32 字节）
     * @returns {{ encrypted: string, encryptType: string }}
     */
    static encrypt(password, hwKey) {
        if (safeStorage.isEncryptionAvailable()) {
            return {
                encrypted: safeStorage.encryptString(password).toString('base64'),
                encryptType: 'safe_storage',
            };
        } else if (hwKey) {
            return {
                encrypted: PasswordEncrypt.hwEncrypt(password, hwKey),
                encryptType: 'hw_fingerprint',
            };
        } else {
            return {
                encrypted: password,
                encryptType: 'plain',
            };
        }
    }

    /**
     * 解密密码：根据 encryptType 选择方式
     * @param {string} encoded 加密后的数据
     * @param {string} encryptType 加密类型
     * @param {Buffer} [hwKey] 硬件指纹密钥
     * @returns {string|null} 解密成功返回明文，失败返回 null
     */
    static decrypt(encoded, encryptType, hwKey) {
        if (!encoded) return null;

        if (encryptType === 'safe_storage') {
            if (safeStorage.isEncryptionAvailable()) {
                return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
            }
            return null;  // safeStorage 不可用
        } else if (encryptType === 'hw_fingerprint') {
            if (hwKey) {
                return PasswordEncrypt.hwDecrypt(encoded, hwKey);
            }
            return null;  // 硬件指纹密钥缺失
        }
        // encryptType 缺失或为 'plain' — 按明文处理
        return encoded;
    }
}

module.exports = PasswordEncrypt;
