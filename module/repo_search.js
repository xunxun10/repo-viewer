const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const MyLog = require('../util/my_log');
const {MyDate, MyUnit} = require('../util/my_util');

/**
 * 仓库文件搜索模块
 * 提供文件名搜索功能，支持 Git（本地 clone）和 SVN（本地 checkout）
 */
class RepoSearch {

    /**
     * 构建搜索正则
     * @param {string} input - 用户输入
     * @param {boolean} isRegex - 是否为正则模式
     * @returns {RegExp|null}
     */
    static BuildPattern(input, isRegex = false) {
        if (!input || !input.trim()) return null;

        if (isRegex) {
            try {
                const re = new RegExp(input, 'i');
                // 简单 ReDoS 检测：如果包含嵌套量词（如 (a+)+ 或 (a|b)+），
                // 警告日志但不阻止（用户自行承担风险）
                if (/(\(\.[*+?]\)|\(.+\)[+*?].*[+*?])/.test(input)) {
                    MyLog.Warn(`pattern may cause catastrophic backtracking: ${input}`);
                }
                return re;
            } catch (e) {
                MyLog.Warn(`invalid regex pattern: ${input}, ${e.message}`);
                return null;
            }
        }

        // 文字模式：空格分割，每个词都必须出现（顺序无关）
        const words = input.trim().split(/\s+/).filter(w => w);
        if (words.length === 0) return null;

        const escaped = words.map(w =>
            w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );

        if (escaped.length === 1) {
            // 单个词：包含匹配
            return new RegExp(escaped[0], 'i');
        }

        // 多词：使用 lookahead 实现顺序无关
        // 例如 "foo bar" → ^(?=.*foo)(?=.*bar).*$
        const lookaheads = escaped.map(w => `(?=.*${w})`).join('');
        return new RegExp(`^${lookaheads}.*$`, 'i');
    }

    /**
     * Git 搜索 - 从本地 clone 中搜索文件
     * @param {object} gitApi - GitCommandApi 实例
     * @param {string} branch - 当前分支
     * @param {string} path - 搜索起始目录路径（相对于仓库根）
     * @param {RegExp} pattern - 编译后的正则
     * @returns {Promise<{matched: array}>}
     */
    static async SearchInGit(gitApi, branch, path, pattern) {
        MyLog.Info(`git search: branch=${branch}, path=${path}, pattern=${pattern}`);

        // git ls-tree -r --name-only <branch> <path> 递归获取所有文件
        let cmd;
        if (path) {
            cmd = `ls-tree -r --name-only ${branch} -- "${path}"`;
        } else {
            cmd = `ls-tree -r --name-only ${branch}`;
        }

        const res = await gitApi._GetGitCommandResult(cmd);
        if (!res) {
            return { matched: [] };
        }

        let allFiles = res.split('\n').filter(line => line.trim());
        MyLog.Debug(`git ls-tree returned ${allFiles.length} files`);

        // 过滤匹配
        const matched = [];
        for (const filePath of allFiles) {
            if (filePath && pattern.test(filePath)) {
                matched.push(filePath);
                if (matched.length >= 1000) break;  // 最多 1000 条
            }
        }

        MyLog.Info(`git search matched ${matched.length} files`);
        const truncated = matched.length >= 1000;

        // 分批并发获取文件大小（限制每次 20 个并发，避免同时拉起大量 git 子进程）
        const MAX_CONCURRENT = 20;
        const result = [];

        for (let i = 0; i < matched.length; i += MAX_CONCURRENT) {
             const batch = matched.slice(i, i + MAX_CONCURRENT);
            const batchResults = await Promise.all(batch.map(async (filePath) => {
                try {
                    const sizeRes = await gitApi._GetGitCommandResult(`cat-file -s HEAD:"${filePath}"`, gitApi.repo_path, false);
                    const size = sizeRes ? MyUnit.FileSizeStr(parseInt(sizeRes) || 0) : '';

                    return {
                        path: filePath,
                        text: filePath.split('/').pop(),
                        size: size,
                    };
                } catch (e) {
                    return {
                        path: filePath,
                        text: filePath.split('/').pop(),
                        size: '',
                    };
                }
            }));
            result.push(...batchResults);
        }

        return { matched: result, truncated };
    }

