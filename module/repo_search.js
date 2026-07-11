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

        // 分批并发获取文件详细信息（限制每次 20 个并发，避免同时拉起大量 git 子进程）
        const MAX_CONCURRENT = 20;
        const result = [];

        for (let i = 0; i < matched.length; i += MAX_CONCURRENT) {
             const batch = matched.slice(i, i + MAX_CONCURRENT);
            const batchResults = await Promise.all(batch.map(async (filePath) => {
                try {
                    const [logRes, sizeRes] = await Promise.all([
                        gitApi._GetGitCommandResult(`log -1 --pretty=format:"%an|%ad" --date=iso -- "${filePath}"`, gitApi.repo_path, false),
                        gitApi._GetGitCommandResult(`cat-file -s HEAD:"${filePath}"`, gitApi.repo_path, false)
                    ]);

                    let author = '', date = '', size = '';
                    if (logRes) {
                        const parts = logRes.split('|');
                        author = parts[0] || '';
                        date = parts[1] || '';
                    }
                    if (sizeRes) {
                        size = MyUnit.FileSizeStr(parseInt(sizeRes) || 0);
                    }

                    return {
                        path: filePath,
                        text: filePath.split('/').pop(),
                        revision: '',
                        author: author,
                        date: date,
                        size: size,
                        fullPath: filePath,
                    };
                } catch (e) {
                    return {
                        path: filePath,
                        text: filePath.split('/').pop(),
                        revision: '',
                        author: '',
                        date: '',
                        size: '',
                        fullPath: filePath,
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
    static async SearchInSvn(svnApi, relativePath, pattern) {
        MyLog.Info(`svn search: path=${relativePath}, pattern=${pattern}`);

        const allFiles = await svnApi.GetLocalFileList(relativePath || '');
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
}

module.exports = RepoSearch;
