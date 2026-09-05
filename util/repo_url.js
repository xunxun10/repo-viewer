/**
 * 仓库 URL 工具：主机:端口解析与仓库类型判断
 * 凭据按主机名+端口绑定存储，以此作为凭据的唯一 key
 */
class RepoUrl {

    /**
     * 解析仓库 URL 的主机名[:端口]，用于凭据按主机绑定
     * 支持 http(s)://、svn://、ssh:// 以及 git@host:path 形式
     * 无显式端口时仅返回主机名，显式端口时返回 "host:port"
     * @param {string} repo_url
     * @returns {string|null} 解析失败返回 null
     */
    static GetHostPort(repo_url) {
        if (!repo_url) return null;
        repo_url = String(repo_url).trim();
        if (!repo_url) return null;

        // scp-like git 地址：git@github.com:org/repo.git 或 git@host:/abs/path
        var scp = repo_url.match(/^([^@/]+)@([^:]+):/);
        if (scp) {
            return scp[2];
        }

        try {
            var u = new URL(repo_url);
            if (!u.hostname) return null;
            if (u.port) return u.hostname + ':' + u.port;
            return u.hostname;
        } catch (e) {
            return null;
        }
    }

    /**
     * 判断仓库类型：svn 或 git
     * @param {string} repo_url
     * @returns {string}
     */
    static GetRepoType(repo_url) {
        if (!repo_url) return 'svn';
        if (repo_url.endsWith('.git') || repo_url.includes('git@') || repo_url.includes('.git/')) {
            return 'git';
        }
        return 'svn';
    }
}

module.exports = RepoUrl;