    /**
     * SVN 搜索 - 从本地 checkout 目录搜索
     * @param {object} svnApi - SvnCommandApi 实例
     * @param {string} relativePath - 搜索起始相对路径
     * @param {RegExp} pattern - 编译后的正则
     * @returns {Promise<{matched: array}>}
     */
    static async SearchInSvn(svnApi, relativePath, pattern, projectRoot) {
        MyLog.Info(`svn search: path=${relativePath}, pattern=${pattern}, projectRoot=${projectRoot}`);

        const allFiles = await svnApi.GetLocalFileList(relativePath || '', projectRoot);
        MyLog.Debug(`svn local file list returned ${allFiles.length} files`);

        // 过滤匹配
        const matched = [];
        for (const file of allFiles) {
            if (file.path && pattern.test(file.path)) {
                matched.push(file);
                if (matched.length >= 500) break;  // 最多 500 条
            }
        }

        MyLog.Info(`svn search matched ${matched.length} files`);
        const truncated = matched.length >= 500;
        return { matched, truncated };
    }

    // ==================== 跨仓库搜索（直接扫描本地缓存目录） ====================

    /**
     * 从 Git 本地仓库的 .git/config 中提取远程仓库 URL
     * @param {string} repoPath - Git 仓库本地路径
     * @returns {string|null}
     */
    static _GetGitRepoUrl(repoPath) {
        const configPath = path.join(repoPath, '.git', 'config');
        if (!fs.existsSync(configPath)) return null;
        try {
            const config = fs.readFileSync(configPath, 'utf8');
            const match = config.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*(.+?)\s*$/m);
            return match ? match[1].trim() : null;
        } catch (e) {
            MyLog.Warn(`failed to read git config: ${configPath}, ${e.message}`);
            return null;
        }
    }

    /**
     * 从 SVN 工作副本中提取项目根 URL（parent of trunk/branches/tags）
     * @param {string} repoPath - SVN 工作副本路径
     * @returns {string|null}
     */
    static _GetSvnRepoUrl(repoPath) {
        const svnDir = path.join(repoPath, '.svn');
        if (!fs.existsSync(svnDir)) return null;

        // 1) 尝试 .svn/entries（SVN 1.6 第一行为 URL）
        const entriesPath = path.join(svnDir, 'entries');
        if (fs.existsSync(entriesPath)) {
            try {
                const content = fs.readFileSync(entriesPath, 'utf8');
                const firstLine = content.split('\n')[0].trim();
                if (firstLine && !/^\d+$/.test(firstLine)) {
                    return this._ExtractSvnProjectRoot(firstLine);
                }
            } catch (e) {
                MyLog.Debug(`failed to read svn entries: ${e.message}`);
            }
        }

        // 2) SVN 1.7+：通过 svn info 获取 URL，再提取项目根
        try {
            const result = child_process.execSync(
                `svn info "${repoPath}"`,
                { encoding: 'utf8', timeout: 10000 }
            );
            const urlMatch = result.match(/^URL:\s*(.+)$/m);
            if (urlMatch) {
                return this._ExtractSvnProjectRoot(urlMatch[1].trim());
            }
        } catch (e) {
            MyLog.Debug(`failed to run svn info for ${repoPath}: ${e.message}`);
        }

        return null;
    }

    /**
     * 从 SVN checkout URL 中提取项目根（parent of trunk/branches/tags）
     * @param {string} url - SVN checkout URL
     * @returns {string}
     */
    static _ExtractSvnProjectRoot(url) {
        const markers = ['/trunk', '/branches/', '/tags/'];
        for (const marker of markers) {
            const idx = url.indexOf(marker);
            if (idx !== -1) {
                return url.substring(0, idx);
            }
        }
        return url;
    }

    /**
     * 获取仓库显示名（从 URL 中提取有意义的项目名）
     * @param {string} repoUrl 
     * @returns {string}
     */
    static _GetRepoDisplayName(repoUrl) {
        if (!repoUrl) return 'unknown';
        // 去除末尾的 .git
        let name = repoUrl.replace(/\.git$/, '');
        // 去除末尾的 /
        name = name.replace(/\/$/, '');
        const parts = name.split('/');
        const last = parts[parts.length - 1] || '';
        // 如果最后一段是 trunk/branches/tags，取上一级作为项目名
        if ((last === 'trunk' || last === 'branches' || last === 'tags') && parts.length >= 2) {
            return parts[parts.length - 2] || last;
        }
        return last || 'unknown';
    }

    /**
     * 递归遍历本地目录，匹配文件路径
     * @param {string} dirPath - 目录路径
     * @param {RegExp} pattern - 编译后的正则
     * @param {string} relativeRoot - 相对于仓库根目录的路径前缀
     * @param {number} maxResults - 当前仓库最大结果数
     * @returns {Array<{path: string, text: string}>}
     */
    static WalkDirectory(dirPath, pattern, relativeRoot = '', excludeDirs = ['.git', '.svn'], maxResults = 200) {
        const results = [];
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (results.length >= maxResults) break;
                const fullPath = path.join(dirPath, entry.name);
                const relativePath = relativeRoot
                    ? relativeRoot.replace(/\\/g, '/') + '/' + entry.name
                    : entry.name;

                if (entry.isDirectory()) {
                    if (excludeDirs.includes(entry.name)) continue;
                    const subResults = this.WalkDirectory(fullPath, pattern, relativePath, excludeDirs, maxResults - results.length);
                    results.push(...subResults);
                } else if (entry.isFile()) {
                    if (pattern.test(relativePath)) {
                        results.push({
                            path: relativePath,
                            text: entry.name,
                        });
                    }
                }
            }
        } catch (e) {
            MyLog.Warn(`walk directory error: ${dirPath}, ${e.message}`);
        }
        return results;
    }

    /**
     * 跨仓库搜索 - 扫描本地缓存目录，搜索所有已缓存仓库的文件
     * @param {string} cacheDir - 缓存根目录
     * @param {RegExp} pattern - 编译后的正则
     * @param {object} [options] - 可选配置
     * @param {number} [options.maxRepos=20] - 最多搜索多少个仓库
     * @param {number} [options.maxPerRepo=200] - 每个仓库最多返回多少条结果
     * @param {number} [options.maxTotal=1000] - 总共最多返回多少条结果
     * @returns {{matched: Array, stats: {scanned: number, found: number, errors: Array<string>}}}
     */
    static SearchCachedRepos(cacheDir, pattern, options = {}) {
        const maxRepos = options.maxRepos || 20;
        const maxPerRepo = options.maxPerRepo || 200;
        const maxTotal = options.maxTotal || 1000;
        const results = [];
        const errors = [];
        let scannedCount = 0;

        if (!fs.existsSync(cacheDir)) {
            MyLog.Warn(`cache dir not found: ${cacheDir}`);
            return { matched: [], stats: { scanned: 0, found: 0, errors: ['缓存目录不存在'] } };
        }

        const entries = fs.readdirSync(cacheDir, { withFileTypes: true });

        for (const entry of entries) {
            if (results.length >= maxTotal) break;
            if (scannedCount >= maxRepos) break;

            const fullPath = path.join(cacheDir, entry.name);
            if (!entry.isDirectory()) continue;

            try {
                let repoUrl = null;

                // 优先尝试读取 .info 文件（缓存根目录下，内容为纯文本 repo_url）
                const entryBaseName = entry.name.replace(/\.svn$/, '');
                const infoFilePath = path.join(cacheDir, entryBaseName + '.info');
                let infoFileExisted = false;
                if (fs.existsSync(infoFilePath)) {
                    try {
                        const content = fs.readFileSync(infoFilePath, 'utf8').trim();
                        if (content) {
                            repoUrl = content;
                            infoFileExisted = true;
                        }
                    } catch (e) {
                        MyLog.Debug(`read info file failed: ${infoFilePath}, ${e.message}`);
                    }
                }

                // fallback: 解析 Git/SVN 元数据
                if (!repoUrl) {
                    const gitDir = path.join(fullPath, '.git');
                    if (fs.existsSync(gitDir)) {
                        repoUrl = this._GetGitRepoUrl(fullPath);
                    }
                }
                if (!repoUrl) {
                    const svnDir = path.join(fullPath, '.svn');
                    if (fs.existsSync(svnDir)) {
                        repoUrl = this._GetSvnRepoUrl(fullPath);
                    }
                }

                // 如果 info 文件不存在但成功从元数据获取到 URL，则回写 info 文件
                if (repoUrl && !infoFileExisted) {
                    try {
                        fs.writeFileSync(infoFilePath, repoUrl, 'utf8');
                        MyLog.Debug(`regenerated info file: ${infoFilePath}`);
                    } catch (e) {
                        MyLog.Debug(`failed to write info file: ${infoFilePath}, ${e.message}`);
                    }
                }

                if (!repoUrl) continue; // 不是可识别的缓存仓库

                const isGit = fs.existsSync(path.join(fullPath, '.git'));

                scannedCount++;
                const repoName = this._GetRepoDisplayName(repoUrl);
                const excludeDirs = isGit ? ['.git'] : ['.svn'];

                const repoResults = this.WalkDirectory(fullPath, pattern, '', excludeDirs, maxPerRepo);

                for (const r of repoResults) {
                    if (results.length >= maxTotal) break;
                    results.push({
                        path: r.path,
                        text: r.text,
                        repo_url: repoUrl,
                        repo_name: repoName,
                    });
                }

                MyLog.Info(`cached repo search: ${repoName}, found ${repoResults.length} files`);
            } catch (e) {
                errors.push(`${entry.name}: ${e.message}`);
                MyLog.Warn(`search cached repo error: ${entry.name}, ${e.message}`);
            }
        }

        return {
            matched: results,
            stats: { scanned: scannedCount, found: results.length, errors },
        };
    }
}

module.exports = RepoSearch;
